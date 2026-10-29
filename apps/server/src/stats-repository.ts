import { query } from "./connection.js";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  matchesPlayed: number;
  wins: number;
  winRate: number | null;
  updatedAt: Date;
}

export interface LeaderboardCursor {
  score: number;
  wins: number;
  userId: string;
}

export async function getLeaderboard(options: {
  seasonSlug?: string;
  queue?: string;
  limit?: number;
  cursor?: LeaderboardCursor;
}): Promise<{ rows: LeaderboardRow[]; nextCursor: LeaderboardCursor | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursor = options.cursor;
  const result = await query<LeaderboardRow>(
    `SELECT
      r.rank::integer AS rank, r.user_id AS "userId", r.username, r.display_name AS "displayName",
      u.avatar_url AS "avatarUrl", r.score, r.matches_played::integer AS "matchesPlayed", r.wins::integer AS wins,
      r.win_rate::double precision AS "winRate", r.updated_at AS "updatedAt"
     FROM ranked_leaderboard r JOIN users u ON u.id = r.user_id
     WHERE r.season_slug = $1 AND r.queue = $2
       AND (
         $3::integer IS NULL
         OR r.score < $3
         OR (r.score = $3 AND r.wins < $4)
         OR (r.score = $3 AND r.wins = $4 AND r.user_id > $5::uuid)
       )
     ORDER BY r.score DESC, r.wins DESC, r.user_id
     LIMIT $6`,
    [
      options.seasonSlug ?? "lifetime",
      options.queue ?? "classic_ffa",
      cursor?.score ?? null,
      cursor?.wins ?? null,
      cursor?.userId ?? null,
      limit + 1,
    ]
  );
  const hasNext = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: hasNext && last ? { score: last.score, wins: last.wins, userId: last.userId } : null,
  };
}

export async function getPlayerStats(userId: string) {
  const [career, colors, objectives, maps, doctrines, ratingHistory] = await Promise.all([
    query(
      `SELECT user_id AS "userId", username, display_name AS "displayName",
        matches_played::integer AS "matchesPlayed", wins::integer AS wins,
        losses::integer AS losses, draws::integer AS draws,
        win_rate::double precision AS "winRate",
        average_placement::double precision AS "averagePlacement",
        current_win_streak::integer AS "currentWinStreak"
       FROM player_career_stats WHERE user_id = $1`,
      [userId]
    ),
    query(
      `SELECT color, matches_played::integer AS "matchesPlayed", wins::integer AS wins,
        win_rate::double precision AS "winRate"
       FROM player_color_stats WHERE user_id = $1 ORDER BY matches_played DESC, color`,
      [userId]
    ),
    query(
      `SELECT objective_id AS "objectiveId", matches_played::integer AS "matchesPlayed",
        wins::integer AS wins, win_rate::double precision AS "winRate"
       FROM player_objective_stats WHERE user_id = $1
       ORDER BY matches_played DESC, objective_id`,
      [userId]
    ),
    query(
      `SELECT map_id AS "mapId", game_mode AS "gameMode",
        matches_played::integer AS "matchesPlayed", wins::integer AS wins,
        win_rate::double precision AS "winRate"
       FROM player_map_stats WHERE user_id = $1 ORDER BY matches_played DESC, map_id`,
      [userId]
    ),
    query(
      `SELECT doctrine_id AS "doctrineId", matches_played::integer AS "matchesPlayed",
        wins::integer AS wins, win_rate::double precision AS "winRate"
       FROM player_doctrine_stats WHERE user_id = $1
       ORDER BY matches_played DESC, doctrine_id`,
      [userId]
    ),
    query(
      `SELECT match_id AS "matchId", previous_score AS "previousScore",
        new_score AS "newScore", score_delta AS "scoreDelta", result, created_at AS "createdAt"
       FROM player_rating_history
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [userId]
    ),
  ]);

  return {
    career: career.rows[0] ?? null,
    byColor: colors.rows,
    byObjective: objectives.rows,
    byMap: maps.rows,
    byDoctrine: doctrines.rows,
    recentRatingChanges: ratingHistory.rows,
  };
}

export interface MatchHistoryCursor {
  endedAt: string;
  matchId: string;
}

export async function getPlayerMatchHistory(options: {
  userId: string;
  limit?: number;
  cursor?: MatchHistoryCursor;
}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const cursor = options.cursor;
  const result = await query(
    `SELECT
      m.id AS "matchId", m.room_code AS "roomCode", m.map_id AS "mapId",
      m.game_mode AS "gameMode", m.competition_mode AS "competitionMode",
      m.match_origin AS "matchOrigin", m.ended_at AS "endedAt", p.result, p.placement, p.color,
      p.objective_id AS "objectiveId", p.doctrine_id AS "doctrineId",
      p.final_territories AS "finalTerritories", p.final_armies AS "finalArmies"
     FROM match_participants p
     JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = $1 AND m.status = 'finished'
       AND ($2::timestamptz IS NULL OR (m.ended_at, m.id) < ($2, $3::uuid))
     ORDER BY m.ended_at DESC, m.id DESC
     LIMIT $4`,
    [options.userId, cursor?.endedAt ?? null, cursor?.matchId ?? null, limit + 1]
  );
  const hasNext = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor:
      hasNext && last ? { endedAt: last.endedAt.toISOString(), matchId: last.matchId } : null,
  };
}
