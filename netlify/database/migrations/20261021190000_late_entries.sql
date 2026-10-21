-- Players added after a game's bracket has started. They go on the end of `seeds`, and
-- `late` maps each one's player id to where they joined the running bracket:
--   {"seed": 7}               an empty first-round spot (single or double elimination)
--   {"round": 3}              round robin and Swiss: plays from that round on
--   {"group": "B", "round": 2}  groups: joins that group from that round on
ALTER TABLE brackets ADD COLUMN late JSONB NOT NULL DEFAULT '{}'::jsonb;
