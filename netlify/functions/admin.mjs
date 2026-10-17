// Organizer API, behind the shared password in FUSION_ADMIN_PASSWORD.
//   POST /api/admin/check    check the password
//   GET  /api/admin/players  everyone who signed up, with real names, emails and paid status
//   POST /api/admin/op       one change: { op, game, ... }
import {
  Engine, GAMES, MAX_PLAYERS, HttpError, json, respond, withClient, transaction, bumpRevision, loadState,
  engineBracket, pruneStale, requireOrganizer, listPlayers, cleanText, tagKey, newId,
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
  const game = body.game;

  return transaction(async (client) => {
    let br = null;
    if (game !== undefined && game !== null) {
      if (!Object.hasOwn(GAMES, game)) throw new HttpError(400, "Unknown game.");
      br = (await client.query(
        "SELECT game, status, reset, seeds FROM brackets WHERE game = $1 FOR UPDATE", [game]
      )).rows[0];
    }
    const needGame = () => { if (!br) throw new HttpError(400, "Say which game this change is for."); };
    const needSetup = () => {
      needGame();
      if (br.status !== "setup") throw new HttpError(409, `${GAMES[game]} has already started. Go back to setup first.`);
    };
    const needLive = () => {
      needGame();
      if (br.status !== "live") throw new HttpError(409, `${GAMES[game]} hasn't started yet.`);
    };
    const engineView = async () => {
      const state = await loadState(client);
      return Engine.run(engineBracket(state.brackets.find((b) => b.game === game)));
    };
    const uniqueTag = (message) => (err) => {
      if (err && err.code === "23505") throw new HttpError(409, message);
      throw err;
    };

    switch (op) {
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
        if (n >= MAX_PLAYERS) throw new HttpError(409, `${GAMES[game]} is full.`);
        const id = newId("p");
        await client.query(
          "INSERT INTO players (id, tag, real_name, source) VALUES ($1, $2, $3, 'walk-in')", [id, tag, cleanText(body.name, 60) || null]
        );
        await client.query("INSERT INTO entries (game, player_id, tag_key) VALUES ($1, $2, $3)", [game, id, tagKey(tag)])
          .catch(uniqueTag(`“${tag}” is already in ${GAMES[game]}.`));
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
        if (ids.length < 2) throw new HttpError(409, "A bracket needs at least 2 players.");
        await client.query("DELETE FROM results WHERE game = $1", [game]);
        await client.query("DELETE FROM calls WHERE game = $1", [game]);
        await client.query(
          "UPDATE brackets SET status = 'live', seeds = $2::jsonb, started_at = NOW() WHERE game = $1", [game, JSON.stringify(ids)]
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
        await client.query("UPDATE brackets SET status = 'setup', seeds = '[]'::jsonb, started_at = NULL WHERE game = $1", [game]);
        break;
      }
      case "reset": {
        needGame();
        if (br.status === "live") {
          const D = await engineView();
          if (D.out.GF1 && D.out.GF1.status === "done") {
            throw new HttpError(409, "The Grand Final already has a result, so bracket reset is locked.");
          }
        }
        await client.query("UPDATE brackets SET reset = $2 WHERE game = $1", [game, !!body.on]);
        if (br.status === "live") await pruneStale(client, game);
        break;
      }
      case "result":
      case "clear":
      case "call":
      case "uncall": {
        needLive();
        const mid = String(body.matchId || "");
        const D = await engineView();
        const m = D.st.M[mid], o = D.out[mid];
        if (!m || m.auto || !o) throw new HttpError(404, "That match isn't in the bracket.");
        if (op === "result") {
          if (["ready", "live", "done"].indexOf(o.status) < 0) throw new HttpError(409, "That match is still waiting on an earlier result.");
          const a = o.slots[0].p, b = o.slots[1].p, w = String(body.winner || "");
          if (w !== a && w !== b) throw new HttpError(400, "Pick one of the two players as the winner.");
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
    return { ok: true, state: await loadState(client), players: await listPlayers(client) };
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
