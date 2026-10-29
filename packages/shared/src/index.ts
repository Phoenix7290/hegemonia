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

export interface MarketResourcePrice {
  buyPrice: number;
  sellPrice: number;
}

export interface MarketPrices {
  steel: MarketResourcePrice;
  oil: MarketResourcePrice;
  gold: MarketResourcePrice;
}

export interface InvestmentRoute {
  id: string;
  playerAId: string;
  playerBId: string;
  treatyId: string;
  status: "pending" | "active";
  roundsActive: number;
  createdRound: number;
}

export interface BorderTradeDeal {
  id: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromTerritoryId: string;
  toTerritoryId: string;
  resource: ResourceType;
  price: number;
  status: "pending" | "active";
  createdRound: number;
}

export const BuildingTypeSchema = z.enum([
  "market",
  "industry",
  "fortification",
  "airfield",
  "port",
]);
export type BuildingType = z.infer<typeof BuildingTypeSchema>;

export interface TerritoryBuilding {
  type: BuildingType;
  level: number;
}

export interface PlayerResources {
  money: number;
  steel: number;
  oil: number;
  gold: number;
}

export const UnitTypeSchema = z.enum([
  "infantry",
  "tank",
  "artillery",
  "aircraft",
  "navy",
]);
export type UnitType = z.infer<typeof UnitTypeSchema>;

export const UnitCountsSchema = z.object({
  infantry: z.number().int().min(0),
  tank: z.number().int().min(0),
  artillery: z.number().int().min(0),
  aircraft: z.number().int().min(0),
  navy: z.number().int().min(0),
});
export type UnitCounts = z.infer<typeof UnitCountsSchema>;

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

export interface PlayerMatchAnalytics {
  capitalContinentId?: ContinentId;
  totalMoneyEarned: number;
  fuelStarvationTurns: number;
  encircledRoundsCount: number;
  buildingsConstructed: Record<BuildingType, number>;
  unitsRecruited: UnitCounts;
  unitsLost: UnitCounts;
  unificationRounds: Partial<Record<ContinentId, number>>;
}

export function createInitialPlayerAnalytics(capitalContinentId?: ContinentId): PlayerMatchAnalytics {
  return {
    capitalContinentId,
    totalMoneyEarned: 0,
    fuelStarvationTurns: 0,
    encircledRoundsCount: 0,
    buildingsConstructed: {
      market: 0,
      industry: 0,
      fortification: 0,
      airfield: 0,
      port: 0,
    },
    unitsRecruited: {
      infantry: 0,
      tank: 0,
      artillery: 0,
      aircraft: 0,
      navy: 0,
    },
    unitsLost: {
      infantry: 0,
      tank: 0,
      artillery: 0,
      aircraft: 0,
      navy: 0,
    },
    unificationRounds: {},
  };
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
  /** Geoeconomic match telemetry & continental balance metrics (HEGEM-59) */
  analytics?: PlayerMatchAnalytics;
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
  units?: UnitCounts;
  /** Armies that already moved into this territory during the maneuver phase */
  movedInArmies: number;
  movedInUnits?: UnitCounts;
  /** Constructed infrastructure buildings on this territory (max 2 regular, 3 in active capital) */
  buildings?: TerritoryBuilding[];
  /** Whether this territory's airfield has already performed a strategic airlift this turn */
  airliftedThisTurn?: boolean;
  /** Whether this territory is encircled/out of supply line with capital (HEGEM-35) */
  isEncircled?: boolean;
  /** Consecutive rounds this territory has been encircled without supply */
  encircledRounds?: number;
  /** Whether mechanized units in this territory are out of fuel due to national oil <= 0 */
  outOfFuel?: boolean;
  /** Whether this territory has blitzkrieg spearhead attack available this turn */
  blitzkriegAvailable?: boolean;
  /** Round when this territory was conquered */
  conqueredTurnRound?: number;
  /** Whether infantry in this territory is fatigued from assaulting and cannot lead a second assault */
  infantryAssaultFatigued?: boolean;
  /** Whether artillery barrage was already fired from this territory this turn */
  artilleryBarrageFiredThisTurn?: boolean;
  /** Whether an air mission was already launched from this airfield this turn */
  airMissionFlownThisTurn?: boolean;
  /** Target territory has received Close Air Support (CAS) bonus for attacker */
  casBonusAttackerId?: string;
}

export interface PendingConquest {
  fromTerritoryId: string;
  toTerritoryId: string;
  minMove: number;
  maxMove: number;
  occupyingUnits?: UnitCounts;
  remainingAttackers?: UnitCounts;
}

export interface CombatRollResult {
  fromTerritoryId: string;
  toTerritoryId: string;
  attackerDice: number[];
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  attackerLossUnits?: UnitCounts;
  defenderLossUnits?: UnitCounts;
  conquered: boolean;
  attackerModifier?: number;
  defenderModifier?: number;
  lastStandBonus?: boolean;
  fortificationLevel?: number;
  casBonus?: boolean;
  blitzkriegBonus?: boolean;
  encircledDefenderPenalty?: number;
  navalBlockade?: boolean;
  coastalBombardmentBonus?: boolean;
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
  /** Dynamic Age of Empires 2-style global market prices */
  marketPrices: MarketPrices;
  /** Active bilateral commercial investment routes between allied markets */
  investmentRoutes: InvestmentRoute[];
  /** Active and pending border trade resource extraction contracts */
  borderTrades: BorderTradeDeal[];
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

export const BuildStructureActionSchema = z.object({
  type: z.literal("build_structure"),
  territoryId: z.string(),
  buildingType: BuildingTypeSchema,
});

export const RecruitUnitActionSchema = z.object({
  type: z.literal("recruit_unit"),
  territoryId: z.string(),
  unitType: UnitTypeSchema,
  quantity: z.number().int().min(1).default(1),
});

export const AirliftActionSchema = z.object({
  type: z.literal("airlift"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  armies: z.number().int().min(1),
});

export const MarketTradeActionSchema = z.object({
  type: z.literal("market_trade"),
  operation: z.enum(["buy", "sell"]),
  resource: ResourceTypeSchema,
  quantity: z.number().int().min(1).default(1),
});

export const ProposeInvestmentActionSchema = z.object({
  type: z.literal("propose_investment"),
  targetPlayerId: z.string(),
});

export const AcceptInvestmentActionSchema = z.object({
  type: z.literal("accept_investment"),
  routeId: z.string(),
});

export const RejectInvestmentActionSchema = z.object({
  type: z.literal("reject_investment"),
  routeId: z.string(),
});

export const ProposeBorderTradeActionSchema = z.object({
  type: z.literal("propose_border_trade"),
  targetPlayerId: z.string(),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  resource: ResourceTypeSchema,
  price: z.number().int().min(1),
});

export const AcceptBorderTradeActionSchema = z.object({
  type: z.literal("accept_border_trade"),
  dealId: z.string(),
});

export const RejectBorderTradeActionSchema = z.object({
  type: z.literal("reject_border_trade"),
  dealId: z.string(),
});

export const ArtilleryBarrageActionSchema = z.object({
  type: z.literal("artillery_barrage"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
});
export type ArtilleryBarrageAction = z.infer<typeof ArtilleryBarrageActionSchema>;

export const AirMissionTypeSchema = z.enum(["cas", "bombardment", "recon"]);
export type AirMissionType = z.infer<typeof AirMissionTypeSchema>;

export const AirMissionActionSchema = z.object({
  type: z.literal("air_mission"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  missionType: AirMissionTypeSchema,
});
export type AirMissionAction = z.infer<typeof AirMissionActionSchema>;

export const AttackActionSchema = z.object({
  type: z.literal("attack"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  diceCount: z.number().int().min(1).max(3).optional(),
  units: UnitCountsSchema.optional(),
});

export const OccupyActionSchema = z.object({
  type: z.literal("occupy"),
  armies: z.number().int().min(1).max(3),
  units: UnitCountsSchema.optional(),
});

export const EndAttackPhaseActionSchema = z.object({
  type: z.literal("end_attack"),
});

export const ManeuverActionSchema = z.object({
  type: z.literal("maneuver"),
  fromTerritoryId: z.string(),
  toTerritoryId: z.string(),
  armies: z.number().int().min(1),
  units: UnitCountsSchema.optional(),
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
  BuildStructureActionSchema,
  RecruitUnitActionSchema,
  AirliftActionSchema,
  MarketTradeActionSchema,
  ProposeInvestmentActionSchema,
  AcceptInvestmentActionSchema,
  RejectInvestmentActionSchema,
  ProposeBorderTradeActionSchema,
  AcceptBorderTradeActionSchema,
  RejectBorderTradeActionSchema,
  ArtilleryBarrageActionSchema,
  AirMissionActionSchema,
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
