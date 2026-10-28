import type { PoolClient } from "pg";
import type { AuthUser, ProfileVisibility, RegisterInput } from "@hegemonia/shared";
import { query } from "./connection.js";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  profile_visibility: ProfileVisibility;
  role: AuthUser["role"];
  created_at: Date;
}

export interface SessionIdentity {
  sessionId: string;
  user: AuthUser;
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    profileVisibility: row.profile_visibility,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

const userColumns = `id, email, username, display_name, avatar_url, bio,
  profile_visibility, role, created_at`;

export async function createUser(input: RegisterInput, passwordHash: string): Promise<AuthUser> {
  const result = await query<UserRow>(
    `INSERT INTO users (email, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING ${userColumns}`,
    [input.email, input.username, input.displayName, passwordHash]
  );
  return toAuthUser(result.rows[0]);
}

export async function findUserForLogin(identifier: string) {
  const result = await query<UserRow & { password_hash: string | null }>(
    `SELECT ${userColumns}, password_hash FROM users
     WHERE (email = $1 OR username = $1) AND is_active AND deleted_at IS NULL
     LIMIT 1`,
    [identifier]
  );
  return result.rows[0] ?? null;
}

export async function createSession(options: {
  userId: string;
  tokenHash: Buffer;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4::inet, $5) RETURNING id`,
    [
      options.userId,
      options.tokenHash,
      options.expiresAt,
      options.ipAddress,
      options.userAgent?.slice(0, 512) ?? null,
    ]
  );
  return result.rows[0].id;
}

export async function findSession(tokenHash: Buffer): Promise<SessionIdentity | null> {
  const result = await query<UserRow & { session_id: string; last_seen_at: Date }>(
    `SELECT s.id AS session_id, s.last_seen_at,
       u.id, u.email, u.username, u.display_name, u.avatar_url, u.bio,
       u.profile_visibility, u.role, u.created_at
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND u.is_active AND u.deleted_at IS NULL`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > 15 * 60 * 1000) {
    await query(
      `UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1;
       UPDATE users SET last_seen_at = now() WHERE id = $2`,
      [row.session_id, row.id]
    );
  }
  return { sessionId: row.session_id, user: toAuthUser(row) };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
}

export async function updateProfileRecord(
  userId: string,
  changes: { displayName?: string; bio?: string; profileVisibility?: ProfileVisibility },
  client?: PoolClient
): Promise<AuthUser> {
  const executor: typeof query = client ? client.query.bind(client) : query;
  const result = await executor<UserRow>(
    `UPDATE users SET display_name = coalesce($2, display_name),
       bio = coalesce($3, bio), profile_visibility = coalesce($4, profile_visibility),
       updated_at = now()
     WHERE id = $1 RETURNING ${userColumns}`,
    [userId, changes.displayName ?? null, changes.bio ?? null, changes.profileVisibility ?? null]
  );
  return toAuthUser(result.rows[0]);
}

export async function setAvatarUrl(userId: string, avatarUrl: string | null): Promise<string | null> {
  const result = await query<{ previous: string | null }>(
    `WITH previous AS (SELECT avatar_url FROM users WHERE id = $1)
     UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1
     RETURNING (SELECT avatar_url FROM previous) AS previous`,
    [userId, avatarUrl]
  );
  return result.rows[0]?.previous ?? null;
}
