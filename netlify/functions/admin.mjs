// Organizer API, behind the shared password in FUSION_ADMIN_PASSWORD.
//   POST /api/admin/check    check the password
//   GET  /api/admin/players  everyone who signed up, with real names, emails and paid status
//   POST /api/admin/op       one change: { op, game, ... }
import {
  Engine, COLORS, MAX_PLAYERS, MAX_GAMES, SETTING_KEYS, HttpError, json, respond, withClient, transaction,
  bumpRevision, loadState, engineBracket, pruneStale, requireOrganizer, listPlayers, cleanText, cleanSetting,
  tagKey, newId, slugify,
} from "../lib/core.mjs";

const score = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new HttpError(400, "Scores must be whole numbers from 0 to 99.");
  return n;
};
const SET_SEEDS = `UPDATE entries e SET seed = o.n
                     FROM unnest($2::text[]) WITH ORDINALITY AS o(id, n)
                    WHERE e.game = $1 AND e.player_id = o.id`;

async function runOp(body) {
  const op = String(body.op || "");
  const game = body.game === undefined || body.game === null || body.game === "" ? null : String(body.game);

  return transaction(async (client) => {
    let br = null;
    if (game !== null) {
      br = (await client.query(
        "SELECT game, name, status, format, settings, seeds FROM brackets WHERE game = $1 FOR UPDATE", [game]
      )).rows[0];
      if (!br) throw new HttpError(404, "That game isn't on the list anymore. Refresh the page.");
      br.settings = br.settings && typeof br.settings === "object" ? br.settings : {};
    }
    const needGame = () => { if (!br) throw new HttpError(400, "Say which game this change is for."); };
    const needSetup = () => {
      needGame();
      if (br.status !== "setup") throw new HttpError(409, `${br.name} has already started. Go back to sign-ups first.`);
    };
    const needLive = () => {
      needGame();
      if (br.status !== "live") throw new HttpError(409, `${br.name} hasn't started yet.`);
    };
    const engineView = async () => {
      const state = await loadState(client);
      return Engine.run(engineBracket(state.brackets.find((b) => b.game === game)));
    };
    const uniqueTag = (message) => (err) => {
      if (err && err.code === "23505") throw new HttpError(409, message);
      throw err;
    };
    const gameName = (value) => {
      const name = cleanText(value, 40);
      if (name.length < 2) throw new HttpError(400, "Game names need at least 2 characters.");
      return name;
    };
    let created = null;

    switch (op) {
      case "game-add": {
        const name = gameName(body.name);
        const rows = (await client.query("SELECT game, name, color, sort FROM brackets ORDER BY sort FOR UPDATE")).rows;
        if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `There's already a game called “${name}”.`);
        if (rows.length >= MAX_GAMES) throw new HttpError(409, `The site runs up to ${MAX_GAMES} games at once. Delete one first.`);
        const used = new Set(rows.map((r) => r.color));
        const color = COLORS.find((c) => !used.has(c)) || COLORS[rows.length % COLORS.length];
        const sort = rows.reduce((max, r) => Math.max(max, r.sort), 0) + 1;
        created = slugify(name, rows.map((r) => r.game));
        await client.query("INSERT INTO brackets (game, name, sort, color) VALUES ($1, $2, $3, $4)", [created, name, sort, color]);
        break;
      }
      case "game-edit": {
        needGame();
        const sets = [], vals = [game];
        if (body.name !== undefined) {
          const name = gameName(body.name);
          const clash = await client.query("SELECT 1 FROM brackets WHERE game <> $1 AND lower(name) = lower($2)", [game, name]);
          if (clash.rowCount) throw new HttpError(409, `There's already a game called “${name}”.`);
          vals.push(name);
          sets.push(`name = $${vals.length}`);
        }
        if (body.color !== undefined) {
          if (!COLORS.includes(body.color)) throw new HttpError(400, "Pick one of the listed colours.");
          vals.push(body.color);
          sets.push(`color = $${vals.length}`);
        }
        if (!sets.length) throw new HttpError(400, "Nothing to change.");
        await client.query(`UPDATE brackets SET ${sets.join(", ")} WHERE game = $1`, vals);
        break;
      }
      case "game-remove": {
        needSetup();
        // Sign-ups, results and called matches go with it (ON DELETE CASCADE).
        await client.query("DELETE FROM brackets WHERE game = $1", [game]);
        // Anyone who was only signed up for this game is removed entirely.
        await client.query("DELETE FROM players p WHERE NOT EXISTS (SELECT 1 FROM entries e WHERE e.player_id = p.id)");
        break;
      }
      case "format": {
        needGame();
        const live = br.status === "live";
        let format = br.format;
        if (body.format !== undefined) {
          if (live) throw new HttpError(409, `${br.name} has already started. Go back to sign-ups to change its format.`);
          if (!Engine.FORMATS.includes(body.format)) throw new HttpError(400, "Unknown format.");
          format = body.format;
        }
        const input = body.settings && typeof body.settings === "object" ? body.settings : {};
        const next = { ...br.settings };
        for (const [key, value] of Object.entries(input)) {
          if (!SETTING_KEYS.includes(key)) throw new HttpError(400, "Unknown setting.");
          next[key] = cleanSetting(key, value);
        }
        if (live) {
          const D = await engineView();
          for (const key of Object.keys(input)) {
            const resetApplies = format === "double" || (format === "groups" && D.plan.ko === "double");
            if (key === "reset" && resetApplies) {
              if (D.out.GF1 && D.out.GF1.status === "done") throw new HttpError(409, "The Grand Final already has a result, so bracket reset is locked.");
            } else if (key === "rounds" && format === "swiss") {
              const paired = D.rounds.filter((r) => r.paired).length;
              const p = Engine.plan(format, next, D.players.length);
              if (p.problems.length) throw new HttpError(409, p.problems[0]);
              if (p.rounds < paired) throw new HttpError(409, `Round ${paired} is already under way, so this needs at least ${paired} rounds.`);
            } else {
              throw new HttpError(409, `${br.name} has already started. Go back to sign-ups to change that.`);
            }
          }
        }
        await client.query("UPDATE brackets SET format = $2, settings = $3::jsonb WHERE game = $1", [game, format, JSON.stringify(next)]);
        if (live) await pruneStale(client, game);
        break;
      }
      case "paid": {
        const r = await client.query("UPDATE players SET paid = $2 WHERE id = $1", [String(body.playerId), !!body.paid]);
        if (!r.rowCount) throw new HttpError(404, "That player isn't on the list.");
        break;
      }
      case "rename": {
        const tag = cleanText(body.tag, 24);
        if (tag.length < 2) throw new HttpError(400, "Gamer tags need at least 2 characters.");
        const pid = String(body.playerId);
        const r = await client.query("UPDATE players SET tag = $2 WHERE id = $1", [pid, tag]);
        if (!r.rowCount) throw new HttpError(404, "That player isn't on the list.");
        await client.query("UPDATE entries SET tag_key = $2 WHERE player_id = $1", [pid, tagKey(tag)])
          .catch(uniqueTag(`Someone else in that game already uses “${tag}”.`));
        break;
      }
      case "remove":
      case "restore": {
        needSetup();
        const r = await client.query(
          "UPDATE entries SET removed = $3 WHERE game = $1 AND player_id = $2", [game, String(body.playerId), op === "remove"]
        ).catch(uniqueTag("Another player in this game already uses that tag. Rename one of them first."));
        if (!r.rowCount) throw new HttpError(404, "That player isn't signed up for this game.");
        break;
      }
      case "walkin": {
        needSetup();
        const tag = cleanText(body.tag, 24);
        if (tag.length < 2) throw new HttpError(400, "Gamer tags need at least 2 characters.");
        const n = (await client.query("SELECT COUNT(*)::int AS n FROM entries WHERE game = $1 AND NOT removed", [game])).rows[0].n;
        if (n >= MAX_PLAYERS) throw new HttpError(409, `${br.name} is full.`);
        const id = newId("p");
        await client.query(
          "INSERT INTO players (id, tag, real_name, source) VALUES ($1, $2, $3, 'walk-in')", [id, tag, cleanText(body.name, 60) || null]
        );
        await client.query("INSERT INTO entries (game, player_id, tag_key) VALUES ($1, $2, $3)", [game, id, tagKey(tag)])
          .catch(uniqueTag(`“${tag}” is already in ${br.name}.`));
        break;
      }
      case "late": {
        // Someone joins after the bracket started: a new walk-in (tag) or someone already
        // on the list (playerId), e.g. signed up for another game or removed before the start.
        needLive();
        const seeds = Array.isArray(br.seeds) ? br.seeds.map(String) : [];
        if (seeds.length >= MAX_PLAYERS) throw new HttpError(409, `${br.name} is full.`);
        let pid, tag, known = null;
        if (body.playerId) {
          pid = String(body.playerId);
          known = (await client.query("SELECT id, tag FROM players WHERE id = $1", [pid])).rows[0];
          if (!known) throw new HttpError(404, "That player isn't on the list.");
          tag = known.tag;
          if (seeds.includes(pid)) throw new HttpError(409, `${tag} is already in ${br.name}.`);
        } else {
          tag = cleanText(body.tag, 24);
          if (tag.length < 2) throw new HttpError(400, "Gamer tags need at least 2 characters.");
          pid = newId("p");
        }
        const pb = (await loadState(client)).brackets.find((b) => b.game === game);
        if (pb.players.some((p) => tagKey(p.tag) === tagKey(tag))) throw new HttpError(409, `“${tag}” is already in ${br.name}.`);
        // The engine decides where they fit without undoing anything already played.
        const entry = Engine.lateEntry(engineBracket(pb), { group: body.group ? String(body.group) : undefined });
        if (!entry.ok) throw new HttpError(409, entry.reason);
        if (known) {
          if (body.paid) await client.query("UPDATE players SET paid = TRUE WHERE id = $1", [pid]);
        } else {
          await client.query(
            "INSERT INTO players (id, tag, real_name, source, paid) VALUES ($1, $2, $3, 'walk-in', $4)",
            [pid, tag, cleanText(body.name, 60) || null, !!body.paid]
          );
        }
        await client.query(
          `INSERT INTO entries (game, player_id, tag_key) VALUES ($1, $2, $3)
           ON CONFLICT (game, player_id) DO UPDATE SET removed = FALSE, tag_key = EXCLUDED.tag_key`,
          [game, pid, tagKey(tag)]
        ).catch(uniqueTag(`“${tag}” is already in ${br.name}.`));
        await client.query(
          "UPDATE brackets SET seeds = seeds || to_jsonb($2::text), late = late || jsonb_build_object($2::text, $3::jsonb) WHERE game = $1",
          [game, pid, JSON.stringify(entry.late)]
        );
        await pruneStale(client, game);
        created = pid;
        break;
      }
      case "seed": {
        needSetup();
        const order = Array.isArray(body.order) ? body.order.map(String).slice(0, 500) : [];
        await client.query("UPDATE entries SET seed = NULL WHERE game = $1", [game]);
        if (order.length) await client.query(SET_SEEDS, [game, order]);
        break;
      }
      case "start": {
        needSetup();
        const ids = (await client.query(
          "SELECT player_id FROM entries WHERE game = $1 AND NOT removed ORDER BY seed NULLS LAST, created_at, player_id", [game]
        )).rows.map((r) => r.player_id);
        const p = Engine.plan(br.format, br.settings, ids.length);
        if (p.problems.length) throw new HttpError(409, p.problems[0]);
        await client.query("DELETE FROM results WHERE game = $1", [game]);
        await client.query("DELETE FROM calls WHERE game = $1", [game]);
        await client.query(
          "UPDATE brackets SET status = 'live', seeds = $2::jsonb, late = '{}'::jsonb, started_at = NOW() WHERE game = $1", [game, JSON.stringify(ids)]
        );
        break;
      }
      case "reopen": {
        needLive();
        const ids = Array.isArray(br.seeds) ? br.seeds.map(String) : [];
        await client.query("UPDATE entries SET seed = NULL WHERE game = $1", [game]);
        if (ids.length) await client.query(SET_SEEDS, [game, ids]);
        await client.query("DELETE FROM results WHERE game = $1", [game]);
        await client.query("DELETE FROM calls WHERE game = $1", [game]);
        // Late entrants stay signed up, at the bottom of the seed list.
        await client.query("UPDATE brackets SET status = 'setup', seeds = '[]'::jsonb, late = '{}'::jsonb, started_at = NULL WHERE game = $1", [game]);
        break;
      }
      case "result":
      case "clear":
      case "call":
      case "uncall": {
        needLive();
        const mid = String(body.matchId || "");
        const D = await engineView();
        const m = D.M[mid], o = D.out[mid];
        if (!m || m.auto || !o) throw new HttpError(404, "That match isn't in the bracket.");
        if (op === "result") {
          if (["ready", "live", "done"].indexOf(o.status) < 0) throw new HttpError(409, "That match is still waiting on an earlier result.");
          const a = o.slots[0].p, b = o.slots[1].p;
          const draw = body.draw === true;
          if (draw && !m.draws) throw new HttpError(400, "This match can't end in a draw.");
          const w = draw ? null : String(body.winner || "");
          if (!draw && w !== a && w !== b) throw new HttpError(400, "Pick one of the two players as the winner.");
          await client.query(
            `INSERT INTO results (game, match_id, a, b, w, sa, sb, t) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (game, match_id) DO UPDATE
               SET a = EXCLUDED.a, b = EXCLUDED.b, w = EXCLUDED.w, sa = EXCLUDED.sa, sb = EXCLUDED.sb, t = EXCLUDED.t`,
            [game, mid, a, b, w, score(body.sa), score(body.sb)]
          );
          await client.query("DELETE FROM calls WHERE game = $1 AND match_id = $2", [game, mid]);
        } else if (op === "clear") {
          await client.query("DELETE FROM results WHERE game = $1 AND match_id = $2", [game, mid]);
        } else if (op === "call") {
          if (o.status !== "ready" && o.status !== "live") throw new HttpError(409, "Only a match that's ready can be called to a setup.");
          await client.query(
            `INSERT INTO calls (game, match_id, setup, t) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (game, match_id) DO UPDATE SET setup = EXCLUDED.setup, t = EXCLUDED.t`,
            [game, mid, cleanText(body.setup, 12)]
          );
        } else {
          await client.query("DELETE FROM calls WHERE game = $1 AND match_id = $2", [game, mid]);
        }
        await pruneStale(client, game);
        break;
      }
      default:
        throw new HttpError(400, "Unknown change.");
    }

    await bumpRevision(client);
    return { ok: true, created, state: await loadState(client), players: await listPlayers(client) };
  });
}

export default async (req) =>
  respond(async () => {
    const route = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
    await requireOrganizer(req);
    if (route === "check" && req.method === "POST") return json({ ok: true });
    if (route === "players" && req.method === "GET") return json({ players: await withClient(listPlayers) });
    if (route === "op" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch (_) {
        throw new HttpError(400, "Send the change as JSON.");
      }
      return json(await runOp(body || {}));
    }
    throw new HttpError(404, "Unknown organizer request.");
  });

export const config = { path: ["/api/admin/check", "/api/admin/players", "/api/admin/op"] };
