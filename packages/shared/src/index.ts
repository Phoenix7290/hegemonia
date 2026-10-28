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

export const ResourceTypeSchema = z.enum(["steel", "oil", "gold"]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export interface PlayerResources {
  money: number;
  steel: number;
  oil: number;
  gold: number;
}

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
  /** Native strategic resource deposit (steel, oil, or gold) */
  resource?: ResourceType;
  /** Passive trade hub / maritime strait money bonus per turn ($1 or $2) */
  tradeBonus?: number;
  /** Whether the territory is coastal or insular (allows building naval ports) */
  isCoastal?: boolean;
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
  /** Designated national capital territory ID */
  capitalTerritoryId?: string;
  /** Whether the capital was conquered/occupied by an adversary */
  isCapitalLost?: boolean;
  /** Round or turn when the capital was lost */
  capitalLostTurn?: number;
  /** Multiplier on economic income (defaults to 1.0; 0.5-0.7 when capital is lost) */
  economicPenaltyMultiplier?: number;
  /** Penalty applied to morale or recruitment (-2 armies when capital decapitated) */
  moralePenalty?: number;
  /** Individual player infamy percentage (0 to 100%) */
  infamy: number;
  /** National treasury ($) and strategic resource stockpiles (steel, oil, gold) */
  resources: PlayerResources;
  /** Whether this player has already purchased a supply card with gold on the current turn */
  boughtCardWithGoldThisTurn?: boolean;
}

export type TreatyType = "nap" | "alliance";
export type TreatyStatus = "pending" | "active" | "broken";

export interface Treaty {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  type: TreatyType;
  status: TreatyStatus;
  createdRound: number;
}

export interface Coalition {
  id: string;
  targetPlayerId: string;
  memberPlayerIds: string[];
  createdRound: number;
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
  attackerModifier?: number;
  defenderModifier?: number;
  lastStandBonus?: boolean;
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
  /** Global non-decaying World Tension percentage (0 to 100%) */
  worldTension: number;
  /** Active and pending bilateral diplomatic treaties */
  treaties: Treaty[];
  /** Active coalitions against warmonger/hegemon players */
  coalitions: Coalition[];
}

// Client -> Server Action Schemas (Zod)
export const SelectCapitalActionSchema = z.object({
  type: z.literal("select_capital"),
  territoryId: z.string(),
});

export const DeployActionSchema = z.object({
  type: z.literal("deploy"),
  territoryId: z.string(),
  armies: z.number().int().min(1),
});

export const TradeCardsActionSchema = z.object({
  type: z.literal("trade_cards"),
  cardIds: z.tuple([z.string(), z.string(), z.string()]),
});

export const BuyCardWithGoldActionSchema = z.object({
  type: z.literal("buy_card_with_gold"),
  paymentMode: z.enum(["gold_only", "gold_and_money"]).optional(),
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

export const ProposeTreatyActionSchema = z.object({
  type: z.literal("propose_treaty"),
  targetPlayerId: z.string(),
  treatyType: z.enum(["nap", "alliance"]),
});

export const AcceptTreatyActionSchema = z.object({
  type: z.literal("accept_treaty"),
  treatyId: z.string(),
});

export const RejectTreatyActionSchema = z.object({
  type: z.literal("reject_treaty"),
  treatyId: z.string(),
});

export const BreakTreatyActionSchema = z.object({
  type: z.literal("break_treaty"),
  treatyId: z.string(),
});

export const FormCoalitionActionSchema = z.object({
  type: z.literal("form_coalition"),
  targetPlayerId: z.string(),
});

export const JoinCoalitionActionSchema = z.object({
  type: z.literal("join_coalition"),
  coalitionId: z.string(),
});

export const GameActionSchema = z.discriminatedUnion("type", [
  SelectCapitalActionSchema,
  DeployActionSchema,
  TradeCardsActionSchema,
  BuyCardWithGoldActionSchema,
  AttackActionSchema,
  OccupyActionSchema,
  EndAttackPhaseActionSchema,
  ManeuverActionSchema,
  EndTurnActionSchema,
  ProposeTreatyActionSchema,
  AcceptTreatyActionSchema,
  RejectTreatyActionSchema,
  BreakTreatyActionSchema,
  FormCoalitionActionSchema,
  JoinCoalitionActionSchema,
]);

export type GameAction = z.infer<typeof GameActionSchema>;

export * from "./identity.js";
export * from "./comms.js";
