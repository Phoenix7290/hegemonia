-- Up migration
ALTER TABLE users
  ADD COLUMN total_xp bigint NOT NULL DEFAULT 0,
  ADD COLUMN level integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT users_total_xp_positive CHECK (total_xp >= 0),
  ADD CONSTRAINT users_level_positive CHECK (level >= 1);

CREATE TABLE player_xp_grants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES match_participants(id) ON DELETE SET NULL,
  competition_mode text NOT NULL,
  base_xp integer NOT NULL,
  bonus_xp integer NOT NULL DEFAULT 0,
  total_xp integer NOT NULL,
  level_before integer NOT NULL,
  level_after integer NOT NULL,
  breakdown_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL DEFAULT 'match_completion',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_xp_grants_unique_user_match UNIQUE (user_id, match_id),
  CONSTRAINT player_xp_grants_xp_positive CHECK (total_xp >= 0)
);

CREATE INDEX idx_player_xp_grants_user_id ON player_xp_grants (user_id, created_at DESC);
CREATE INDEX idx_player_xp_grants_match_id ON player_xp_grants (match_id);

-- Down migration
DROP TABLE IF EXISTS player_xp_grants;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_level_positive,
  DROP CONSTRAINT IF EXISTS users_total_xp_positive,
  DROP COLUMN IF EXISTS level,
  DROP COLUMN IF EXISTS total_xp;
