import express from "express";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  LoginSchema,
  ProfileUpdateSchema,
  RegisterSchema,
  UserSearchSchema,
} from "@hegemonia/shared";
import {
  authenticateToken,
  loginAccount,
  logoutAccount,
  logoutAllAccounts,
  registerAccount,
  AuthError,
} from "./auth-service.js";
import { setAvatarUrl, updateProfileRecord } from "./auth-repository.js";
import { type AvatarStorage, createAvatarStorage } from "./avatar-storage.js";
import {
  blockUser,
  getMutualFriends,
  getProfile,
  listBlocked,
  listFriends,
  listRequests,
  removeFriendship,
  requestFriend,
  respondFriend,
  searchUsers,
  SocialError,
  unblockUser,
} from "./social-repository.js";
import { getPlayerMatchHistory, getPlayerStats } from "./stats-repository.js";
import { matchmakingService } from "./matchmaking.js";
import {
  clearSessionCookie,
  createRateLimiter,
  identity,
  optionalIdentity,
  requireIdentity,
  sessionTokenFromHeaders,
  setSessionCookie,
} from "./http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const avatarDir = resolve(process.env.AVATAR_DIR ?? "data/avatars");
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });

export async function createAuthRouter(avatarStorage: AvatarStorage = createAvatarStorage()): Promise<express.Router> {
  if (avatarStorage.driver === "local") {
    await mkdir(avatarDir, { recursive: true });
  }
  const router = express.Router();
  router.use(optionalIdentity);
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.headers.origin) return next();
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:5173";
    const sameOrigin = `${req.protocol}://${req.get("host")}`;
    if (req.headers.origin !== allowed && req.headers.origin !== sameOrigin) {
      res.status(403).json({ error: "Origem não autorizada.", code: "origin_rejected" });
      return;
    }
    next();
  });

  router.post("/auth/register", authLimiter, async (req, res, next) => {
    try {
      const input = RegisterSchema.parse(req.body);
      const result = await registerAccount(input, req);
      setSessionCookie(res, result.session.token, result.session.expiresAt);
      res.status(201).json({ user: result.user });
    } catch (error) { next(error); }
  });

  router.post("/auth/login", authLimiter, async (req, res, next) => {
    try {
      const input = LoginSchema.parse(req.body);
      const result = await loginAccount(input, req);
      setSessionCookie(res, result.session.token, result.session.expiresAt);
      res.json({ user: result.user });
    } catch (error) { next(error); }
  });

  router.get("/auth/me", (_req, res) => {
    res.json({ user: identityOrNull(res)?.user ?? null });
  });

  router.post("/auth/logout", requireIdentity, async (_req, res, next) => {
    try {
      await matchmakingService.logout(identity(res).user.id);
      await logoutAccount(identity(res).sessionId);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.post("/auth/logout-all", requireIdentity, async (_req, res, next) => {
    try {
      await matchmakingService.logout(identity(res).user.id);
      await logoutAllAccounts(identity(res).user.id);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.patch("/profile", requireIdentity, async (req, res, next) => {
    try {
      const input = ProfileUpdateSchema.parse(req.body);
      const user = await updateProfileRecord(identity(res).user.id, input);
      res.json({ user });
    } catch (error) { next(error); }
  });

  router.put("/profile/avatar", requireIdentity, express.raw({ type: () => true, limit: "5mb" }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length < 12) {
        res.status(400).json({ error: "Envie uma imagem válida de até 5 MiB." });
        return;
      }
      const image = sharp(req.body, { limitInputPixels: 25_000_000, failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.format || !["jpeg", "png", "webp", "gif", "avif"].includes(metadata.format)) {
        res.status(415).json({ error: "Formato não suportado. Use JPEG, PNG, WebP, GIF ou AVIF." });
        return;
      }
      const filename = `${randomBytes(24).toString("hex")}.webp`;
      const buffer = await image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
      const avatarUrl = await avatarStorage.save(filename, buffer);
      const previous = await setAvatarUrl(identity(res).user.id, avatarUrl);
      if (previous && previous !== avatarUrl) {
        await avatarStorage.delete(previous);
      }
      res.json({ avatarUrl });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/profile/avatar", requireIdentity, async (_req, res, next) => {
    try {
      const previous = await setAvatarUrl(identity(res).user.id, null);
      if (previous) {
        await avatarStorage.delete(previous);
      }
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.get("/profiles/:username", async (req, res, next) => {
    try {
      res.json(await getProfile(String(req.params.username), identityOrNull(res)?.user.id ?? null));
    } catch (error) { next(error); }
  });

  router.get("/profiles/:username/stats", async (req, res, next) => {
    try {
      const { profile } = await getProfile(String(req.params.username), identityOrNull(res)?.user.id ?? null);
      if (!profile.canViewStats) {
        res.status(403).json({ error: "Este comandante mantém suas estatísticas privadas." });
        return;
      }
      res.json(await getPlayerStats(profile.id));
    } catch (error) { next(error); }
  });

  router.get("/profiles/:username/matches", async (req, res, next) => {
    try {
      const { profile } = await getProfile(String(req.params.username), identityOrNull(res)?.user.id ?? null);
      if (!profile.canViewStats) {
        res.status(403).json({ error: "Este comandante mantém seu histórico privado." });
        return;
      }
      const result = await getPlayerMatchHistory({ userId: profile.id, limit: 12 });
      res.json({ matches: result.rows });
    } catch (error) { next(error); }
  });

  router.get("/profiles/:username/mutual", requireIdentity, async (req, res, next) => {
    try {
      const { profile } = await getProfile(String(req.params.username), identity(res).user.id);
      if (profile.relationship === "blocked") {
        res.status(403).json({ error: "Lista indisponível." });
        return;
      }
      res.json({ friends: profile.isSelf ? [] : await getMutualFriends(identity(res).user.id, profile.id) });
    } catch (error) { next(error); }
  });

  router.get("/users/search", requireIdentity, async (req, res, next) => {
    try {
      const { q } = UserSearchSchema.parse({ q: req.query.q });
      res.json({ users: await searchUsers(identity(res).user.id, q) });
    } catch (error) { next(error); }
  });

  router.get("/friends", requireIdentity, async (_req, res, next) => {
    try { res.json({ friends: await listFriends(identity(res).user.id) }); } catch (error) { next(error); }
  });
  router.get("/friends/requests", requireIdentity, async (_req, res, next) => {
    try { res.json(await listRequests(identity(res).user.id)); } catch (error) { next(error); }
  });
  router.get("/friends/blocked", requireIdentity, async (_req, res, next) => {
    try { res.json({ blocked: await listBlocked(identity(res).user.id) }); } catch (error) { next(error); }
  });
  router.post("/friends/:userId/request", requireIdentity, validUserId, async (req, res, next) => {
    try { await requestFriend(identity(res).user.id, String(req.params.userId)); res.status(204).end(); } catch (error) { next(error); }
  });
  router.post("/friends/:userId/accept", requireIdentity, validUserId, async (req, res, next) => {
    try { await respondFriend(identity(res).user.id, String(req.params.userId), true); res.status(204).end(); } catch (error) { next(error); }
  });
  router.post("/friends/:userId/decline", requireIdentity, validUserId, async (req, res, next) => {
    try { await respondFriend(identity(res).user.id, String(req.params.userId), false); res.status(204).end(); } catch (error) { next(error); }
  });
  router.delete("/friends/:userId", requireIdentity, validUserId, async (req, res, next) => {
    try { await removeFriendship(identity(res).user.id, String(req.params.userId)); res.status(204).end(); } catch (error) { next(error); }
  });
  router.post("/friends/:userId/block", requireIdentity, validUserId, async (req, res, next) => {
    try { await blockUser(identity(res).user.id, String(req.params.userId)); res.status(204).end(); } catch (error) { next(error); }
  });
  router.delete("/friends/:userId/block", requireIdentity, validUserId, async (req, res, next) => {
    try { await unblockUser(identity(res).user.id, String(req.params.userId)); res.status(204).end(); } catch (error) { next(error); }
  });

  return router;
}

function identityOrNull(res: express.Response) {
  return (res.locals.identity as Awaited<ReturnType<typeof authenticateToken>>) ?? null;
}

function validUserId(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!UUID.test(String(req.params.userId))) {
    res.status(400).json({ error: "Identificador de jogador inválido." });
    return;
  }
  next();
}

export async function removeAvatar(url: string | null, storage: AvatarStorage = createAvatarStorage()): Promise<void> {
  await storage.delete(url);
}

export function socialErrorStatus(error: unknown): number | null {
  if (error instanceof AuthError) return error.status;
  if (error instanceof SocialError) return error.status;
  return null;
}
