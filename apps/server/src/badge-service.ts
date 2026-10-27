import type { PoolClient } from "pg";

export async function awardMatchBadges(client: PoolClient, matchId: string): Promise<void> {
  await client.query(
    `INSERT INTO user_badges (user_id, badge_id, source_match_id)
     SELECT p.user_id, b.id, $1
     FROM match_participants p
     JOIN player_career_stats stats ON stats.user_id = p.user_id
     JOIN badges b ON (
       (b.category = 'victory' AND stats.wins >= b.threshold)
       OR (b.category = 'career' AND stats.matches_played >= b.threshold)
       OR (b.category = 'streak' AND stats.current_win_streak >= b.threshold)
     )
     WHERE p.match_id = $1 AND p.user_id IS NOT NULL AND NOT p.is_bot
     ON CONFLICT (user_id, badge_id) DO NOTHING`,
    [matchId]
  );
}
