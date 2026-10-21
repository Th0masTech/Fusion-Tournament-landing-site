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

## Files not in this repo

The top section's moving background lives only on the live web host. Until it's copied in, the site shows
a still image (`img/hero-smash.jpg`) in its place:

- `vid/SSYouTube.online_Super Smash Bros. Ultimate -  Everyone is Here! (Live Wallpaper)_1080p.mp4`

## Viewing it locally

Open `index.html` in a browser, or run `python -m http.server` in this folder and go to
http://localhost:8000.
