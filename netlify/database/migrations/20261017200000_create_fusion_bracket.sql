-- Sign-ups and brackets for the Fusion Tournament.
-- players: one row per person who signs up (or is added as a walk-in).
-- entries: that person's spot in one game's bracket while sign-ups are open.
-- brackets: one row per game; once started, `seeds` freezes the player order.
-- results / calls: reported match results and matches called to a setup.

CREATE TABLE meta (
  id INTEGER PRIMARY KEY,
  rev BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO meta (id) VALUES (1);

CREATE TABLE brackets (
  game TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'live')),
  reset BOOLEAN NOT NULL DEFAULT TRUE,
  seeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ
);
INSERT INTO brackets (game, name, sort) VALUES ('smash', 'Smash Ultimate', 1), ('fc', 'FC 27', 2);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  real_name TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'walk-in')),
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE entries (
  game TEXT NOT NULL REFERENCES brackets (game),
  player_id TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  tag_key TEXT NOT NULL,
  seed INTEGER,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game, player_id)
);
-- A gamer tag can only be used once per game (removed entries don't count).
CREATE UNIQUE INDEX entries_unique_tag ON entries (game, tag_key) WHERE NOT removed;

CREATE TABLE results (
  game TEXT NOT NULL REFERENCES brackets (game),
  match_id TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  w TEXT NOT NULL,
  sa INTEGER,
  sb INTEGER,
  t TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game, match_id)
);

CREATE TABLE calls (
  game TEXT NOT NULL REFERENCES brackets (game),
  match_id TEXT NOT NULL,
  setup TEXT NOT NULL DEFAULT '',
  t TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game, match_id)
);
