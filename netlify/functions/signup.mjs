// POST /api/signup: someone signs up on the homepage and lands in the bracket(s) they picked.
import {
  GAMES, MAX_PLAYERS, HttpError, json, respond, transaction, bumpRevision, cleanText, tagKey, newId,
} from "../lib/core.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async (req) =>
  respond(async () => {
    let body;
    try {
      body = await req.json();
    } catch (_) {
      throw new HttpError(400, "Send the sign-up form as JSON.");
    }
    body = body || {};
    // Hidden field that people never see; bots fill it in.
    if (body.company) return json({ ok: true, games: [] });

    const tag = cleanText(body.tag, 24);
    const name = cleanText(body.name, 60);
    const email = cleanText(body.email, 120).toLowerCase();
    const games = [...new Set((Array.isArray(body.games) ? body.games : []).filter((g) => Object.hasOwn(GAMES, g)))];
    if (tag.length < 2) throw new HttpError(400, "Enter a gamer tag (at least 2 characters).");
    if (name.length < 2) throw new HttpError(400, "Enter your real name.");
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (!games.length) throw new HttpError(400, "Pick at least one tournament.");

    return transaction(async (client) => {
      const brackets = (await client.query(
        "SELECT game, status FROM brackets WHERE game = ANY($1::text[]) ORDER BY game FOR UPDATE", [games]
      )).rows;
      const closed = brackets.filter((b) => b.status !== "setup").map((b) => GAMES[b.game]);
      if (closed.length) {
        throw new HttpError(409, `Sign-ups for ${closed.join(" and ")} closed when the bracket started. Talk to an organizer at the venue.`);
      }
      const counts = (await client.query(
        "SELECT game, COUNT(*)::int AS n FROM entries WHERE game = ANY($1::text[]) AND NOT removed GROUP BY game", [games]
      )).rows;
      const full = counts.filter((c) => c.n >= MAX_PLAYERS).map((c) => GAMES[c.game]);
      if (full.length) throw new HttpError(409, `${full.join(" and ")} is full.`);

      const id = newId("p");
      await client.query(
        "INSERT INTO players (id, tag, real_name, email, source) VALUES ($1, $2, $3, $4, 'form')", [id, tag, name, email]
      );
      for (const game of games) {
        try {
          await client.query("INSERT INTO entries (game, player_id, tag_key) VALUES ($1, $2, $3)", [game, id, tagKey(tag)]);
        } catch (err) {
          if (err && err.code === "23505") {
            throw new HttpError(409, `“${tag}” is already signed up for ${GAMES[game]}. If that's you, you're all set. If not, add a number or initial to your tag.`);
          }
          throw err;
        }
      }
      await bumpRevision(client);
      return json({ ok: true, player: { id, tag }, games });
    });
  });

export const config = { path: "/api/signup", method: ["POST"] };
