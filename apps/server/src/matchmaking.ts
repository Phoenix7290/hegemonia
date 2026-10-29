import { randomUUID } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  IDLE_MATCHMAKING_STATUS,
  MATCHMAKING_QUEUE,
  MATCHMAKING_RULESET_VERSION,
  type MatchmakingEnqueueInput,
  type MatchmakingSeason,
  type MatchmakingStatus,
  type PublicQueueMode,
} from "@hegemonia/shared";
import { query } from "./connection.js";

const QUEUE_SIZE = 2;
const QUEUE_HEARTBEAT_TTL_MS = 30_000;
const MATCH_RESERVATION_TTL_MS = 120_000;
const MAX_RATING_RANGE = 1_000;

interface QueueTicket {
  id: string;
  userId: string;
  mode: PublicQueueMode;
  rulesetVersion: string;
  region: string | null;
  latencyMs: number | null;
  enqueuedAt: number;
  lastSeenAt: number;
  rating: number;
  season: MatchmakingSeason | null;
  status: "queued" | "reserving" | "matched";
  roomCode: string | null;
  matchedAt: number | null;
}

export interface MatchedRoomOptions {
  competitionMode: PublicQueueMode;
  matchOrigin: "matchmaking";
  seasonId?: string;
  expectedUserIds: string[];
  matchmakingTicketIds: string[];
  rulesConfig: {
    mapId: "classic";
    gameMode: "classic";
    queue: typeof MATCHMAKING_QUEUE;
    rulesetVersion: string;
  };
}

interface MatchmakingDependencies {
  now: () => number;
  createRoom: (options: MatchedRoomOptions) => Promise<{ roomId: string }>;
  hasActiveMatch: (userId: string) => Promise<boolean>;
  getRankedContext: (userId: string) => Promise<{ rating: number; season: MatchmakingSeason }>;
}

export class MatchmakingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class MatchmakingService {
  private readonly tickets = new Map<string, QueueTicket>();
  private readonly activeRooms = new Map<string, string>();
  private operations: Promise<unknown> = Promise.resolve();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly dependencies: MatchmakingDependencies) {
    this.sweepTimer = setInterval(() => {
      void this.serialize(() => this.matchTickets());
    }, 1_000);
    this.sweepTimer.unref();
  }

  async enqueue(userId: string, input: MatchmakingEnqueueInput): Promise<MatchmakingStatus> {
    return this.serialize(async () => {
      if (this.tickets.has(userId)) {
        throw new MatchmakingError(409, "already_queued", "Esta conta já possui uma busca ou partida reservada.");
      }
      if (this.activeRooms.has(userId) || await this.dependencies.hasActiveMatch(userId)) {
        throw new MatchmakingError(409, "active_match", "Saia da partida ativa antes de entrar em uma fila.");
      }
      const rulesetVersion = input.rulesetVersion ?? MATCHMAKING_RULESET_VERSION;
      if (rulesetVersion !== MATCHMAKING_RULESET_VERSION) {
        throw new MatchmakingError(409, "version_incompatible", "Atualize o cliente para entrar nesta fila.");
      }

      const now = this.dependencies.now();
      const ranked = input.mode === "ranked"
        ? await this.dependencies.getRankedContext(userId)
        : null;
      const ticket: QueueTicket = {
        id: randomUUID(),
        userId,
        mode: input.mode,
        rulesetVersion,
        region: input.region?.toLowerCase() ?? null,
        latencyMs: input.latencyMs ?? null,
        enqueuedAt: now,
        lastSeenAt: now,
        rating: ranked?.rating ?? 1_000,
        season: ranked?.season ?? null,
        status: "queued",
        roomCode: null,
        matchedAt: null,
      };
      this.tickets.set(userId, ticket);
      await this.matchTickets();
      return this.statusFor(ticket);
    });
  }

  async getStatus(userId: string): Promise<MatchmakingStatus> {
    return this.serialize(async () => {
      await this.matchTickets();
      const ticket = this.tickets.get(userId);
      if (!ticket) return { ...IDLE_MATCHMAKING_STATUS };
      if (ticket.status === "queued") ticket.lastSeenAt = this.dependencies.now();
      return this.statusFor(ticket);
    });
  }

  async cancel(userId: string): Promise<MatchmakingStatus> {
    return this.serialize(() => {
      const ticket = this.tickets.get(userId);
      if (ticket?.status === "matched" || ticket?.status === "reserving") {
        throw new MatchmakingError(409, "match_already_found", "A partida já foi encontrada; conecte-se à sala reservada.");
      }
      this.tickets.delete(userId);
      return { ...IDLE_MATCHMAKING_STATUS };
    });
  }

  async logout(userId: string): Promise<void> {
    await this.serialize(() => {
      const ticket = this.tickets.get(userId);
      if (ticket?.status === "queued") this.tickets.delete(userId);
    });
  }

  confirmParticipant(userId: string, roomCode: string): void {
    const activeRoom = this.activeRooms.get(userId);
    if (activeRoom && activeRoom !== roomCode) {
      throw new MatchmakingError(409, "active_match", "Esta conta já participa de outra partida ativa.");
    }
    this.activeRooms.set(userId, roomCode);
    this.tickets.delete(userId);
  }

  releaseParticipant(userId: string, roomCode: string): void {
    if (this.activeRooms.get(userId) === roomCode) this.activeRooms.delete(userId);
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
  }

  private statusFor(ticket: QueueTicket): MatchmakingStatus {
    const now = this.dependencies.now();
    return {
      status: ticket.status === "matched" ? "matched" : "queued",
      mode: ticket.mode,
      queuedAt: new Date(ticket.enqueuedAt).toISOString(),
      elapsedSeconds: Math.max(0, Math.floor((now - ticket.enqueuedAt) / 1_000)),
      roomCode: ticket.roomCode,
      season: ticket.season,
    };
  }

  private async matchTickets(): Promise<void> {
    const now = this.dependencies.now();
    for (const [userId, ticket] of this.tickets) {
      const expired = ticket.status === "matched"
        ? now - (ticket.matchedAt ?? now) >= MATCH_RESERVATION_TTL_MS
        : ticket.status === "queued" && now - ticket.lastSeenAt >= QUEUE_HEARTBEAT_TTL_MS;
      if (expired) this.tickets.delete(userId);
    }

    for (const mode of ["ranked", "casual"] as const) {
      let candidates = this.queuedTickets(mode);
      while (candidates.length >= QUEUE_SIZE) {
        const group = this.selectGroup(candidates, now);
        if (!group) break;
        for (const ticket of group) ticket.status = "reserving";
        try {
          const room = await this.dependencies.createRoom({
            competitionMode: mode,
            matchOrigin: "matchmaking",
            seasonId: group[0].season?.id,
            expectedUserIds: group.map((ticket) => ticket.userId),
            matchmakingTicketIds: group.map((ticket) => ticket.id),
            rulesConfig: {
              mapId: "classic",
              gameMode: "classic",
              queue: MATCHMAKING_QUEUE,
              rulesetVersion: MATCHMAKING_RULESET_VERSION,
            },
          });
          for (const ticket of group) {
            const current = this.tickets.get(ticket.userId);
            if (current?.id !== ticket.id) continue;
            current.status = "matched";
            current.roomCode = room.roomId;
            current.matchedAt = this.dependencies.now();
          }
        } catch (error) {
          for (const ticket of group) {
            const current = this.tickets.get(ticket.userId);
            if (current?.id === ticket.id && current.status === "reserving") {
              current.status = "queued";
              current.lastSeenAt = this.dependencies.now();
            }
          }
          console.error("Falha ao criar sala do matchmaking:", error);
          return;
        }
        candidates = this.queuedTickets(mode);
      }
    }
  }

  private queuedTickets(mode: PublicQueueMode): QueueTicket[] {
    return [...this.tickets.values()]
      .filter((ticket) => ticket.mode === mode && ticket.status === "queued")
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id));
  }

  private selectGroup(candidates: QueueTicket[], now: number): QueueTicket[] | null {
    if (candidates[0].mode === "casual") return candidates.slice(0, QUEUE_SIZE);
    for (const anchor of candidates) {
      const range = rankedRatingRange(now - anchor.enqueuedAt);
      const compatible = candidates.filter((ticket) =>
        ticket.season?.id === anchor.season?.id &&
        ticket.region === anchor.region &&
        Math.abs(ticket.rating - anchor.rating) <= range
      );
      if (compatible.length >= QUEUE_SIZE) return compatible.slice(0, QUEUE_SIZE);
    }
    return null;
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.operations.then(operation, operation);
    this.operations = result.catch(() => undefined);
    return result;
  }
}

export function rankedRatingRange(waitMilliseconds: number): number {
  const steps = Math.floor(Math.max(0, waitMilliseconds) / 15_000);
  return Math.min(MAX_RATING_RANGE, 100 + steps * 100);
}

export const matchmakingService = new MatchmakingService({
  now: Date.now,
  createRoom: (options) => matchMaker.createRoom("hegemonia", options),
  hasActiveMatch: async (userId) => {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM match_participants p
        JOIN matches m ON m.id = p.match_id
        WHERE p.user_id = $1 AND m.status IN ('lobby', 'playing')
      ) AS exists`,
      [userId]
    );
    return result.rows[0].exists;
  },
  getRankedContext: async (userId) => {
    const seasonResult = await query<MatchmakingSeason>(
      `SELECT id, slug, name FROM seasons
       WHERE status = 'active' AND starts_at <= now()
         AND (ends_at IS NULL OR ends_at > now())
       ORDER BY starts_at DESC LIMIT 1`
    );
    const season = seasonResult.rows[0];
    if (!season) {
      throw new MatchmakingError(503, "no_active_season", "Nenhuma temporada competitiva está ativa.");
    }
    const ratingResult = await query<{ score: number }>(
      `SELECT score FROM player_ratings
       WHERE user_id = $1 AND season_id = $2 AND queue = $3`,
      [userId, season.id, MATCHMAKING_QUEUE]
    );
    return { season, rating: ratingResult.rows[0]?.score ?? 1_000 };
  },
});
