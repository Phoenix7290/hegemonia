import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { AuthUser, LoginInput, RegisterInput } from "@hegemonia/shared";
import {
  createSession,
  createUser,
  findSession,
  findUserForLogin,
  revokeAllSessions,
  revokeSession,
  type SessionIdentity,
} from "./auth-repository.js";

const SESSION_TTL_DAYS = Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS ?? 30), 1), 365);
const dummyHashPromise = argon2.hash("not-a-real-account-password", { type: argon2.argon2id });

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "auth_error"
  ) {
    super(message);
  }
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

async function issueSession(user: AuthUser, request: { ip?: string; headers: Record<string, unknown> }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ip = request.ip?.slice(0, 128) || null;
  const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null;
  const sessionId = await createSession({ userId: user.id, tokenHash: hashToken(token), expiresAt, ipAddress: ip, userAgent });
  return { token, expiresAt, sessionId };
}

export async function registerAccount(input: RegisterInput, request: { ip?: string; headers: Record<string, unknown> }) {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  try {
    const user = await createUser(input, passwordHash);
    return { user, session: await issueSession(user, request) };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new AuthError("E-mail ou nome de usuário já cadastrado.", 409, "account_exists");
    }
    throw error;
  }
}

export async function loginAccount(input: LoginInput, request: { ip?: string; headers: Record<string, unknown> }) {
  const record = await findUserForLogin(input.identifier);
  const passwordHash = record?.password_hash ?? (await dummyHashPromise);
  const valid = await argon2.verify(passwordHash, input.password).catch(() => false);
  if (!record || !valid) {
    throw new AuthError("Credenciais inválidas.", 401, "invalid_credentials");
  }
  const user = {
    id: record.id,
    email: record.email,
    username: record.username,
    displayName: record.display_name,
    avatarUrl: record.avatar_url,
    bio: record.bio,
    profileVisibility: record.profile_visibility,
    role: record.role,
    createdAt: record.created_at.toISOString(),
  } satisfies AuthUser;
  return { user, session: await issueSession(user, request) };
}

export async function authenticateToken(token: string | undefined): Promise<SessionIdentity | null> {
  if (!token || token.length > 128) return null;
  return findSession(hashToken(token));
}

export async function logoutAccount(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

export async function logoutAllAccounts(userId: string): Promise<void> {
  await revokeAllSessions(userId);
}
