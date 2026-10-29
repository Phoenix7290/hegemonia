-- Up migration
ALTER TABLE matches
  DROP CONSTRAINT matches_competition_mode_valid,
  DROP CONSTRAINT matches_ranked_season_required,
  ADD COLUMN match_origin text NOT NULL DEFAULT 'lobby',
  ADD CONSTRAINT matches_competition_mode_valid CHECK (competition_mode IN ('casual', 'ranked', 'custom')),
  ADD CONSTRAINT matches_match_origin_valid CHECK (match_origin IN ('matchmaking', 'lobby')),
  ADD CONSTRAINT matches_ranked_season_required CHECK (
    competition_mode <> 'ranked' OR (season_id IS NOT NULL AND match_origin = 'matchmaking')
  ),
  ADD CONSTRAINT matches_custom_origin_valid CHECK (competition_mode <> 'custom' OR match_origin = 'lobby');

-- Down migration
ALTER TABLE matches
  DROP CONSTRAINT matches_custom_origin_valid,
  DROP CONSTRAINT matches_ranked_season_required,
  DROP CONSTRAINT matches_match_origin_valid,
  DROP CONSTRAINT matches_competition_mode_valid,
  DROP COLUMN match_origin,
  ADD CONSTRAINT matches_competition_mode_valid CHECK (competition_mode IN ('casual', 'ranked')),
  ADD CONSTRAINT matches_ranked_season_required CHECK (competition_mode <> 'ranked' OR season_id IS NOT NULL);
