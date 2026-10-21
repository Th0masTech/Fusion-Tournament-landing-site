// POST /api/signup: someone signs up on the homepage and lands in the game(s) they picked.
import {
  MAX_PLAYERS, MAX_GAMES, HttpError, json, respond, transaction, bumpRevision, cleanText, tagKey, newId,
} from "../lib/core.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const and = (names) => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);

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
    const picked = [...new Set((Array.isArray(body.games) ? body.games : []).map(String))].slice(0, MAX_GAMES);
    if (tag.length < 2) throw new HttpError(400, "Enter a gamer tag (at least 2 characters).");
    if (name.length < 2) throw new HttpError(400, "Enter your real name.");
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (!picked.length) throw new HttpError(400, "Pick at least one tournament.");

    return transaction(async (client) => {
      const games = (await client.query(
        "SELECT game, name, status FROM brackets WHERE game = ANY($1::text[]) ORDER BY sort, game FOR UPDATE", [picked]
      )).rows;
      if (games.length !== picked.length) {
        throw new HttpError(409, "One of those tournaments isn't on the list anymore. Refresh the page and pick again.");
      }
      const closed = games.filter((g) => g.status !== "setup").map((g) => g.name);
      if (closed.length) {
        throw new HttpError(409, `Sign-ups for ${and(closed)} closed when the bracket started. Talk to an organizer at the venue.`);
      }
      const counts = (await client.query(
        "SELECT game, COUNT(*)::int AS n FROM entries WHERE game = ANY($1::text[]) AND NOT removed GROUP BY game", [picked]
      )).rows;
      const full = games.filter((g) => counts.some((c) => c.game === g.game && c.n >= MAX_PLAYERS)).map((g) => g.name);
      if (full.length) throw new HttpError(409, `${and(full)} ${full.length > 1 ? "are" : "is"} full.`);

      const id = newId("p");
      await client.query(
        "INSERT INTO players (id, tag, real_name, email, source) VALUES ($1, $2, $3, $4, 'form')", [id, tag, name, email]
      );
      for (const g of games) {
        try {
          await client.query("INSERT INTO entries (game, player_id, tag_key) VALUES ($1, $2, $3)", [g.game, id, tagKey(tag)]);
        } catch (err) {
          if (err && err.code === "23505") {
            throw new HttpError(409, `“${tag}” is already signed up for ${g.name}. If that's you, you're all set. If not, add a number or initial to your tag.`);
          }
          throw err;
        }
      }
      await bumpRevision(client);
      return json({ ok: true, player: { id, tag }, games: games.map((g) => ({ game: g.game, name: g.name })) });
    });
  });

export const config = { path: "/api/signup", method: ["POST"] };
