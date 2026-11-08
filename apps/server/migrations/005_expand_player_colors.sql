-- Expand match_participants_color_valid to support v0.6.1 10-color palette (HEGEM-132)
ALTER TABLE match_participants
  DROP CONSTRAINT IF EXISTS match_participants_color_valid;

ALTER TABLE match_participants
  ADD CONSTRAINT match_participants_color_valid
  CHECK (color IN ('blue', 'red', 'green', 'dark_green', 'yellow', 'orange', 'pink', 'purple', 'black', 'white'));
