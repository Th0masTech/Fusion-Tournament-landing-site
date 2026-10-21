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
- Join the Discord: a button beside Register, its own section above the newsletter, and a Discord icon in the
  footer, all using the server's permanent invite link.
- One registration background for every screen size (phones used to download a separate 58 MB image).
- Sign-up form on the homepage that feeds a live bracket page, with five tournament formats and games the
  organizers set up themselves (see below).

## Files not in this repo

The top section's moving background lives only on the live web host. Until it's copied in, the site shows
a still image (`img/hero-smash.jpg`) in its place:

- `vid/SSYouTube.online_Super Smash Bros. Ultimate -  Everyone is Here! (Live Wallpaper)_1080p.mp4`

## Sign-ups and the live bracket

People sign up in the Registration section of the homepage: gamer tag, real name, email, and which
tournaments they're entering. Their gamer tag appears on the new **Bracket** page straight away. Paying still
happens through the Square link, which the form points to once they've signed up.

Organizers sign in on the Bracket page with a shared password. From there they can:

- **Manage the games.** Add a game, rename it, give it a colour, or delete it (before its bracket starts). The
  sign-up form lists whatever games are set up, so after the next-games poll nobody has to touch the code. The
  About section's text still names Smash and FC 27, so update that by hand.
- **Pick each game's format** before it starts:
  - **Double elimination:** two losses and you're out, with an optional bracket reset in the Grand Final.
  - **Single elimination:** one loss and you're out, with an optional third-place match.
  - **Round robin:** everyone plays everyone.
  - **Groups, then knockout:** round-robin groups, then the top players from each go into a single- or
    double-elimination bracket.
  - **Swiss:** a set number of rounds, each paired by record, with no rematches.

  Round robin, groups and Swiss can allow draws (3 points a win, 1 a draw). The format is locked once the
  bracket starts. Going back to sign-ups unlocks it again but clears the results.
- **Run sign-ups.** See real names and emails, tick off who has paid, remove sign-ups that didn't pay, add
  walk-ins, and set or shuffle the seeds.
- **Run the event.** **Start bracket** closes sign-ups for that game. After that, tap a match to call it to a
  setup or report the result and score.
- **Add a late player.** **Add a player** works after the start too, for a new walk-in or someone already on
  the list (signed up for another game, or removed before the start). Nothing already played changes. The
  dialog shows where they'll go before you confirm:
  - **Single or double elimination:** an empty first-round spot (a bye), as long as the player in that spot
    hasn't played their next match yet. Once there's no such spot, the dialog says the bracket is full or
    that it's too late.
  - **Round robin:** they play everyone, one match a round from the current round. Extra rounds are added
    at the end if needed.
  - **Swiss:** they join the next round that hasn't started, on 0 points. If that round is already paired
    but nothing has been played in it yet, it's paired again with them in.
  - **Groups, then knockout:** pick their group (the smallest by default). Any group whose players haven't
    reached the knockout yet can take them.

  The public sign-up form stays closed for games that have started, so late players always go through an
  organizer.

Every screen with the Bracket page open updates within a few seconds. **Big screen** gives the venue TV a now
playing / up next / standings / latest results view, and `bracket.html#big` opens straight into it.

Real names and emails only go to signed-in organizers. The public page only ever gets gamer tags.

| Part | Files |
| --- | --- |
| Sign-up form | `index.html` (`#register`), `js/signup.js`, styles at the end of the ticket section in `style.css` |
| Bracket page | `bracket.html`, `js/bracket-app.js`, `css/bracket.css` |
| Bracket rules | `js/bracket-engine.js`: every format, standings and placings, shared by the page and the server so both agree on who plays whom |
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
