import {
  type BorderTradeDeal,
  type BuildingType,
  createInitialPlayerAnalytics,
  type GameAction,
  type GameMapDef,
  type GameState,
  type InvestmentRoute,
  type MarketPrices,
  type MarketResourcePrice,
  type ObjectiveCard,
  type PlayerColor,
  type PlayerMatchAnalytics,
  type PlayerState,
  type ResourceType,
  type TerritoryCard,
  type TerritoryState,
  type UnitCounts,
  type UnitType,
} from "@hegemonia/shared";
import {
  ALL_OBJECTIVES,
  ALL_SEA_LINKS,
  ASIA_SUBREGIONS,
  CLASSIC_MAP,
  CLASSIC_OBJECTIVES,
  DIRECT_SEA_LINKS,
  isSeaLink,
  PACIFIC_WRAP_LINKS,
  ROLEPLAY_OBJECTIVES,
} from "@hegemonia/maps";
import { createSeededRng, hashSeed, type SeededRng } from "./rng.js";
import {
  addUnits,
  canSubtractUnits,
  emptyUnitCounts,
  getMovedInUnits,
  getTerritoryUnits,
  removeCasualties,
  selectUnits,
  setMovedInUnits,
  setTerritoryUnits,
  singleUnitCount,
  subtractUnits,
  totalUnits,
  UNIT_TYPES,
} from "./units.js";

export * from "./rng.js";
export * from "./units.js";

export interface CreateGameOptions {
  id: string;
  players: { id: string; name: string; color: PlayerColor }[];
  seed: string;
  map?: GameMapDef;
  objectives?: ObjectiveCard[];
}

/**
 * Classic Grow War trade progression: 4, 6, 8, 10, 12, 15, then +5 per subsequent exchange
 */
export function getTradeBonusArmies(tradeIndexZeroBased: number): number {
  const table = [4, 6, 8, 10, 12, 15];
  if (tradeIndexZeroBased < table.length) {
    return table[tradeIndexZeroBased];
  }
  return 15 + (tradeIndexZeroBased - (table.length - 1)) * 5;
}

/**
 * Checks if 3 territory cards form a valid exchange set:
 * - 3 identical symbols OR 3 all-different symbols (joker counts as anything)
 */
export function isValidCardSet(cards: TerritoryCard[]): boolean {
  if (cards.length !== 3) return false;
  const nonJokers = cards.filter((c) => c.symbol !== "joker");
  if (nonJokers.length <= 1) return true; // 2 or 3 jokers always valid
  if (nonJokers.length === 2) {
    // 1 joker can complete either 3-of-a-kind or 3-different
    return true;
  }
  const [a, b, c] = nonJokers.map((x) => x.symbol);
  const allSame = a === b && b === c;
  const allDiff = a !== b && b !== c && a !== c;
  return allSame || allDiff;
}

/**
 * Calculates start-of-turn reinforcements for a player:
 * max(3, floor(ownedTerritories / 2)) + full continent bonuses
 */
export function calculateTurnReinforcements(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): {
  baseArmies: number;
  continentBonus: number;
  capitalBonus: number;
  moralePenalty: number;
  total: number;
  controlledContinents: string[];
} {
  const player = state.players.find((p) => p.id === playerId);
  const ownedIds = Object.values(state.territories)
    .filter((t) => t.ownerId === playerId)
    .map((t) => t.id);
  const ownedSet = new Set(ownedIds);

  const baseArmies = Math.max(3, Math.floor(ownedIds.length / 2));
  let continentBonus = 0;
  const controlledContinents: string[] = [];

  for (const cont of map.continents) {
    if (cont.id === "asia") {
      // Asia is divided into 3 strategic sub-regions (+2 Indo-Arábia, +2 Estepes & Sibéria, +3 Leste Asiático = +7 total)
      let allAsiaSubregionsControlled = true;
      for (const sub of ASIA_SUBREGIONS) {
        if (sub.territoryIds.every((tid) => ownedSet.has(tid))) {
          continentBonus += sub.bonus;
          controlledContinents.push(sub.id);
        } else {
          allAsiaSubregionsControlled = false;
        }
      }
      if (allAsiaSubregionsControlled) {
        controlledContinents.push("asia");
      }
      continue;
    }
    const contTerritories = map.territories.filter((t) => t.continent === cont.id);
    if (contTerritories.length > 0 && contTerritories.every((t) => ownedSet.has(t.id))) {
      continentBonus += cont.bonus;
      controlledContinents.push(cont.id);
    }
  }

  // Capital bonus: +1 division if the player controls their assigned capital
  let capitalBonus = 0;
  if (
    player?.capitalTerritoryId &&
    state.territories[player.capitalTerritoryId]?.ownerId === playerId
  ) {
    capitalBonus = 1;
  }

  const moralePenalty = player?.moralePenalty ?? 0;
  const total = Math.max(1, baseArmies + continentBonus + capitalBonus - moralePenalty);

  return {
    baseArmies,
    continentBonus,
    capitalBonus,
    moralePenalty,
    total,
    controlledContinents,
  };
}

export interface BuildingCost {
  money: number;
  steel: number;
}

export const BUILDING_COSTS: Record<BuildingType, BuildingCost> = {
  market: { money: 5, steel: 0 },
  industry: { money: 6, steel: 1 },
  fortification: { money: 4, steel: 0 }, // Level 1 Casamata
  airfield: { money: 5, steel: 1 },
  port: { money: 5, steel: 0 },
};

export const FORTIFICATION_LEVEL_2_COST: BuildingCost = {
  money: 4,
  steel: 1,
};

export interface UnitCost {
  money: number;
  steel: number;
  oil: number;
}

export const UNIT_COSTS: Record<UnitType, UnitCost> = {
  infantry: { money: 3, steel: 0, oil: 0 },
  tank: { money: 4, steel: 2, oil: 0 },
  artillery: { money: 4, steel: 2, oil: 0 },
  aircraft: { money: 5, steel: 1, oil: 1 },
  navy: { money: 5, steel: 2, oil: 1 },
};

export interface MarketPriceConfig {
  baseBuy: number;
  baseSell: number;
  step: number;
  minSell: number;
  maxBuy: number;
}

export const DEFAULT_MARKET_CONFIG: Record<ResourceType, MarketPriceConfig> = {
  steel: { baseBuy: 4, baseSell: 3, step: 1, minSell: 1, maxBuy: 12 },
  oil: { baseBuy: 5, baseSell: 4, step: 1, minSell: 2, maxBuy: 14 },
  gold: { baseBuy: 8, baseSell: 6, step: 2, minSell: 4, maxBuy: 18 },
};

export const INITIAL_MARKET_PRICES: MarketPrices = {
  steel: { buyPrice: 4, sellPrice: 3 },
  oil: { buyPrice: 5, sellPrice: 4 },
  gold: { buyPrice: 8, sellPrice: 6 },
};

/**
 * Checks whether a player controls at least 1 territory with a built Market.
 */
export function playerHasMarket(state: GameState, playerId: string): boolean {
  return Object.values(state.territories).some(
    (t) => t.ownerId === playerId && hasTerritoryBuilding(t, "market")
  );
}

/**
 * Returns the maximum number of infrastructure building slots for a territory:
 * - 3 slots if the territory is the owner's active National Capital
 * - 2 slots for all regular territories
 */
export function getTerritoryMaxBuildingSlots(
  state: GameState,
  territoryId: string
): number {
  const terr = state.territories[territoryId];
  if (!terr) return 2;
  const owner = state.players.find((p) => p.id === terr.ownerId);
  if (owner && owner.capitalTerritoryId === territoryId && !owner.isCapitalLost) {
    return 3;
  }
  return 2;
}

export function getTerritoryBuildingLevel(
  terr: TerritoryState | undefined,
  buildingType: BuildingType
): number {
  if (!terr?.buildings) return 0;
  const found = terr.buildings.find((b) => b.type === buildingType);
  return found ? found.level : 0;
}

export function hasTerritoryBuilding(
  terr: TerritoryState | undefined,
  buildingType: BuildingType
): boolean {
  return getTerritoryBuildingLevel(terr, buildingType) >= 1;
}

/**
 * Applies 1 impact of siege/bombardment damage to a territory's fortification:
 * - Level 2 (Fortaleza) degrades to Level 1 (Casamata)
 * - Level 1 (Casamata) is destroyed
 */
export function damageTerritoryFortification(
  terr: TerritoryState
): "degraded_to_1" | "destroyed" | "none" {
  if (!terr.buildings) return "none";
  const idx = terr.buildings.findIndex((b) => b.type === "fortification");
  if (idx === -1) return "none";
  if (terr.buildings[idx].level >= 2) {
    terr.buildings[idx].level = 1;
    return "degraded_to_1";
  }
  terr.buildings.splice(idx, 1);
  return "destroyed";
}

export interface NavalBlockadeCheck {
  isBlockaded: boolean;
  reason?: string;
  attackerNavy: number;
  defenderNavy: number;
}

/**
 * Checks asymmetric naval blockade over strategic maritime links (HEGEM-57).
 * If the defender has strictly more naval units in connected ports than the attacker,
 * the maritime passage is blockaded.
 */
export function checkNavalBlockade(
  state: GameState,
  fromTerritoryId: string,
  toTerritoryId: string,
  actingPlayerId: string
): NavalBlockadeCheck {
  if (!isSeaLink(fromTerritoryId, toTerritoryId)) {
    return { isBlockaded: false, attackerNavy: 0, defenderNavy: 0 };
  }

  const fromTerr = state.territories[fromTerritoryId];
  const toTerr = state.territories[toTerritoryId];
  if (!fromTerr || !toTerr) {
    return { isBlockaded: false, attackerNavy: 0, defenderNavy: 0 };
  }

  const attackerPlayer = state.players.find((p) => p.id === actingPlayerId);
  const defenderPlayer = state.players.find((p) => p.id === toTerr.ownerId);

  const attackerHasOil = (attackerPlayer?.resources?.oil ?? 0) > 0;
  const defenderHasOil = (defenderPlayer?.resources?.oil ?? 0) > 0;

  let attackerNavy = 0;
  if (fromTerr.ownerId === actingPlayerId && hasTerritoryBuilding(fromTerr, "port") && attackerHasOil) {
    attackerNavy = getTerritoryUnits(fromTerr).navy;
  }

  let defenderNavy = 0;
  if (toTerr.ownerId !== actingPlayerId && hasTerritoryBuilding(toTerr, "port") && defenderHasOil) {
    defenderNavy = getTerritoryUnits(toTerr).navy;
  }

  const isBlockaded = defenderNavy > attackerNavy;
  return {
    isBlockaded,
    reason: isBlockaded ? `Bloqueio naval inimigo (${defenderNavy} vs ${attackerNavy} frotas)` : undefined,
    attackerNavy,
    defenderNavy,
  };
}

/**
 * Evaluates graph supply connectivity from national Capitals and flags encircled / out-of-supply territories (HEGEM-35).
 * Also flags out-of-fuel status for mechanized units if national oil <= 0.
 */
export function updateSupplyAndEncirclement(
  state: GameState,
  map: GameMapDef = CLASSIC_MAP
): void {
  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  for (const player of state.players) {
    if (player.eliminated) continue;

    const playerHasOil = (player.resources?.oil ?? 0) > 0;
    const playerTerritories = Object.values(state.territories).filter(
      (t) => t.ownerId === player.id
    );

    // Flag out of fuel
    for (const t of playerTerritories) {
      const units = getTerritoryUnits(t);
      const hasMechanized = units.tank > 0 || units.aircraft > 0 || units.navy > 0;
      t.outOfFuel = !playerHasOil && hasMechanized;
    }

    const capId = player.capitalTerritoryId;
    const hasValidCapital =
      capId &&
      state.territories[capId]?.ownerId === player.id &&
      !player.isCapitalLost;

    if (!hasValidCapital) {
      for (const t of playerTerritories) {
        t.isEncircled = false;
        t.encircledRounds = 0;
      }
      continue;
    }

    const suppliedIds = new Set<string>();
    const queue: string[] = [capId];
    suppliedIds.add(capId);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currDef = mapById.get(currId);
      if (!currDef) continue;
      const currTerr = state.territories[currId];

      for (const nbrId of currDef.neighbors) {
        if (suppliedIds.has(nbrId)) continue;
        const nbrTerr = state.territories[nbrId];
        if (!nbrTerr || nbrTerr.ownerId !== player.id) continue;

        if (isSeaLink(currId, nbrId)) {
          const blockade = checkNavalBlockade(state, currId, nbrId, player.id);
          if (blockade.isBlockaded) continue;
        }

        suppliedIds.add(nbrId);
        queue.push(nbrId);
      }
    }

    for (const t of playerTerritories) {
      if (suppliedIds.has(t.id)) {
        t.isEncircled = false;
        t.encircledRounds = 0;
      } else {
        t.isEncircled = true;
        t.encircledRounds = Math.max(1, t.encircledRounds ?? 1);
      }
    }
  }
}

/**
 * Finds all territories within an Airfield's operational range:
 * BFS distance <= 2, with at most 1 maritime sea link crossing (HEGEM-30).
 */
export function findAirMissionTargets(
  state: GameState,
  fromTerritoryId: string,
  map: GameMapDef = CLASSIC_MAP
): string[] {
  const mapById = new Map(map.territories.map((t) => [t.id, t]));
  const fromDef = mapById.get(fromTerritoryId);
  if (!fromDef) return [];

  const targets = new Set<string>();
  type QueueItem = { id: string; distance: number; seaCrossings: number };
  const queue: QueueItem[] = [{ id: fromTerritoryId, distance: 0, seaCrossings: 0 }];
  const visited = new Map<string, number>();
  visited.set(fromTerritoryId, 0);

  while (queue.length > 0) {
    const { id, distance, seaCrossings } = queue.shift()!;
    if (distance > 0) {
      targets.add(id);
    }
    if (distance >= 2) continue;

    const def = mapById.get(id);
    if (!def) continue;

    for (const nbrId of def.neighbors) {
      const isSea = isSeaLink(id, nbrId);
      const nextCrossings = seaCrossings + (isSea ? 1 : 0);
      if (nextCrossings > 1) continue;

      const prevCrossings = visited.get(nbrId);
      if (prevCrossings !== undefined && prevCrossings <= nextCrossings) continue;
      visited.set(nbrId, nextCrossings);
      queue.push({ id: nbrId, distance: distance + 1, seaCrossings: nextCrossings });
    }
  }

  return Array.from(targets);
}

export interface TurnEconomyBreakdown {
  capitalMoney: number;
  tradeHubMoney: number;
  goldPassiveMoney: number;
  buildingMoney: number;
  investmentMoney: number;
  grossMoney: number;
  economicPenaltyMultiplier: number;
  netMoney: number;
  steel: number;
  oil: number;
  gold: number;
}

/**
 * Calculates start-of-turn economic income and strategic resource extraction (HEGEM-18, HEGEM-32, HEGEM-22):
 * - Capital National Treasury: +3$ if the player has established a capital
 * - Trade Hubs: sum of territory `tradeBonus` across occupied territories (armies >= 1)
 * - Gold Passive Treasury: +2$ per occupied territory with `resource === "gold"`
 * - Building Income:
 *   - +2$ per `market`
 *   - +2$ per `industry` in a territory without a natural resource (`!def.resource`)
 *   - +1$ per `port` built in a Trade Hub (`(def.tradeBonus ?? 0) > 0`)
 * - Allied Investment Routes:
 *   - +2$ per active route (rising to +3$ after 3 rounds of peace)
 * - Strategic Extraction: +1 Steel / Oil / Gold per occupied territory with matching `resource`
 *   (doubled to +2/turn if the territory has an `industry` building)
 * - Decapitation Penalty: `netMoney = Math.floor(grossMoney * economicPenaltyMultiplier)`
 */
export function calculateTurnEconomy(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): TurnEconomyBreakdown {
  const player = state.players.find((p) => p.id === playerId);
  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  const occupiedTerritories = Object.values(state.territories).filter(
    (t) => t.ownerId === playerId && t.armies >= 1
  );

  const capitalMoney = player?.capitalTerritoryId ? 3 : 0;
  let tradeHubMoney = 0;
  let goldPassiveMoney = 0;
  let buildingMoney = 0;
  let investmentMoney = 0;
  let steel = 0;
  let oil = 0;
  let gold = 0;

  for (const terr of occupiedTerritories) {
    const def = mapById.get(terr.id);
    if (!def) continue;
    const hasMarket = hasTerritoryBuilding(terr, "market");
    const hasIndustry = hasTerritoryBuilding(terr, "industry");
    const hasPort = hasTerritoryBuilding(terr, "port");

    if (def.tradeBonus && def.tradeBonus > 0) {
      tradeHubMoney += def.tradeBonus;
      if (hasPort) {
        buildingMoney += 1;
      }
    }
    if (hasMarket) {
      buildingMoney += 2;
    }
    if (hasIndustry && !def.resource) {
      buildingMoney += 2;
    }

    const resourceYield = hasIndustry ? 2 : 1;
    if (def.resource === "steel") {
      steel += resourceYield;
    } else if (def.resource === "oil") {
      oil += resourceYield;
    } else if (def.resource === "gold") {
      gold += resourceYield;
      goldPassiveMoney += 2;
    }
  }

  // Calculate income from active Allied Investment Routes (HEGEM-22)
  if (state.investmentRoutes && state.investmentRoutes.length > 0) {
    for (const route of state.investmentRoutes) {
      if (
        route.status === "active" &&
        (route.playerAId === playerId || route.playerBId === playerId) &&
        playerHasMarket(state, route.playerAId) &&
        playerHasMarket(state, route.playerBId)
      ) {
        investmentMoney += route.roundsActive >= 3 ? 3 : 2;
      }
    }
  }

  const grossMoney =
    capitalMoney + tradeHubMoney + goldPassiveMoney + buildingMoney + investmentMoney;
  const economicPenaltyMultiplier = player?.isCapitalLost
    ? (player.economicPenaltyMultiplier ?? 0.5)
    : 1.0;
  const netMoney = Math.floor(grossMoney * economicPenaltyMultiplier);

  return {
    capitalMoney,
    tradeHubMoney,
    goldPassiveMoney,
    buildingMoney,
    investmentMoney,
    grossMoney,
    economicPenaltyMultiplier,
    netMoney,
    steel,
    oil,
    gold,
  };
}

function collectTurnEconomy(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): TurnEconomyBreakdown {
  const player = state.players.find((p) => p.id === playerId);
  const econ = calculateTurnEconomy(state, playerId, map);
  if (!player) return econ;

  player.resources = player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  player.resources.money += econ.netMoney;
  player.resources.steel += econ.steel;
  player.resources.oil += econ.oil;
  player.resources.gold += econ.gold;

  player.analytics = player.analytics ?? createInitialPlayerAnalytics();
  player.analytics.totalMoneyEarned += econ.netMoney;

  const parts: string[] = [];
  if (econ.netMoney > 0) parts.push(`+$${econ.netMoney}`);
  if (econ.steel > 0) parts.push(`+${econ.steel} Aço`);
  if (econ.oil > 0) parts.push(`+${econ.oil} Petróleo`);
  if (econ.gold > 0) parts.push(`+${econ.gold} Ouro`);

  if (parts.length > 0) {
    state.log.push(`Economia de ${player.name}: ${parts.join(", ")}.`);
  }
  return econ;
}

/**
 * Initializes a new authoritative game state.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const map = opts.map ?? CLASSIC_MAP;
  if (opts.players.length < 2 || opts.players.length > 6) {
    throw new Error("Player count must be between 2 and 6.");
  }

  const rng = createSeededRng(opts.seed);
  const shuffledPlayers = rng.shuffle(opts.players);

  // Deal territories evenly (round-robin from shuffled territory list), 1 army each
  const shuffledTerritories = rng.shuffle(map.territories);
  const territories: Record<string, TerritoryState> = {};
  const playerOwnedTerritoryIds: Record<string, string[]> = {};
  for (const p of shuffledPlayers) {
    playerOwnedTerritoryIds[p.id] = [];
  }

  shuffledTerritories.forEach((t, idx) => {
    const owner = shuffledPlayers[idx % shuffledPlayers.length];
    territories[t.id] = {
      id: t.id,
      ownerId: owner.id,
      armies: 1,
      units: singleUnitCount("infantry"),
      movedInArmies: 0,
      movedInUnits: emptyUnitCounts(),
      buildings: [],
      airliftedThisTurn: false,
    };
    playerOwnedTerritoryIds[owner.id].push(t.id);
  });

  // Assign objectives: if custom objectives passed, use them; otherwise pool ALL_OBJECTIVES
  // and give 50% chance for a player to be assigned a thematic roleplay objective matching their starting core territory
  const pool = opts.objectives ? [...opts.objectives] : [...ALL_OBJECTIVES];
  const shuffledObjectives = rng.shuffle(pool);
  const assignedObjectiveIds = new Set<string>();

  const players: PlayerState[] = shuffledPlayers.map((p) => {
    let chosenObjective: ObjectiveCard | undefined;
    const startingTerrs = playerOwnedTerritoryIds[p.id] ?? [];

    if (!opts.objectives) {
      // Look for a thematic roleplay objective matching any of player's starting territories
      const matchingRoleplay = ROLEPLAY_OBJECTIVES.filter(
        (obj) =>
          !assignedObjectiveIds.has(obj.id) &&
          obj.coreTerritoryIds?.some((coreId) => startingTerrs.includes(coreId))
      );

      if (matchingRoleplay.length > 0 && rng.nextFloat() < 0.5) {
        chosenObjective = matchingRoleplay[rng.nextInt(0, matchingRoleplay.length - 1)];
      }
    }

    if (!chosenObjective) {
      // Only pick an objective if the player is eligible:
      // - Classic objectives (no coreTerritoryIds) are open to any player
      // - Roleplay objectives REQUIRE holding at least one of their core starting territories
      chosenObjective = shuffledObjectives.find((obj) => {
        if (assignedObjectiveIds.has(obj.id)) return false;
        if (!obj.coreTerritoryIds || obj.coreTerritoryIds.length === 0) {
          return true;
        }
        return obj.coreTerritoryIds.some((coreId) => startingTerrs.includes(coreId));
      });
    }

    if (!chosenObjective) {
      // Fallback exclusively to classic unassigned objectives
      chosenObjective = rng.shuffle([...CLASSIC_OBJECTIVES]).find((obj) => !assignedObjectiveIds.has(obj.id))
        ?? shuffledObjectives[0];
    }
    assignedObjectiveIds.add(chosenObjective.id);

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      eliminated: false,
      objective: chosenObjective,
      cards: [],
      unplacedArmies: 0,
      conqueredThisTurn: false,
      connected: true,
      capitalTerritoryId: undefined,
      isCapitalLost: false,
      economicPenaltyMultiplier: 1.0,
      moralePenalty: 0,
      infamy: 0,
      resources: { money: 0, steel: 0, oil: 0, gold: 0 },
      boughtCardWithGoldThisTurn: false,
      analytics: createInitialPlayerAnalytics(),
    };
  });

  // Build territory deck (42 territory cards + 2 jokers)
  const rawDeck: TerritoryCard[] = [
    ...map.territories.map((t) => ({
      id: `card_${t.id}`,
      territoryId: t.id,
      symbol: t.symbol,
    })),
    { id: "card_joker_1", territoryId: null, symbol: "joker" },
    { id: "card_joker_2", territoryId: null, symbol: "joker" },
  ];
  const deck = rng.shuffle(rawDeck);

  const state: GameState = {
    id: opts.id,
    round: 1,
    turnIndex: 0,
    phase: "deploy",
    players,
    territories,
    deck,
    discardPile: [],
    tradeCount: 0,
    pendingConquest: null,
    lastCombat: null,
    winnerId: null,
    seedCommitHash: hashSeed(opts.seed),
    log: [`Partida iniciada com ${players.length} jogadores. Rodada 1: apenas posicionamento.`],
    worldTension: 0,
    treaties: [],
    coalitions: [],
    marketPrices: structuredClone(INITIAL_MARKET_PRICES),
    investmentRoutes: [],
    borderTrades: [],
  };

  // Give first player their initial turn reinforcements and war economy extraction
  const firstPlayer = state.players[0];
  const reinf = calculateTurnReinforcements(state, firstPlayer.id, map);
  firstPlayer.unplacedArmies = reinf.total;
  state.log.push(`${firstPlayer.name} recebe ${reinf.total} exércitos para posicionar.`);
  collectTurnEconomy(state, firstPlayer.id, map);

  return state;
}

/**
 * Checks whether a specific player has fulfilled their secret objective
 * (or is the sole remaining player).
 */
export function checkPlayerVictory(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return false;

  const activePlayers = state.players.filter((p) => !p.eliminated);
  if (activePlayers.length === 1 && activePlayers[0].id === playerId) {
    return true;
  }

  const ownedTerritories = Object.values(state.territories).filter(
    (t) => t.ownerId === playerId
  );
  const ownedSet = new Set(ownedTerritories.map((t) => t.id));

  const controlledContinents = map.continents
    .filter((cont) => {
      const terrs = map.territories.filter((t) => t.continent === cont.id);
      return terrs.length > 0 && terrs.every((t) => ownedSet.has(t.id));
    })
    .map((c) => c.id);

  const rule = player.objective.rule;
  if (rule.type === "territories") {
    const qualifying = ownedTerritories.filter(
      (t) => t.armies >= rule.minArmiesPerTerritory
    );
    return qualifying.length >= rule.count;
  }

  if (rule.type === "specific_territories") {
    const hasRequired = rule.territoryIds.every((id) => ownedSet.has(id));
    if (!hasRequired) return false;
    if (rule.extraAnyOf && rule.extraAnyOf.length > 0) {
      return rule.extraAnyOf.some((group) => group.every((id) => ownedSet.has(id)));
    }
    return true;
  }

  if (rule.type === "continents") {
    const hasRequired = rule.continents.every((c) =>
      controlledContinents.includes(c)
    );
    if (!hasRequired) return false;
    if (rule.extraAnyContinent) {
      return controlledContinents.length >= rule.continents.length + 1;
    }
    return true;
  }

  if (rule.type === "destroy_color") {
    const targetPlayer = state.players.find((p) => p.color === rule.targetColor);
    // Fallback to 24 territories if target color isn't in game, is the player themselves,
    // or was eliminated by someone else
    const useFallback =
      !targetPlayer ||
      targetPlayer.id === player.id ||
      (targetPlayer.eliminated && targetPlayer.eliminatedBy !== player.id);

    if (useFallback) {
      return ownedTerritories.length >= rule.fallbackTerritories;
    }
    return targetPlayer.eliminated && targetPlayer.eliminatedBy === player.id;
  }

  return false;
}

export interface ObjectiveProgress {
  completionPct: number;
  held: number;
  total: number;
  description: string;
}

/**
 * Calculates a player's objective progress percentage (0 - 100%) and held/total units.
 * Used for post-match telemetry, analytical balance, and UI tracking.
 */
export function calculateObjectiveProgress(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): ObjectiveProgress {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { completionPct: 0, held: 0, total: 1, description: "Jogador não encontrado" };
  }

  if (state.winnerId === playerId) {
    return { completionPct: 100, held: 1, total: 1, description: player.objective.descriptionPt };
  }

  const ownedTerritories = Object.values(state.territories).filter(
    (t) => t.ownerId === playerId
  );
  const ownedSet = new Set(ownedTerritories.map((t) => t.id));
  const rule = player.objective.rule;

  if (rule.type === "territories") {
    const qualifying = ownedTerritories.filter(
      (t) => t.armies >= rule.minArmiesPerTerritory
    ).length;
    const total = rule.count;
    const completionPct = Math.min(100, Math.round((qualifying / total) * 100));
    return { completionPct, held: qualifying, total, description: player.objective.descriptionPt };
  }

  if (rule.type === "specific_territories") {
    const reqHeld = rule.territoryIds.filter((id) => ownedSet.has(id)).length;
    let extraHeld = 0;
    let extraTotal = 0;
    if (rule.extraAnyOf && rule.extraAnyOf.length > 0) {
      extraTotal = rule.extraAnyOf[0].length;
      extraHeld = Math.max(
        ...rule.extraAnyOf.map((grp) => grp.filter((id) => ownedSet.has(id)).length)
      );
    }
    const held = reqHeld + extraHeld;
    const total = rule.territoryIds.length + extraTotal;
    const completionPct = Math.min(100, Math.round((held / total) * 100));
    return { completionPct, held, total, description: player.objective.descriptionPt };
  }

  if (rule.type === "continents") {
    const requiredContinentTerritoryIds = map.territories
      .filter((t) => rule.continents.includes(t.continent))
      .map((t) => t.id);
    let held = requiredContinentTerritoryIds.filter((id) => ownedSet.has(id)).length;
    let total = requiredContinentTerritoryIds.length;
    if (rule.extraAnyContinent) {
      const otherContinents = map.continents.filter((c) => !rule.continents.includes(c.id));
      let bestExtraRatio = 0;
      let bestExtraHeld = 0;
      let bestExtraTotal = 1;
      for (const oc of otherContinents) {
        const oTerrs = map.territories.filter((t) => t.continent === oc.id);
        const oHeld = oTerrs.filter((t) => ownedSet.has(t.id)).length;
        if (oHeld / oTerrs.length > bestExtraRatio) {
          bestExtraRatio = oHeld / oTerrs.length;
          bestExtraHeld = oHeld;
          bestExtraTotal = oTerrs.length;
        }
      }
      held += bestExtraHeld;
      total += bestExtraTotal;
    }
    const completionPct = Math.min(100, Math.round((held / total) * 100));
    return { completionPct, held, total, description: player.objective.descriptionPt };
  }

  if (rule.type === "destroy_color") {
    const targetPlayer = state.players.find((p) => p.color === rule.targetColor);
    const useFallback =
      !targetPlayer ||
      targetPlayer.id === player.id ||
      (targetPlayer.eliminated && targetPlayer.eliminatedBy !== player.id);

    if (useFallback) {
      const held = ownedTerritories.length;
      const total = rule.fallbackTerritories;
      const completionPct = Math.min(100, Math.round((held / total) * 100));
      return { completionPct, held, total, description: player.objective.descriptionPt };
    }

    if (targetPlayer.eliminated && targetPlayer.eliminatedBy === player.id) {
      return { completionPct: 100, held: 1, total: 1, description: player.objective.descriptionPt };
    }
    const targetTerritories = Object.values(state.territories).filter(
      (t) => t.ownerId === targetPlayer.id
    ).length;
    const initialApprox = 7;
    const eliminatedShare = Math.max(0, initialApprox - targetTerritories);
    const completionPct = Math.min(90, Math.round((eliminatedShare / initialApprox) * 100));
    return {
      completionPct,
      held: eliminatedShare,
      total: initialApprox,
      description: player.objective.descriptionPt,
    };
  }

  return { completionPct: 0, held: 0, total: 1, description: player.objective.descriptionPt };
}

/**
 * Pure authoritative action reducer: validates and applies a player action.
 */
export function applyAction(
  prevState: GameState,
  playerId: string,
  action: GameAction,
  rng: SeededRng,
  map: GameMapDef = CLASSIC_MAP
): GameState {
  if (prevState.phase === "game_over" || prevState.winnerId) {
    throw new Error("A partida já terminou.");
  }

  const state: GameState = structuredClone(prevState);
  const currentPlayer = state.players[state.turnIndex];
  const actingPlayer = state.players.find((p) => p.id === playerId);
  if (!actingPlayer || actingPlayer.eliminated) {
    throw new Error("Jogador inválido ou eliminado.");
  }

  const isOutOfTurnAction =
    action.type === "propose_treaty" ||
    action.type === "accept_treaty" ||
    action.type === "reject_treaty" ||
    action.type === "break_treaty" ||
    action.type === "form_coalition" ||
    action.type === "join_coalition" ||
    action.type === "propose_investment" ||
    action.type === "accept_investment" ||
    action.type === "reject_investment" ||
    action.type === "propose_border_trade" ||
    action.type === "accept_border_trade" ||
    action.type === "reject_border_trade";

  if (!isOutOfTurnAction && (!currentPlayer || currentPlayer.id !== playerId)) {
    throw new Error("Não é o seu turno.");
  }

  actingPlayer.resources = actingPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  if (currentPlayer) {
    currentPlayer.resources = currentPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  }
  state.marketPrices = state.marketPrices ?? structuredClone(INITIAL_MARKET_PRICES);
  state.investmentRoutes = state.investmentRoutes ?? [];
  state.borderTrades = state.borderTrades ?? [];

  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  switch (action.type) {
    case "trade_cards": {
      if (state.phase !== "deploy" && currentPlayer.cards.length < 5) {
        throw new Error("Troca de cartas só é permitida na fase de posicionamento.");
      }
      const [id1, id2, id3] = action.cardIds;
      if (new Set([id1, id2, id3]).size !== 3) {
        throw new Error("Selecione 3 cartas distintas.");
      }
      const selected = action.cardIds.map((cid) => {
        const c = currentPlayer.cards.find((card) => card.id === cid);
        if (!c) throw new Error(`Carta inválida: ${cid}`);
        return c;
      });
      if (!isValidCardSet(selected)) {
        throw new Error("Combinação de cartas inválida (precisa de 3 iguais ou 3 diferentes).");
      }

      const bonus = getTradeBonusArmies(state.tradeCount);
      state.tradeCount += 1;
      currentPlayer.unplacedArmies += bonus;

      // Remove traded cards from hand and put into discardPile
      currentPlayer.cards = currentPlayer.cards.filter(
        (c) => !action.cardIds.includes(c.id)
      );
      state.discardPile.push(...selected);

      // Classic rule: +2 extra armies on owned territories pictured on traded cards
      const territoryBonuses: string[] = [];
      for (const c of selected) {
        if (c.territoryId && state.territories[c.territoryId]?.ownerId === playerId) {
          const terr = state.territories[c.territoryId];
          setTerritoryUnits(
            terr,
            addUnits(getTerritoryUnits(terr), singleUnitCount("infantry", 2))
          );
          territoryBonuses.push(mapById.get(c.territoryId)?.namePt ?? c.territoryId);
        }
      }

      state.log.push(
        `${currentPlayer.name} trocou cartas (+${bonus} exércitos)${
          territoryBonuses.length ? ` e ganhou +2 em: ${territoryBonuses.join(", ")}` : ""
        }.`
      );
      break;
    }

    case "buy_card_with_gold": {
      if (state.phase !== "deploy") {
        throw new Error("A compra de cartas com Ouro só é permitida na fase de posicionamento.");
      }
      if (currentPlayer.cards.length >= 5) {
        throw new Error("Você já possui 5 cartas e precisa realizar uma troca obrigatória antes.");
      }
      if (currentPlayer.boughtCardWithGoldThisTurn) {
        throw new Error("Só é permitido comprar 1 carta de suprimento com Ouro por turno.");
      }

      const mode =
        action.paymentMode ??
        (currentPlayer.resources.gold >= 2 ? "gold_only" : "gold_and_money");

      if (mode === "gold_only") {
        if (currentPlayer.resources.gold < 2) {
          throw new Error("Ouro insuficiente: são necessários 2 de Ouro para esta modalidade.");
        }
        currentPlayer.resources.gold -= 2;
      } else {
        if (currentPlayer.resources.gold < 1 || currentPlayer.resources.money < 4) {
          throw new Error("Recursos insuficientes: são necessários 1 de Ouro e $4 de Dinheiro.");
        }
        currentPlayer.resources.gold -= 1;
        currentPlayer.resources.money -= 4;
      }

      if (state.deck.length === 0 && state.discardPile.length > 0) {
        state.deck = rng.shuffle(state.discardPile);
        state.discardPile = [];
      }
      const drawnCard = state.deck.pop();
      if (!drawnCard) {
        throw new Error("Não há cartas disponíveis no baralho de suprimentos.");
      }

      currentPlayer.cards.push(drawnCard);
      currentPlayer.boughtCardWithGoldThisTurn = true;
      const costTag = mode === "gold_only" ? "2 Ouro" : "1 Ouro + $4";
      state.log.push(
        `${currentPlayer.name} adquiriu 1 carta de suprimento estratégica (${costTag}).`
      );
      break;
    }

    case "build_structure": {
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes de construir.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode construir estruturas em territórios sob seu controle.");
      }
      const def = mapById.get(terr.id);
      if (!def) {
        throw new Error("Território inválido.");
      }

      terr.buildings = terr.buildings ?? [];
      const existing = terr.buildings.find((b) => b.type === action.buildingType);

      if (existing) {
        if (action.buildingType === "fortification") {
          if (existing.level >= 2) {
            throw new Error(
              "A fortificação neste território já está no nível máximo (Fortaleza Nv. 2)."
            );
          }
          const upgradeCost = FORTIFICATION_LEVEL_2_COST;
          if (
            currentPlayer.resources.money < upgradeCost.money ||
            currentPlayer.resources.steel < upgradeCost.steel
          ) {
            throw new Error(
              `Recursos insuficientes para evoluir Fortaleza Nv. 2 (custo: $${upgradeCost.money} e ${upgradeCost.steel} Aço).`
            );
          }
          currentPlayer.resources.money -= upgradeCost.money;
          currentPlayer.resources.steel -= upgradeCost.steel;
          existing.level = 2;
          currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
          currentPlayer.analytics.buildingsConstructed.fortification =
            (currentPlayer.analytics.buildingsConstructed.fortification || 0) + 1;
          state.log.push(
            `🏰 ${currentPlayer.name} evoluiu a Casamata em ${def.namePt} para Fortaleza Nv. 2 (-$${upgradeCost.money}, -${upgradeCost.steel} Aço).`
          );
          break;
        }
        throw new Error("Este território já possui esta estrutura construída.");
      }

      if (action.buildingType === "port" && def.isCoastal === false) {
        throw new Error(
          "Portos Navais só podem ser construídos em territórios costeiros ou insulares."
        );
      }

      const maxSlots = getTerritoryMaxBuildingSlots(state, terr.id);
      if (terr.buildings.length >= maxSlots) {
        throw new Error(
          `Limite máximo de ${maxSlots} construções atingido em ${def.namePt}.`
        );
      }

      const cost = BUILDING_COSTS[action.buildingType];
      if (
        currentPlayer.resources.money < cost.money ||
        currentPlayer.resources.steel < cost.steel
      ) {
        const costText =
          cost.steel > 0 ? `$${cost.money} e ${cost.steel} Aço` : `$${cost.money}`;
        throw new Error(`Recursos insuficientes para construir (custo: ${costText}).`);
      }

      currentPlayer.resources.money -= cost.money;
      currentPlayer.resources.steel -= cost.steel;
      terr.buildings.push({ type: action.buildingType, level: 1 });

      currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
      currentPlayer.analytics.buildingsConstructed[action.buildingType] =
        (currentPlayer.analytics.buildingsConstructed[action.buildingType] || 0) + 1;
      if (action.buildingType === "port") {
        updateSupplyAndEncirclement(state, map);
      }

      const buildingNamesPt: Record<BuildingType, string> = {
        market: "Mercado",
        industry: "Indústria",
        fortification: "Casamata (Fortificação Nv. 1)",
        airfield: "Aeródromo",
        port: "Porto Naval",
      };
      const costSummary =
        cost.steel > 0 ? `-$${cost.money}, -${cost.steel} Aço` : `-$${cost.money}`;
      state.log.push(
        `🏗️ ${currentPlayer.name} construiu ${buildingNamesPt[action.buildingType]} em ${def.namePt} (${costSummary}).`
      );
      break;
    }

    case "recruit_unit": {
      if (state.phase !== "deploy") {
        throw new Error("O recrutamento só é permitido na fase de posicionamento.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode recrutar em territórios sob seu controle.");
      }
      const def = mapById.get(terr.id);
      if (!def) throw new Error("Território inválido.");

      const requiredBuilding: Partial<Record<UnitType, BuildingType>> = {
        tank: "industry",
        artillery: "industry",
        aircraft: "airfield",
        navy: "port",
      };
      const requirement = requiredBuilding[action.unitType];
      if (requirement && !hasTerritoryBuilding(terr, requirement)) {
        const requirementNames: Record<BuildingType, string> = {
          market: "Mercado",
          industry: "Indústria",
          fortification: "Fortificação",
          airfield: "Aeródromo",
          port: "Porto Naval",
        };
        throw new Error(
          `O recrutamento desta unidade exige ${requirementNames[requirement]} no território.`
        );
      }
      if (action.unitType === "navy" && def.isCoastal === false) {
        throw new Error("A Marinha só pode ser recrutada em territórios costeiros ou insulares.");
      }

      const unitCost = UNIT_COSTS[action.unitType];
      const totalCost = {
        money: unitCost.money * action.quantity,
        steel: unitCost.steel * action.quantity,
        oil: unitCost.oil * action.quantity,
      };
      if (
        currentPlayer.resources.money < totalCost.money ||
        currentPlayer.resources.steel < totalCost.steel ||
        currentPlayer.resources.oil < totalCost.oil
      ) {
        throw new Error(
          `Recursos insuficientes: o recrutamento custa $${totalCost.money}, ${totalCost.steel} Aço e ${totalCost.oil} Petróleo.`
        );
      }

      currentPlayer.resources.money -= totalCost.money;
      currentPlayer.resources.steel -= totalCost.steel;
      currentPlayer.resources.oil -= totalCost.oil;
      setTerritoryUnits(
        terr,
        addUnits(
          getTerritoryUnits(terr),
          singleUnitCount(action.unitType, action.quantity)
        )
      );

      currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
      currentPlayer.analytics.unitsRecruited[action.unitType] += action.quantity;
      updateSupplyAndEncirclement(state, map);

      const unitNames: Record<UnitType, string> = {
        infantry: "Infantaria",
        tank: "Blindado",
        artillery: "Artilharia",
        aircraft: "Aeronave",
        navy: "Marinha",
      };
      state.log.push(
        `${currentPlayer.name} recrutou ${action.quantity}x ${unitNames[action.unitType]} em ${def.namePt}.`
      );
      break;
    }

    case "market_trade": {
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes de negociar no mercado.");
      }
      if (!playerHasMarket(state, playerId)) {
        throw new Error(
          "É necessário controlar pelo menos um território com Mercado construído para acessar o mercado global."
        );
      }
      const cfg = DEFAULT_MARKET_CONFIG[action.resource];
      const marketPrice = state.marketPrices[action.resource];
      const resourceLabels: Record<ResourceType, string> = {
        steel: "Aço",
        oil: "Petróleo",
        gold: "Ouro",
      };
      const resName = resourceLabels[action.resource] ?? action.resource;

      if (action.operation === "buy") {
        let totalCost = 0;
        let tempBuy = marketPrice.buyPrice;
        let tempSell = marketPrice.sellPrice;
        for (let i = 0; i < action.quantity; i++) {
          totalCost += tempBuy;
          tempBuy = Math.min(cfg.maxBuy, tempBuy + cfg.step);
          tempSell = Math.min(
            cfg.maxBuy - (action.resource === "gold" ? 2 : 1),
            tempSell + cfg.step
          );
        }
        if (currentPlayer.resources.money < totalCost) {
          throw new Error(
            `Dinheiro insuficiente para comprar ${action.quantity}x ${resName}. Necessários $${totalCost}, você possui $${currentPlayer.resources.money}.`
          );
        }
        currentPlayer.resources.money -= totalCost;
        currentPlayer.resources[action.resource] += action.quantity;
        marketPrice.buyPrice = tempBuy;
        marketPrice.sellPrice = tempSell;

        state.log.push(
          `📈 MERCADO GLOBAL: ${currentPlayer.name} comprou ${action.quantity}x ${resName} por $${totalCost}. (Novo Preço: Compra $${tempBuy} / Venda $${tempSell})`
        );
      } else {
        if (currentPlayer.resources[action.resource] < action.quantity) {
          throw new Error(
            `Estoque insuficiente de ${resName}. Você possui ${currentPlayer.resources[action.resource]}, tentativa de vender ${action.quantity}.`
          );
        }
        let totalRevenue = 0;
        let tempBuy = marketPrice.buyPrice;
        let tempSell = marketPrice.sellPrice;
        for (let i = 0; i < action.quantity; i++) {
          totalRevenue += tempSell;
          tempSell = Math.max(cfg.minSell, tempSell - cfg.step);
          tempBuy = Math.max(
            cfg.minSell + (action.resource === "gold" ? 2 : 1),
            tempBuy - cfg.step
          );
        }
        currentPlayer.resources[action.resource] -= action.quantity;
        currentPlayer.resources.money += totalRevenue;
        marketPrice.buyPrice = tempBuy;
        marketPrice.sellPrice = tempSell;

        state.log.push(
          `📉 MERCADO GLOBAL: ${currentPlayer.name} vendeu ${action.quantity}x ${resName} por $${totalRevenue}. (Novo Preço: Compra $${tempBuy} / Venda $${tempSell})`
        );
      }
      break;
    }

    case "select_capital": {
      if (state.phase !== "deploy") {
        throw new Error("A capital só pode ser selecionada durante a fase de posicionamento.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode estabelecer a capital em um território sob seu controle.");
      }
      const hadCapitalBefore = Boolean(currentPlayer.capitalTerritoryId);
      currentPlayer.capitalTerritoryId = action.territoryId;
      currentPlayer.isCapitalLost = false;
      if (!hadCapitalBefore) {
        currentPlayer.resources.money += 3;
      }
      const capDef = mapById.get(terr.id);
      if (capDef) {
        currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
        currentPlayer.analytics.capitalContinentId = capDef.continent;
      }
      updateSupplyAndEncirclement(state, map);
      const tName = capDef?.namePt ?? terr.id;
      state.log.push(`⭐ ${currentPlayer.name} estabeleceu ${tName} como sua Capital Nacional!`);
      break;
    }

    case "deploy": {
      if (state.phase !== "deploy") {
        throw new Error("Ação de posicionar só é permitida na fase de posicionamento.");
      }
      if (currentPlayer.cards.length >= 5) {
        throw new Error("Você possui 5 ou mais cartas e é obrigado a realizar uma troca antes.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode posicionar exércitos em territórios seus.");
      }
      if (terr.isEncircled) {
        throw new Error(
          "Território sob cerco militar (sem linha de suprimento com a Capital) não pode receber reforços."
        );
      }
      if (action.armies > currentPlayer.unplacedArmies) {
        throw new Error("Quantidade de exércitos superior ao disponível para posicionar.");
      }

      // If capital has not been explicitly chosen yet, establish this territory as capital
      if (!currentPlayer.capitalTerritoryId) {
        currentPlayer.capitalTerritoryId = terr.id;
        currentPlayer.isCapitalLost = false;
        currentPlayer.resources.money += 3;
        const capDef = mapById.get(terr.id);
        if (capDef) {
          currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
          currentPlayer.analytics.capitalContinentId = capDef.continent;
        }
        updateSupplyAndEncirclement(state, map);
        const capName = capDef?.namePt ?? terr.id;
        state.log.push(`⭐ ${currentPlayer.name} estabeleceu ${capName} como sua Capital Nacional!`);
      }

      setTerritoryUnits(
        terr,
        addUnits(getTerritoryUnits(terr), singleUnitCount("infantry", action.armies))
      );
      currentPlayer.unplacedArmies -= action.armies;
      const tName = mapById.get(terr.id)?.namePt ?? terr.id;
      state.log.push(`${currentPlayer.name} posicionou +${action.armies} em ${tName}.`);

      // When all reinforcements are placed:
      if (currentPlayer.unplacedArmies === 0) {
        if (state.round === 1) {
          // Round 1 rule: no attacks allowed on the first round! Advance directly to next player
          advanceTurn(state, rng, map);
        } else {
          state.phase = "attack";
        }
      }
      break;
    }

    case "artillery_barrage": {
      if (state.phase !== "attack") {
        throw new Error("Barragem de artilharia só pode ser disparada durante a fase de combate.");
      }
      if (state.round === 1) {
        throw new Error("Ações de combate não são permitidas na primeira rodada.");
      }
      if (state.pendingConquest) {
        throw new Error("Mova tropas para o território recém-conquistado antes de continuar.");
      }

      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || !toTerr) throw new Error("Território inválido.");
      if (fromTerr.ownerId !== playerId) throw new Error("Território de artilharia não é seu.");
      if (toTerr.ownerId === playerId) throw new Error("Você não pode bombardear seu próprio território.");

      const fromDef = mapById.get(fromTerr.id)!;
      if (!fromDef.neighbors.includes(toTerr.id)) {
        throw new Error("A artilharia possui alcance máximo de 1 fronteira adjacente.");
      }

      if (fromTerr.artilleryBarrageFiredThisTurn) {
        throw new Error("A artilharia desta base já realizou uma barragem de saturação neste turno.");
      }

      const fromUnits = getTerritoryUnits(fromTerr);
      if (fromUnits.artillery <= 0) {
        throw new Error("Não há baterias de artilharia estacionadas neste território.");
      }

      // Check active diplomatic treaties (NAP or Alliance)
      const hasActiveTreaty = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === toTerr.ownerId) ||
            (t.fromPlayerId === toTerr.ownerId && t.toPlayerId === playerId))
      );
      if (hasActiveTreaty) {
        throw new Error("Você possui um tratado ativo com este general.");
      }

      fromTerr.artilleryBarrageFiredThisTurn = true;
      const rolls = Array.from({ length: fromUnits.artillery }, () => rng.rollD6());
      const hits = rolls.filter((r) => r >= 4).length;

      const fromName = fromDef.namePt;
      const toName = mapById.get(toTerr.id)!.namePt;

      if (hits === 0) {
        state.log.push(
          `🎯 BARRAGEM DE ARTILHARIA: Baterias em ${fromName} dispararam contra ${toName} [${rolls.join(",")}], mas os projéteis erraram o alvo.`
        );
        break;
      }

      let remainingHits = hits;
      const fort = toTerr.buildings?.find((b) => b.type === "fortification");
      if (fort && remainingHits > 0) {
        if (fort.level >= 2) {
          fort.level = 1;
          remainingHits--;
          state.log.push(
            `🎯 BARRAGEM DE ARTILHARIA: Disparos de ${fromName} [${rolls.join(",")}] danificaram a Fortaleza em ${toName}, degradando-a para Casamata Nv. 1!`
          );
        } else if (fort.level === 1) {
          toTerr.buildings = toTerr.buildings?.filter((b) => b.type !== "fortification");
          remainingHits--;
          state.log.push(
            `🎯 BARRAGEM DE ARTILHARIA: Disparos de ${fromName} [${rolls.join(",")}] destruíram a Casamata defensiva em ${toName}!`
          );
        }
      }

      let unitsDestroyed = 0;
      if (remainingHits > 0 && toTerr.armies > 1) {
        const killCount = Math.min(remainingHits, toTerr.armies - 1);
        const defenderCombat = removeCasualties(getTerritoryUnits(toTerr), killCount);
        setTerritoryUnits(toTerr, defenderCombat.remaining);
        unitsDestroyed = killCount;

        const defenderPlayer = state.players.find((p) => p.id === toTerr.ownerId);
        if (defenderPlayer) {
          defenderPlayer.analytics = defenderPlayer.analytics ?? createInitialPlayerAnalytics();
          const defAnalytics = defenderPlayer.analytics;
          for (const u of UNIT_TYPES) {
            defAnalytics.unitsLost[u] += defenderCombat.losses[u];
          }
        }

        state.log.push(
          `🎯 BARRAGEM DE ARTILHARIA: Disparos de ${fromName} [${rolls.join(",")}] destruíram ${killCount} divisão(ões) inimiga(s) em ${toName}!`
        );
      } else if (unitsDestroyed === 0 && !fort) {
        state.log.push(
          `🎯 BARRAGEM DE ARTILHARIA: Disparos de ${fromName} [${rolls.join(",")}] atingiram ${toName}, mas a última guarnição sobreviveu entrincheirada!`
        );
      }
      break;
    }

    case "air_mission": {
      if (state.phase !== "attack") {
        throw new Error("Missões aéreas só podem ser executadas durante a fase de combate.");
      }
      if (state.round === 1) {
        throw new Error("Ações de combate não são permitidas na primeira rodada.");
      }
      if (state.pendingConquest) {
        throw new Error("Mova tropas para o território recém-conquistado antes de continuar.");
      }

      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || !toTerr) throw new Error("Território inválido.");
      if (fromTerr.ownerId !== playerId) throw new Error("Aeródromo de origem não pertence a você.");

      const fromUnits = getTerritoryUnits(fromTerr);
      if (fromUnits.aircraft <= 0) {
        throw new Error("Não há aeronaves baseadas neste território.");
      }
      if (!hasTerritoryBuilding(fromTerr, "airfield")) {
        throw new Error("Operações aéreas exigem um Aeródromo no território de origem.");
      }
      if (fromTerr.airMissionFlownThisTurn) {
        throw new Error("As esquadrilhas deste aeródromo já executaram uma surtida de combate neste turno.");
      }

      if ((currentPlayer.resources?.oil ?? 0) < 1) {
        throw new Error("Combustível insuficiente: surtidas aéreas exigem 1 Petróleo.");
      }

      const fromDef = mapById.get(fromTerr.id)!;
      const toDef = mapById.get(toTerr.id)!;

      // Range check
      if (action.missionType === "cas") {
        if (!fromDef.neighbors.includes(toTerr.id)) {
          throw new Error("Apoio Aéreo Aproximado (CAS) exige que o alvo seja adjacente (alcance 1).");
        }
      } else {
        const validTargets = findAirMissionTargets(state, fromTerr.id, map);
        if (!validTargets.includes(toTerr.id)) {
          throw new Error("O alvo está fora do alcance operacional de 2 territórios (com no máx. 1 travessia marítima).");
        }
      }

      // Check active diplomatic treaties (NAP or Alliance)
      const hasActiveTreaty = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === toTerr.ownerId) ||
            (t.fromPlayerId === toTerr.ownerId && t.toPlayerId === playerId))
      );
      if (hasActiveTreaty) {
        throw new Error("Você possui um tratado ativo com este general.");
      }

      // Deduct 1 oil for flight sortie
      currentPlayer.resources.oil -= 1;
      fromTerr.airMissionFlownThisTurn = true;

      if (action.missionType === "cas") {
        toTerr.casBonusAttackerId = playerId;
        state.log.push(
          `✈️ MISSÃO AÉREA (CAS): Esquadrilha de ${fromDef.namePt} estabeleceu Apoio Aéreo sobre ${toDef.namePt}! (+1 dado de ataque no assalto terrestre)`
        );
      } else if (action.missionType === "bombardment") {
        const bombRoll = rng.rollD6();
        if (bombRoll >= 5 && toTerr.buildings && toTerr.buildings.length > 0) {
          const targetBuilding = toTerr.buildings[0];
          const bNames: Record<BuildingType, string> = {
            market: "Mercado",
            industry: "Indústria",
            fortification: "Fortificação",
            airfield: "Aeródromo",
            port: "Porto Naval",
          };
          if (targetBuilding.level > 1) {
            targetBuilding.level -= 1;
          } else {
            toTerr.buildings.shift();
          }
          state.log.push(
            `💥 BOMBARDEIO ESTRATÉGICO: Aeronaves bombardearam ${toDef.namePt} [dado: ${bombRoll}] e destruíram a estrutura de ${bNames[targetBuilding.type]}!`
          );
        } else {
          state.log.push(
            `✈️ BOMBARDEIO ESTRATÉGICO: Bombardeiros sobre ${toDef.namePt} [dado: ${bombRoll}] não conseguiram atingir infraestruturas críticas.`
          );
        }
      } else if (action.missionType === "recon") {
        if (fromTerr.isEncircled) {
          throw new Error("Aeronaves em territórios cercados não conseguem transmitir dados de inteligência para a Capital.");
        }
        const targetPlayer = state.players.find((p) => p.id === toTerr.ownerId);
        const progress = targetPlayer ? calculateObjectiveProgress(state, targetPlayer.id, map) : null;
        state.log.push(
          `📡 RECONHECIMENTO AÉREO: Voo de inteligência sobre ${toDef.namePt} (${targetPlayer?.name ?? "Inimigo"}): ${toTerr.armies} divisões guarnecidas${
            progress ? `, objetivo: ${progress.held}/${progress.total} (${progress.completionPct}%)` : ""
          }.`
        );
      }
      break;
    }

    case "attack": {
      if (state.phase !== "attack") {
        throw new Error("Ataques só são permitidos na fase de ataque.");
      }
      if (state.round === 1) {
        throw new Error("Não é permitido atacar na primeira rodada.");
      }
      if (state.pendingConquest) {
        throw new Error("Mova tropas para o território recém-conquistado antes de continuar.");
      }
      if (currentPlayer.cards.length >= 5) {
        throw new Error("Troca obrigatória pendente (5+ cartas na mão).");
      }

      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || !toTerr) throw new Error("Território inválido.");
      if (fromTerr.ownerId !== playerId) throw new Error("Território atacante não é seu.");
      if (toTerr.ownerId === playerId) throw new Error("Você não pode atacar seu próprio território.");
      if (fromTerr.armies < 2) throw new Error("É necessário pelo menos 2 exércitos para atacar.");

      const fromDef = mapById.get(fromTerr.id)!;
      if (!fromDef.neighbors.includes(toTerr.id)) {
        throw new Error("Os territórios não fazem fronteira.");
      }

      const fromUnits = getTerritoryUnits(fromTerr);
      const toUnits = getTerritoryUnits(toTerr);
      const attackingUnits = action.units
        ? { ...action.units }
        : selectUnits(fromUnits, fromTerr.armies - 1);
      const attackingCount = totalUnits(attackingUnits);
      if (attackingCount < 1 || attackingCount > fromTerr.armies - 1) {
        throw new Error("A força-tarefa deve manter ao menos 1 divisão de guarnição na origem.");
      }
      if (!canSubtractUnits(fromUnits, attackingUnits)) {
        throw new Error("A força-tarefa selecionada excede as unidades disponíveis na origem.");
      }

      // Check infantry assault fatigue vs Blitzkrieg capability (HEGEM-25)
      if (fromTerr.conqueredTurnRound === state.round) {
        if (!fromTerr.blitzkriegAvailable) {
          throw new Error(
            "A infantaria que ocupou este território sofre fadiga de combate e não pode realizar novos ataques no mesmo turno."
          );
        }
        if (attackingUnits.infantry > 0) {
          throw new Error(
            "Apenas blindados (tanques) abastecidos podem avançar em Blitzkrieg; a infantaria ocupante sofre fadiga."
          );
        }
      }

      // Check asymmetric naval blockade over maritime crossings (HEGEM-57)
      const isMaritimeAttack = isSeaLink(fromTerr.id, toTerr.id);
      let coastalBombardment = false;
      if (isMaritimeAttack) {
        const blockade = checkNavalBlockade(state, fromTerr.id, toTerr.id, playerId);
        if (blockade.isBlockaded) {
          throw new Error(
            `A travessia marítima para ${mapById.get(toTerr.id)?.namePt ?? toTerr.id} está bloqueada por frotas inimigas ancoradas no Porto.`
          );
        }
        if (blockade.attackerNavy > 0) {
          coastalBombardment = true;
        }
      }

      // Check active diplomatic treaties (NAP or Alliance)
      const hasActiveTreaty = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === toTerr.ownerId) ||
            (t.fromPlayerId === toTerr.ownerId && t.toPlayerId === playerId))
      );
      if (hasActiveTreaty) {
        throw new Error(
          "Você possui um tratado de paz ativo com este general. Rompa o tratado antes de atacar."
        );
      }

      // Check coalition mutual non-aggression: members of the same coalition cannot attack each other
      const sharedCoalition = state.coalitions?.some(
        (c) =>
          c.memberPlayerIds.includes(playerId) &&
          c.memberPlayerIds.includes(toTerr.ownerId)
      );
      if (sharedCoalition) {
        throw new Error(
          "Generais da mesma coalizão não podem se atacar enquanto a coalizão estiver ativa."
        );
      }

      const defenderPlayer = state.players.find((p) => p.id === toTerr.ownerId);
      const isDefendingCapital =
        defenderPlayer?.capitalTerritoryId === toTerr.id &&
        toTerr.ownerId === defenderPlayer.id;

      let attackerModifier = 0;
      let defenderModifier = 0;
      let lastStandBonus = false;

      // Mobilização Total (Last Stand): Hegemon bonus against coalition members
      const defenderCoalition = state.coalitions?.find(
        (c) => c.targetPlayerId === toTerr.ownerId && c.memberPlayerIds.includes(playerId)
      );
      if (defenderCoalition && defenderPlayer) {
        if ((defenderPlayer.infamy ?? 0) >= 100 && defenderCoalition.memberPlayerIds.length >= 3) {
          defenderModifier = 2;
          lastStandBonus = true;
        } else if ((defenderPlayer.infamy ?? 0) >= 50 && defenderCoalition.memberPlayerIds.length >= 2) {
          defenderModifier = 1;
          lastStandBonus = true;
        }
      }

      const attackerCoalition = state.coalitions?.find(
        (c) => c.targetPlayerId === playerId && c.memberPlayerIds.includes(toTerr.ownerId)
      );
      if (attackerCoalition) {
        if ((currentPlayer.infamy ?? 0) >= 100 && attackerCoalition.memberPlayerIds.length >= 3) {
          attackerModifier = 2;
          lastStandBonus = true;
        } else if ((currentPlayer.infamy ?? 0) >= 50 && attackerCoalition.memberPlayerIds.length >= 2) {
          attackerModifier = 1;
          lastStandBonus = true;
        }
      }

      const hasCasBonus = toTerr.casBonusAttackerId === playerId;
      const maxAttackerDice = Math.min(hasCasBonus ? 4 : 3, attackingCount);
      const attackerDiceCount = action.diceCount
        ? Math.min(action.diceCount, maxAttackerDice)
        : maxAttackerDice;
      const defenderDiceCount = Math.min(3, toTerr.armies);

      const attackerDice = Array.from({ length: attackerDiceCount }, () => rng.rollD6()).sort(
        (a, b) => b - a
      );
      const defenderDice = Array.from({ length: defenderDiceCount }, () => rng.rollD6()).sort(
        (a, b) => b - a
      );

      // Tank re-roll 1s (Ponta de Lança Couraçada) if attacker has oil (HEGEM-25)
      let blitzkriegBonus = false;
      if (attackingUnits.tank > 0 && (currentPlayer.resources?.oil ?? 0) > 0) {
        let reRolledAny = false;
        for (let i = 0; i < attackerDice.length; i++) {
          if (attackerDice[i] === 1) {
            attackerDice[i] = rng.rollD6();
            reRolledAny = true;
          }
        }
        if (reRolledAny) {
          attackerDice.sort((a, b) => b - a);
          blitzkriegBonus = true;
        }
      }

      if (attackerModifier > 0 && attackerDice.length > 0) {
        attackerDice[0] += attackerModifier;
      }
      if (coastalBombardment && attackerDice.length > 0) {
        attackerDice[0] += 1;
      }
      if (defenderModifier > 0 && defenderDice.length > 0) {
        defenderDice[0] += defenderModifier;
      }

      // Encirclement defender penalty (HEGEM-35: -1, or -2 after 2 rounds)
      let encircledDefenderPenalty: number | undefined;
      if (toTerr.isEncircled) {
        const pen = (toTerr.encircledRounds ?? 1) >= 2 ? 2 : 1;
        encircledDefenderPenalty = pen;
        if (defenderDice.length > 0) {
          defenderDice[0] = Math.max(1, defenderDice[0] - pen);
        }
      }

      // HEGEM-32: Territorial Fortification combat modifiers
      // Level 1 (Casamata): +1 to highest defense die
      // Level 2 (Fortaleza): +1 to highest defense die AND -1 to highest enemy attack die
      const fortLevel = getTerritoryBuildingLevel(toTerr, "fortification");
      if (fortLevel >= 1 && defenderDice.length > 0) {
        defenderDice[0] += 1;
      }
      if (fortLevel >= 2 && attackerDice.length > 0) {
        attackerDice[0] = Math.max(1, attackerDice[0] - 1);
      }

      let attackerLosses = 0;
      let defenderLosses = 0;
      const comparisons = Math.min(attackerDice.length, defenderDice.length);
      let capitalTiesDefended = 0;

      for (let i = 0; i < comparisons; i++) {
        // Defender wins ties! In capital defense, ties are especially held by fortress walls
        if (attackerDice[i] > defenderDice[i]) {
          defenderLosses++;
        } else {
          attackerLosses++;
          if (attackerDice[i] === defenderDice[i] && isDefendingCapital) {
            capitalTiesDefended++;
          }
        }
      }

      const attackerCombat = removeCasualties(attackingUnits, attackerLosses);
      const defenderCombat = removeCasualties(toUnits, defenderLosses);
      setTerritoryUnits(
        fromTerr,
        addUnits(subtractUnits(fromUnits, attackingUnits), attackerCombat.remaining)
      );
      setTerritoryUnits(toTerr, defenderCombat.remaining);

      // Track combat losses in player match analytics (HEGEM-59)
      currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
      for (const u of UNIT_TYPES) {
        currentPlayer.analytics.unitsLost[u] += attackerCombat.losses[u];
      }
      if (defenderPlayer) {
        defenderPlayer.analytics = defenderPlayer.analytics ?? createInitialPlayerAnalytics();
        const defAnalytics = defenderPlayer.analytics;
        for (const u of UNIT_TYPES) {
          defAnalytics.unitsLost[u] += defenderCombat.losses[u];
        }
      }

      const defenderId = toTerr.ownerId;
      const conquered = toTerr.armies === 0;

      state.lastCombat = {
        fromTerritoryId: fromTerr.id,
        toTerritoryId: toTerr.id,
        attackerDice,
        defenderDice,
        attackerLosses,
        defenderLosses,
        attackerLossUnits: attackerCombat.losses,
        defenderLossUnits: defenderCombat.losses,
        conquered,
        attackerModifier,
        defenderModifier,
        lastStandBonus,
        fortificationLevel: fortLevel > 0 ? fortLevel : undefined,
        casBonus: hasCasBonus ? true : undefined,
        blitzkriegBonus: blitzkriegBonus ? true : undefined,
        encircledDefenderPenalty,
        coastalBombardmentBonus: coastalBombardment ? true : undefined,
      };

      const fromName = fromDef.namePt;
      const toName = mapById.get(toTerr.id)!.namePt;
      const capitalCombatTag = isDefendingCapital
        ? ` [⭐ Capital Fortificada${capitalTiesDefended > 0 ? ` (+${capitalTiesDefended} empates resistidos)` : ""}]`
        : "";
      const fortCombatTag =
        fortLevel >= 2
          ? " [🏰 Fortaleza Nv.2 (+1 DEF, -1 ATQ)]"
          : fortLevel === 1
            ? " [🛡️ Casamata Nv.1 (+1 DEF)]"
            : "";
      const lastStandTag = lastStandBonus
        ? ` [⭐ Mobilização Total +${attackerModifier || defenderModifier}]`
        : "";
      const casTag = hasCasBonus ? " [✈️ CAS +1 Dado]" : "";
      const coastalTag = coastalBombardment ? " [⚓ Bombardeio Costeiro +1]" : "";
      const encircledTag = encircledDefenderPenalty ? ` [📦 Cerco -${encircledDefenderPenalty} DEF]` : "";
      state.log.push(
        `Combate ${fromName} [${attackerDice.join(",")}] vs ${toName}${capitalCombatTag}${fortCombatTag}${lastStandTag}${casTag}${coastalTag}${encircledTag} [${defenderDice.join(",")}] → baixas ATQ:${attackerLosses} DEF:${defenderLosses}`
      );

      if (conquered) {
        toTerr.ownerId = playerId;
        currentPlayer.conqueredThisTurn = true;
        toTerr.conqueredTurnRound = state.round;
        toTerr.infantryAssaultFatigued = true;
        toTerr.blitzkriegAvailable =
          attackerCombat.remaining.tank > 0 && (currentPlayer.resources?.oil ?? 0) > 0;
        toTerr.casBonusAttackerId = undefined;
        state.worldTension = Math.min(100, (state.worldTension ?? 0) + 0.5);

        // HEGEM-32: If conquered territory had a Level 2 Fortress, it degrades to Level 1 Casamata
        const fortBuilding = toTerr.buildings?.find((b) => b.type === "fortification");
        if (fortBuilding && fortBuilding.level >= 2) {
          fortBuilding.level = 1;
          state.log.push(
            `🏰 A Fortaleza em ${toName} sofreu danos estruturais na captura e degradou para Casamata Nv. 1.`
          );
        }

        // Check if player recaptured their own previously lost capital
        if (currentPlayer.capitalTerritoryId === toTerr.id && currentPlayer.isCapitalLost) {
          currentPlayer.isCapitalLost = false;
          currentPlayer.economicPenaltyMultiplier = 1.0;
          state.log.push(
            `🎖️ CAPITAL RESTAURADA! ${currentPlayer.name} reconquistou sua Capital Nacional em ${toName}!`
          );
        }

        // HEGEM-24: Golpe de Decapitação when conquering an opponent's capital
        if (isDefendingCapital && defenderPlayer) {
          defenderPlayer.isCapitalLost = true;
          defenderPlayer.capitalLostTurn = state.round;
          defenderPlayer.economicPenaltyMultiplier = 0.5;
          defenderPlayer.moralePenalty = 2;
          state.worldTension = Math.min(100, (state.worldTension ?? 0) + 20);
          currentPlayer.infamy = Math.min(100, (currentPlayer.infamy ?? 0) + 15);

          let stolenCardNotice = "";
          if (defenderPlayer.cards.length > 0) {
            const cardIdx = rng.nextInt(0, defenderPlayer.cards.length - 1);
            const [stolenCard] = defenderPlayer.cards.splice(cardIdx, 1);
            currentPlayer.cards.push(stolenCard);
            const cardName = stolenCard.territoryId
              ? (mapById.get(stolenCard.territoryId)?.namePt ?? stolenCard.territoryId)
              : "Coringa";
            stolenCardNotice = ` e confiscou 1 carta de território (${cardName})`;
          }

          state.log.push(
            `💥 GOLPE DE DECAPITAÇÃO! ${currentPlayer.name} capturou a Capital ${toName} de ${defenderPlayer.name}! (${defenderPlayer.name} sofre -2 divisões de moral no próximo turno${stolenCardNotice})`
          );
        }

        const remainingAttackers = attackerCombat.remaining;
        const maxMove = Math.min(
          attackerDiceCount,
          totalUnits(remainingAttackers),
          fromTerr.armies - 1
        );
        const minMove = 1;
        const occupyingUnits = selectUnits(remainingAttackers, 1);

        setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), occupyingUnits));
        setTerritoryUnits(toTerr, occupyingUnits);

        if (maxMove <= 1) {
          state.pendingConquest = null;
        } else {
          state.pendingConquest = {
            fromTerritoryId: fromTerr.id,
            toTerritoryId: toTerr.id,
            minMove: 1,
            maxMove,
            occupyingUnits,
            remainingAttackers: subtractUnits(remainingAttackers, occupyingUnits),
          };
        }

        state.log.push(`${currentPlayer.name} conquistou ${toName}!`);

        // Check if defender was completely eliminated
        const defenderRemaining = Object.values(state.territories).some(
          (t) => t.ownerId === defenderId
        );
        if (!defenderRemaining) {
          const defenderPlayer = state.players.find((p) => p.id === defenderId)!;
          defenderPlayer.eliminated = true;
          defenderPlayer.eliminatedBy = playerId;
          state.worldTension = Math.min(100, (state.worldTension ?? 0) + 25);
          currentPlayer.infamy = Math.min(100, (currentPlayer.infamy ?? 0) + 25);
          // Eliminator takes victim's cards
          if (defenderPlayer.cards.length > 0) {
            currentPlayer.cards.push(...defenderPlayer.cards);
            state.log.push(
              `${currentPlayer.name} eliminou ${defenderPlayer.name} e capturou ${defenderPlayer.cards.length} carta(s)!`
            );
            defenderPlayer.cards = [];
          } else {
            state.log.push(`${currentPlayer.name} eliminou ${defenderPlayer.name}!`);
          }
        }
      }
      break;
    }

    case "occupy": {
      if (!state.pendingConquest) {
        throw new Error("Nenhuma conquista pendente para ocupar.");
      }
      const {
        fromTerritoryId,
        toTerritoryId,
        minMove,
        maxMove,
        occupyingUnits,
        remainingAttackers,
      } = state.pendingConquest;
      if (action.armies < minMove || action.armies > maxMove) {
        throw new Error(`Você deve mover entre ${minMove} e ${maxMove} exércitos.`);
      }

      const fromTerr = state.territories[fromTerritoryId];
      const toTerr = state.territories[toTerritoryId];
      const initialOccupation = occupyingUnits ?? selectUnits(getTerritoryUnits(toTerr), 1);
      const availableAttackers = remainingAttackers ?? getTerritoryUnits(fromTerr);
      const additional = action.armies - 1;
      let additionalUnits = selectUnits(availableAttackers, additional);

      if (action.units) {
        if (totalUnits(action.units) !== action.armies) {
          throw new Error("A composição da ocupação deve corresponder ao total de divisões movidas.");
        }
        if (!canSubtractUnits(action.units, initialOccupation)) {
          throw new Error("A composição da ocupação deve incluir a divisão que já ocupou o território.");
        }
        additionalUnits = subtractUnits(action.units, initialOccupation);
        if (!canSubtractUnits(availableAttackers, additionalUnits)) {
          throw new Error("A composição excede os sobreviventes disponíveis para ocupar.");
        }
      }

      setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), additionalUnits));
      setTerritoryUnits(toTerr, addUnits(getTerritoryUnits(toTerr), additionalUnits));
      if (toTerr.blitzkriegAvailable) {
        const finalUnits = getTerritoryUnits(toTerr);
        toTerr.blitzkriegAvailable = finalUnits.tank > 0 && (currentPlayer.resources?.oil ?? 0) > 0;
      }
      updateSupplyAndEncirclement(state, map);
      state.pendingConquest = null;
      break;
    }

    case "end_attack": {
      if (state.phase !== "attack") {
        throw new Error("Você não está na fase de ataque.");
      }
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes.");
      }
      state.phase = "maneuver";
      for (const t of Object.values(state.territories)) {
        setMovedInUnits(t, emptyUnitCounts());
        t.airliftedThisTurn = false;
        t.casBonusAttackerId = undefined;
        t.blitzkriegAvailable = false;
        t.infantryAssaultFatigued = false;
        t.conqueredTurnRound = undefined;
      }
      break;
    }

    case "airlift": {
      if (state.phase !== "maneuver") {
        throw new Error("Ponte Aérea só é permitida na fase de movimentação.");
      }
      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || !toTerr) throw new Error("Território inválido.");
      if (fromTerr.id === toTerr.id) {
        throw new Error("Selecione um território de destino diferente da origem.");
      }
      if (fromTerr.ownerId !== playerId || toTerr.ownerId !== playerId) {
        throw new Error("Ambos os territórios devem pertencer a você.");
      }
      if (!hasTerritoryBuilding(fromTerr, "airfield") || !hasTerritoryBuilding(toTerr, "airfield")) {
        throw new Error(
          "Ponte Aérea exige um Aeródromo construído tanto no território de origem quanto no de destino."
        );
      }
      if (fromTerr.airliftedThisTurn) {
        throw new Error("Este Aeródromo já realizou uma operação de Ponte Aérea neste turno.");
      }
      const availableUnits = subtractUnits(getTerritoryUnits(fromTerr), getMovedInUnits(fromTerr));
      const movableArmies = Math.min(
        availableUnits.infantry,
        Math.max(0, totalUnits(availableUnits) - 1)
      );
      if (action.armies > movableArmies) {
        throw new Error(
          `Apenas ${movableArmies} divisão(ões) de infantaria podem ser transportadas deste território neste turno.`
        );
      }

      const movedUnits = singleUnitCount("infantry", action.armies);
      setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), movedUnits));
      setTerritoryUnits(toTerr, addUnits(getTerritoryUnits(toTerr), movedUnits));
      setMovedInUnits(toTerr, addUnits(getMovedInUnits(toTerr), movedUnits));
      fromTerr.airliftedThisTurn = true;

      const fromDef = mapById.get(fromTerr.id)!;
      const toDef = mapById.get(toTerr.id)!;
      state.log.push(
        `✈️ PONTE AÉREA: ${currentPlayer.name} transportou ${action.armies} divisão(ões) de ${fromDef.namePt} para ${toDef.namePt}.`
      );
      break;
    }

    case "maneuver": {
      if (state.phase !== "maneuver") {
        throw new Error("Remanejamento só é permitido na fase de movimentação.");
      }
      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || !toTerr) throw new Error("Território inválido.");
      if (fromTerr.ownerId !== playerId || toTerr.ownerId !== playerId) {
        throw new Error("Ambos os territórios devem pertencer a você.");
      }
      const fromDef = mapById.get(fromTerr.id)!;
      if (!fromDef.neighbors.includes(toTerr.id)) {
        throw new Error("No War clássico, o remanejamento só é permitido entre territórios vizinhos.");
      }

      const availableUnits = subtractUnits(getTerritoryUnits(fromTerr), getMovedInUnits(fromTerr));
      const movableArmies = Math.max(0, totalUnits(availableUnits) - 1);
      if (action.armies > movableArmies) {
        throw new Error(`Apenas ${movableArmies} exército(s) podem se mover deste território neste turno.`);
      }
      const movedUnits = action.units ?? selectUnits(availableUnits, action.armies);
      if (totalUnits(movedUnits) !== action.armies) {
        throw new Error("A composição deve corresponder ao total de divisões movidas.");
      }
      if (!canSubtractUnits(availableUnits, movedUnits)) {
        throw new Error("A composição inclui unidades indisponíveis ou que já se moveram neste turno.");
      }

      if (isSeaLink(fromTerr.id, toTerr.id)) {
        const blockade = checkNavalBlockade(state, fromTerr.id, toTerr.id, playerId);
        if (blockade.isBlockaded) {
          throw new Error("A rota marítima está bloqueada por frotas inimigas.");
        }
        if (movedUnits.navy > 0 && !hasTerritoryBuilding(toTerr, "port")) {
          throw new Error("Unidades navais só podem ser manobradas para portos costeiros aliados.");
        }
      }

      setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), movedUnits));
      setTerritoryUnits(toTerr, addUnits(getTerritoryUnits(toTerr), movedUnits));
      setMovedInUnits(toTerr, addUnits(getMovedInUnits(toTerr), movedUnits));
      updateSupplyAndEncirclement(state, map);

      state.log.push(
        `${currentPlayer.name} moveu ${action.armies} de ${fromDef.namePt} para ${
          mapById.get(toTerr.id)!.namePt
        }.`
      );
      break;
    }

    case "propose_treaty": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode propor um tratado a si mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("General-alvo inválido ou eliminado.");
      }
      if (action.treatyType === "alliance" && (state.worldTension ?? 0) < 50) {
        throw new Error(
          "Alianças Militares só podem ser firmadas com Tensão Mundial de pelo menos 50%."
        );
      }
      state.treaties = state.treaties ?? [];
      const existing = state.treaties.find(
        (t) =>
          t.status !== "broken" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === action.targetPlayerId) ||
            (t.fromPlayerId === action.targetPlayerId && t.toPlayerId === playerId))
      );
      if (existing) {
        if (existing.status === "active") throw new Error("Já existe um tratado ativo com este general.");
        if (existing.status === "pending") throw new Error("Já existe uma proposta de tratado em análise.");
      }

      const treatyId = `treaty_${Date.now()}_${rng.nextInt(100, 999)}`;
      state.treaties.push({
        id: treatyId,
        fromPlayerId: playerId,
        toPlayerId: action.targetPlayerId,
        type: action.treatyType,
        status: "pending",
        createdRound: state.round,
      });

      const treatyLabel = action.treatyType === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(`📜 ${actingPlayer.name} enviou uma proposta de ${treatyLabel} para ${target.name}.`);
      break;
    }

    case "accept_treaty": {
      state.treaties = state.treaties ?? [];
      const treaty = state.treaties.find((t) => t.id === action.treatyId);
      if (!treaty || treaty.status !== "pending") {
        throw new Error("Tratado não encontrado ou já processado.");
      }
      if (treaty.toPlayerId !== playerId) {
        throw new Error("Apenas o general destinatário pode aceitar o tratado.");
      }
      treaty.status = "active";
      const fromP = state.players.find((p) => p.id === treaty.fromPlayerId);
      const toP = state.players.find((p) => p.id === treaty.toPlayerId);
      const label = treaty.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(`🤝 TRATADO FIRMADO! ${fromP?.name} e ${toP?.name} ratificaram um ${label}!`);
      break;
    }

    case "reject_treaty": {
      state.treaties = state.treaties ?? [];
      const treatyIdx = state.treaties.findIndex((t) => t.id === action.treatyId);
      if (treatyIdx === -1) throw new Error("Tratado não encontrado.");
      const treaty = state.treaties[treatyIdx];
      if (treaty.toPlayerId !== playerId && treaty.fromPlayerId !== playerId) {
        throw new Error("Você não tem permissão para rejeitar ou cancelar este tratado.");
      }
      state.treaties.splice(treatyIdx, 1);
      const label = treaty.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(`❌ Proposta de ${label} foi recusada.`);
      break;
    }

    case "break_treaty": {
      state.treaties = state.treaties ?? [];
      const treaty = state.treaties.find((t) => t.id === action.treatyId);
      if (!treaty || treaty.status !== "active") {
        throw new Error("Tratado ativo não encontrado.");
      }
      if (treaty.fromPlayerId !== playerId && treaty.toPlayerId !== playerId) {
        throw new Error("Você não é signatário deste tratado.");
      }
      const otherId = treaty.fromPlayerId === playerId ? treaty.toPlayerId : treaty.fromPlayerId;
      const otherP = state.players.find((p) => p.id === otherId);

      treaty.status = "broken";
      state.treaties = state.treaties.filter((t) => t.id !== treaty.id);

      // Confiscate/dissolve any investment routes between the signatories (HEGEM-22)
      if (state.investmentRoutes) {
        const removed = state.investmentRoutes.filter(
          (r) =>
            (r.playerAId === playerId && r.playerBId === otherId) ||
            (r.playerAId === otherId && r.playerBId === playerId)
        );
        if (removed.length > 0) {
          state.investmentRoutes = state.investmentRoutes.filter(
            (r) =>
              !(
                (r.playerAId === playerId && r.playerBId === otherId) ||
                (r.playerAId === otherId && r.playerBId === playerId)
              )
          );
          state.log.push(
            `📉 ROTAS COMERCIAIS DISSOLVIDAS: Todas as rotas de investimento mútuo entre ${actingPlayer.name} e ${otherP?.name ?? "aliado"} foram confiscadas e desfeitas!`
          );
        }
      }

      actingPlayer.infamy = Math.min(100, (actingPlayer.infamy ?? 0) + 35);
      state.worldTension = Math.min(100, (state.worldTension ?? 0) + 15);

      const label = treaty.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(
        `💥 TRAIÇÃO DIPLOMÁTICA! ${actingPlayer.name} rompeu unilateralmente o ${label} com ${otherP?.name}! (+35% de Infâmia, +15% de Tensão Mundial)`
      );
      break;
    }

    case "propose_investment": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode abrir uma rota de investimento consigo mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("Parceiro comercial inválido ou eliminado.");
      }
      if (!playerHasMarket(state, playerId)) {
        throw new Error(
          "Você precisa controlar ao menos um Mercado construído para propor rotas comerciais."
        );
      }
      if (!playerHasMarket(state, action.targetPlayerId)) {
        throw new Error(`${target.name} não possui um Mercado construído em seus territórios.`);
      }
      const activeTreaty = (state.treaties ?? []).find(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === action.targetPlayerId) ||
            (t.fromPlayerId === action.targetPlayerId && t.toPlayerId === playerId))
      );
      if (!activeTreaty) {
        throw new Error(
          "Rotas de investimento exigem um tratado ativo prévio (Pacto de Não-Agressão ou Aliança Militar)."
        );
      }
      state.investmentRoutes = state.investmentRoutes ?? [];
      const existing = state.investmentRoutes.find(
        (r) =>
          ((r.playerAId === playerId && r.playerBId === action.targetPlayerId) ||
            (r.playerAId === action.targetPlayerId && r.playerBId === playerId)) &&
          (r.status === "active" || r.status === "pending")
      );
      if (existing) {
        throw new Error(
          existing.status === "active"
            ? "Já existe uma rota de investimento ativa com este aliado."
            : "Já existe uma proposta de rota pendente com este general."
        );
      }
      if (actingPlayer.resources.money < 3) {
        throw new Error("Recursos insuficientes: você precisa de $3 para o aporte inicial da rota.");
      }

      const routeId = `route_${Date.now()}_${rng.nextInt(100, 999)}`;
      state.investmentRoutes.push({
        id: routeId,
        playerAId: playerId,
        playerBId: action.targetPlayerId,
        treatyId: activeTreaty.id,
        status: "pending",
        roundsActive: 0,
        createdRound: state.round,
      });

      state.log.push(
        `💼 PROPOSTA COMERCIAL: ${actingPlayer.name} propôs uma Rota de Investimento Aliado para ${target.name}.`
      );
      break;
    }

    case "accept_investment": {
      state.investmentRoutes = state.investmentRoutes ?? [];
      const route = state.investmentRoutes.find((r) => r.id === action.routeId);
      if (!route || route.status !== "pending") {
        throw new Error("Proposta de rota de investimento não encontrada ou expirada.");
      }
      if (route.playerBId !== playerId) {
        throw new Error("Você não é o destinatário desta proposta de investimento.");
      }
      const playerA = state.players.find((p) => p.id === route.playerAId);
      if (!playerA || playerA.eliminated) {
        throw new Error("O proponente da rota não está mais na partida.");
      }
      if (!playerHasMarket(state, playerA.id) || !playerHasMarket(state, playerId)) {
        throw new Error("Ambos os generais precisam controlar ao menos um Mercado ativo.");
      }
      const hasTreaty = (state.treaties ?? []).some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerA.id && t.toPlayerId === playerId) ||
            (t.fromPlayerId === playerId && t.toPlayerId === playerA.id))
      );
      if (!hasTreaty) {
        throw new Error("O tratado diplomático entre as partes não está mais ativo.");
      }
      if (playerA.resources.money < 3) {
        throw new Error(
          `O proponente ${playerA.name} não possui mais os $3 necessários para a abertura.`
        );
      }
      if (actingPlayer.resources.money < 3) {
        throw new Error(
          `Dinheiro insuficiente: necessários $3 de capital, você possui $${actingPlayer.resources.money}.`
        );
      }

      playerA.resources.money -= 3;
      actingPlayer.resources.money -= 3;
      route.status = "active";
      route.roundsActive = 0;

      state.log.push(
        `🤝 ROTA DE INVESTIMENTO CONSOLIDADA: ${playerA.name} e ${actingPlayer.name} cofinanciaram uma rota comercial bilateral (+ $2/turno para ambos).`
      );
      break;
    }

    case "reject_investment": {
      state.investmentRoutes = state.investmentRoutes ?? [];
      const routeIdx = state.investmentRoutes.findIndex((r) => r.id === action.routeId);
      if (routeIdx === -1) {
        throw new Error("Proposta de rota não encontrada.");
      }
      const route = state.investmentRoutes[routeIdx];
      if (route.playerAId !== playerId && route.playerBId !== playerId) {
        throw new Error("Você não tem autorização para interagir com esta proposta.");
      }
      state.investmentRoutes.splice(routeIdx, 1);
      const otherId = route.playerAId === playerId ? route.playerBId : route.playerAId;
      const other = state.players.find((p) => p.id === otherId);
      state.log.push(
        `❌ A proposta de Rota de Investimento entre ${actingPlayer.name} e ${other?.name ?? "aliado"} foi cancelada.`
      );
      break;
    }

    case "propose_border_trade": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode negociar consigo mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("Parceiro de comércio de fronteira inválido ou eliminado.");
      }
      const fromTerr = state.territories[action.fromTerritoryId];
      const toTerr = state.territories[action.toTerritoryId];
      if (!fromTerr || fromTerr.ownerId !== playerId) {
        throw new Error("O território de origem do carregamento deve pertencer a você.");
      }
      if (!toTerr || toTerr.ownerId !== action.targetPlayerId) {
        throw new Error("O território de destino deve pertencer ao parceiro comercial.");
      }
      const fromDef = mapById.get(action.fromTerritoryId);
      if (!fromDef || !fromDef.neighbors.includes(action.toTerritoryId)) {
        throw new Error("O comércio de fronteira exige que os territórios compartilhem uma fronteira direta.");
      }
      if (actingPlayer.resources[action.resource] < 1) {
        throw new Error(`Você não possui 1 unidade de ${action.resource} disponível em seu estoque nacional.`);
      }
      if (action.price < 1) {
        throw new Error("O valor da transação deve ser de no mínimo $1.");
      }

      state.borderTrades = state.borderTrades ?? [];
      const dealId = `btrade_${Date.now()}_${rng.nextInt(100, 999)}`;
      state.borderTrades.push({
        id: dealId,
        fromPlayerId: playerId,
        toPlayerId: action.targetPlayerId,
        fromTerritoryId: action.fromTerritoryId,
        toTerritoryId: action.toTerritoryId,
        resource: action.resource,
        price: action.price,
        status: "pending",
        createdRound: state.round,
      });

      const resourceLabels: Record<ResourceType, string> = {
        steel: "Aço",
        oil: "Petróleo",
        gold: "Ouro",
      };
      const resName = resourceLabels[action.resource] ?? action.resource;
      const toDef = mapById.get(action.toTerritoryId)!;
      state.log.push(
        `🚚 OFERTA DE FRONTEIRA: ${actingPlayer.name} ofereceu 1x ${resName} de ${fromDef.namePt} para ${toDef.namePt} (${target.name}) por $${action.price}.`
      );
      break;
    }

    case "accept_border_trade": {
      state.borderTrades = state.borderTrades ?? [];
      const deal = state.borderTrades.find((d) => d.id === action.dealId);
      if (!deal || deal.status !== "pending") {
        throw new Error("Oferta de fronteira não encontrada ou já expirada.");
      }
      if (deal.toPlayerId !== playerId) {
        throw new Error("Você não é o destinatário desta oferta de fronteira.");
      }
      const seller = state.players.find((p) => p.id === deal.fromPlayerId);
      if (!seller || seller.eliminated) {
        throw new Error("O fornecedor não está mais ativo na partida.");
      }
      if (actingPlayer.resources.money < deal.price) {
        throw new Error(
          `Dinheiro insuficiente: necessários $${deal.price}, você possui $${actingPlayer.resources.money}.`
        );
      }
      if (seller.resources[deal.resource] < 1) {
        throw new Error(`O fornecedor ${seller.name} não possui mais 1 unidade de ${deal.resource} em estoque.`);
      }
      const fromTerr = state.territories[deal.fromTerritoryId];
      const toTerr = state.territories[deal.toTerritoryId];
      if (!fromTerr || fromTerr.ownerId !== seller.id || !toTerr || toTerr.ownerId !== playerId) {
        throw new Error("O controle territorial das fronteiras foi alterado após o envio da proposta.");
      }

      actingPlayer.resources.money -= deal.price;
      actingPlayer.resources[deal.resource] += 1;
      seller.resources.money += deal.price;
      seller.resources[deal.resource] -= 1;
      deal.status = "active";

      const resourceLabels: Record<ResourceType, string> = {
        steel: "Aço",
        oil: "Petróleo",
        gold: "Ouro",
      };
      const resName = resourceLabels[deal.resource] ?? deal.resource;
      const fromDef = mapById.get(deal.fromTerritoryId)!;
      const toDef = mapById.get(deal.toTerritoryId)!;

      state.log.push(
        `📦 CARGA RECEBIDA: ${actingPlayer.name} comprou 1x ${resName} de ${seller.name} via fronteira (${fromDef.namePt} ➔ ${toDef.namePt}) por $${deal.price}.`
      );
      break;
    }

    case "reject_border_trade": {
      state.borderTrades = state.borderTrades ?? [];
      const dealIdx = state.borderTrades.findIndex((d) => d.id === action.dealId);
      if (dealIdx === -1) {
        throw new Error("Oferta de fronteira não encontrada.");
      }
      const deal = state.borderTrades[dealIdx];
      if (deal.fromPlayerId !== playerId && deal.toPlayerId !== playerId) {
        throw new Error("Você não tem autorização para cancelar esta oferta.");
      }
      state.borderTrades.splice(dealIdx, 1);
      state.log.push(`❌ Oferta de comércio de fronteira cancelada.`);
      break;
    }

    case "form_coalition": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode formar uma coalizão contra si mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("Alvo da coalizão inválido ou eliminado.");
      }
      if ((target.infamy ?? 0) < 50) {
        throw new Error(
          `O general ${target.name} possui apenas ${target.infamy ?? 0}% de Infâmia. Coalizões exigem pelo menos 50%.`
        );
      }
      state.coalitions = state.coalitions ?? [];
      let coalition = state.coalitions.find((c) => c.targetPlayerId === action.targetPlayerId);
      if (coalition) {
        if (coalition.memberPlayerIds.includes(playerId)) {
          throw new Error("Você já faz parte desta coalizão.");
        }
        const maxMembers = target.infamy >= 100 ? 3 : 2;
        if (coalition.memberPlayerIds.length >= maxMembers) {
          throw new Error(`Esta coalizão já atingiu a capacidade máxima (${maxMembers} generais).`);
        }
        coalition.memberPlayerIds.push(playerId);
        state.log.push(`⚔️ ${actingPlayer.name} ingressou na Coalizão contra ${target.name}!`);
      } else {
        coalition = {
          id: `coalition_${Date.now()}_${rng.nextInt(100, 999)}`,
          targetPlayerId: action.targetPlayerId,
          memberPlayerIds: [playerId],
          createdRound: state.round,
        };
        state.coalitions.push(coalition);
        state.log.push(
          `⚔️ COALIZÃO DECLARADA! ${actingPlayer.name} convocou uma coalizão militar contra o infame ${target.name}!`
        );
      }
      break;
    }

    case "join_coalition": {
      state.coalitions = state.coalitions ?? [];
      const coalition = state.coalitions.find((c) => c.id === action.coalitionId);
      if (!coalition) throw new Error("Coalizão não encontrada.");
      if (coalition.targetPlayerId === playerId) {
        throw new Error("Você é o alvo desta coalizão.");
      }
      if (coalition.memberPlayerIds.includes(playerId)) {
        throw new Error("Você já faz parte desta coalizão.");
      }
      const target = state.players.find((p) => p.id === coalition.targetPlayerId);
      const maxMembers = target && (target.infamy ?? 0) >= 100 ? 3 : 2;
      if (coalition.memberPlayerIds.length >= maxMembers) {
        throw new Error(`A coalizão já possui o limite máximo de ${maxMembers} generais.`);
      }
      coalition.memberPlayerIds.push(playerId);
      const targetName = target ? target.name : "inimigo";
      state.log.push(`⚔️ ${actingPlayer.name} uniu-se à Coalizão contra ${targetName}!`);
      break;
    }

    case "end_turn": {
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes de encerrar o turno.");
      }
      if (state.phase === "deploy" && currentPlayer.unplacedArmies > 0) {
        throw new Error("Posicione todos os seus exércitos antes de encerrar o turno.");
      }
      advanceTurn(state, rng, map);
      break;
    }
  }

  // Immediate victory check after any valid action (once any pending occupy is resolved)
  if (!state.pendingConquest) {
    for (const p of state.players) {
      if (checkPlayerVictory(state, p.id, map)) {
        state.winnerId = p.id;
        state.phase = "game_over";
        state.log.push(`[VITÓRIA] ${p.name} cumpriu seu objetivo e venceu a partida!`);
        break;
      }
    }
  }

  return state;
}

function advanceTurn(state: GameState, rng: SeededRng, map: GameMapDef): void {
  const endingPlayer = state.players[state.turnIndex];

  // Draw 1 territory card if conquered at least 1 territory this turn (and under 5 cards)
  if (endingPlayer.conqueredThisTurn && endingPlayer.cards.length < 5) {
    if (state.deck.length === 0 && state.discardPile.length > 0) {
      state.deck = rng.shuffle(state.discardPile);
      state.discardPile = [];
    }
    const card = state.deck.pop();
    if (card) {
      endingPlayer.cards.push(card);
    }
  }
  endingPlayer.conqueredThisTurn = false;
  endingPlayer.boughtCardWithGoldThisTurn = false;

  for (const t of Object.values(state.territories)) {
    setMovedInUnits(t, emptyUnitCounts());
    t.airliftedThisTurn = false;
    t.artilleryBarrageFiredThisTurn = false;
    t.airMissionFlownThisTurn = false;
    t.casBonusAttackerId = undefined;
    t.conqueredTurnRound = undefined;
    t.blitzkriegAvailable = false;
    t.infantryAssaultFatigued = false;
  }

  // Advance to next non-eliminated player
  const totalPlayers = state.players.length;
  let roundAdvanced = false;
  for (let step = 1; step <= totalPlayers; step++) {
    const nextIdx = (state.turnIndex + step) % totalPlayers;
    if (
      !roundAdvanced &&
      (nextIdx < state.turnIndex || (state.turnIndex === totalPlayers - 1 && nextIdx === 0))
    ) {
      state.round += 1;
      roundAdvanced = true;
      state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 0.5).toFixed(1)));

      if (state.investmentRoutes) {
        for (const route of state.investmentRoutes) {
          if (route.status === "active") {
            route.roundsActive += 1;
          }
        }
      }

      const totalTerritories = Object.keys(state.territories).length;
      if (totalTerritories > 0) {
        for (const p of state.players) {
          if (!p.eliminated) {
            const heldCount = Object.values(state.territories).filter(
              (t) => t.ownerId === p.id
            ).length;
            if (heldCount / totalTerritories >= 0.38) {
              p.infamy = Math.min(100, (p.infamy ?? 0) + 5);
              state.log.push(
                `⚠️ HEGEMONIA AMEAÇADORA: ${p.name} controla ${heldCount}/${totalTerritories} territórios (${Math.round((heldCount / totalTerritories) * 100)}%) e gera alarme global! (+5% Infâmia)`
              );
            }
          }
        }
      }
    }
    const candidate = state.players[nextIdx];
    if (!candidate.eliminated) {
      state.turnIndex = nextIdx;
      state.phase = "deploy";

      // 5-Round National Reorganization after losing capital
      if (
        candidate.isCapitalLost &&
        candidate.capitalLostTurn !== undefined &&
        state.round - candidate.capitalLostTurn >= 5
      ) {
        candidate.isCapitalLost = false;
        candidate.capitalTerritoryId = undefined; // Clears the fallen capital status and allows choosing a new one
        candidate.economicPenaltyMultiplier = 1.0;
        state.log.push(
          `🏛️ REORGANIZAÇÃO NACIONAL: ${candidate.name} reorganizou seu governo 5 rodadas após a queda de sua capital e pode agora estabelecer uma nova Capital de Comando!`
        );
      }

      const reinf = calculateTurnReinforcements(state, candidate.id, map);
      candidate.unplacedArmies = reinf.total;
      candidate.boughtCardWithGoldThisTurn = false;
      if (candidate.moralePenalty && candidate.moralePenalty > 0) {
        // One-turn penalty applied; clear penalty for subsequent turns
        candidate.moralePenalty = 0;
      }
      const capTag = reinf.capitalBonus > 0 ? " (+1 bônus Capital)" : "";
      const penTag = reinf.moralePenalty > 0 ? ` (-${reinf.moralePenalty} penalidade moral)` : "";
      state.log.push(
        `Turno de ${candidate.name} (Rodada ${state.round}): +${reinf.total} exércitos${capTag}${penTag}.`
      );
      collectTurnEconomy(state, candidate.id, map);

      updateSupplyAndEncirclement(state, map);

      // Track geoeconomic metrics (HEGEM-59)
      for (const p of state.players) {
        if (!p.eliminated) {
          p.analytics = p.analytics ?? createInitialPlayerAnalytics();
          const pTerrs = Object.values(state.territories).filter((t) => t.ownerId === p.id);
          const ownsMechanized = pTerrs.some((t) => {
            const u = getTerritoryUnits(t);
            return u.tank > 0 || u.aircraft > 0 || u.navy > 0;
          });
          if (ownsMechanized && (p.resources?.oil ?? 0) <= 0) {
            p.analytics.fuelStarvationTurns += 1;
          }
          for (const continent of map.continents) {
            const contTerrs = map.territories.filter((t) => t.continent === continent.id);
            const holdsAll = contTerrs.every((t) => state.territories[t.id]?.ownerId === p.id);
            if (holdsAll && p.analytics.unificationRounds[continent.id] === undefined) {
              p.analytics.unificationRounds[continent.id] = state.round;
            }
          }
          if (pTerrs.some((t) => t.isEncircled)) {
            p.analytics.encircledRoundsCount += 1;
          }
        }
      }
      break;
    }
  }
}

/**
 * Finds the first valid 3-card set in a player's hand (used by bots and UI auto-select).
 */
export function findValidTradeTriplet(
  cards: TerritoryCard[]
): [string, string, string] | null {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        if (isValidCardSet([cards[i], cards[j], cards[k]])) {
          return [cards[i].id, cards[j].id, cards[k].id];
        }
      }
    }
  }
  return null;
}

/**
 * Creates a masked view of the GameState safe to send to `viewerPlayerId` (or spectator).
 * Secret objectives and card hands of OTHER players are stripped out so F12 inspection reveals nothing!
 */
export function createPlayerView(
  state: GameState,
  viewerPlayerId: string | null
): GameState {
  const clone = structuredClone(state);
  clone.deck = []; // Never send draw deck order to clients
  clone.discardPile = [];

  for (const p of clone.players) {
    if (p.id !== viewerPlayerId && state.phase !== "game_over") {
      p.objective = {
        id: "hidden",
        descriptionPt: "Objetivo Secreto",
        descriptionEn: "Secret Objective",
        rule: { type: "territories", count: 24, minArmiesPerTerritory: 1 },
      };
      // Replace cards with dummy placeholders so clients only see the card count
      p.cards = p.cards.map((_, idx) => ({
        id: `hidden_${idx}`,
        territoryId: null,
        symbol: "circle",
      }));
    }
  }
  return clone;
}
