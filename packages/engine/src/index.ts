import {
  DOCTRINES,
  isDoctrineAvailableInLobby,
  isObjectiveCompatibleWithDoctrine,
  type BorderTradeDeal,
  type BuildingType,
  createInitialPlayerAnalytics,
  type DoctrineId,
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
  type TacticalScenarioId,
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
export { createSeededRng, type SeededRng } from "./rng.js";
import { applyTacticalScenario } from "./scenarios.js";
import {
  applyDoctrineCombatDiceModifiers,
  applySelectDoctrine,
  canDegradeFortificationInCombat,
  getEffectiveBlitzOilCost,
  getEffectiveBuildingMoneyCost,
  getMaxAirliftsPerTurn,
  getPlayerNativeContinent,
  resetDoctrineTurnCounters,
  resolveGuerrillaInsurgencyOnOccupy,
} from "./doctrines.js";
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

export interface CreateGamePlayerInput {
  id: string;
  name: string;
  color: PlayerColor;
  doctrineId?: DoctrineId | null;
  recentObjectiveIds?: string[];
}

export interface CreateGameOptions {
  id: string;
  players: CreateGamePlayerInput[];
  seed: string;
  map?: GameMapDef;
  objectives?: ObjectiveCard[];
  scenarioId?: TacticalScenarioId;
}

export * from "./doctrines.js";
export * from "./scenarios.js";

/**
 * Safe deep-clone utility for GameState and game entities.
 * Uses native structuredClone when supported and safe, with JSON serialization fallback
 * to gracefully handle reactive Proxies (e.g. Svelte 5 $state) and browser window environments.
 */
export function cloneGameState<T>(val: T): T {
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}

/**
 * Card trade progression with a linear limit cap at trade 10 (max 35 base armies) to prevent exponential late-game explosion:
 * Progression: 4, 6, 8, 10, 12, 15, 20, 25, 30, 35 (capped at 35 for all subsequent exchanges from the 10th trade).
 */
export function getTradeBonusArmies(tradeIndexZeroBased: number): number {
  const table = [4, 6, 8, 10, 12, 15, 20, 25, 30, 35];
  if (tradeIndexZeroBased < 0) return table[0];
  if (tradeIndexZeroBased < table.length) {
    return table[tradeIndexZeroBased];
  }
  return table[table.length - 1];
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

  let capitalBonus = 0;
  if (
    player?.capitalTerritoryId &&
    state.territories[player.capitalTerritoryId]?.ownerId === playerId
  ) {
    capitalBonus = 1;
  }

  let doctrineBonus = 0;
  if (player?.doctrineId === "extermination") {
    // Doutrina de Extermínio possui economia zero (0 0 0 0) e não pode construir; recebe +4 divisões de reforço por turno
    doctrineBonus = 4;
  }

  const moralePenalty = player?.moralePenalty ?? 0;
  const total = Math.max(1, baseArmies + continentBonus + capitalBonus + doctrineBonus - moralePenalty);

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
  fortification: { money: 6, steel: 0 }, // Level 1 Casamata
  airfield: { money: 5, steel: 1 },
  port: { money: 5, steel: 0 },
  military_factory: { money: 6, steel: 2 },
  civilian_factory: { money: 5, steel: 1 },
  steel_mine: { money: 5, steel: 0 },
  oil_well: { money: 5, steel: 1 },
  refinery: { money: 6, steel: 1 },
  wonder: { money: 12, steel: 4 },
};

export const FORTIFICATION_LEVEL_2_COST: BuildingCost = {
  money: 6,
  steel: 2,
};

export const INDUSTRY_LEVEL_2_COST: BuildingCost = {
  money: 4,
  steel: 2,
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
  steel: { baseBuy: 4, baseSell: 3, step: 1, minSell: 1, maxBuy: 9999 },
  oil: { baseBuy: 5, baseSell: 4, step: 1, minSell: 1, maxBuy: 9999 },
  gold: { baseBuy: 8, baseSell: 6, step: 2, minSell: 1, maxBuy: 9999 },
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
  let slots = 2;
  if (owner && owner.capitalTerritoryId === territoryId && !owner.isCapitalLost) {
    slots = 3;
  }
  // HEGEM-107: Fábrica Civil expande capacidade de obras em +1 slot
  if (hasTerritoryBuilding(terr, "civilian_factory")) {
    slots += 1;
  }
  // Expansão Territorial de uso único (+1 slot por fora)
  if (terr.infrastructureExpanded) {
    slots += 1;
  }
  return slots;
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
  const attackerExterm = attackerPlayer?.doctrineId === "extermination";
  const defenderExterm = defenderPlayer?.doctrineId === "extermination";

  let attackerNavy = 0;
  if (
    fromTerr.ownerId === actingPlayerId &&
    (hasTerritoryBuilding(fromTerr, "port") || attackerExterm) &&
    attackerHasOil
  ) {
    attackerNavy = getTerritoryUnits(fromTerr).navy;
  }

  let defenderNavy = 0;
  if (
    toTerr.ownerId !== actingPlayerId &&
    (hasTerritoryBuilding(toTerr, "port") || defenderExterm) &&
    defenderHasOil
  ) {
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

    // HEGEM-125: Partisan / Guerrilla doctrine is 100% immune to supply line encirclement everywhere
    if (player.doctrineId === "guerrilla" || player.doctrineId === "guerrilla_warfare") {
      for (const t of playerTerritories) {
        t.isEncircled = false;
        t.encircledRounds = 0;
      }
      continue;
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
 * Retorna a menor distância de caminho contíguo entre dois territórios através de províncias aliadas.
 * Retorna Infinity caso não haja conexão contígua desimpedida.
 */
export function getFriendlyPathDistance(
  state: GameState,
  fromTerritoryId: string,
  toTerritoryId: string,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): number {
  if (fromTerritoryId === toTerritoryId) return 0;
  const mapById = new Map(map.territories.map((t) => [t.id, t]));
  const visited = new Map<string, number>();
  visited.set(fromTerritoryId, 0);
  const queue: [string, number][] = [[fromTerritoryId, 0]];

  while (queue.length > 0) {
    const [currId, dist] = queue.shift()!;
    const currDef = mapById.get(currId);
    if (!currDef) continue;

    for (const nbrId of currDef.neighbors) {
      if (nbrId === toTerritoryId) {
        if (isSeaLink(currId, nbrId)) {
          const blockade = checkNavalBlockade(state, currId, nbrId, playerId);
          if (blockade.isBlockaded) continue;
        }
        return dist + 1;
      }
      if (visited.has(nbrId)) continue;
      const nbrTerr = state.territories[nbrId];
      if (!nbrTerr || nbrTerr.ownerId !== playerId) continue;

      if (isSeaLink(currId, nbrId)) {
        const blockade = checkNavalBlockade(state, currId, nbrId, playerId);
        if (blockade.isBlockaded) continue;
      }

      visited.set(nbrId, dist + 1);
      queue.push([nbrId, dist + 1]);
    }
  }
  return Infinity;
}

/**
 * Verifica se dois territórios aliados estão conectados por uma rota contígua de províncias aliadas
 * opcionalmente limitada por uma distância máxima de deslocamento.
 */
export function isConnectedByFriendlyPath(
  state: GameState,
  fromTerritoryId: string,
  toTerritoryId: string,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP,
  maxDistance?: number
): boolean {
  const dist = getFriendlyPathDistance(state, fromTerritoryId, toTerritoryId, playerId, map);
  if (!Number.isFinite(dist)) return false;
  if (maxDistance !== undefined && dist > maxDistance) return false;
  return true;
}

/**
 * Retorna todos os territórios aliados alcançáveis para manobra a partir de uma origem aliada,
 * respeitando os alcances específicos por tipo de unidade (HEGEM-138):
 * - Infantaria e Artilharia: 1 tile (vizinho direto)
 * - Tanques (Blindados): até 2 tiles conectados
 * - Força Naval: até 3 tiles conectados por rotas marítimas
 * - Aeronaves: qualquer território aliado que possua Aeródromo (desde que a origem possua Aeródromo)
 */
export function getReachableManeuverTargets(
  state: GameState,
  fromTerritoryId: string,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP,
  unitsToMove?: UnitCounts
): Set<string> {
  const reachable = new Set<string>();
  const fromTerr = state.territories[fromTerritoryId];
  if (!fromTerr || fromTerr.ownerId !== playerId) return reachable;

  const mapById = new Map(map.territories.map((t) => [t.id, t]));
  const fromUnits = getTerritoryUnits(fromTerr);
  const fromHasAirfield = hasTerritoryBuilding(fromTerr, "airfield");

  // Determina o alcance máximo permitido
  let maxLandDistance = 1;
  let canMoveAirfieldToAirfield = false;

  if (unitsToMove) {
    if (unitsToMove.infantry > 0 || unitsToMove.artillery > 0) {
      maxLandDistance = 1;
    } else if (unitsToMove.tank > 0) {
      maxLandDistance = 2;
    } else if (unitsToMove.navy > 0) {
      maxLandDistance = 3;
    } else if (unitsToMove.aircraft > 0) {
      canMoveAirfieldToAirfield = fromHasAirfield;
      maxLandDistance = 0; // Se apenas aviões, somente aeródromos
    }
  } else {
    // Modo geral / seleção prévia: alcance máximo pelas unidades presentes no território
    if (fromUnits.tank > 0) maxLandDistance = Math.max(maxLandDistance, 2);
    if (fromUnits.navy > 0) maxLandDistance = Math.max(maxLandDistance, 3);
    if (fromUnits.aircraft > 0 && fromHasAirfield) canMoveAirfieldToAirfield = true;
  }

  // BFS com limite de distância maxLandDistance
  if (maxLandDistance > 0) {
    const visited = new Map<string, number>();
    visited.set(fromTerritoryId, 0);
    const queue: [string, number][] = [[fromTerritoryId, 0]];

    while (queue.length > 0) {
      const [currId, dist] = queue.shift()!;
      if (dist >= maxLandDistance) continue;
      const currDef = mapById.get(currId);
      if (!currDef) continue;

      for (const nbrId of currDef.neighbors) {
        if (visited.has(nbrId)) continue;
        const nbrTerr = state.territories[nbrId];
        if (!nbrTerr || nbrTerr.ownerId !== playerId) continue;

        if (isSeaLink(currId, nbrId)) {
          const blockade = checkNavalBlockade(state, currId, nbrId, playerId);
          if (blockade.isBlockaded) continue;
        }

        visited.set(nbrId, dist + 1);
        reachable.add(nbrId);
        queue.push([nbrId, dist + 1]);
      }
    }
  }

  // Deslocamento de Aeronaves: entre aeródromos aliados em qualquer lugar do mapa
  if (canMoveAirfieldToAirfield) {
    for (const t of Object.values(state.territories)) {
      if (
        t.id !== fromTerritoryId &&
        t.ownerId === playerId &&
        hasTerritoryBuilding(t, "airfield")
      ) {
        reachable.add(t.id);
      }
    }
  }

  // Airlift destination targets (se tiver aeródromo na origem e não tiver sido usado nesta rodada)
  if (fromHasAirfield && !fromTerr.airliftedThisTurn) {
    for (const t of Object.values(state.territories)) {
      if (
        t.id !== fromTerritoryId &&
        t.ownerId === playerId &&
        hasTerritoryBuilding(t, "airfield")
      ) {
        reachable.add(t.id);
      }
    }
  }

  return reachable;
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
  artilleryUpkeep: number;
  grossMoney: number;
  economicPenaltyMultiplier: number;
  netMoney: number;
  steel: number;
  oil: number;
  gold: number;
}

export function calculateTurnEconomy(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): TurnEconomyBreakdown {
  const player = state.players.find((p) => p.id === playerId);
  if (player?.doctrineId === "extermination") {
    return {
      capitalMoney: 0,
      tradeHubMoney: 0,
      goldPassiveMoney: 0,
      buildingMoney: 0,
      investmentMoney: 0,
      artilleryUpkeep: 0,
      grossMoney: 0,
      economicPenaltyMultiplier: 1.0,
      netMoney: 0,
      steel: 0,
      oil: 0,
      gold: 0,
    };
  }

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
    const indBldg = (terr.buildings ?? []).find((b) => b.type === "industry");
    const isIndLv2 = (indBldg?.level ?? 1) >= 2;
    const hasCivilianFactory = hasTerritoryBuilding(terr, "civilian_factory");
    const hasSteelMine = hasTerritoryBuilding(terr, "steel_mine");
    const hasOilWell = hasTerritoryBuilding(terr, "oil_well");
    const hasRefinery = hasTerritoryBuilding(terr, "refinery");
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
    if (hasCivilianFactory) {
      buildingMoney += 3;
    }
    if (hasIndustry && !def.resource) {
      buildingMoney += isIndLv2 ? 4 : 2;
    }

    const resourceYield = hasIndustry ? (isIndLv2 ? 4 : 2) : 1;
    if (def.resource === "steel") {
      steel += resourceYield + (hasSteelMine ? 2 : 0);
    } else if (def.resource === "oil") {
      oil += resourceYield + (hasOilWell ? 2 : 0);
    } else if (def.resource === "gold") {
      gold += resourceYield;
      goldPassiveMoney += 2;
    } else {
      if (hasSteelMine) steel += 1;
      if (hasOilWell) oil += 1;
    }

    if (hasRefinery) {
      oil += 1;
    }
  }

  // HEGEM-128: Central Bank Gold Reserve Interest (+$2 base income for every 3 Gold held in reserve, starting Round 2+)
  const heldGold = player?.resources?.gold ?? 0;
  if (state.round > 1 && heldGold >= 3) {
    goldPassiveMoney += Math.floor(heldGold / 3) * 2;
  }

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

  let totalArtillery = 0;
  for (const terr of occupiedTerritories) {
    if (terr.units?.artillery) {
      totalArtillery += terr.units.artillery;
    }
  }
  const artilleryUpkeep = totalArtillery * 1;

  let grossMoney =
    capitalMoney + tradeHubMoney + goldPassiveMoney + buildingMoney + investmentMoney;

  // HEGEM-116: Modificadores Econômicos de Doutrina
  if (player?.doctrineId === "mass_assault") {
    grossMoney = Math.floor(grossMoney * 0.60);
  } else if (player?.doctrineId === "tall_sovereign" || player?.doctrineId === "defense_in_depth") {
    if (occupiedTerritories.length <= 5) {
      for (const terr of occupiedTerritories) {
        const def = mapById.get(terr.id);
        if (def?.resource === "steel") steel += 1;
        if (def?.resource === "oil") oil += 1;
        if (def?.resource === "gold") gold += 1;
      }
    } else {
      const overextPenalty = Math.min(0.75, (occupiedTerritories.length - 5) * 0.15);
      grossMoney = Math.floor(grossMoney * (1 - overextPenalty));
    }
  }
  const economicPenaltyMultiplier = player?.isCapitalLost
    ? (player.economicPenaltyMultiplier ?? 0.5)
    : 1.0;
  const netMoney = Math.floor(grossMoney * economicPenaltyMultiplier) - artilleryUpkeep;

  return {
    capitalMoney,
    tradeHubMoney,
    goldPassiveMoney,
    buildingMoney,
    investmentMoney,
    artilleryUpkeep,
    grossMoney,
    economicPenaltyMultiplier,
    netMoney,
    steel,
    oil,
    gold,
  };
}

export function collectTurnEconomy(
  state: GameState,
  playerId: string,
  map: GameMapDef = CLASSIC_MAP
): TurnEconomyBreakdown {
  const player = state.players.find((p) => p.id === playerId);
  const econ = calculateTurnEconomy(state, playerId, map);
  if (!player) return econ;

  if (player.doctrineId === "extermination") {
    player.resources = { money: 0, steel: 0, oil: 0, gold: 0 };
    return econ;
  }

  player.resources = player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  player.resources.money = Math.max(0, player.resources.money + econ.netMoney);
  player.resources.steel += econ.steel;
  player.resources.oil += econ.oil;
  player.resources.gold += econ.gold;

  player.analytics = player.analytics ?? createInitialPlayerAnalytics();
  player.analytics.totalMoneyEarned += Math.max(0, econ.netMoney);

  const parts: string[] = [];
  if (econ.netMoney > 0) {
    parts.push(
      `+$${econ.netMoney}${econ.artilleryUpkeep > 0 ? ` (após -$${econ.artilleryUpkeep} manutenção de artilharia)` : ""}`
    );
  } else if (econ.netMoney < 0) {
    parts.push(`-$${Math.abs(econ.netMoney)} (Manutenção de Artilharia)`);
  }
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
      airliftsCountThisTurn: 0,
    };
    playerOwnedTerritoryIds[owner.id].push(t.id);
  });

  const pool = opts.objectives ? [...opts.objectives] : [...ALL_OBJECTIVES];
  const shuffledObjectives = rng.shuffle(pool);
  const assignedObjectiveIds = new Set<string>();

  const players: PlayerState[] = shuffledPlayers.map((p) => {
    const recentSet = new Set(p.recentObjectiveIds ?? []);
    const startingTerrs = playerOwnedTerritoryIds[p.id] ?? [];

    const isObjEligible = (obj: ObjectiveCard): boolean => {
      if (assignedObjectiveIds.has(obj.id)) return false;
      if (!isObjectiveCompatibleWithDoctrine(obj, p.doctrineId)) return false;
      const rule = obj.rule;
      if (rule.type === "destroy_color") {
        const hasOpponent = shuffledPlayers.some(
          (other) => other.id !== p.id && other.color === rule.targetColor
        );
        if (!hasOpponent) return false;
      }
      return true;
    };

    const hasAffinity = (obj: ObjectiveCard): boolean => {
      if (!p.doctrineId) return false;
      if (obj.allowedDoctrines && obj.allowedDoctrines.includes(p.doctrineId)) return true;
      if (p.doctrineId === "tall_sovereign" || p.doctrineId === "defense_in_depth") {
        return (
          obj.rule.type === "fortified_bastion" ||
          obj.rule.type === "economic_hegemony" ||
          obj.rule.type === "diplomatic_pax"
        );
      }
      if (p.doctrineId === "extermination") {
        return obj.rule.type === "eliminate_players";
      }
      // HEGEM-125: Classic Command (superior_firepower ID) prioritizes Classic War conquest objectives
      if (p.doctrineId === "superior_firepower") {
        return CLASSIC_OBJECTIVES.some((co) => co.id === obj.id);
      }
      return false;
    };

    const eligible = shuffledObjectives.filter(isObjEligible);
    const freshEligible = eligible.filter((o) => !recentSet.has(o.id));
    const recentEligible = eligible.filter((o) => recentSet.has(o.id));
    const prioritizedPool = [...freshEligible, ...recentEligible];

    let chosenObjective: ObjectiveCard | undefined;
    if (p.doctrineId) {
      chosenObjective = prioritizedPool.find(hasAffinity);
    }

    if (!chosenObjective && !opts.objectives) {
      const matchingRoleplay = ROLEPLAY_OBJECTIVES.filter(
        (obj) =>
          isObjEligible(obj) &&
          obj.coreTerritoryIds?.some((coreId) => startingTerrs.includes(coreId))
      );

      if (matchingRoleplay.length > 0 && rng.nextFloat() < 0.5) {
        chosenObjective = matchingRoleplay[rng.nextInt(0, matchingRoleplay.length - 1)];
      }
    }

    if (!chosenObjective) {
      chosenObjective = prioritizedPool.find((obj) => {
        if (!obj.coreTerritoryIds || obj.coreTerritoryIds.length === 0) {
          return true;
        }
        return obj.coreTerritoryIds.some((coreId) => startingTerrs.includes(coreId));
      });
    }

    if (!chosenObjective) {
      chosenObjective =
        prioritizedPool[0] ??
        rng.shuffle([...CLASSIC_OBJECTIVES]).find((obj) => isObjEligible(obj)) ??
        shuffledObjectives.find((obj) => isObjEligible(obj)) ??
        shuffledObjectives[0];
    }
    assignedObjectiveIds.add(chosenObjective.id);

    const remainingPrioritized = prioritizedPool.filter((o) => o.id !== chosenObjective.id);
    let candidateChoices = [chosenObjective, ...remainingPrioritized.slice(0, 2)];
    if (candidateChoices.length < 3) {
      const fallbackExtra = pool.filter(
        (o) =>
          isObjectiveCompatibleWithDoctrine(o, p.doctrineId) &&
          !candidateChoices.some((c) => c.id === o.id)
      );
      candidateChoices = [...candidateChoices, ...fallbackExtra].slice(0, 3);
    }

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      doctrineId: p.doctrineId ?? null,
      blitzCountThisTurn: 0,
      airliftsUsedThisTurn: 0,
      assaultedTargetsThisTurn: [],
      eliminated: false,
      objective: chosenObjective,
      availableObjectives: candidateChoices,
      pendingObjectiveChoice: false,
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
    marketPrices: cloneGameState(INITIAL_MARKET_PRICES),
    investmentRoutes: [],
    borderTrades: [],
  };

  if (opts.scenarioId && opts.scenarioId !== "standard") {
    applyTacticalScenario(state, opts.scenarioId, map);
  } else {
    const firstPlayer = state.players[0];
    const reinf = calculateTurnReinforcements(state, firstPlayer.id, map);
    firstPlayer.unplacedArmies = reinf.total;
    state.log.push(`${firstPlayer.name} recebe ${reinf.total} exércitos para posicionar.`);
    collectTurnEconomy(state, firstPlayer.id, map);
  }

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
    const useFallback =
      !targetPlayer ||
      targetPlayer.id === player.id ||
      (targetPlayer.eliminated && targetPlayer.eliminatedBy !== player.id);

    if (useFallback) {
      return ownedTerritories.length >= rule.fallbackTerritories;
    }
    return targetPlayer.eliminated && targetPlayer.eliminatedBy === player.id;
  }

  // HEGEM-117: Novas Condições de Vitória Assimétricas
  if (rule.type === "economic_hegemony") {
    const moneyOk = (player.resources?.money ?? 0) >= rule.targetMoney;
    const goldOk = (player.resources?.gold ?? 0) >= rule.targetGold;
    const activeRoutes = (state.investmentRoutes ?? []).filter(
      (r) =>
        r.status === "active" &&
        (r.playerAId === playerId || r.playerBId === playerId)
    ).length;
    return moneyOk && goldOk && activeRoutes >= rule.activeInvestmentRoutes;
  }

  if (rule.type === "fortified_bastion") {
    const fortifiedCount = ownedTerritories.filter((t) =>
      (t.buildings ?? []).some((b) => b.type === "fortification")
    ).length;
    return (
      fortifiedCount >= rule.bastionTerritoryCount &&
      (player.bastionRoundsHeld ?? 0) >= rule.roundsRequired
    );
  }

  if (rule.type === "diplomatic_pax") {
    if (state.round >= rule.fallbackRoundsSurvival) {
      return true;
    }
    const otherLiving = state.players.filter((p) => !p.eliminated && p.id !== playerId);
    if (otherLiving.length === 0) return true;

    const activeTreaties = (state.treaties ?? []).filter((t) => t.status === "active");
    const hasAlliance = activeTreaties.some(
      (t) =>
        t.type === "alliance" &&
        (t.fromPlayerId === playerId || t.toPlayerId === playerId)
    );
    const hasNapWithAll = otherLiving.every((other) =>
      activeTreaties.some(
        (t) =>
          (t.fromPlayerId === playerId && t.toPlayerId === other.id) ||
          (t.fromPlayerId === other.id && t.toPlayerId === playerId)
      )
    );
    return hasAlliance && hasNapWithAll;
  }

  if (rule.type === "eliminate_players") {
    const eliminatedByMe = state.players.filter(
      (p) => p.eliminated && p.eliminatedBy === player.id
    ).length;
    const totalOpponents = state.players.filter((p) => p.id !== player.id).length;
    const required = Math.min(rule.minEliminations, Math.max(1, totalOpponents));
    if (eliminatedByMe < required) return false;

    if (rule.requireWorldTension !== undefined && (state.worldTension ?? 0) < rule.requireWorldTension) {
      return false;
    }
    if (rule.requireInfamy !== undefined && (player.infamy ?? 0) < rule.requireInfamy) {
      return false;
    }
    if (rule.minTerritoriesHeld !== undefined && ownedTerritories.length < rule.minTerritoriesHeld) {
      return false;
    }
    return true;
  }

  return false;
}

export interface ObjectiveMetric {
  label: string;
  current: number;
  target: number;
  unit?: string;
  pct: number;
}

export interface ObjectiveProgress {
  completionPct: number;
  held: number;
  total: number;
  description: string;
  metrics?: ObjectiveMetric[];
}

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

  if (rule.type === "economic_hegemony") {
    const moneyProgress = Math.min(100, Math.round(((player.resources?.money ?? 0) / rule.targetMoney) * 100));
    const goldProgress = Math.min(100, Math.round(((player.resources?.gold ?? 0) / rule.targetGold) * 100));
    const activeRoutes = (state.investmentRoutes ?? []).filter(
      (r) => r.status === "active" && (r.playerAId === playerId || r.playerBId === playerId)
    ).length;
    const routeProgress = Math.min(100, Math.round((activeRoutes / rule.activeInvestmentRoutes) * 100));
    const completionPct = Math.round(moneyProgress * 0.4 + goldProgress * 0.4 + routeProgress * 0.2);
    const metrics: ObjectiveMetric[] = [
      {
        label: "Dinheiro no Tesouro",
        current: player.resources?.money ?? 0,
        target: rule.targetMoney,
        unit: "$",
        pct: moneyProgress,
      },
      {
        label: "Reserva de Ouro",
        current: player.resources?.gold ?? 0,
        target: rule.targetGold,
        unit: "Ouro",
        pct: goldProgress,
      },
      {
        label: "Rotas de Investimento",
        current: activeRoutes,
        target: rule.activeInvestmentRoutes,
        pct: routeProgress,
      },
    ];
    return {
      completionPct,
      held: player.resources?.money ?? 0,
      total: rule.targetMoney,
      description: player.objective.descriptionPt,
      metrics,
    };
  }

  if (rule.type === "fortified_bastion") {
    const fortifiedCount = ownedTerritories.filter((t) =>
      (t.buildings ?? []).some((b) => b.type === "fortification")
    ).length;
    const fortProgress = Math.min(100, Math.round((fortifiedCount / rule.bastionTerritoryCount) * 100));
    const roundProgress = Math.min(100, Math.round(((player.bastionRoundsHeld ?? 0) / rule.roundsRequired) * 100));
    const completionPct = Math.round(fortProgress * 0.5 + roundProgress * 0.5);
    const metrics: ObjectiveMetric[] = [
      {
        label: "Territórios Fortificados",
        current: fortifiedCount,
        target: rule.bastionTerritoryCount,
        pct: fortProgress,
      },
      {
        label: "Rodadas Invicto",
        current: player.bastionRoundsHeld ?? 0,
        target: rule.roundsRequired,
        pct: roundProgress,
      },
    ];
    return {
      completionPct,
      held: player.bastionRoundsHeld ?? 0,
      total: rule.roundsRequired,
      description: player.objective.descriptionPt,
      metrics,
    };
  }

  if (rule.type === "diplomatic_pax") {
    const otherLiving = state.players.filter((p) => !p.eliminated && p.id !== playerId);
    const activeTreaties = (state.treaties ?? []).filter((t) => t.status === "active");
    const treatiedCount = otherLiving.filter((other) =>
      activeTreaties.some(
        (t) =>
          (t.fromPlayerId === playerId && t.toPlayerId === other.id) ||
          (t.fromPlayerId === other.id && t.toPlayerId === playerId)
      )
    ).length;
    const treatyProgress = otherLiving.length > 0 ? Math.round((treatiedCount / otherLiving.length) * 100) : 100;
    const roundProgress = Math.min(100, Math.round((state.round / rule.fallbackRoundsSurvival) * 100));
    const completionPct = Math.max(treatyProgress, roundProgress);
    return {
      completionPct,
      held: treatiedCount,
      total: Math.max(1, otherLiving.length),
      description: player.objective.descriptionPt,
    };
  }

  if (rule.type === "eliminate_players") {
    const eliminatedByMe = state.players.filter(
      (p) => p.eliminated && p.eliminatedBy === player.id
    ).length;
    const totalOpponents = state.players.filter((p) => p.id !== player.id).length;
    const required = Math.min(rule.minEliminations, Math.max(1, totalOpponents));
    let totalFactors = 1;
    let factorSum = Math.min(1, eliminatedByMe / required);

    const metrics: ObjectiveMetric[] = [
      {
        label: "Generais Eliminados",
        current: eliminatedByMe,
        target: required,
        pct: Math.min(100, Math.round((eliminatedByMe / required) * 100)),
      },
    ];

    if (rule.requireWorldTension !== undefined) {
      totalFactors++;
      factorSum += Math.min(1, (state.worldTension ?? 0) / rule.requireWorldTension);
      metrics.push({
        label: "Tensão Mundial",
        current: state.worldTension ?? 0,
        target: rule.requireWorldTension,
        unit: "%",
        pct: Math.min(100, Math.round(((state.worldTension ?? 0) / rule.requireWorldTension) * 100)),
      });
    }
    if (rule.requireInfamy !== undefined) {
      totalFactors++;
      factorSum += Math.min(1, (player.infamy ?? 0) / rule.requireInfamy);
      metrics.push({
        label: "Infâmia",
        current: player.infamy ?? 0,
        target: rule.requireInfamy,
        unit: "%",
        pct: Math.min(100, Math.round(((player.infamy ?? 0) / rule.requireInfamy) * 100)),
      });
    }
    if (rule.minTerritoriesHeld !== undefined) {
      totalFactors++;
      factorSum += Math.min(1, ownedTerritories.length / rule.minTerritoriesHeld);
      metrics.push({
        label: "Territórios Ocupados",
        current: ownedTerritories.length,
        target: rule.minTerritoriesHeld,
        pct: Math.min(100, Math.round((ownedTerritories.length / rule.minTerritoriesHeld) * 100)),
      });
    }

    const completionPct = Math.min(100, Math.round((factorSum / totalFactors) * 100));
    return {
      completionPct,
      held: eliminatedByMe,
      total: required,
      description: player.objective.descriptionPt,
      metrics,
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

  const state: GameState = cloneGameState(prevState);
  const currentPlayer = state.players[state.turnIndex];
  const actingPlayer = state.players.find((p) => p.id === playerId);
  if (!actingPlayer || actingPlayer.eliminated) {
    throw new Error("Jogador inválido ou eliminado.");
  }

  const isOutOfTurnAction =
    action.type === "market_trade" ||
    action.type === "select_doctrine" ||
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
    action.type === "reject_border_trade" ||
    action.type === "send_alliance_aid" ||
    action.type === "send_coalition_aircraft";

  if (!isOutOfTurnAction && (!currentPlayer || currentPlayer.id !== playerId)) {
    throw new Error("Não é o seu turno.");
  }

  actingPlayer.resources = actingPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  if (currentPlayer) {
    currentPlayer.resources = currentPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  }
  state.marketPrices = state.marketPrices ?? cloneGameState(INITIAL_MARKET_PRICES);
  state.investmentRoutes = state.investmentRoutes ?? [];
  state.borderTrades = state.borderTrades ?? [];

  const mapById = new Map(map.territories.map((t) => [t.id, t]));

  switch (action.type) {
    case "select_doctrine": {
      if (state.round > 1) {
        throw new Error(
          "A Doutrina Militar Nacional só pode ser definida no início da partida (Rodada 1)."
        );
      }
      if (actingPlayer.doctrineId === action.doctrineId) {
        throw new Error("Sua Doutrina Militar Nacional já foi estabelecida para esta campanha.");
      }

      // HEGEM-116: Validação de limites no lobby / partida
      const currentSelections = state.players.map((p) => p.doctrineId);
      if (!isDoctrineAvailableInLobby(action.doctrineId, currentSelections)) {
        throw new Error(
          `O limite de generais com a doutrina "${DOCTRINES[action.doctrineId]?.namePt}" já foi atingido nesta partida.`
        );
      }

      // HEGEM-117: Compatibilidade estrita entre Doutrina e Objetivo Secreto
      if (actingPlayer.objective && !isObjectiveCompatibleWithDoctrine(actingPlayer.objective, action.doctrineId)) {
        throw new Error(
          `A doutrina militar "${DOCTRINES[action.doctrineId]?.namePt}" é incompatível com o seu Objetivo Secreto.`
        );
      }

      actingPlayer.doctrineId = action.doctrineId;
      const docDef = DOCTRINES[action.doctrineId];

      if (action.doctrineId === "extermination") {
        state.worldTension = Math.max(state.worldTension ?? 0, 50);
        actingPlayer.infamy = Math.max(actingPlayer.infamy ?? 0, 50);
        actingPlayer.resources = { money: 0, steel: 0, oil: 0, gold: 0 };
      }

      state.log.push(
        `🎖️ DOUTRINA MILITAR: ${actingPlayer.name} adotou a doutrina "${docDef.namePt}"!`
      );
      break;
    }

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

      let bonus = getTradeBonusArmies(state.tradeCount);
      state.tradeCount += 1;

      const placeBonusUnitsOnEmpire = (unitType: UnitType, qty: number): number => {
        if (qty <= 0) return 0;
        const ownedTerrs = Object.values(state.territories).filter((t) => t.ownerId === playerId);
        if (ownedTerrs.length === 0) return 0;
        let target =
          (currentPlayer.capitalTerritoryId
            ? state.territories[currentPlayer.capitalTerritoryId]
            : undefined) ?? ownedTerrs[0];
        if (!target || target.ownerId !== playerId) {
          target = ownedTerrs[0];
        }
        if (unitType === "navy") {
          const coastal = ownedTerrs.find((t) => mapById.get(t.id)?.isCoastal !== false);
          if (!coastal) return 0;
          target = coastal;
        } else if (unitType === "aircraft") {
          const withAirfield = ownedTerrs.find((t) => hasTerritoryBuilding(t, "airfield"));
          if (withAirfield) target = withAirfield;
        }
        setTerritoryUnits(
          target,
          addUnits(getTerritoryUnits(target), singleUnitCount(unitType, qty))
        );
        return qty;
      };

      const docId = currentPlayer.doctrineId;
      let tradeRewardSummary = "";
      const isCappedTrade = state.tradeCount >= 10;
      const ownedTerritoriesList = Object.values(state.territories).filter((t) => t.ownerId === playerId);
      const totalEmpireInf =
        currentPlayer.unplacedArmies +
        ownedTerritoriesList.reduce((acc, t) => acc + getTerritoryUnits(t).infantry, 0);
      const totalEmpireTanks = ownedTerritoriesList.reduce((acc, t) => acc + getTerritoryUnits(t).tank, 0);
      const totalEmpireAir = ownedTerritoriesList.reduce((acc, t) => acc + getTerritoryUnits(t).aircraft, 0);
      const totalEmpireNavy = ownedTerritoriesList.reduce((acc, t) => acc + getTerritoryUnits(t).navy, 0);
      const totalEmpireArmies = ownedTerritoriesList.reduce((acc, t) => acc + t.armies, 0) + currentPlayer.unplacedArmies;

      if (docId === "mass_assault") {
        // HEGEM-126: Mass Assault receives only Infantry (bonus + 2), capped at 50 total infantry units
        const rawInf = isCappedTrade ? Math.min(15, bonus + 2) : bonus + 2;
        const allowedInf = Math.max(0, Math.min(rawInf, 50 - totalEmpireInf));
        currentPlayer.unplacedArmies += allowedInf;
        tradeRewardSummary = `+${allowedInf} Infantarias (Assalto em Massa, limite máx. 50)`;
      } else if (docId === "blitzkrieg") {
        // HEGEM-126: Blitzkrieg receives only Tanks; from 10th trade capped at 20 empire tanks (max 8 per trade)
        let tankCount = Math.max(2, Math.floor(bonus / 2));
        if (isCappedTrade) {
          tankCount = Math.min(8, Math.max(0, Math.min(tankCount, 20 - totalEmpireTanks)));
        }
        placeBonusUnitsOnEmpire("tank", tankCount);
        tradeRewardSummary = `+${tankCount} Blindados (Blitzkrieg${isCappedTrade ? ", teto 20" : ""})`;
      } else if (docId === "naval_supremacy" || docId === "fleet_in_being") {
        // HEGEM-126: AeroNaval receives equal amount of Aircraft and Navy; from 10th trade capped at 12 air and 12 navy
        let pairCount = Math.max(1, Math.floor(bonus / 4));
        if (isCappedTrade) {
          const maxAir = Math.max(0, 12 - totalEmpireAir);
          const maxNavy = Math.max(0, 12 - totalEmpireNavy);
          pairCount = Math.min(3, Math.min(pairCount, Math.min(maxAir, maxNavy)));
        }
        const airPlaced = placeBonusUnitsOnEmpire("aircraft", pairCount);
        const navyPlaced = placeBonusUnitsOnEmpire("navy", pairCount);
        tradeRewardSummary = `+${airPlaced} Aeronave(s) e +${navyPlaced} Marinha(s) (Supremacia Aeronaval${isCappedTrade ? ", teto 12" : ""})`;
      } else if (docId === "extermination") {
        // HEGEM-126: Extermination receives a combined-arms package of every unit; capped from 10th trade
        let infQty = Math.max(2, Math.floor(bonus / 3));
        let heavyQty = bonus >= 10 ? 2 : 1;
        let airQty = 1;
        let navyQty = 1;
        if (isCappedTrade) {
          infQty = Math.min(6, Math.max(0, Math.min(infQty, 30 - totalEmpireInf)));
          heavyQty = Math.min(2, Math.max(0, Math.min(heavyQty, 12 - totalEmpireTanks)));
          airQty = totalEmpireAir >= 6 ? 0 : 1;
          navyQty = totalEmpireNavy >= 6 ? 0 : 1;
        }
        currentPlayer.unplacedArmies += infQty;
        placeBonusUnitsOnEmpire("tank", heavyQty);
        placeBonusUnitsOnEmpire("artillery", heavyQty);
        placeBonusUnitsOnEmpire("aircraft", airQty);
        placeBonusUnitsOnEmpire("navy", navyQty);
        tradeRewardSummary = `+${infQty} Inf, +${heavyQty} Blindado(s), +${heavyQty} Art, +${airQty} Caça, +${navyQty} Frota (Extermínio${isCappedTrade ? ", com teto" : ""})`;
      } else if (docId === "guerrilla" || docId === "guerrilla_warfare") {
        // HEGEM-126: Partisan receives a small amount of Infantry and Navy; capped from 10th trade
        let infQty = Math.max(2, Math.floor(bonus / 2));
        let navyQty = bonus >= 10 ? 2 : 1;
        if (isCappedTrade) {
          infQty = Math.min(8, Math.max(0, Math.min(infQty, 35 - totalEmpireInf)));
          navyQty = Math.min(2, Math.max(0, Math.min(navyQty, 8 - totalEmpireNavy)));
        }
        currentPlayer.unplacedArmies += infQty;
        const nPlaced = placeBonusUnitsOnEmpire("navy", navyQty);
        tradeRewardSummary = `+${infQty} Infantarias e +${nPlaced} Marinha(s) (Partisan${isCappedTrade ? ", com teto" : ""})`;
      } else if (docId === "tall_sovereign" || docId === "defense_in_depth") {
        // HEGEM-126: Tall receives large Money and Resources, but NO army units; capped from 10th trade
        let moneyGrant = bonus * 3;
        let steelGrant = Math.max(2, Math.floor(bonus / 3));
        let oilGrant = Math.max(2, Math.floor(bonus / 3));
        let goldGrant = Math.max(1, Math.floor(bonus / 5));
        if (isCappedTrade) {
          moneyGrant = Math.min(60, moneyGrant);
          steelGrant = Math.min(8, steelGrant);
          oilGrant = Math.min(8, oilGrant);
          goldGrant = Math.min(4, goldGrant);
        }
        currentPlayer.resources.money += moneyGrant;
        currentPlayer.resources.steel += steelGrant;
        currentPlayer.resources.oil += oilGrant;
        currentPlayer.resources.gold += goldGrant;
        tradeRewardSummary = `+$${moneyGrant}, +${steelGrant} Aço, +${oilGrant} Petróleo, +${goldGrant} Ouro (Fortaleza Soberana${isCappedTrade ? ", com teto" : ""})`;
      } else if (docId === "superior_firepower") {
        // HEGEM-126: Classic / Normal doctrine receives small Infantry + Money + Resources; capped from 10th trade
        let infQty = Math.max(3, Math.floor(bonus * 0.75));
        let moneyGrant = Math.max(4, bonus);
        let steelGrant = 1;
        let oilGrant = 1;
        if (isCappedTrade) {
          infQty = Math.min(12, Math.max(0, Math.min(infQty, 35 - totalEmpireInf)));
          moneyGrant = Math.min(25, moneyGrant);
          steelGrant = Math.min(2, steelGrant);
          oilGrant = Math.min(2, oilGrant);
        }
        currentPlayer.unplacedArmies += infQty;
        currentPlayer.resources.money += moneyGrant;
        currentPlayer.resources.steel += steelGrant;
        currentPlayer.resources.oil += oilGrant;
        tradeRewardSummary = `+${infQty} exércitos, +$${moneyGrant}, +${steelGrant} Aço, +${oilGrant} Petróleo (Comando Clássico${isCappedTrade ? ", com teto" : ""})`;
      } else {
        const allowedArmies = isCappedTrade ? Math.min(20, Math.max(0, Math.min(bonus, 60 - totalEmpireArmies))) : bonus;
        currentPlayer.unplacedArmies += allowedArmies;
        tradeRewardSummary = `+${allowedArmies} exércitos${isCappedTrade ? " (com teto)" : ""}`;
      }

      currentPlayer.cards = currentPlayer.cards.filter(
        (c) => !action.cardIds.includes(c.id)
      );
      state.discardPile.push(...selected);

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
        `${currentPlayer.name} trocou cartas (${tradeRewardSummary})${
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

      const GOLD_CARD_COST = 4;
      if ((currentPlayer.resources?.gold ?? 0) < GOLD_CARD_COST) {
        throw new Error(
          `Ouro insuficiente: são necessários ${GOLD_CARD_COST} de Ouro para adquirir uma carta de suprimento estratégica.`
        );
      }
      currentPlayer.resources.gold -= GOLD_CARD_COST;

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
      state.log.push(
        `${currentPlayer.name} adquiriu 1 carta de suprimento estratégica (-${GOLD_CARD_COST} Ouro).`
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

      // Doutrina de Extermínio possui economia zero e não pode construir nenhuma estrutura
      if (currentPlayer.doctrineId === "extermination") {
        throw new Error(
          "A Doutrina de Extermínio proíbe a construção de melhorias civis e estruturas (economia nula 0 0 0 0)."
        );
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

        if (action.buildingType === "industry") {
          const isTallOrEconomic =
            currentPlayer.doctrineId === "tall_sovereign" ||
            currentPlayer.doctrineId === "defense_in_depth";
          if (!isTallOrEconomic) {
            throw new Error(
              "Apenas generais com Doutrina de Desenvolvimento Tall (Fortaleza Soberana) podem expandir Indústria para o Nível 2."
            );
          }
          if (existing.level >= 2) {
            throw new Error(
              "A indústria neste território já está no nível máximo (Complexo Industrial Nv. 2)."
            );
          }
          const upgradeCost = INDUSTRY_LEVEL_2_COST;
          if (
            (currentPlayer.resources?.money ?? 0) < upgradeCost.money ||
            (currentPlayer.resources?.steel ?? 0) < upgradeCost.steel
          ) {
            throw new Error(
              `Recursos insuficientes para evoluir Complexo Industrial Nv. 2 (custo: $${upgradeCost.money} e ${upgradeCost.steel} Aço).`
            );
          }
          currentPlayer.resources.money -= upgradeCost.money;
          currentPlayer.resources.steel -= upgradeCost.steel;
          existing.level = 2;
          currentPlayer.analytics = currentPlayer.analytics ?? createInitialPlayerAnalytics();
          currentPlayer.analytics.buildingsConstructed.industry =
            (currentPlayer.analytics.buildingsConstructed.industry || 0) + 1;
          state.log.push(
            `🏭 ${currentPlayer.name} evoluiu a Indústria em ${def.namePt} para Complexo Industrial Nv. 2 (+100% produção) (-$${upgradeCost.money}, -${upgradeCost.steel} Aço).`
          );
          break;
        }

        throw new Error("Este território já possui esta estrutura construída.");
      }

      if (action.buildingType === "wonder") {
        const isBastion =
          currentPlayer.objective?.rule.type === "fortified_bastion" ||
          currentPlayer.doctrineId === "tall_sovereign" ||
          currentPlayer.doctrineId === "defense_in_depth";
        if (!isBastion) {
          throw new Error(
            "A construção da Maravilha é exclusiva para o objetivo de Bastião Inexpugnável ou Doutrina Tall."
          );
        }
        if (!hasTerritoryBuilding(terr, "fortification")) {
          throw new Error(
            "A Maravilha deve ser construída em um território previamente protegido por uma Fortaleza."
          );
        }
        const alreadyHasWonder = Object.values(state.territories).some(
          (t) => t.ownerId === playerId && hasTerritoryBuilding(t, "wonder")
        );
        if (alreadyHasWonder) {
          throw new Error("Você já possui uma Maravilha Soberana em construção.");
        }
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

      const baseCost = BUILDING_COSTS[action.buildingType];
      // Epic IX — Frota em Potência: -$1 em Portos e Aeródromos
      const effectiveMoneyCost = getEffectiveBuildingMoneyCost(
        currentPlayer,
        action.buildingType,
        baseCost.money
      );

      if (
        currentPlayer.resources.money < effectiveMoneyCost ||
        currentPlayer.resources.steel < baseCost.steel
      ) {
        const costText =
          baseCost.steel > 0
            ? `$${effectiveMoneyCost} e ${baseCost.steel} Aço`
            : `$${effectiveMoneyCost}`;
        throw new Error(`Recursos insuficientes para construir (custo: ${costText}).`);
      }

      currentPlayer.resources.money -= effectiveMoneyCost;
      currentPlayer.resources.steel -= baseCost.steel;
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
        military_factory: "Arsenal Bélico",
        civilian_factory: "Fábrica Civil",
        steel_mine: "Mina de Aço",
        oil_well: "Poço Petrolífero",
        refinery: "Refinaria",
        wonder: "Maravilha Soberana",
      };
      const costSummary =
        baseCost.steel > 0
          ? `-$${effectiveMoneyCost}, -${baseCost.steel} Aço`
          : `-$${effectiveMoneyCost}`;
      state.log.push(
        `🏗️ ${currentPlayer.name} construiu ${buildingNamesPt[action.buildingType]} em ${def.namePt} (${costSummary}).`
      );

      if (action.buildingType === "wonder") {
        currentPlayer.wonderRoundsHeld = 0;
        state.log.push(
          `🌟 ALERTA GLOBAL — MARAVILHA DO BASTIÃO: ${currentPlayer.name} iniciou a construção da MARAVILHA SOBERANA em ${def.namePt}! As nações mundiais têm 3 rodadas para romper suas defesas antes da vitória absoluta!`
        );
      }
      break;
    }

    case "demolish_structure": {
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes de demolir.");
      }
      if (state.phase !== "deploy") {
        throw new Error("A demolição de estruturas só é permitida na fase de posicionamento/engenharia.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode demolir estruturas em territórios sob seu controle.");
      }
      const def = mapById.get(terr.id);
      if (!def) {
        throw new Error("Território inválido.");
      }

      // HEGEM-116: Doutrina de Extermínio é proibida de construir melhorias civis
      if (
        currentPlayer.doctrineId === "extermination" &&
        (action.buildingType === "market" || action.buildingType === "civilian_factory")
      ) {
        throw new Error(
          "A Doutrina de Extermínio proíbe a construção de melhorias civis (Mercados e Fábricas Civis)."
        );
      }

      terr.buildings = terr.buildings ?? [];
      const idx = terr.buildings.findIndex((b) => b.type === action.buildingType);
      if (idx === -1) {
        throw new Error("Este território não possui esta estrutura construída.");
      }

      const targetBldg = terr.buildings[idx];
      const baseCost = BUILDING_COSTS[action.buildingType];
      let totalMoneySpent = baseCost.money;
      let totalSteelSpent = baseCost.steel;

      if (action.buildingType === "fortification" && targetBldg.level >= 2) {
        totalMoneySpent += FORTIFICATION_LEVEL_2_COST.money;
        totalSteelSpent += FORTIFICATION_LEVEL_2_COST.steel;
      }

      const moneyRefund = Math.floor(totalMoneySpent * 0.5);
      const steelRefund = Math.ceil(totalSteelSpent * 0.5);

      terr.buildings.splice(idx, 1);
      actingPlayer.resources.money += moneyRefund;
      actingPlayer.resources.steel += steelRefund;

      const buildingNamesPt: Record<BuildingType, string> = {
        market: "Mercado Global",
        industry: "Complexo Industrial",
        fortification: targetBldg.level >= 2 ? "Fortaleza Nv. 2" : "Casamata Nv. 1",
        airfield: "Aeródromo Militar",
        port: "Porto Naval",
        military_factory: "Arsenal Bélico",
        civilian_factory: "Fábrica Civil",
        steel_mine: "Mina de Aço",
        oil_well: "Poço Petrolífero",
        refinery: "Refinaria Petroquímica",
        wonder: "Maravilha do Bastião",
      };
      const bName = buildingNamesPt[action.buildingType] ?? action.buildingType;
      const refundSummary =
        steelRefund > 0
          ? `+$${moneyRefund} e +${steelRefund} Aço recuperados`
          : `+$${moneyRefund} recuperados`;

      state.log.push(
        `ENGENHARIA: ${actingPlayer.name} demoliu ${bName} em ${def.namePt} para desobstrução estratégica (${refundSummary}).`
      );

      if (action.buildingType === "port") {
        updateSupplyAndEncirclement(state, map);
      }
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

      // HEGEM-116: Doutrina de Assalto em Massa proíbe unidades mecanizadas e aéreas
      if (currentPlayer.doctrineId === "mass_assault") {
        if (action.unitType === "tank" || action.unitType === "artillery" || action.unitType === "aircraft") {
          throw new Error(
            "A Doutrina de Assalto em Massa proíbe o recrutamento de Blindados, Artilharia e Aviação."
          );
        }
      }

      const requiredBuilding: Partial<Record<UnitType, BuildingType>> = {
        tank: "industry",
        artillery: "industry",
        aircraft: "airfield",
        navy: "port",
      };
      const requirement = requiredBuilding[action.unitType];
      if (requirement) {
        let hasReq = hasTerritoryBuilding(terr, requirement);
        if (action.unitType === "tank" || action.unitType === "artillery") {
          hasReq = hasReq || hasTerritoryBuilding(terr, "military_factory");
        }
        // HEGEM-125: Extermination doctrine can recruit and operate Navy on any coastal territory without needing a Naval Port
        if (action.unitType === "navy" && currentPlayer.doctrineId === "extermination") {
          hasReq = true;
        }
        if (!hasReq) {
          const requirementNames: Record<BuildingType, string> = {
            market: "Mercado",
            industry: "Indústria ou Arsenal Bélico",
            fortification: "Fortificação",
            airfield: "Aeródromo",
            port: "Porto Naval",
            military_factory: "Arsenal Bélico",
            civilian_factory: "Fábrica Civil",
            steel_mine: "Mina de Aço",
            oil_well: "Poço Petrolífero",
            refinery: "Refinaria",
            wonder: "Maravilha Estratégica",
          };
          throw new Error(
            `O recrutamento desta unidade exige ${requirementNames[requirement]} no território.`
          );
        }
      }
      if (action.unitType === "navy" && def.isCoastal === false) {
        throw new Error("A Marinha só pode ser recrutada em territórios costeiros ou insulares.");
      }

      const unitCost = { ...UNIT_COSTS[action.unitType] };

      // HEGEM-116 & HEGEM-125: Modificadores das Doutrinas HoI4 (superior_firepower = Comando Clássico sem penalidades)
      if (currentPlayer.doctrineId === "mass_assault" && action.unitType === "infantry") {
        unitCost.money = 2;
      }
      if (currentPlayer.doctrineId === "blitzkrieg" && action.unitType === "tank") {
        unitCost.steel = Math.max(1, unitCost.steel - 1);
      }

      // HEGEM-107: Arsenal Bélico (military_factory) reduz o custo de recrutamento em aço/ouro
      const hasMilitaryFactory =
        hasTerritoryBuilding(terr, "military_factory") ||
        Object.values(state.territories).some(
          (t) => t.ownerId === playerId && hasTerritoryBuilding(t, "military_factory")
        );
      if (hasMilitaryFactory) {
        if (action.unitType === "tank" || action.unitType === "artillery") {
          unitCost.steel = Math.max(1, unitCost.steel - 1);
        } else if (action.unitType === "aircraft") {
          unitCost.money = Math.max(3, unitCost.money - 1);
        }
      }

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
      if (currentPlayer.doctrineId === "extermination") {
        throw new Error("A Doutrina de Extermínio possui economia nula e não opera no Mercado.");
      }
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
        if (actingPlayer.resources.money < totalCost) {
          throw new Error(
            `Dinheiro insuficiente para comprar ${action.quantity}x ${resName}. Necessários $${totalCost}, você possui $${actingPlayer.resources.money}.`
          );
        }
        actingPlayer.resources.money -= totalCost;
        actingPlayer.resources[action.resource] += action.quantity;
        marketPrice.buyPrice = tempBuy;
        marketPrice.sellPrice = tempSell;

        state.log.push(
          `📈 MERCADO GLOBAL: ${actingPlayer.name} comprou ${action.quantity}x ${resName} por $${totalCost}. (Novo Preço: Compra $${tempBuy} / Venda $${tempSell})`
        );
      } else {
        if (actingPlayer.resources[action.resource] < action.quantity) {
          throw new Error(
            `Estoque insuficiente de ${resName}. Você possui ${actingPlayer.resources[action.resource]}, tentativa de vender ${action.quantity}.`
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
        actingPlayer.resources[action.resource] -= action.quantity;
        actingPlayer.resources.money += totalRevenue;
        marketPrice.buyPrice = tempBuy;
        marketPrice.sellPrice = tempSell;

        state.log.push(
          `📉 MERCADO GLOBAL: ${actingPlayer.name} vendeu ${action.quantity}x ${resName} por $${totalRevenue}. (Novo Preço: Compra $${tempBuy} / Venda $${tempSell})`
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

      if (currentPlayer.unplacedArmies === 0 && state.round === 1) {
        if (!currentPlayer.pendingObjectiveChoice) {
          advanceTurn(state, rng, map);
        }
      }
      break;
    }

    case "choose_objective": {
      if (state.phase !== "deploy") {
        throw new Error("A escolha do objetivo secreto deve ser realizada na fase de posicionamento.");
      }
      const targetObj = currentPlayer.availableObjectives?.find((o) => o.id === action.objectiveId);
      if (!targetObj) {
        throw new Error("Objetivo secreto não disponível para escolha.");
      }
      currentPlayer.objective = targetObj;
      currentPlayer.pendingObjectiveChoice = false;
      state.log.push(`🎯 ${currentPlayer.name} confirmou seu Objetivo Secreto da campanha.`);
      if (currentPlayer.unplacedArmies === 0 && state.round === 1) {
        advanceTurn(state, rng, map);
      }
      break;
    }

    case "expand_infrastructure": {
      if (state.phase !== "deploy") {
        throw new Error("A expansão de infraestrutura só é permitida na fase de posicionamento.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode expandir a infraestrutura em um território sob seu controle.");
      }
      if (terr.infrastructureExpanded) {
        throw new Error("Este território já recebeu uma expansão de infraestrutura.");
      }
      currentPlayer.resources = currentPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      const cost = { money: 4, steel: 1 };
      if (
        (currentPlayer.resources?.money ?? 0) < cost.money ||
        (currentPlayer.resources?.steel ?? 0) < cost.steel
      ) {
        throw new Error(
          `Recursos insuficientes: a expansão territorial custa $${cost.money} e ${cost.steel} Aço.`
        );
      }
      currentPlayer.resources.money -= cost.money;
      currentPlayer.resources.steel -= cost.steel;
      terr.infrastructureExpanded = true;
      const def = mapById.get(terr.id);
      const tName = def?.namePt ?? terr.id;
      state.log.push(
        `🏗️ ${currentPlayer.name} expandiu a infraestrutura territorial de ${tName} (+1 slot de construção permanente)!`
      );
      break;
    }

    case "end_deploy": {
      if (state.phase !== "deploy") {
        throw new Error("Você não está na fase de posicionamento.");
      }
      if (currentPlayer.pendingObjectiveChoice && currentPlayer.availableObjectives?.length) {
        currentPlayer.objective = currentPlayer.availableObjectives[0];
        currentPlayer.pendingObjectiveChoice = false;
        state.log.push(`🎯 ${currentPlayer.name} teve seu Objetivo Secreto selecionado automaticamente.`);
      }
      if (state.round === 1) {
        throw new Error("Na primeira rodada, posicione todas as tropas para avançar automaticamente.");
      }
      if (currentPlayer.unplacedArmies > 0) {
        throw new Error("Posicione todas as tropas de reforço antes de avançar para a fase de ataque.");
      }
      state.phase = "attack";
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
      const toDef = mapById.get(toTerr.id)!;
      const isNeighbor = fromDef.neighbors.includes(toTerr.id);
      const isDirectSea = isSeaLink(fromTerr.id, toTerr.id);
      if (!isNeighbor && !isDirectSea) {
        throw new Error("A artilharia possui alcance máximo de 1 fronteira adjacente ou conexão marítima direta.");
      }

      if (isDirectSea) {
        const navalCheck = checkNavalBlockade(state, fromTerr.id, toTerr.id, playerId);
        if (navalCheck.isBlockaded) {
          throw new Error("A rota marítima está sob bloqueio naval inimigo, impedindo o apoio de fogo costeiro.");
        }
      }

      const maxBarrages = 1;
      const currentBarrages =
        fromTerr.artilleryBarragesCountThisTurn ??
        (fromTerr.artilleryBarrageFiredThisTurn ? 1 : 0);
      if (currentBarrages >= maxBarrages) {
        throw new Error(
          "A artilharia desta base já realizou uma barragem de saturação neste turno."
        );
      }

      const fromUnits = getTerritoryUnits(fromTerr);
      if (fromUnits.artillery <= 0) {
        throw new Error("Não há baterias de artilharia estacionadas neste território.");
      }

      const hasActiveTreaty = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === toTerr.ownerId) ||
            (t.fromPlayerId === toTerr.ownerId && t.toPlayerId === playerId))
      );
      if (hasActiveTreaty) {
        throw new Error("Você possui um tratado ativo com este general.");
      }

      fromTerr.artilleryBarragesCountThisTurn = currentBarrages + 1;
      fromTerr.artilleryBarrageFiredThisTurn =
        fromTerr.artilleryBarragesCountThisTurn >= maxBarrages;
      state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 0.1).toFixed(1)));
      const rolls = Array.from({ length: fromUnits.artillery }, () => rng.rollD6());
      const hits = rolls.filter((r) => r >= 4).length;

      state.lastStrike = {
        kind: "artillery_barrage",
        fromTerritoryId: fromTerr.id,
        toTerritoryId: toTerr.id,
        hits,
        round: state.round,
      };

      const fromName = fromDef.namePt;
      const toName = mapById.get(toTerr.id)!.namePt;
      const barragePrefix = isDirectSea ? "🎯 BARRAGEM COSTEIRA DE ARTILHARIA" : "🎯 BARRAGEM DE ARTILHARIA";

      if (hits === 0) {
        state.log.push(
          `${barragePrefix}: Baterias em ${fromName} dispararam contra ${toName} [${rolls.join(",")}], mas os projéteis erraram o alvo.`
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
            `${barragePrefix}: Disparos de ${fromName} [${rolls.join(",")}] danificaram a Fortaleza em ${toName}, degradando-a para Casamata Nv. 1!`
          );
        } else if (fort.level === 1) {
          toTerr.buildings = toTerr.buildings?.filter((b) => b.type !== "fortification");
          remainingHits--;
          state.log.push(
            `${barragePrefix}: Disparos de ${fromName} [${rolls.join(",")}] destruíram a Casamata defensiva em ${toName}!`
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
          `${barragePrefix}: Disparos de ${fromName} [${rolls.join(",")}] destruíram ${killCount} divisão(ões) inimiga(s) em ${toName}!`
        );
      } else if (unitsDestroyed === 0 && !fort) {
        state.log.push(
          `${barragePrefix}: Disparos de ${fromName} [${rolls.join(",")}] atingiram ${toName}, mas a última guarnição sobreviveu entrincheirada!`
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

      const airOilCost = action.missionType === "bombardment" ? 2 : 1;
      if ((currentPlayer.resources?.oil ?? 0) < airOilCost) {
        throw new Error(
          `Combustível insuficiente: esta missão aérea exige ${airOilCost} Petróleo.`
        );
      }

      const fromDef = mapById.get(fromTerr.id)!;
      const toDef = mapById.get(toTerr.id)!;

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

      const hasActiveTreaty = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === toTerr.ownerId) ||
            (t.fromPlayerId === toTerr.ownerId && t.toPlayerId === playerId))
      );
      if (hasActiveTreaty) {
        throw new Error("Você possui um tratado ativo com este general.");
      }

      currentPlayer.resources.oil -= airOilCost;
      fromTerr.airMissionFlownThisTurn = true;
      state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 0.1).toFixed(1)));
      state.lastStrike = {
        kind: "air_mission",
        missionType: action.missionType,
        fromTerritoryId: fromTerr.id,
        toTerritoryId: toTerr.id,
        round: state.round,
      };

      if (action.missionType === "cas") {
        toTerr.casBonusAttackerId = playerId;
        state.log.push(
          `✈️ MISSÃO AÉREA (CAS): Esquadrilha de ${fromDef.namePt} estabeleceu Apoio Aéreo sobre ${toDef.namePt}! (+1 dado de ataque no assalto terrestre)`
        );
      } else if (action.missionType === "bombardment") {
        const bombRoll = rng.rollD6();
        const defenderOwner = state.players.find((p) => p.id === toTerr.ownerId);
        // Epic IX — Defesa em Profundidade: Casamata (Fortificação Nv. 1) resiste a ataques que não sejam de artilharia ou tanques
        const targetableBuildingIdx = (toTerr.buildings ?? []).findIndex((b) => {
          if (
            b.type === "fortification" &&
            b.level === 1 &&
            defenderOwner?.doctrineId === "defense_in_depth"
          ) {
            return false;
          }
          return true;
        });

        if (bombRoll >= 5 && toTerr.buildings && targetableBuildingIdx !== -1) {
          const targetBuilding = toTerr.buildings[targetableBuildingIdx];
          const bNames: Record<BuildingType, string> = {
            market: "Mercado",
            industry: "Indústria",
            fortification: "Fortificação",
            airfield: "Aeródromo",
            port: "Porto Naval",
            military_factory: "Arsenal Bélico",
            civilian_factory: "Fábrica Civil",
            steel_mine: "Mina de Aço",
            oil_well: "Poço Petrolífero",
            refinery: "Refinaria",
            wonder: "Maravilha Estratégica",
          };
          if (targetBuilding.level > 1) {
            targetBuilding.level -= 1;
          } else {
            toTerr.buildings.splice(targetableBuildingIdx, 1);
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
      const toDef = mapById.get(toTerr.id)!;
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

      // Check infantry assault fatigue vs Blitzkrieg capability (HEGEM-25 & Epic IX)
      const isBlitzSpearheadAdvance = fromTerr.conqueredTurnRound === state.round;
      if (isBlitzSpearheadAdvance) {
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
        const blitzOilRequired = getEffectiveBlitzOilCost(currentPlayer, 1);
        if ((currentPlayer.resources?.oil ?? 0) < blitzOilRequired) {
          throw new Error("Combustível insuficiente para sustentar o avanço em Blitzkrieg.");
        }
      }

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

      const attackerHadFuel = (currentPlayer.resources?.oil ?? 0) > 0;
      if (isBlitzSpearheadAdvance) {
        const blitzOilCost = getEffectiveBlitzOilCost(currentPlayer, 1);
        currentPlayer.resources.oil = Math.max(0, (currentPlayer.resources?.oil ?? 0) - blitzOilCost);
        currentPlayer.blitzCountThisTurn = (currentPlayer.blitzCountThisTurn ?? 0) + 1;
      } else if (attackingUnits.tank > 0 && attackerHadFuel) {
        // HEGEM-128: Ofensivas blindadas consomem 1 Petróleo ao engajar com combustível
        currentPlayer.resources.oil = Math.max(0, (currentPlayer.resources?.oil ?? 0) - 1);
      }

      if (coastalBombardment && (currentPlayer.resources?.oil ?? 0) > 0) {
        // HEGEM-128: Bombardeio e assalto naval consomem 1 Petróleo da frota
        currentPlayer.resources.oil = Math.max(0, (currentPlayer.resources?.oil ?? 0) - 1);
      }

      const defenderPlayer = state.players.find((p) => p.id === toTerr.ownerId);
      const isDefendingCapital =
        defenderPlayer?.capitalTerritoryId === toTerr.id &&
        toTerr.ownerId === defenderPlayer.id;

      let attackerModifier = 0;
      let defenderModifier = 0;
      let lastStandBonus = false;

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

      // Tank re-roll 1s (Ponta de Lança Couraçada) if attacker has oil (HEGEM-25 & HEGEM-109)
      let blitzkriegBonus = false;
      let heavyArmorBonus = false;
      let tankSuperiorityBonus = false;
      if (attackingUnits.tank > 0 && attackerHadFuel) {
        // 1-2 Tanques: re-rola 1s; 3+ Tanques: re-rola 1s e 2s (Ponta de Lança Pesada)
        const minRoll = attackingUnits.tank >= 3 ? 3 : 2;
        let reRolledAny = false;
        for (let i = 0; i < attackerDice.length; i++) {
          if (attackerDice[i] < minRoll) {
            attackerDice[i] = rng.rollD6();
            reRolledAny = true;
          }
        }
        if (reRolledAny) {
          attackerDice.sort((a, b) => b - a);
          blitzkriegBonus = true;
          if (attackingUnits.tank >= 3) heavyArmorBonus = true;
        }

        // 5+ Tanques com Superioridade Blindada: +1 no 2º maior dado de ataque
        if (
          attackingUnits.tank >= 5 &&
          attackingUnits.tank > (toUnits.tank ?? 0) &&
          attackerDice.length >= 2
        ) {
          attackerDice[1] += 1;
          tankSuperiorityBonus = true;
        }
      }

      // HEGEM-109: Escala de Artilharia de Apoio no Assalto
      const artillerySuppressionBonus = (attackingUnits.artillery ?? 0) >= 2;
      const artillerySiegeBonus = (attackingUnits.artillery ?? 0) >= 4;
      const artillerySaturationBonus = (attackingUnits.artillery ?? 0) >= 6;

      // HEGEM-116: Modificadores de Combate das Doutrinas HoI4
      const {
        attackerBonusApplied: doctrineAttackerBonus,
        defenderBonusApplied: doctrineDefenderBonus,
      } = applyDoctrineCombatDiceModifiers({
        state,
        map,
        attacker: currentPlayer,
        defender: defenderPlayer,
        fromTerritory: fromTerr,
        toTerritory: toTerr,
        committedAttackerUnits: attackingUnits,
        defenderUnits: toUnits,
        attackerDice,
        defenderDice,
      });

      if (attackerModifier > 0 && attackerDice.length > 0) {
        attackerDice[0] += attackerModifier;
      }
      if (coastalBombardment && attackerDice.length > 0) {
        attackerDice[0] += 1;
      }
      if (defenderModifier > 0 && defenderDice.length > 0) {
        defenderDice[0] += defenderModifier;
      }

      let encircledDefenderPenalty: number | undefined;
      if (toTerr.isEncircled) {
        const pen = (toTerr.encircledRounds ?? 1) >= 2 ? 2 : 1;
        encircledDefenderPenalty = pen;
        if (defenderDice.length > 0) {
          defenderDice[0] = Math.max(1, defenderDice[0] - pen);
        }
      }

      let unescortedArtilleryPenalty = false;
      if (toUnits.artillery > 0 && toUnits.infantry === 0 && toUnits.tank === 0) {
        unescortedArtilleryPenalty = true;
        if (defenderDice.length > 0) {
          defenderDice[0] = Math.max(1, defenderDice[0] - 1);
        }
      }

      const fortLevel = getTerritoryBuildingLevel(toTerr, "fortification");
      // Casamata Nv. 1: +1 ao maior dado de defesa (suprimida se atacante tiver 2+ artilharias)
      if (fortLevel >= 1 && defenderDice.length > 0) {
        if (!artillerySuppressionBonus) {
          defenderDice[0] += 1;
        }
      }
      // Fortaleza Nv. 2: -1 ao maior dado de ataque (neutralizada se atacante tiver 4+ artilharias)
      if (fortLevel >= 2 && attackerDice.length > 0) {
        if (!artillerySiegeBonus) {
          attackerDice[0] = Math.max(1, attackerDice[0] - 1);
        }
      }
      // 6+ Artilharias: Saturação maciça (+1 ao maior dado de ataque)
      if (artillerySaturationBonus && attackerDice.length > 0) {
        attackerDice[0] += 1;
      }

      let attackerLosses = 0;
      let defenderLosses = 0;
      const comparisons = Math.min(attackerDice.length, defenderDice.length);
      let capitalTiesDefended = 0;

      for (let i = 0; i < comparisons; i++) {
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
        attackerUnits: { ...attackingUnits },
        attackerLossUnits: attackerCombat.losses,
        defenderLossUnits: defenderCombat.losses,
        conquered,
        attackerModifier,
        defenderModifier,
        lastStandBonus,
        fortificationLevel: fortLevel > 0 ? fortLevel : undefined,
        casBonus: hasCasBonus ? true : undefined,
        blitzkriegBonus: blitzkriegBonus ? true : undefined,
        heavyArmorBonus: heavyArmorBonus ? true : undefined,
        tankSuperiorityBonus: tankSuperiorityBonus ? true : undefined,
        artillerySuppressionBonus: artillerySuppressionBonus && fortLevel >= 1 ? true : undefined,
        artillerySiegeBonus: artillerySiegeBonus && fortLevel >= 2 ? true : undefined,
        artillerySaturationBonus: artillerySaturationBonus ? true : undefined,
        doctrineAttackerBonus: doctrineAttackerBonus ? true : undefined,
        doctrineDefenderBonus: doctrineDefenderBonus ? true : undefined,
        encircledDefenderPenalty,
        coastalBombardmentBonus: coastalBombardment ? true : undefined,
        unescortedArtilleryPenalty: unescortedArtilleryPenalty ? true : undefined,
      };

      const fromName = fromDef.namePt;
      const toName = toDef.namePt;
      const capitalCombatTag = isDefendingCapital
        ? ` [⭐ Capital Fortificada${capitalTiesDefended > 0 ? ` (+${capitalTiesDefended} empates resistidos)` : ""}]`
        : "";
      const fortCombatTag =
        fortLevel >= 2
          ? (artillerySiegeBonus
              ? " [Fortaleza Nv.2 (Neutralizada por Artilharia)]"
              : " [Fortaleza Nv.2 (+1 DEF, -1 ATQ)]")
          : fortLevel === 1
            ? (artillerySuppressionBonus
                ? " [Casamata Nv.1 (Suprimida por Artilharia)]"
                : " [Casamata Nv.1 (+1 DEF)]")
            : "";
      const heavyArmorCombatTag = heavyArmorBonus ? " [Ponta de Lança Pesada]" : "";
      const tankSupCombatTag = tankSuperiorityBonus ? " [Superioridade Blindada +1]" : "";
      const artSaturationCombatTag = artillerySaturationBonus ? " [Chuva de Aço +1 ATQ]" : "";
      const docAttTag = doctrineAttackerBonus
        ? ` [${currentPlayer.doctrineId ? DOCTRINES[currentPlayer.doctrineId]?.namePt ?? "Doutrina" : "Doutrina"} +1 ATQ]`
        : "";
      const docDefTag = doctrineDefenderBonus
        ? ` [${defenderPlayer?.doctrineId ? DOCTRINES[defenderPlayer.doctrineId]?.namePt ?? "Doutrina" : "Doutrina"} +1 DEF]`
        : "";
      const lastStandTag = lastStandBonus
        ? ` [Mobilização Total +${attackerModifier || defenderModifier}]`
        : "";
      const casTag = hasCasBonus ? " [CAS +1 Dado]" : "";
      const coastalTag = coastalBombardment ? " [Bombardeio Costeiro +1]" : "";
      const encircledTag = encircledDefenderPenalty ? ` [Cerco -${encircledDefenderPenalty} DEF]` : "";
      const unescortedArtilleryTag = unescortedArtilleryPenalty
        ? " [Artilharia Desprotegida -1 DEF]"
        : "";
      state.log.push(
        `Combate ${fromName}${docAttTag}${heavyArmorCombatTag}${tankSupCombatTag}${artSaturationCombatTag} [${attackerDice.join(",")}] vs ${toName}${capitalCombatTag}${fortCombatTag}${docDefTag}${lastStandTag}${casTag}${coastalTag}${encircledTag}${unescortedArtilleryTag} [${defenderDice.join(",")}] → baixas ATQ:${attackerLosses} DEF:${defenderLosses}`
      );

      if (conquered) {
        toTerr.ownerId = playerId;
        currentPlayer.conqueredThisTurn = true;
        toTerr.conqueredTurnRound = state.round;
        toTerr.infantryAssaultFatigued = true;
        const canAffordBlitzOil =
          (currentPlayer.resources?.oil ?? 0) >= getEffectiveBlitzOilCost(currentPlayer, 1);
        toTerr.blitzkriegAvailable = attackerCombat.remaining.tank > 0 && canAffordBlitzOil;
        toTerr.casBonusAttackerId = undefined;
        state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 0.3).toFixed(1)));

        // HEGEM-98: Dano Colateral Dinâmico em Conquistas (Aço & Artilharia)
        if (toTerr.buildings && toTerr.buildings.length > 0) {
          const fort = toTerr.buildings.find((b) => b.type === "fortification");
          if (fort && fort.level >= 2) {
            fort.level = 1;
            state.log.push(
              `A Fortaleza em ${toName} sofreu danos estruturais na captura e degradou para Casamata Nv. 1.`
            );
          }

          let collapseChance = 0.30;
          if ((attackingUnits.tank ?? 0) > 0) collapseChance += 0.25;
          if ((attackingUnits.artillery ?? 0) > 0) collapseChance += 0.40;
          collapseChance = Math.min(0.95, collapseChance);

          const buildingLabelsPt: Record<BuildingType, string> = {
            market: "Mercado Global",
            industry: "Complexo Industrial",
            fortification: "Casamata",
            airfield: "Aeródromo Militar",
            port: "Porto Naval",
            military_factory: "Arsenal Bélico",
            civilian_factory: "Fábrica Civil",
            steel_mine: "Mina de Aço",
            oil_well: "Poço Petrolífero",
            refinery: "Refinaria",
            wonder: "Maravilha Estratégica",
          };

          const survivingBuildings: typeof toTerr.buildings = [];
          for (const b of toTerr.buildings) {
            const roll = rng.nextFloat();
            if (roll < collapseChance) {
              const bLabel = buildingLabelsPt[b.type] ?? b.type;
              state.log.push(
                `A infraestrutura ${bLabel} em ${toName} foi destruída durante a ofensiva de ${currentPlayer.name}!`
              );
            } else {
              survivingBuildings.push(b);
            }
          }
          toTerr.buildings = survivingBuildings;
        }

        if (currentPlayer.capitalTerritoryId === toTerr.id && currentPlayer.isCapitalLost) {
          currentPlayer.isCapitalLost = false;
          currentPlayer.economicPenaltyMultiplier = 1.0;
          state.log.push(
            `🎖️ CAPITAL RESTAURADA! ${currentPlayer.name} reconquistou sua Capital Nacional em ${toName}!`
          );
        }

        if (isDefendingCapital && defenderPlayer) {
          defenderPlayer.isCapitalLost = true;
          defenderPlayer.capitalLostTurn = state.round;
          defenderPlayer.economicPenaltyMultiplier = 0.5;
          defenderPlayer.moralePenalty = 2;
          state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 2.5).toFixed(1)));
          currentPlayer.infamy = Math.min(100, (currentPlayer.infamy ?? 0) + 8);

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
          totalUnits(remainingAttackers),
          fromTerr.armies - 1
        );
        const occupyingUnits = selectUnits(remainingAttackers, 1);

        setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), occupyingUnits));
        setTerritoryUnits(toTerr, occupyingUnits);

        state.log.push(`${currentPlayer.name} conquistou ${toName}!`);

        // Saque de Extermínio (+1 divisão de recrutas em troca de economia nula)
        if (currentPlayer.doctrineId === "extermination") {
          currentPlayer.resources = { money: 0, steel: 0, oil: 0, gold: 0 };
          currentPlayer.unplacedArmies += 1;
          state.log.push(
            `☠️ SAQUE TOTAL (Extermínio): ${currentPlayer.name} capturou recrutas e material bélico da província de ${toName} (+1 divisão de recrutas)!`
          );
        }

        if (maxMove <= 1) {
          state.pendingConquest = null;
          // Epic IX — Guerra de Guerrilha: ocupação imediata com apenas 1 divisão dispara insurgência partisan!
          resolveGuerrillaInsurgencyOnOccupy({
            state,
            map,
            rng,
            occupier: currentPlayer,
            previousOwner: defenderPlayer,
            conqueredTerritory: toTerr,
          });
          updateSupplyAndEncirclement(state, map);
        } else {
          state.pendingConquest = {
            fromTerritoryId: fromTerr.id,
            toTerritoryId: toTerr.id,
            minMove: 1,
            maxMove,
            occupyingUnits,
            remainingAttackers: subtractUnits(remainingAttackers, occupyingUnits),
            previousOwnerId: defenderId,
            wasBlitzkriegAssault: isBlitzSpearheadAdvance,
          };
        }

        // Check if defender was completely eliminated (if partisan insurgency didn't reclaim the territory)
        const defenderRemaining = Object.values(state.territories).some(
          (t) => t.ownerId === defenderId
        );
        if (!defenderRemaining) {
          const defPlayer = state.players.find((p) => p.id === defenderId)!;
          defPlayer.eliminated = true;
          defPlayer.eliminatedBy = playerId;
          state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 3.5).toFixed(1)));
          currentPlayer.infamy = Math.min(100, (currentPlayer.infamy ?? 0) + 12);
          if (defPlayer.cards.length > 0) {
            currentPlayer.cards.push(...defPlayer.cards);
            state.log.push(
              `${currentPlayer.name} eliminou ${defPlayer.name} e capturou ${defPlayer.cards.length} carta(s)!`
            );
            defPlayer.cards = [];
          } else {
            state.log.push(`${currentPlayer.name} eliminou ${defPlayer.name}!`);
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
        previousOwnerId,
      } = state.pendingConquest;
      if (action.armies < minMove || action.armies > maxMove) {
        throw new Error(`Você deve mover entre ${minMove} e ${maxMove} exércitos.`);
      }

      const fromTerr = state.territories[fromTerritoryId];
      const toTerr = state.territories[toTerritoryId];
      const initialOccupation = occupyingUnits ?? selectUnits(getTerritoryUnits(toTerr), 1);
      const availableAttackers = remainingAttackers ?? getTerritoryUnits(fromTerr);
      const totalPool = addUnits(initialOccupation, availableAttackers);

      let chosenUnits: UnitCounts;
      if (action.units) {
        if (action.units.aircraft > 0) {
          throw new Error("Aeronaves não podem avançar na ocupação de combate. Devem permanecer nos aeródromos.");
        }
        if (totalUnits(action.units) !== action.armies) {
          throw new Error("A composição da ocupação deve corresponder ao total de divisões movidas.");
        }
        if (!canSubtractUnits(totalPool, action.units)) {
          throw new Error("A composição excede os sobreviventes disponíveis para ocupar.");
        }
        chosenUnits = { ...action.units };
      } else {
        const nonAirPool = { ...totalPool, aircraft: 0 };
        chosenUnits = selectUnits(nonAirPool, action.armies);
      }

      const remainingForOrigin = subtractUnits(totalPool, chosenUnits);
      setTerritoryUnits(
        fromTerr,
        addUnits(subtractUnits(getTerritoryUnits(fromTerr), availableAttackers), remainingForOrigin)
      );
      setTerritoryUnits(toTerr, chosenUnits);
      if (toTerr.blitzkriegAvailable) {
        const finalUnits = getTerritoryUnits(toTerr);
        const canAffordBlitzOil =
          (currentPlayer.resources?.oil ?? 0) >= getEffectiveBlitzOilCost(currentPlayer, 1);
        toTerr.blitzkriegAvailable = finalUnits.tank > 0 && canAffordBlitzOil;
      }

      const prevOwner = previousOwnerId
        ? state.players.find((p) => p.id === previousOwnerId)
        : undefined;
      state.pendingConquest = null;

      // Epic IX — Guerra de Guerrilha: se o atacante avançar deixando apenas 1 divisão de guarnição no território conquistado
      resolveGuerrillaInsurgencyOnOccupy({
        state,
        map,
        rng,
        occupier: currentPlayer,
        previousOwner: prevOwner,
        conqueredTerritory: toTerr,
      });

      updateSupplyAndEncirclement(state, map);
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
        t.airliftsCountThisTurn = 0;
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

      const maxAirlifts = getMaxAirliftsPerTurn(currentPlayer);
      const usedFromBase = fromTerr.airliftsCountThisTurn ?? (fromTerr.airliftedThisTurn ? 1 : 0);
      if (usedFromBase >= maxAirlifts) {
        throw new Error(
          `Este Aeródromo já realizou o limite de operações de Ponte Aérea neste turno (${maxAirlifts}/${maxAirlifts}).`
        );
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

      const nextCount = usedFromBase + 1;
      fromTerr.airliftsCountThisTurn = nextCount;
      fromTerr.airliftedThisTurn = nextCount >= maxAirlifts;
      currentPlayer.airliftsUsedThisTurn = (currentPlayer.airliftsUsedThisTurn ?? 0) + 1;

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
      const toDef = mapById.get(toTerr.id)!;
      const isNeighbor = fromDef.neighbors.includes(toTerr.id);

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

      // HEGEM-138: Limites estritos de alcance por tipo de unidade na Fase 3
      const dist = getFriendlyPathDistance(state, fromTerr.id, toTerr.id, playerId, map);
      const fromHasAirfield = hasTerritoryBuilding(fromTerr, "airfield");
      const toHasAirfield = hasTerritoryBuilding(toTerr, "airfield");

      // 1. Aeronaves: precisam obrigatoriamente de Aeródromo na origem e no destino
      if (movedUnits.aircraft > 0) {
        if (!fromHasAirfield) {
          throw new Error("Aeronaves só podem decolar de territórios que possuam Aeródromo.");
        }
        if (!toHasAirfield) {
          throw new Error("Aeronaves só podem pousar em territórios que possuam Aeródromo.");
        }
      }

      // 2. Infantaria e Artilharia: máximo 1 tile (vizinho direto)
      if (movedUnits.infantry > 0 || movedUnits.artillery > 0) {
        if (dist > 1 && !isNeighbor) {
          throw new Error(
            "Infantaria e Artilharia movem-se apenas entre territórios diretamente vizinhos (alcance de 1 território)."
          );
        }
      }

      // 3. Blindados (Tanques): máximo 2 tiles conectados sob seu controle
      if (movedUnits.tank > 0) {
        if (dist > 2) {
          throw new Error(
            "Blindados podem se mover por no máximo 2 territórios conectados sob seu controle."
          );
        }
      }

      // 4. Força Naval: máximo 3 conexões marítimas
      if (movedUnits.navy > 0) {
        if (dist > 3) {
          throw new Error("Forças navais podem se mover por no máximo 3 conexões marítimas.");
        }
      }

      // 5. Se move apenas Aeronaves entre aeródromos, o deslocamento é livre pelo mapa
      const isOnlyAircraft = totalUnits(movedUnits) === movedUnits.aircraft && movedUnits.aircraft > 0;
      if (!isOnlyAircraft && !Number.isFinite(dist) && !isNeighbor) {
        throw new Error("O remanejamento só é permitido entre territórios conectados por rotas aliadas.");
      }

      let navalFuelSurcharge = 0;
      if (isSeaLink(fromTerr.id, toTerr.id)) {
        const blockade = checkNavalBlockade(state, fromTerr.id, toTerr.id, playerId);
        if (blockade.isBlockaded) {
          throw new Error("A rota marítima está bloqueada por frotas inimigas.");
        }
        // HEGEM-112: Projeção marítima permitida sem porto de destino mediante sobretaxa de petróleo
        const hasDestPort = hasTerritoryBuilding(toTerr, "port");
        if (movedUnits.navy > 0 || !hasDestPort) {
          navalFuelSurcharge = 1;
          if ((currentPlayer.resources?.oil ?? 0) < navalFuelSurcharge) {
            throw new Error(
              `Petróleo insuficiente para a sobretaxa logística de projeção naval sem porto de destino. Necessário: ${navalFuelSurcharge} Petróleo.`
            );
          }
          currentPlayer.resources.oil -= navalFuelSurcharge;
        }
      }

      setTerritoryUnits(fromTerr, subtractUnits(getTerritoryUnits(fromTerr), movedUnits));
      setTerritoryUnits(toTerr, addUnits(getTerritoryUnits(toTerr), movedUnits));
      setMovedInUnits(toTerr, addUnits(getMovedInUnits(toTerr), movedUnits));
      updateSupplyAndEncirclement(state, map);

      const surchargeText =
        navalFuelSurcharge > 0 ? ` (Sobretaxa Logística: -${navalFuelSurcharge} Petróleo)` : "";
      state.log.push(
        `${currentPlayer.name} moveu ${action.armies} de ${fromDef.namePt} para ${
          mapById.get(toTerr.id)!.namePt
        }${surchargeText}.`
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
      state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + 5.0).toFixed(1)));

      const label = treaty.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(
        `💥 TRAIÇÃO DIPLOMÁTICA! ${actingPlayer.name} rompeu unilateralmente o ${label} com ${otherP?.name}! (+35% de Infâmia, +5% de Tensão Mundial)`
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

    case "send_alliance_aid": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode enviar remessas de aliança para si mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("Destinatário inválido ou eliminado.");
      }
      const hasActiveAlliance = state.treaties?.some(
        (t) =>
          t.status === "active" &&
          t.type === "alliance" &&
          ((t.fromPlayerId === playerId && t.toPlayerId === target.id) ||
            (t.fromPlayerId === target.id && t.toPlayerId === playerId))
      );
      const inSameCoalition = state.coalitions?.some(
        (c) =>
          c.memberPlayerIds.includes(playerId) && c.memberPlayerIds.includes(target.id)
      );
      if (actingPlayer.doctrineId === "extermination") {
        throw new Error("A Doutrina de Extermínio opera com economia nula e não pode enviar remessas financeiras.");
      }
      if (target.doctrineId === "extermination") {
        throw new Error("A Doutrina de Extermínio proíbe o recebimento de ajuda ou recursos da economia global.");
      }

      if (!hasActiveAlliance && !inSameCoalition) {
        throw new Error(
          "Remessas Lend-Lease exigem uma Aliança Militar ativa ou participação na mesma Coalizão."
        );
      }

      const moneyAmt = Math.max(0, Math.floor(action.money ?? 0));
      const steelAmt = Math.max(0, Math.floor(action.steel ?? 0));
      const oilAmt = Math.max(0, Math.floor(action.oil ?? 0));
      const goldAmt = Math.max(0, Math.floor(action.gold ?? 0));
      if (moneyAmt + steelAmt + oilAmt + goldAmt <= 0) {
        throw new Error("Selecione ao menos um recurso ou valor monetário para enviar.");
      }

      actingPlayer.resources = actingPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      target.resources = target.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      if (
        actingPlayer.resources.money < moneyAmt ||
        actingPlayer.resources.steel < steelAmt ||
        actingPlayer.resources.oil < oilAmt ||
        actingPlayer.resources.gold < goldAmt
      ) {
        throw new Error("Recursos insuficientes no estoque nacional para enviar esta remessa.");
      }

      actingPlayer.resources.money -= moneyAmt;
      actingPlayer.resources.steel -= steelAmt;
      actingPlayer.resources.oil -= oilAmt;
      actingPlayer.resources.gold -= goldAmt;

      target.resources.money += moneyAmt;
      target.resources.steel += steelAmt;
      target.resources.oil += oilAmt;
      target.resources.gold += goldAmt;

      const parts: string[] = [];
      if (moneyAmt > 0) parts.push(`$${moneyAmt}`);
      if (steelAmt > 0) parts.push(`${steelAmt} Aço`);
      if (oilAmt > 0) parts.push(`${oilAmt} Petróleo`);
      if (goldAmt > 0) parts.push(`${goldAmt} Ouro`);
      state.log.push(
        `🤝 LEND-LEASE: ${actingPlayer.name} enviou ajuda estratégica (${parts.join(", ")}) para seu aliado ${target.name}!`
      );
      break;
    }

    case "send_coalition_aircraft": {
      if (action.targetPlayerId === playerId) {
        throw new Error("Você não pode transferir esquadrilhas de coalizão para si mesmo.");
      }
      const target = state.players.find((p) => p.id === action.targetPlayerId);
      if (!target || target.eliminated) {
        throw new Error("Aliado de coalizão inválido ou eliminado.");
      }
      const inSameCoalition = state.coalitions?.some(
        (c) =>
          c.memberPlayerIds.includes(playerId) && c.memberPlayerIds.includes(target.id)
      );
      if (!inSameCoalition) {
        throw new Error(
          "A transferência direta de aeronaves é exclusiva para membros da mesma Coalizão Militar."
        );
      }

      const fromTerr = state.territories[action.fromTerritoryId];
      if (!fromTerr || fromTerr.ownerId !== playerId) {
        throw new Error("O território de origem das aeronaves não está sob seu controle.");
      }
      const fromUnits = getTerritoryUnits(fromTerr);
      if (fromUnits.aircraft < action.quantity) {
        throw new Error("Quantidade de aeronaves insuficiente no território de origem.");
      }
      if (fromTerr.armies - action.quantity < 1) {
        throw new Error("O território de origem deve manter ao menos 1 divisão de guarnição.");
      }

      let destTerr = action.toTerritoryId ? state.territories[action.toTerritoryId] : undefined;
      if (!destTerr || destTerr.ownerId !== target.id) {
        destTerr =
          (target.capitalTerritoryId &&
          state.territories[target.capitalTerritoryId]?.ownerId === target.id
            ? state.territories[target.capitalTerritoryId]
            : undefined) ??
          Object.values(state.territories).find((t) => t.ownerId === target.id);
      }
      if (!destTerr) {
        throw new Error("O aliado destinatário não possui territórios válidos para receber as aeronaves.");
      }

      setTerritoryUnits(
        fromTerr,
        subtractUnits(fromUnits, singleUnitCount("aircraft", action.quantity))
      );
      setTerritoryUnits(
        destTerr,
        addUnits(getTerritoryUnits(destTerr), singleUnitCount("aircraft", action.quantity))
      );

      const fromName = mapById.get(fromTerr.id)?.namePt ?? fromTerr.id;
      const toName = mapById.get(destTerr.id)?.namePt ?? destTerr.id;
      state.log.push(
        `✈️ ESQUADRILHA DE COALIZÃO: ${actingPlayer.name} transferiu ${action.quantity}x Aeronave(s) de ${fromName} para ${toName} (${target.name})!`
      );
      break;
    }

    case "end_turn": {
      if (state.pendingConquest) {
        throw new Error("Conclua a ocupação do território conquistado antes de encerrar o turno.");
      }
      if (state.phase === "deploy" && currentPlayer.unplacedArmies > 0) {
        throw new Error("Posicione todos os seus exércitos antes de encerrar o turno.");
      }
      if (currentPlayer.pendingObjectiveChoice && currentPlayer.availableObjectives?.length) {
        currentPlayer.objective = currentPlayer.availableObjectives[0];
        currentPlayer.pendingObjectiveChoice = false;
        state.log.push(`🎯 ${currentPlayer.name} teve seu Objetivo Secreto selecionado automaticamente.`);
      }
      advanceTurn(state, rng, map);
      break;
    }
  }

  if (!state.pendingConquest && state.round > 1) {
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
  endingPlayer.blitzCountThisTurn = 0;
  endingPlayer.airliftsUsedThisTurn = 0;
  endingPlayer.assaultedTargetsThisTurn = [];

  for (const t of Object.values(state.territories)) {
    setMovedInUnits(t, emptyUnitCounts());
    t.airliftedThisTurn = false;
    t.airliftsCountThisTurn = 0;
    t.artilleryBarrageFiredThisTurn = false;
    t.artilleryBarragesCountThisTurn = 0;
    t.airMissionFlownThisTurn = false;
    t.casBonusAttackerId = undefined;
    t.conqueredTurnRound = undefined;
    t.blitzkriegAvailable = false;
    t.infantryAssaultFatigued = false;
  }

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
      const activePlayersCount = state.players.filter((p) => !p.eliminated).length;
      const roundTensionBoost = activePlayersCount <= 3 ? 1.5 : activePlayersCount <= 4 ? 1.2 : 1.0;
      state.worldTension = Math.min(100, Number(((state.worldTension ?? 0) + roundTensionBoost).toFixed(1)));

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
              p.infamy = Math.min(100, (p.infamy ?? 0) + 2);
              state.log.push(
                `⚠️ HEGEMONIA AMEAÇADORA: ${p.name} controla ${heldCount}/${totalTerritories} territórios (${Math.round((heldCount / totalTerritories) * 100)}%) e gera alarme global! (+2% Infâmia)`
              );
            }
          }
        }
      }

      // HEGEM-117: Verificação e Alerta Global de Bastião Fortificado
      for (const p of state.players) {
        if (!p.eliminated && p.objective?.rule.type === "fortified_bastion") {
          const rule = p.objective.rule;
          const fortifiedCount = Object.values(state.territories).filter(
            (t) =>
              t.ownerId === p.id &&
              (t.buildings ?? []).some((b) => b.type === "fortification")
          ).length;

          if (fortifiedCount >= rule.bastionTerritoryCount) {
            p.bastionRoundsHeld = (p.bastionRoundsHeld ?? 0) + 1;
            state.log.push(
              `🏰 ALERTA GLOBAL — BASTIÃO SOBERANO: ${p.name} mantém ${fortifiedCount} fortalezas ativas (${p.bastionRoundsHeld}/${rule.roundsRequired} rodadas)! As nações rivais devem romper as defesas para impedir a vitória por soberania!`
            );
          } else {
            if ((p.bastionRoundsHeld ?? 0) > 0) {
              state.log.push(
                `💥 BASTIÃO ROMPIDO: As fortalezas de ${p.name} foram reduzidas para ${fortifiedCount}. A contagem defensiva foi reiniciada!`
              );
            }
            p.bastionRoundsHeld = 0;
          }
        }
      }

      // Verificação da MARAVILHA SOBERANA (Objetivo Bastião / Fim do Mundo)
      for (const p of state.players) {
        if (!p.eliminated) {
          const wonderTerr = Object.values(state.territories).find(
            (t) => t.ownerId === p.id && hasTerritoryBuilding(t, "wonder")
          );
          if (wonderTerr) {
            p.wonderRoundsHeld = (p.wonderRoundsHeld ?? 0) + 1;
            const wDef = map.territories.find((t) => t.id === wonderTerr.id);
            const wName = wDef?.namePt ?? wonderTerr.id;
            state.log.push(
              `🌟 ALERTA GLOBAL — MARAVILHA SOBERANA: ${p.name} manteve a Maravilha em ${wName} (${p.wonderRoundsHeld}/3 rodadas)! Ao atingir 3 rodadas, a vitória será imediata!`
            );
            if (p.wonderRoundsHeld >= 3) {
              state.winnerId = p.id;
              state.phase = "game_over";
              state.log.push(
                `💥 O MUNDO ACABA: A Maravilha Soberana em ${wName} foi concluída! O Bastião triunfou e ${p.name} venceu a campanha mundial!`
              );
              return;
            }
          } else {
            p.wonderRoundsHeld = 0;
          }
        }
      }
    }
    const candidate = state.players[nextIdx];
    if (!candidate.eliminated) {
      state.turnIndex = nextIdx;
      state.phase = "deploy";
      candidate.blitzCountThisTurn = 0;
      candidate.airliftsUsedThisTurn = 0;
      candidate.assaultedTargetsThisTurn = [];

      if (
        candidate.isCapitalLost &&
        candidate.capitalLostTurn !== undefined &&
        state.round - candidate.capitalLostTurn >= 5
      ) {
        candidate.isCapitalLost = false;
        candidate.capitalTerritoryId = undefined;
        candidate.economicPenaltyMultiplier = 1.0;
        state.log.push(
          `🏛️ REORGANIZAÇÃO NACIONAL: ${candidate.name} reorganizou seu governo 5 rodadas após a queda de sua capital e pode agora estabelecer uma nova Capital de Comando!`
        );
      }

      const reinf = calculateTurnReinforcements(state, candidate.id, map);
      candidate.unplacedArmies = reinf.total;
      candidate.boughtCardWithGoldThisTurn = false;
      if (candidate.moralePenalty && candidate.moralePenalty > 0) {
        candidate.moralePenalty = 0;
      }
      const capTag = reinf.capitalBonus > 0 ? " (+1 bônus Capital)" : "";
      const penTag = reinf.moralePenalty > 0 ? ` (-${reinf.moralePenalty} penalidade moral)` : "";
      state.log.push(
        `Turno de ${candidate.name} (Rodada ${state.round}): +${reinf.total} exércitos${capTag}${penTag}.`
      );
      collectTurnEconomy(state, candidate.id, map);

      // HEGEM-127: Mobilização de Unidades Características por Turno (Rodada 2+)
      if (state.round > 1 && candidate.doctrineId) {
        const mapById = new Map(map.territories.map((t) => [t.id, t]));
        const candTerrs = Object.values(state.territories).filter(
          (t) => t.ownerId === candidate.id
        );
        const capTerr =
          (candidate.capitalTerritoryId &&
          state.territories[candidate.capitalTerritoryId]?.ownerId === candidate.id
            ? state.territories[candidate.capitalTerritoryId]
            : undefined) ?? candTerrs[0];
        const coastalTerr =
          candTerrs.find((t) => mapById.get(t.id)?.isCoastal !== false) ?? capTerr;

        const spawnOnTerr = (
          targetTerr: TerritoryState | undefined,
          uType: UnitType,
          qty: number
        ) => {
          if (!targetTerr || qty <= 0) return;
          setTerritoryUnits(
            targetTerr,
            addUnits(getTerritoryUnits(targetTerr), singleUnitCount(uType, qty))
          );
        };

        switch (candidate.doctrineId) {
          case "extermination": {
            candidate.unplacedArmies += 5;
            spawnOnTerr(capTerr, "tank", 2);
            spawnOnTerr(capTerr, "artillery", 2);
            spawnOnTerr(capTerr, "aircraft", 1);
            spawnOnTerr(coastalTerr, "navy", 1);
            state.log.push(
              `☠️ MOBILIZAÇÃO DE EXTERMÍNIO: ${candidate.name} mobilizou +5 Infantarias, +2 Tanques, +2 Artilharias, +1 Avião e +1 Navio!`
            );
            break;
          }
          case "mass_assault": {
            const totalInf =
              candTerrs.reduce((sum, t) => sum + getTerritoryUnits(t).infantry, 0) +
              candidate.unplacedArmies;
            const addInf = Math.max(0, Math.min(2, 50 - totalInf));
            if (addInf > 0) {
              candidate.unplacedArmies += addInf;
              state.log.push(
                `🚩 LEVA EM MASSA: ${candidate.name} recebeu +${addInf} Infantaria(s) de mobilização doutrinária (Teto: 50).`
              );
            }
            break;
          }
          case "blitzkrieg": {
            if (capTerr) {
              spawnOnTerr(capTerr, "tank", 1);
              candidate.unplacedArmies = Math.max(1, candidate.unplacedArmies - 2);
              state.log.push(
                `⚡ LINHA DE MONTAGEM BLINDADA: ${candidate.name} mobilizou +1 Tanque na Capital (-2 recrutas de infantaria).`
              );
            }
            break;
          }
          case "naval_supremacy":
          case "fleet_in_being": {
            spawnOnTerr(capTerr, "aircraft", 1);
            spawnOnTerr(coastalTerr, "navy", 1);
            state.log.push(
              `⚓ ESTALEIROS & ESQUADRILHAS: ${candidate.name} mobilizou +1 Aeronave e +1 Esquadra Naval!`
            );
            break;
          }
          case "guerrilla":
          case "guerrilla_warfare": {
            if (coastalTerr) {
              spawnOnTerr(coastalTerr, "navy", 1);
              state.log.push(
                `🏴‍☠️ FLOTILHA PARTISAN: ${candidate.name} mobilizou +1 Navio de patrulha costeira!`
              );
            }
            break;
          }
          default:
            break;
        }
      }

      updateSupplyAndEncirclement(state, map);

      for (const p of state.players) {
        if (!p.eliminated) {
          p.analytics = p.analytics ?? createInitialPlayerAnalytics();
          const pTerrs = Object.values(state.territories).filter((t) => t.ownerId === p.id);
          const ownsMechanized = pTerrs.some((t) => {
            const u = getTerritoryUnits(t);
            return u.tank > 0 || u.aircraft > 0 || u.navy > 0;
          });
          const hasRefinery = pTerrs.some((t) => hasTerritoryBuilding(t, "refinery"));
          if (ownsMechanized && (p.resources?.oil ?? 0) <= 0 && !hasRefinery) {
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
  const clone = cloneGameState(state);
  clone.deck = [];
  clone.discardPile = [];

  for (const p of clone.players) {
    if (p.id !== viewerPlayerId && state.phase !== "game_over") {
      p.objective = {
        id: "hidden",
        descriptionPt: "Objetivo Secreto",
        descriptionEn: "Secret Objective",
        rule: { type: "territories", count: 24, minArmiesPerTerritory: 1 },
      };
      p.cards = p.cards.map((_, idx) => ({
        id: `hidden_${idx}`,
        territoryId: null,
        symbol: "circle",
      }));
      p.availableObjectives = undefined;
    }
  }
  return clone;
}