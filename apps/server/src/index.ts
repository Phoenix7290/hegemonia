import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HegemoniaRoom } from "./room.js";
import {
  checkDatabase,
  closeDatabase,
  getLeaderboard,
  getPlayerMatchHistory,
  getPlayerStats,
  getRecentMatches,
  type LeaderboardCursor,
  type MatchHistoryCursor,
} from "./db.js";

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "::";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.get("/health", async (_req, res, next) => {
  try {
    await checkDatabase();
    res.json({ status: "ok", service: "hegemonia-server", database: "postgresql", ipv6Ready: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/matches", async (_req, res, next) => {
  try {
    res.json({ matches: await getRecentMatches() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/leaderboard", async (req, res, next) => {
  try {
    const cursor = decodeLeaderboardCursor(req.query.cursor);
    const result = await getLeaderboard({
      seasonSlug: cleanQueryText(req.query.season, 64) ?? "lifetime",
      queue: cleanQueryText(req.query.queue, 64) ?? "classic_ffa",
      limit: parseLimit(req.query.limit, 50),
      cursor,
    });
    res.json({
      leaderboard: result.rows,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/players/:userId/stats", async (req, res, next) => {
  try {
    if (!UUID_PATTERN.test(req.params.userId)) {
      res.status(400).json({ error: "userId inválido." });
      return;
    }
    res.json(await getPlayerStats(req.params.userId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/players/:userId/matches", async (req, res, next) => {
  try {
    if (!UUID_PATTERN.test(req.params.userId)) {
      res.status(400).json({ error: "userId inválido." });
      return;
    }
    const cursor = decodeMatchHistoryCursor(req.query.cursor);
    const result = await getPlayerMatchHistory({
      userId: req.params.userId,
      limit: parseLimit(req.query.limit, 20),
      cursor,
    });
    res.json({
      matches: result.rows,
      nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
    });
  } catch (error) {
    next(error);
  }
});

const staticDir = resolve(process.env.PUBLIC_DIR ?? "../web/dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/matchmake")) {
      return next();
    }
    res.sendFile(join(staticDir, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (error instanceof InvalidCursorError) {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error("Falha na API:", error);
  res.status(500).json({ error: "Falha interna do servidor." });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("hegemonia", HegemoniaRoom).filterBy(["roomCode"]);

await checkDatabase();
httpServer.listen(PORT, HOST, () => {
  console.log(`Hegemonia Server listening on [${HOST}]:${PORT} (IPv6 + IPv4 Dual-Stack)`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

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
  if (
    typeof cursor.score !== "number" || !Number.isInteger(cursor.score) || cursor.score < 0 ||
    typeof cursor.wins !== "number" || !Number.isInteger(cursor.wins) || cursor.wins < 0 ||
    typeof cursor.userId !== "string" || !UUID_PATTERN.test(cursor.userId)
  ) {
    throw new InvalidCursorError("Cursor de paginação inválido.");
  }
  return { score: cursor.score, wins: cursor.wins, userId: cursor.userId };
}

function decodeMatchHistoryCursor(value: unknown): MatchHistoryCursor | undefined {
  const cursor = decodeCursor(value);
  if (cursor === undefined) return undefined;
  if (
    typeof cursor.endedAt !== "string" || !Number.isFinite(Date.parse(cursor.endedAt)) ||
    typeof cursor.matchId !== "string" || !UUID_PATTERN.test(cursor.matchId)
  ) {
    throw new InvalidCursorError("Cursor de paginação inválido.");
  }
  return { endedAt: cursor.endedAt, matchId: cursor.matchId };
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
