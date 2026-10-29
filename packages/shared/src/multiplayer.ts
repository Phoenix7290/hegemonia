import { z } from "zod";

export const MATCHMAKING_RULESET_VERSION = "0.1.0";
export const MATCHMAKING_QUEUE = "classic_ffa";

export const CompetitionModeSchema = z.enum(["ranked", "casual", "custom"]);
export type CompetitionMode = z.infer<typeof CompetitionModeSchema>;

export const PublicQueueModeSchema = z.enum(["ranked", "casual"]);
export type PublicQueueMode = z.infer<typeof PublicQueueModeSchema>;

export const MatchOriginSchema = z.enum(["matchmaking", "lobby"]);
export type MatchOrigin = z.infer<typeof MatchOriginSchema>;

export const MatchmakingEnqueueSchema = z.object({
  mode: PublicQueueModeSchema,
  rulesetVersion: z.string().max(32).optional(),
  region: z.string().trim().min(2).max(32).optional(),
  latencyMs: z.number().int().min(0).max(10_000).optional(),
});
export type MatchmakingEnqueueInput = z.infer<typeof MatchmakingEnqueueSchema>;

export interface MatchmakingSeason {
  id: string;
  slug: string;
  name: string;
}

export interface MatchmakingStatus {
  status: "idle" | "queued" | "matched";
  mode: PublicQueueMode | null;
  queuedAt: string | null;
  elapsedSeconds: number;
  roomCode: string | null;
  season: MatchmakingSeason | null;
}

export const IDLE_MATCHMAKING_STATUS: MatchmakingStatus = {
  status: "idle",
  mode: null,
  queuedAt: null,
  elapsedSeconds: 0,
  roomCode: null,
  season: null,
};
