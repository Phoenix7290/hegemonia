-- Up migration
ALTER TABLE users
  ADD COLUMN bio text NOT NULL DEFAULT '',
  ADD COLUMN profile_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN last_seen_at timestamptz,
  ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 500),
  ADD CONSTRAINT users_profile_visibility_valid CHECK (profile_visibility IN ('public', 'friends', 'private'));

CREATE TABLE friendships (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  blocked_by uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT friendships_pair_unique UNIQUE (user_low_id, user_high_id),
  CONSTRAINT friendships_pair_ordered CHECK (user_low_id < user_high_id),
  CONSTRAINT friendships_requester_in_pair CHECK (requester_id IN (user_low_id, user_high_id)),
  CONSTRAINT friendships_blocker_in_pair CHECK (blocked_by IS NULL OR blocked_by IN (user_low_id, user_high_id)),
  CONSTRAINT friendships_status_valid CHECK (status IN ('pending', 'accepted', 'blocked')),
  CONSTRAINT friendships_state_valid CHECK (
    (status = 'pending' AND blocked_by IS NULL AND accepted_at IS NULL)
    OR (status = 'accepted' AND blocked_by IS NULL AND accepted_at IS NOT NULL)
    OR (status = 'blocked' AND blocked_by IS NOT NULL)
  )
);

CREATE TABLE badges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  category text NOT NULL,
  threshold integer NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badges_category_valid CHECK (category IN ('victory', 'career', 'streak')),
  CONSTRAINT badges_threshold_positive CHECK (threshold > 0),
  CONSTRAINT badges_category_threshold_unique UNIQUE (category, threshold)
);

CREATE TABLE user_badges (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  source_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX friendships_high_pending_idx ON friendships (user_high_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX friendships_low_pending_idx ON friendships (user_low_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX friendships_low_status_idx ON friendships (user_low_id, status, accepted_at DESC);
CREATE INDEX friendships_high_status_idx ON friendships (user_high_id, status, accepted_at DESC);
CREATE INDEX users_search_username_idx ON users (lower(username::text) varchar_pattern_ops);
CREATE INDEX users_last_seen_idx ON users (last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX user_badges_awarded_idx ON user_badges (user_id, awarded_at DESC);
CREATE INDEX user_badges_badge_idx ON user_badges (badge_id, awarded_at DESC);

INSERT INTO badges (slug, name, description, icon, category, threshold, sort_order) VALUES
  ('first-victory', 'Primeira Conquista', 'Vença sua primeira partida.', 'laurel', 'victory', 1, 10),
  ('veteran-commander', 'Comandante Veterano', 'Complete 10 partidas.', 'shield', 'career', 10, 20),
  ('ten-victories', 'Estrategista Consolidado', 'Conquiste 10 vitórias.', 'swords', 'victory', 10, 30),
  ('fifty-victories', 'Arquiteto da Hegemonia', 'Conquiste 50 vitórias.', 'crown', 'victory', 50, 40),
  ('three-win-streak', 'Ofensiva Coordenada', 'Alcance uma sequência de 3 vitórias.', 'chevrons', 'streak', 3, 50),
  ('five-win-streak', 'Campanha Imparável', 'Alcance uma sequência de 5 vitórias.', 'star', 'streak', 5, 60);

-- Down migration
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS friendships;
DROP INDEX IF EXISTS users_search_username_idx;
ALTER TABLE users
  DROP COLUMN last_seen_at,
  DROP COLUMN profile_visibility,
  DROP COLUMN bio;
