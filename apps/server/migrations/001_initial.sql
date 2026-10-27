-- Up migration
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email citext UNIQUE,
  username citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text,
  role text NOT NULL DEFAULT 'user',
  locale text NOT NULL DEFAULT 'pt-BR',
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_username_length CHECK (char_length(username::text) BETWEEN 3 AND 24),
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 32),
  CONSTRAINT users_role_valid CHECK (role IN ('user', 'moderator', 'admin')),
  CONSTRAINT users_password_or_identity CHECK (password_hash IS NULL OR email IS NOT NULL)
);

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  CONSTRAINT auth_sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT auth_sessions_expiry_valid CHECK (expires_at > created_at)
);

CREATE TABLE auth_one_time_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT auth_one_time_tokens_purpose_valid CHECK (purpose IN ('verify_email', 'reset_password')),
  CONSTRAINT auth_one_time_tokens_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT auth_one_time_tokens_expiry_valid CHECK (expires_at > created_at)
);

CREATE TABLE seasons (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seasons_status_valid CHECK (status IN ('draft', 'active', 'closed')),
  CONSTRAINT seasons_dates_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  room_code text NOT NULL,
  status text NOT NULL DEFAULT 'lobby',
  map_id text NOT NULL DEFAULT 'classic',
  game_mode text NOT NULL DEFAULT 'classic',
  competition_mode text NOT NULL DEFAULT 'casual',
  season_id uuid REFERENCES seasons(id) ON DELETE RESTRICT,
  ruleset_version text NOT NULL,
  rules_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ranked_eligible boolean NOT NULL DEFAULT false,
  ranked_ineligible_reason text,
  current_round integer NOT NULL DEFAULT 1,
  seed_commit_hash text NOT NULL,
  revealed_seed text,
  state_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_room_code_valid CHECK (char_length(room_code) BETWEEN 1 AND 12),
  CONSTRAINT matches_status_valid CHECK (status IN ('lobby', 'playing', 'finished', 'abandoned')),
  CONSTRAINT matches_game_mode_valid CHECK (game_mode IN ('classic', 'roleplay')),
  CONSTRAINT matches_competition_mode_valid CHECK (competition_mode IN ('casual', 'ranked')),
  CONSTRAINT matches_round_positive CHECK (current_round >= 1),
  CONSTRAINT matches_rules_config_object CHECK (jsonb_typeof(rules_config) = 'object'),
  CONSTRAINT matches_state_object CHECK (state_json IS NULL OR jsonb_typeof(state_json) = 'object'),
  CONSTRAINT matches_ranked_season_required CHECK (competition_mode <> 'ranked' OR season_id IS NOT NULL),
  CONSTRAINT matches_ranked_eligibility_valid CHECK (
    NOT ranked_eligible OR (competition_mode = 'ranked' AND ranked_ineligible_reason IS NULL)
  ),
  CONSTRAINT matches_finished_fields_valid CHECK (
    status <> 'finished' OR (started_at IS NOT NULL AND ended_at IS NOT NULL AND revealed_seed IS NOT NULL AND state_json IS NOT NULL)
  ),
  CONSTRAINT matches_dates_valid CHECK (
    (started_at IS NULL OR started_at >= created_at)
    AND (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at))
  )
);

CREATE TABLE match_participants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  engine_player_id text NOT NULL,
  display_name text NOT NULL,
  color text NOT NULL,
  objective_id text,
  doctrine_id text,
  seat_index integer NOT NULL,
  is_bot boolean NOT NULL DEFAULT false,
  result text NOT NULL DEFAULT 'pending',
  placement integer,
  eliminated_by_participant_id uuid REFERENCES match_participants(id) ON DELETE SET NULL,
  eliminated_at_sequence integer,
  final_territories integer,
  final_armies integer,
  peak_territories integer NOT NULL DEFAULT 0,
  turns_played integer NOT NULL DEFAULT 0,
  stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_participants_match_engine_unique UNIQUE (match_id, engine_player_id),
  CONSTRAINT match_participants_match_seat_unique UNIQUE (match_id, seat_index),
  CONSTRAINT match_participants_color_valid CHECK (color IN ('blue', 'red', 'green', 'yellow', 'black', 'white')),
  CONSTRAINT match_participants_seat_valid CHECK (seat_index BETWEEN 0 AND 5),
  CONSTRAINT match_participants_bot_has_no_user CHECK (NOT is_bot OR user_id IS NULL),
  CONSTRAINT match_participants_result_valid CHECK (result IN ('pending', 'win', 'loss', 'draw', 'abandoned')),
  CONSTRAINT match_participants_placement_valid CHECK (placement BETWEEN 1 AND 6),
  CONSTRAINT match_participants_winner_first CHECK ((result = 'win') = (placement = 1)),
  CONSTRAINT match_participants_counts_valid CHECK (
    (final_territories IS NULL OR final_territories >= 0)
    AND (final_armies IS NULL OR final_armies >= 0)
    AND peak_territories >= 0
    AND turns_played >= 0
  ),
  CONSTRAINT match_participants_stats_object CHECK (jsonb_typeof(stats_json) = 'object')
);

CREATE UNIQUE INDEX match_participants_match_user_uidx
  ON match_participants (match_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX match_participants_one_winner_uidx
  ON match_participants (match_id)
  WHERE result = 'win';
CREATE INDEX match_participants_user_history_idx
  ON match_participants (user_id, match_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX match_participants_eliminated_by_idx
  ON match_participants (eliminated_by_participant_id)
  WHERE eliminated_by_participant_id IS NOT NULL;

CREATE TABLE match_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES match_participants(id) ON DELETE SET NULL,
  sequence integer NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_events_match_sequence_unique UNIQUE (match_id, sequence),
  CONSTRAINT match_events_sequence_positive CHECK (sequence > 0),
  CONSTRAINT match_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE match_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  reason text NOT NULL DEFAULT 'action',
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_snapshots_match_sequence_unique UNIQUE (match_id, sequence),
  CONSTRAINT match_snapshots_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT match_snapshots_reason_valid CHECK (reason IN ('start', 'action', 'checkpoint', 'game_over')),
  CONSTRAINT match_snapshots_state_object CHECK (jsonb_typeof(state_json) = 'object')
);

CREATE TABLE player_ratings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  queue text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  matches_played integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id, queue),
  CONSTRAINT player_ratings_counts_valid CHECK (score >= 0 AND matches_played >= 0 AND wins BETWEEN 0 AND matches_played)
);

CREATE TABLE player_rating_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL UNIQUE REFERENCES match_participants(id) ON DELETE RESTRICT,
  queue text NOT NULL,
  previous_score integer NOT NULL,
  new_score integer NOT NULL,
  score_delta integer NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_rating_history_match_user_queue_unique UNIQUE (match_id, user_id, queue),
  CONSTRAINT player_rating_history_result_valid CHECK (result IN ('win', 'loss', 'draw', 'abandoned')),
  CONSTRAINT player_rating_history_scores_valid CHECK (
    previous_score >= 0 AND new_score >= 0 AND score_delta = new_score - previous_score
  )
);

CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);
CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_one_time_tokens_user_active_idx
  ON auth_one_time_tokens (user_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;
CREATE INDEX matches_recent_idx ON matches (updated_at DESC, id);
CREATE INDEX matches_active_idx ON matches (status, updated_at DESC)
  WHERE status IN ('lobby', 'playing');
CREATE INDEX matches_season_idx ON matches (season_id, competition_mode, ended_at DESC)
  WHERE season_id IS NOT NULL;
CREATE INDEX match_events_participant_idx ON match_events (participant_id, sequence)
  WHERE participant_id IS NOT NULL;
CREATE INDEX player_ratings_leaderboard_idx
  ON player_ratings (season_id, queue, score DESC, wins DESC, user_id);
CREATE INDEX player_rating_history_user_idx
  ON player_rating_history (user_id, created_at DESC, id);

INSERT INTO seasons (slug, name, status, starts_at)
VALUES ('lifetime', 'Carreira Competitiva', 'active', '-infinity');

CREATE VIEW player_career_stats AS
WITH eligible_results AS (
  SELECT
    p.user_id,
    p.result,
    p.placement,
    m.ended_at,
    m.id AS match_id,
    row_number() OVER (PARTITION BY p.user_id ORDER BY m.ended_at DESC, m.id DESC) AS recent_position
  FROM match_participants p
  JOIN matches m ON m.id = p.match_id
  WHERE p.user_id IS NOT NULL
    AND NOT p.is_bot
    AND m.status = 'finished'
    AND p.result IN ('win', 'loss', 'draw')
),
first_non_wins AS (
  SELECT user_id, min(recent_position) AS position
  FROM eligible_results
  WHERE result <> 'win'
  GROUP BY user_id
),
current_streaks AS (
  SELECT r.user_id, count(*) AS current_win_streak
  FROM eligible_results r
  LEFT JOIN first_non_wins f ON f.user_id = r.user_id
  WHERE r.result = 'win' AND r.recent_position < coalesce(f.position, 2147483647)
  GROUP BY r.user_id
)
SELECT
  u.id AS user_id,
  u.username,
  u.display_name,
  count(r.match_id) AS matches_played,
  count(r.match_id) FILTER (WHERE r.result = 'win') AS wins,
  count(r.match_id) FILTER (WHERE r.result = 'loss') AS losses,
  count(r.match_id) FILTER (WHERE r.result = 'draw') AS draws,
  round(100.0 * count(r.match_id) FILTER (WHERE r.result = 'win') / nullif(count(r.match_id), 0), 2) AS win_rate,
  round(avg(r.placement), 2) AS average_placement,
  coalesce(max(s.current_win_streak), 0) AS current_win_streak
FROM users u
LEFT JOIN eligible_results r ON r.user_id = u.id
LEFT JOIN current_streaks s ON s.user_id = u.id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.username, u.display_name;

CREATE VIEW player_color_stats AS
SELECT
  p.user_id,
  p.color,
  count(*) AS matches_played,
  count(*) FILTER (WHERE p.result = 'win') AS wins,
  round(100.0 * count(*) FILTER (WHERE p.result = 'win') / count(*), 2) AS win_rate
FROM match_participants p
JOIN matches m ON m.id = p.match_id
WHERE p.user_id IS NOT NULL AND NOT p.is_bot AND m.status = 'finished'
  AND p.result IN ('win', 'loss', 'draw')
GROUP BY p.user_id, p.color;

CREATE VIEW player_objective_stats AS
SELECT
  p.user_id,
  p.objective_id,
  count(*) AS matches_played,
  count(*) FILTER (WHERE p.result = 'win') AS wins,
  round(100.0 * count(*) FILTER (WHERE p.result = 'win') / count(*), 2) AS win_rate
FROM match_participants p
JOIN matches m ON m.id = p.match_id
WHERE p.user_id IS NOT NULL AND NOT p.is_bot AND m.status = 'finished'
  AND p.result IN ('win', 'loss', 'draw') AND p.objective_id IS NOT NULL
GROUP BY p.user_id, p.objective_id;

CREATE VIEW player_map_stats AS
SELECT
  p.user_id,
  m.map_id,
  m.game_mode,
  count(*) AS matches_played,
  count(*) FILTER (WHERE p.result = 'win') AS wins,
  round(100.0 * count(*) FILTER (WHERE p.result = 'win') / count(*), 2) AS win_rate
FROM match_participants p
JOIN matches m ON m.id = p.match_id
WHERE p.user_id IS NOT NULL AND NOT p.is_bot AND m.status = 'finished'
  AND p.result IN ('win', 'loss', 'draw')
GROUP BY p.user_id, m.map_id, m.game_mode;

CREATE VIEW player_doctrine_stats AS
SELECT
  p.user_id,
  p.doctrine_id,
  count(*) AS matches_played,
  count(*) FILTER (WHERE p.result = 'win') AS wins,
  round(100.0 * count(*) FILTER (WHERE p.result = 'win') / count(*), 2) AS win_rate
FROM match_participants p
JOIN matches m ON m.id = p.match_id
WHERE p.user_id IS NOT NULL AND NOT p.is_bot AND m.status = 'finished'
  AND p.result IN ('win', 'loss', 'draw') AND p.doctrine_id IS NOT NULL
GROUP BY p.user_id, p.doctrine_id;

CREATE VIEW ranked_leaderboard AS
SELECT
  r.season_id,
  s.slug AS season_slug,
  r.queue,
  r.user_id,
  u.username,
  u.display_name,
  r.score,
  r.matches_played,
  r.wins,
  round(100.0 * r.wins / nullif(r.matches_played, 0), 2) AS win_rate,
  rank() OVER (
    PARTITION BY r.season_id, r.queue
    ORDER BY r.score DESC, r.wins DESC, round(100.0 * r.wins / nullif(r.matches_played, 0), 2) DESC, r.user_id
  ) AS rank,
  r.updated_at
FROM player_ratings r
JOIN users u ON u.id = r.user_id
JOIN seasons s ON s.id = r.season_id
WHERE r.matches_played > 0 AND u.is_active AND u.deleted_at IS NULL;

-- Down migration
DROP VIEW IF EXISTS ranked_leaderboard;
DROP VIEW IF EXISTS player_doctrine_stats;
DROP VIEW IF EXISTS player_map_stats;
DROP VIEW IF EXISTS player_objective_stats;
DROP VIEW IF EXISTS player_color_stats;
DROP VIEW IF EXISTS player_career_stats;
DROP TABLE IF EXISTS player_rating_history;
DROP TABLE IF EXISTS player_ratings;
DROP TABLE IF EXISTS match_snapshots;
DROP TABLE IF EXISTS match_events;
DROP TABLE IF EXISTS match_participants;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS seasons;
DROP TABLE IF EXISTS auth_one_time_tokens;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS users;
DROP EXTENSION IF EXISTS citext;
