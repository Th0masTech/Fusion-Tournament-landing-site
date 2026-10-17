# Fusion Tournament site (redesign)

Redesigned version of [fusion.deets.technology](https://fusion.deets.technology/), kept separate from the
live site and its original repo. Nothing here is deployed.

## What changed

- New look built from the Fusion logo's colours (neon pink and cyan on deep violet), with the big logo as the
  hero and registration laid out as a ticket.
- Works properly on phones (viewport set, real slide-out menu, no sideways scrolling).
- Intro: the Fusion teaser plays full screen on a first visit. During the logo burst the site fades in behind it
  and the teaser's logo glides onto the site's logo. Skippable, once per visit, and skipped for reduced motion
  or a slow connection.
- Rules page laid out like a game settings screen, with a note that rules may change on the day.
- Game updated to FC 27; duplicate "Games" menu link removed.
- Gameplay section with the official Super Smash Bros. Ultimate and EA SPORTS FC 27 trailers, embedded
  from YouTube (replacing the previous-tournament clips).
- One registration background for every screen size (phones used to download a separate 58 MB image).
- Sign-up form on the homepage that feeds a live double-elimination bracket page (see below).

## Files not in this repo

These are on the live web host and need to be copied in before deploying from this repo:

- `vid/SSYouTube.online_Super Smash Bros. Ultimate -  Everyone is Here! (Live Wallpaper)_1080p.mp4`
- `img/967393.jpg` (registration background)

## Sign-ups and the live bracket

People sign up in the Registration section of the homepage: gamer tag, real name, email, and which
tournaments (Smash Ultimate, FC 27, or both). Their gamer tag appears on the new **Bracket** page straight away.
Paying still happens through the Square link, which the form points to once they've signed up.

Organizers sign in on the Bracket page with a shared password. Before a bracket starts they can see real names
and emails, tick off who has paid, remove sign-ups that didn't pay, add walk-ins, and set or shuffle the seeds.
**Start bracket** closes sign-ups for that game and generates the double-elimination bracket (byes for top seeds,
bracket reset in the Grand Final). From then on they tap a match to call it to a setup or report the winner and
score. Every screen with the Bracket page open updates within a few seconds, and **Big screen** gives the venue TV
a now playing / up next / latest results view (`bracket.html#big` opens straight into it).

Real names and emails only go to signed-in organizers. The public page only ever gets gamer tags.

| Part | Files |
| --- | --- |
| Sign-up form | `index.html` (`#register`), `js/signup.js`, styles at the end of the ticket section in `style.css` |
| Bracket page | `bracket.html`, `js/bracket-app.js`, `css/bracket.css` |
| Bracket rules | `js/bracket-engine.js`, shared by the page and the server so both agree on who plays whom |
| Server | `netlify/functions/` (`state`, `signup`, `admin`) and `netlify/lib/core.mjs` |
| Database tables | `netlify/database/migrations/` |

## Deploying on Netlify

The sign-ups need a server, so this version runs on Netlify (functions plus Netlify Database, its built-in Postgres).

1. Copy in the two media files listed above.
2. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick this repo. The build
   settings come from `netlify.toml`, so there's nothing to fill in.
3. Before the first real use, go to **Project configuration → Environment variables** and add
   `FUSION_ADMIN_PASSWORD` with the password organizers will type in. Give it the **Functions** scope, then
   redeploy so it takes effect.
4. The first deploy creates the database and its tables. Netlify Database is only on Netlify's credit-based plans;
   if the deploy log says the database feature isn't available for the account, that's why.

Deploy previews get their own copy of the sign-ups. Names and emails stay behind the organizer password there too,
but treat preview links as shareable.

## Viewing it locally

To look at the design, open `index.html` in a browser, or run `python -m http.server` in this folder and go to
http://localhost:8000. The sign-up form and the Bracket page need the server: install the
[Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/), run `npm install`, then
`netlify dev`, and once, `netlify database migrations apply` to create the tables locally.
