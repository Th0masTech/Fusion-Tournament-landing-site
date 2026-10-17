// Shared server code for the Fusion sign-up and bracket API.
import { getDatabase } from "@netlify/database";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import Engine from "../../js/bracket-engine.js";

export { Engine };
export const GAMES = { smash: "Smash Ultimate", fc: "FC 27" };
export const MAX_PLAYERS = 128;

// One database client per function instance, created on first use.
let database = null;
function db() {
  if (!database) database = getDatabase();
  return database;
}

export function env(key) {
  const fromNetlify = globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get(key) : undefined;
  return fromNetlify !== undefined ? fromNetlify : process.env[key];
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// Turns thrown errors into the JSON shape the pages expect.
export async function respond(work) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err && err.name === "MissingDatabaseConnectionError") {
      return json({ error: "The sign-up database isn't set up yet. Deploy the site on Netlify so it can create one." }, 503);
    }
    console.error(err);
    return json({ error: "Something went wrong on our side. Try again in a moment." }, 500);
  }
}

export function newId(prefix) {
  return prefix + randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
}

export function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
export function tagKey(tag) {
  return cleanText(tag, 24).toLowerCase();
}

function isConnectionError(err) {
  if (!err) return false;
  if (err.code && /^(08|57P0)/.test(err.code)) return true;
  return !err.code && /terminat|ECONNRESET|socket|closed|timeout/i.test(String(err.message || ""));
}

// Runs fn with a pooled connection. Retries once if the connection itself drops.
export async function withClient(fn) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let client;
    try {
      client = await db().pool.connect();
    } catch (err) {
      if (err && err.name === "MissingDatabaseConnectionError") throw err;
      lastErr = err;
      continue;
    }
    let broken = false;
    try {
      return await fn(client);
    } catch (err) {
      broken = isConnectionError(err);
      if (!broken || attempt === 1) throw err;
      lastErr = err;
    } finally {
      client.release(broken ? true : undefined);
    }
  }
  throw lastErr;
}

export function transaction(fn) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) { /* connection already gone */ }
      throw err;
    }
  });
}

export async function bumpRevision(client) {
  await client.query("UPDATE meta SET rev = rev + 1, updated_at = NOW() WHERE id = 1");
}

const iso = (t) => (t ? new Date(t).toISOString() : null);

// The public picture of every bracket. Real names and emails never leave through here.
export async function loadState(client) {
  const meta = (await client.query("SELECT rev, updated_at FROM meta WHERE id = 1")).rows[0] || { rev: 0, updated_at: null };
  const brackets = (await client.query("SELECT game, name, status, reset, seeds, started_at FROM brackets ORDER BY sort, game")).rows;
  const tags = (await client.query("SELECT id, tag FROM players")).rows;
  const entries = (await client.query(
    "SELECT game, player_id FROM entries WHERE NOT removed ORDER BY game, seed NULLS LAST, created_at, player_id"
  )).rows;
  const results = (await client.query("SELECT game, match_id, a, b, w, sa, sb, t FROM results")).rows;
  const calls = (await client.query("SELECT game, match_id, setup, t FROM calls")).rows;

  const tagOf = {};
  tags.forEach((p) => { tagOf[p.id] = p.tag; });
  return {
    rev: Number(meta.rev),
    updatedAt: iso(meta.updated_at),
    brackets: brackets.map((b) => {
      const ids = b.status === "live"
        ? (Array.isArray(b.seeds) ? b.seeds : [])
        : entries.filter((e) => e.game === b.game).map((e) => e.player_id);
      const res = {};
      results.filter((r) => r.game === b.game).forEach((r) => {
        res[r.match_id] = { a: r.a, b: r.b, w: r.w, sa: r.sa, sb: r.sb, t: iso(r.t) };
      });
      const live = {};
      calls.filter((c) => c.game === b.game).forEach((c) => { live[c.match_id] = { setup: c.setup, t: iso(c.t) }; });
      return {
        game: b.game,
        name: b.name,
        status: b.status,
        reset: b.reset,
        startedAt: iso(b.started_at),
        players: ids.map((id) => ({ id, tag: tagOf[id] || "?" })),
        results: b.status === "live" ? res : {},
        live: b.status === "live" ? live : {},
      };
    }),
  };
}

// The bracket in the shape the engine reads.
export function engineBracket(publicBracket) {
  return {
    players: publicBracket.players.map((p) => ({ id: p.id, name: p.tag })),
    results: publicBracket.results,
    live: publicBracket.live,
    reset: publicBracket.reset,
  };
}

// Drops results and calls that no longer fit the bracket (an earlier result changed).
export async function pruneStale(client, game) {
  for (let i = 0; i < 6; i++) {
    const state = await loadState(client);
    const b = state.brackets.find((x) => x.game === game);
    if (!b || b.status !== "live") return;
    const D = Engine.run(engineBracket(b));
    if (!D.stale.length && !D.staleLive.length) return;
    if (D.stale.length) await client.query("DELETE FROM results WHERE game = $1 AND match_id = ANY($2::text[])", [game, D.stale]);
    if (D.staleLive.length) await client.query("DELETE FROM calls WHERE game = $1 AND match_id = ANY($2::text[])", [game, D.staleLive]);
  }
}

// Organizer password check (constant time). Wrong guesses are slowed down.
export async function requireOrganizer(req) {
  const expected = env("FUSION_ADMIN_PASSWORD");
  if (!expected) throw new HttpError(503, "No organizer password is set. Add FUSION_ADMIN_PASSWORD in Netlify, then redeploy.");
  const given = req.headers.get("x-fusion-key") || "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!given || !timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, "That organizer password isn't right.");
  }
}

export async function listPlayers(client) {
  const rows = (await client.query(
    `SELECT p.id, p.tag, p.real_name, p.email, p.source, p.paid, p.created_at,
            COALESCE(json_agg(json_build_object('game', e.game, 'removed', e.removed, 'seed', e.seed))
                     FILTER (WHERE e.game IS NOT NULL), '[]') AS entries
       FROM players p LEFT JOIN entries e ON e.player_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at, p.id`
  )).rows;
  return rows.map((p) => ({
    id: p.id, tag: p.tag, name: p.real_name || "", email: p.email || "", source: p.source, paid: p.paid,
    createdAt: iso(p.created_at), entries: p.entries,
  }));
}
