import { z } from "zod";

export const PlayerColorSchema = z.enum([
  "blue",
  "red",
  "green",
  "yellow",
  "black",
  "white",
]);
export type PlayerColor = z.infer<typeof PlayerColorSchema>;

export const ContinentIdSchema = z.enum([
  "south_america",
  "north_america",
  "europe",
  "africa",
  "asia",
  "oceania",
]);
export type ContinentId = z.infer<typeof ContinentIdSchema>;

export const CardSymbolSchema = z.enum([
  "circle",
  "square",
  "triangle",
  "joker",
]);
export type CardSymbol = z.infer<typeof CardSymbolSchema>;

export const TurnPhaseSchema = z.enum([
  "deploy",
  "attack",
  "maneuver",
  "game_over",
]);
export type TurnPhase = z.infer<typeof TurnPhaseSchema>;

export interface TerritoryDef {
  id: string;
  name: string;
  namePt: string;
  continent: ContinentId;
  symbol: Exclude<CardSymbol, "joker">;
  neighbors: string[];
  /** Visual centroid [x, y] in SVG viewBox 0..1000 x 0..560 */
  center: [number, number];
  /** Stylized polygon SVG path data */
  svgPath: string;
}

export interface ContinentDef {
  id: ContinentId;
  name: string;
  namePt: string;
  bonus: number;
  color: string;
}

export interface GameMapDef {
  id: string;
  name: string;
  continents: ContinentDef[];
  territories: TerritoryDef[];
}

export interface TerritoryCard {
  id: string;
  territoryId: string | null; // null for jokers
  symbol: CardSymbol;
}

export type ObjectiveKind =
  | {
      type: "continents";
      continents: ContinentId[];
      extraAnyContinent?: boolean;
    }
  | {
      type: "territories";
      count: number;
      minArmiesPerTerritory: number;
    }
  | {
      type: "destroy_color";
      targetColor: PlayerColor;
      fallbackTerritories: number;
    }
  | {
      type: "specific_territories";
      territoryIds: string[];
      extraAnyOf?: string[][];
    };

export interface ObjectiveCard {
  id: string;
  descriptionPt: string;
  descriptionEn: string;
  rule: ObjectiveKind;
  coreTerritoryIds?: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  color: PlayerColor;
  eliminated: boolean;
  eliminatedBy?: string;
  objective: ObjectiveCard;
  cards: TerritoryCard[];
  unplacedArmies: number;
  conqueredThisTurn: boolean;
  connected: boolean;
}

export interface TerritoryState {
  id: string;
  ownerId: string;
  armies: number;
  /** Armies that already moved into this territory during the maneuver phase */
  movedInArmies: number;
}

export interface PendingConquest {
  fromTerritoryId: string;
  toTerritoryId: string;
  minMove: number;
  maxMove: number;
}

export interface CombatRollResult {
  fromTerritoryId: string;
  toTerritoryId: string;
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  conquered: boolean;
}

export interface GameState {
  id: string;
  round: number;
  turnIndex: number;
  phase: TurnPhase;
  players: PlayerState[];
  territories: Record<string, TerritoryState>;
  deck: TerritoryCard[];
  discardPile: TerritoryCard[];
  tradeCount: number;
  pendingConquest: PendingConquest | null;
  lastCombat: CombatRollResult | null;
  winnerId: string | null;
  seedCommitHash: string;
  revealedSeed?: string;
  log: string[];
}

// Client -> Server Action Schemas (Zod)
export const DeployActionSchema = z.object({
  type: z.literal("deploy"),
  territoryId: z.string(),
  armies: z.number().int().min(1),
});

export const TradeCardsActionSchema = z.object({
  type: z.literal("trade_cards"),
  cardIds: z.tuple([z.string(), z.string(), z.string()]),
});

export const AttackActionSchema = z.object({
  type: z.literal("attack"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  diceCount: z.number().int().min(1).max(3).optional(),
});

export const OccupyActionSchema = z.object({
  type: z.literal("occupy"),
  armies: z.number().int().min(1).max(3),
});

export const EndAttackPhaseActionSchema = z.object({
  type: z.literal("end_attack"),
});

export const ManeuverActionSchema = z.object({
  type: z.literal("maneuver"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  armies: z.number().int().min(1),
});

export const EndTurnActionSchema = z.object({
  type: z.literal("end_turn"),
});

export const GameActionSchema = z.discriminatedUnion("type", [
  DeployActionSchema,
  TradeCardsActionSchema,
  AttackActionSchema,
  OccupyActionSchema,
  EndAttackPhaseActionSchema,
  ManeuverActionSchema,
  EndTurnActionSchema,
]);

export type GameAction = z.infer<typeof GameActionSchema>;
