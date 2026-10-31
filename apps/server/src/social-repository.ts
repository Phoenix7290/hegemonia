import type { PoolClient } from "pg";
import type { Badge, FriendSummary, PublicProfile } from "@hegemonia/shared";
import { query, withTransaction } from "./connection.js";

export class SocialError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  profile_visibility: "public" | "friends" | "private";
  total_xp: string | number;
  level: number;
  created_at: Date;
  last_seen_at: Date | null;
  relationship_status: string | null;
  requester_id: string | null;
  blocked_by: string | null;
}

export async function getProfile(username: string, viewerId: string | null) {
  const result = await query<ProfileRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.profile_visibility,
       u.total_xp, u.level, u.created_at, u.last_seen_at, f.status AS relationship_status,
       f.requester_id, f.blocked_by
     FROM users u
     LEFT JOIN friendships f ON f.user_low_id = least(u.id, $2::uuid)
       AND f.user_high_id = greatest(u.id, $2::uuid)
     WHERE u.username = $1 AND u.is_active AND u.deleted_at IS NULL`,
    [username, viewerId]
  );
  const row = result.rows[0];
  if (!row) throw new SocialError("Perfil não encontrado.", 404);
  const isSelf = row.id === viewerId;
  const blocked = row.relationship_status === "blocked";
  const friends = row.relationship_status === "accepted";
  const relationship: PublicProfile["relationship"] = isSelf
    ? "self"
    : blocked
      ? "blocked"
      : friends
        ? "friends"
        : row.relationship_status === "pending"
          ? row.requester_id === viewerId ? "outgoing" : "incoming"
          : "none";
  const canViewStats = !blocked && (isSelf || row.profile_visibility === "public" || (friends && row.profile_visibility === "friends"));
  const mutualFriends = viewerId && !isSelf && !blocked ? await countMutualFriends(viewerId, row.id) : 0;
  const profile: PublicProfile = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: canViewStats || isSelf ? row.bio : null,
    totalXp: Number(row.total_xp || 0),
    level: Number(row.level || 1),
    createdAt: row.created_at.toISOString(),
    lastSeenAt: canViewStats ? row.last_seen_at?.toISOString() ?? null : null,
    isSelf,
    canViewStats,
    relationship,
    mutualFriends,
  };
  const badges = canViewStats ? await getBadges(row.id) : [];
  return { profile, badges };
}

export async function getBadges(userId: string): Promise<Badge[]> {
  const result = await query<Omit<Badge, "awardedAt"> & { awardedAt: Date | null }>(
    `SELECT b.id, b.slug, b.name, b.description, b.icon, b.category, b.threshold,
       ub.awarded_at AS "awardedAt"
     FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
     ORDER BY b.sort_order, b.slug`,
    [userId]
  );
  return result.rows.map((row) => ({ ...row, awardedAt: row.awardedAt?.toISOString() ?? null }));
}

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function lockPair(client: PoolClient, viewerId: string, targetId: string) {
  const [low, high] = pair(viewerId, targetId);
  const result = await client.query<{
    requester_id: string;
    status: string;
    blocked_by: string | null;
  }>(
    `SELECT requester_id, status, blocked_by FROM friendships
     WHERE user_low_id = $1 AND user_high_id = $2 FOR UPDATE`,
    [low, high]
  );
  return { low, high, friendship: result.rows[0] ?? null };
}

async function assertTarget(client: PoolClient, viewerId: string, targetId: string) {
  if (viewerId === targetId) throw new SocialError("Esta ação não pode ser feita com seu próprio perfil.");
  const result = await client.query(
    "SELECT 1 FROM users WHERE id = $1 AND is_active AND deleted_at IS NULL",
    [targetId]
  );
  if (!result.rowCount) throw new SocialError("Jogador não encontrado.", 404);
}

export async function requestFriend(viewerId: string, targetId: string): Promise<void> {
  await withTransaction(async (client) => {
    await assertTarget(client, viewerId, targetId);
    const { low, high, friendship } = await lockPair(client, viewerId, targetId);
    if (friendship?.status === "blocked") throw new SocialError("Não foi possível enviar a solicitação.", 403);
    if (friendship?.status === "accepted") return;
    if (friendship?.status === "pending") {
      if (friendship.requester_id === viewerId) return;
      await client.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = now(), updated_at = now()
         WHERE user_low_id = $1 AND user_high_id = $2 AND status = 'pending'`,
        [low, high]
      );
      return;
    }
    await client.query(
      `INSERT INTO friendships (user_low_id, user_high_id, requester_id)
       VALUES ($1, $2, $3)`,
      [low, high, viewerId]
    );
  });
}

export async function respondFriend(viewerId: string, targetId: string, accept: boolean): Promise<void> {
  await withTransaction(async (client) => {
    await assertTarget(client, viewerId, targetId);
    const { low, high, friendship } = await lockPair(client, viewerId, targetId);
    if (friendship?.status !== "pending" || friendship.requester_id === viewerId) {
      throw new SocialError("Solicitação pendente não encontrada.", 404);
    }
    if (accept) {
      await client.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = now(), updated_at = now()
         WHERE user_low_id = $1 AND user_high_id = $2`,
        [low, high]
      );
    } else {
      await client.query("DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2", [low, high]);
    }
  });
}

export async function removeFriendship(viewerId: string, targetId: string): Promise<void> {
  const [low, high] = pair(viewerId, targetId);
  await query(
    `DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2
       AND (status = 'accepted' OR (status = 'pending' AND requester_id = $3))`,
    [low, high, viewerId]
  );
}

export async function blockUser(viewerId: string, targetId: string): Promise<void> {
  await withTransaction(async (client) => {
    await assertTarget(client, viewerId, targetId);
    const { low, high } = await lockPair(client, viewerId, targetId);
    await client.query(
      `INSERT INTO friendships (user_low_id, user_high_id, requester_id, status, blocked_by)
       VALUES ($1, $2, $3, 'blocked', $3)
       ON CONFLICT (user_low_id, user_high_id) DO UPDATE SET
         requester_id = EXCLUDED.requester_id, status = 'blocked', blocked_by = EXCLUDED.blocked_by,
         accepted_at = NULL, updated_at = now()`,
      [low, high, viewerId]
    );
  });
}

export async function unblockUser(viewerId: string, targetId: string): Promise<void> {
  const [low, high] = pair(viewerId, targetId);
  await query(
    "DELETE FROM friendships WHERE user_low_id = $1 AND user_high_id = $2 AND status = 'blocked' AND blocked_by = $3",
    [low, high, viewerId]
  );
}

const friendColumns = `u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl",
  u.last_seen_at AS "lastSeenAt"`;

export async function listFriends(userId: string): Promise<FriendSummary[]> {
  const result = await query<FriendSummary>(
    `SELECT ${friendColumns}, f.accepted_at AS "friendsSince" FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
     WHERE $1 IN (f.user_low_id, f.user_high_id) AND f.status = 'accepted'
       AND u.is_active AND u.deleted_at IS NULL ORDER BY u.username`,
    [userId]
  );
  return result.rows;
}

export async function listRequests(userId: string) {
  const result = await query<FriendSummary>(
    `SELECT ${friendColumns}, f.created_at AS "requestedAt", f.requester_id AS "requesterId"
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
     WHERE $1 IN (f.user_low_id, f.user_high_id) AND f.status = 'pending'
       AND u.is_active AND u.deleted_at IS NULL ORDER BY f.created_at DESC`,
    [userId]
  );
  const requests = result.rows;
  return {
    incoming: requests.filter((request) => request.requesterId !== userId),
    outgoing: requests.filter((request) => request.requesterId === userId),
  };
}

export async function listBlocked(userId: string): Promise<FriendSummary[]> {
  const result = await query<FriendSummary>(
    `SELECT ${friendColumns} FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
     WHERE $1 IN (f.user_low_id, f.user_high_id) AND f.status = 'blocked' AND f.blocked_by = $1
     ORDER BY u.username`,
    [userId]
  );
  return result.rows;
}

export async function searchUsers(viewerId: string, search: string): Promise<FriendSummary[]> {
  const result = await query<FriendSummary>(
    `SELECT ${friendColumns} FROM users u
     WHERE u.id <> $1 AND u.is_active AND u.deleted_at IS NULL
       AND (u.username ILIKE $2 OR u.display_name ILIKE $2)
       AND NOT EXISTS (
         SELECT 1 FROM friendships f WHERE f.status = 'blocked'
           AND f.user_low_id = least(u.id, $1) AND f.user_high_id = greatest(u.id, $1)
       )
     ORDER BY u.username LIMIT 20`,
    [viewerId, `%${search.replace(/[\\%_]/g, "\\$&")}%`]
  );
  return result.rows;
}

export async function getMutualFriends(viewerId: string, targetId: string): Promise<FriendSummary[]> {
  const result = await query<FriendSummary>(
    `SELECT ${friendColumns} FROM users u
     WHERE EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
         AND f.user_low_id = least(u.id, $1) AND f.user_high_id = greatest(u.id, $1))
       AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
         AND f.user_low_id = least(u.id, $2) AND f.user_high_id = greatest(u.id, $2))
     ORDER BY u.username LIMIT 50`,
    [viewerId, targetId]
  );
  return result.rows;
}

async function countMutualFriends(viewerId: string, targetId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*) FROM users u
     WHERE EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
         AND f.user_low_id = least(u.id, $1) AND f.user_high_id = greatest(u.id, $1))
       AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
         AND f.user_low_id = least(u.id, $2) AND f.user_high_id = greatest(u.id, $2))`,
    [viewerId, targetId]
  );
  return Number(result.rows[0].count);
}
