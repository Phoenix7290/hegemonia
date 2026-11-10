import express from "express";
import cors from "cors";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import { checkDatabase } from "./connection.js";
import { getRecentMatches } from "./match-repository.js";
import { getLeaderboard, type LeaderboardCursor } from "./stats-repository.js";
import { createAuthRouter, socialErrorStatus } from "./auth-routes.js";
import { createMatchmakingRouter } from "./matchmaking-routes.js";
import { MatchmakingError } from "./matchmaking.js";
import { HEGEMONIA_VERSION, MATCHMAKING_RULESET_VERSION } from "@hegemonia/shared";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveServerCommitHash(): string {
  if (process.env.GIT_COMMIT_HASH && process.env.GIT_COMMIT_HASH !== "dev") {
    return process.env.GIT_COMMIT_HASH.trim().slice(0, 7);
  }
  // 1. Tentar ler commit.txt gerado no build em dist/
  const candidatePaths = [
    resolve(process.cwd(), "apps/web/dist/commit.txt"),
    resolve(process.cwd(), "dist/commit.txt"),
    resolve(process.cwd(), "../web/dist/commit.txt"),
  ];
  for (const cp of candidatePaths) {
    try {
      if (existsSync(cp)) {
        const val = readFileSync(cp, "utf8").trim();
        if (val && val !== "dev") return val.slice(0, 7);
      }
    } catch {}
  }
  // 2. Tentar executar git rev-parse se git estiver disponível
  try {
    const gitHash = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (gitHash && gitHash.length >= 4) return gitHash.slice(0, 7);
  } catch {}
  // 3. Tentar ler .git/HEAD diretamente sem binário git
  try {
    const gitHeadPath = resolve(process.cwd(), ".git/HEAD");
    const parentHeadPath = resolve(process.cwd(), "../../.git/HEAD");
    const targetHead = existsSync(gitHeadPath) ? gitHeadPath : (existsSync(parentHeadPath) ? parentHeadPath : null);
    if (targetHead) {
      const gitDir = resolve(targetHead, "..");
      const head = readFileSync(targetHead, "utf8").trim();
      if (head.startsWith("ref: ")) {
        const refFile = resolve(gitDir, head.slice(5).trim());
        if (existsSync(refFile)) {
          return readFileSync(refFile, "utf8").trim().slice(0, 7);
        }
      } else if (head.length >= 7) {
        return head.slice(0, 7);
      }
    }
  } catch {}
  return "dev";
}

let serverCommitHash = resolveServerCommitHash();

export async function createApp(): Promise<express.Express> {
  const app = express();
  const configuredOrigin = process.env.WEB_ORIGIN;
  const isDev = process.env.NODE_ENV !== "production";
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (configuredOrigin && origin === configuredOrigin) return callback(null, true);
        if (
          isDev &&
          (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(
            origin
          ) || !configuredOrigin)
        ) {
          return callback(null, true);
        }
        callback(new Error(`CORS origin blocked: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", async (_req, res, next) => {
    try {
      await checkDatabase();
      res.json({ status: "ok", service: "hegemonia-server", database: "postgresql", ipv6Ready: true });
    } catch (error) { next(error); }
  });

  app.get("/api/matches", async (_req, res, next) => {
    try { res.json({ matches: await getRecentMatches() }); } catch (error) { next(error); }
  });

  app.get("/api/leaderboard", async (req, res, next) => {
    try {
      const result = await getLeaderboard({
        seasonSlug: cleanQueryText(req.query.season, 64) ?? "lifetime",
        queue: cleanQueryText(req.query.queue, 64) ?? "classic_ffa",
        limit: parseLimit(req.query.limit, 50),
        cursor: decodeLeaderboardCursor(req.query.cursor),
      });
      res.json({ leaderboard: result.rows, nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null });
    } catch (error) { next(error); }
  });

  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({
      version: HEGEMONIA_VERSION,
      rulesetVersion: MATCHMAKING_RULESET_VERSION,
      commitHash: serverCommitHash,
    });
  });

  app.use("/api/matchmaking", createMatchmakingRouter());
  app.use("/api", await createAuthRouter());
  app.use("/avatars", express.static(resolve(process.env.AVATAR_DIR ?? "data/avatars"), {
    immutable: true,
    maxAge: "1y",
    fallthrough: false,
  }));

  const staticDir = resolve(process.env.PUBLIC_DIR ?? "../web/dist");
  if (existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        setHeaders: (res, path) => {
          if (path.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
          }
        },
      })
    );
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/matchmake") || req.path.startsWith("/health")) return next();
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const socialStatus = socialErrorStatus(error);
    if (socialStatus) { res.status(socialStatus).json({ error: error instanceof Error ? error.message : "Falha na solicitação." }); return; }
    if (error instanceof MatchmakingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof InvalidCursorError) { res.status(400).json({ error: error.message }); return; }
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? "Dados inválidos.", code: "validation_error", fields: error.flatten().fieldErrors });
      return;
    }
    if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: "O arquivo excede o limite permitido." });
      return;
    }
    if (error instanceof Error && error.name === "SharpError") {
      res.status(400).json({ error: "Não foi possível processar esta imagem." });
      return;
    }
    console.error("Falha na API:", error);
    res.status(500).json({ error: "Falha interna do servidor." });
  });
  return app;
}

function parseLimit(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback;
}

function cleanQueryText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLength) || null;
}

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

class InvalidCursorError extends Error {}

function decodeLeaderboardCursor(value: unknown): LeaderboardCursor | undefined {
  const cursor = decodeCursor(value);
  if (cursor === undefined) return undefined;
  if (typeof cursor.score !== "number" || !Number.isInteger(cursor.score) || cursor.score < 0 ||
    typeof cursor.wins !== "number" || !Number.isInteger(cursor.wins) || cursor.wins < 0 ||
    typeof cursor.userId !== "string" || !UUID_PATTERN.test(cursor.userId)) {
    throw new InvalidCursorError("Cursor de paginação inválido.");
  }
  return { score: cursor.score, wins: cursor.wins, userId: cursor.userId };
}

function decodeCursor(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || !value) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) throw new Error();
    return cursor as Record<string, unknown>;
  } catch {
    throw new InvalidCursorError("Cursor de paginação inválido.");
  }
}
