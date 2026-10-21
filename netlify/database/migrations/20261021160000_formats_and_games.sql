-- Each game picks its own format, organizers manage the list of games from the site,
-- and league formats can record draws.

ALTER TABLE brackets ADD COLUMN format TEXT NOT NULL DEFAULT 'double'
  CHECK (format IN ('double', 'single', 'roundrobin', 'groups', 'swiss'));
ALTER TABLE brackets ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE brackets ADD COLUMN color TEXT NOT NULL DEFAULT 'pink';

-- Bracket reset moves into the settings; FC starts with draws allowed for league formats.
UPDATE brackets SET settings = jsonb_build_object('reset', reset);
UPDATE brackets SET color = 'cyan', settings = settings || '{"draws": true}'::jsonb WHERE game = 'fc';
ALTER TABLE brackets DROP COLUMN reset;

-- A result with no winner is a draw (only formats that allow draws accept one).
ALTER TABLE results ALTER COLUMN w DROP NOT NULL;

-- Deleting a game takes its sign-ups, results and called matches with it.
ALTER TABLE entries DROP CONSTRAINT entries_game_fkey,
  ADD CONSTRAINT entries_game_fkey FOREIGN KEY (game) REFERENCES brackets (game) ON DELETE CASCADE;
ALTER TABLE results DROP CONSTRAINT results_game_fkey,
  ADD CONSTRAINT results_game_fkey FOREIGN KEY (game) REFERENCES brackets (game) ON DELETE CASCADE;
ALTER TABLE calls DROP CONSTRAINT calls_game_fkey,
  ADD CONSTRAINT calls_game_fkey FOREIGN KEY (game) REFERENCES brackets (game) ON DELETE CASCADE;
