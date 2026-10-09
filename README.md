# Fusion Tournament site (redesign)

Redesigned version of [fusion.deets.technology](https://fusion.deets.technology/), kept separate from the
live site and its original repo. Nothing here is deployed.

## What changed

- New look built from the Fusion logo's colours (neon pink and cyan on deep violet), with the big logo as the
  hero and registration laid out as a ticket.
- Works properly on phones (viewport set, real slide-out menu, no sideways scrolling).
- Logo intro: the logo burst from the Fusion teaser plays once in the hero, then hands over to the still logo
  (skipped for reduced motion or a slow connection).
- Rules page laid out like a game settings screen, with a note that rules may change on the day.
- Game updated to FC 27; duplicate "Games" menu link removed.
- One registration background for every screen size (phones used to download a separate 58 MB image).

## Files not in this repo

These are on the live web host and need to be copied in before deploying from this repo:

- `vid/SSYouTube.online_Super Smash Bros. Ultimate -  Everyone is Here! (Live Wallpaper)_1080p.mp4`
- `vid/Fusion website new video.mp4`
- `vid/Fusion Website video 2.mp4`
- `img/967393.jpg` (registration background)

## Viewing it locally

Open `index.html` in a browser, or run `python -m http.server` in this folder and go to
http://localhost:8000.
