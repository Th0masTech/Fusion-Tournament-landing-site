// GET /api/state: every bracket, its players (gamer tags only), results and called matches.
// Cached at Netlify's edge for 2 seconds so a room full of phones polling it stays cheap.
import { json, respond, withClient, loadState } from "../lib/core.mjs";

export default async () =>
  respond(async () => {
    const state = await withClient(loadState);
    return json(state, 200, {
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, s-maxage=2, stale-while-revalidate=4",
    });
  });

export const config = { path: "/api/state", method: ["GET"] };
