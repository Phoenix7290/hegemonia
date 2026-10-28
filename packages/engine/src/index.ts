import {
  type GameAction,
  type GameMapDef,
  type GameState,
  type ObjectiveCard,
  type PlayerColor,
  type PlayerState,
  type TerritoryCard,
  type TerritoryState,
} from "@hegemonia/shared";
import { ALL_OBJECTIVES, ASIA_SUBREGIONS, CLASSIC_MAP, CLASSIC_OBJECTIVES, ROLEPLAY_OBJECTIVES } from "@hegemonia/maps";
import { createSeededRng, hashSeed, type SeededRng } from "./rng.js";

export * from "./rng.js";

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

export interface TurnEconomyBreakdown {
  capitalMoney: number;
  tradeHubMoney: number;
  goldPassiveMoney: number;
  grossMoney: number;
  economicPenaltyMultiplier: number;
  netMoney: number;
  steel: number;
  oil: number;
  gold: number;
}

/**
 * Calculates start-of-turn economic income and strategic resource extraction (HEGEM-18):
 * - Capital National Treasury: +3$ if the player has established a capital
 * - Trade Hubs: sum of territory `tradeBonus` across occupied territories (armies >= 1)
 * - Gold Passive Treasury: +2$ per occupied territory with `resource === "gold"`
 * - Strategic Extraction: +1 Steel / Oil / Gold per occupied territory with matching `resource`
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
  let steel = 0;
  let oil = 0;
  let gold = 0;

  for (const terr of occupiedTerritories) {
    const def = mapById.get(terr.id);
    if (!def) continue;
    if (def.tradeBonus && def.tradeBonus > 0) {
      tradeHubMoney += def.tradeBonus;
    }
    if (def.resource === "steel") {
      steel += 1;
    } else if (def.resource === "oil") {
      oil += 1;
    } else if (def.resource === "gold") {
      gold += 1;
      goldPassiveMoney += 2;
    }
  }

  const grossMoney = capitalMoney + tradeHubMoney + goldPassiveMoney;
  const economicPenaltyMultiplier = player?.isCapitalLost
    ? (player.economicPenaltyMultiplier ?? 0.5)
    : 1.0;
  const netMoney = Math.floor(grossMoney * economicPenaltyMultiplier);

  return {
    capitalMoney,
    tradeHubMoney,
    goldPassiveMoney,
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
      movedInArmies: 0,
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
    action.type === "join_coalition";

  if (!isOutOfTurnAction && (!currentPlayer || currentPlayer.id !== playerId)) {
    throw new Error("Não é o seu turno.");
  }

  actingPlayer.resources = actingPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  if (currentPlayer) {
    currentPlayer.resources = currentPlayer.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
  }

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
          state.territories[c.territoryId].armies += 2;
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
      const tName = mapById.get(terr.id)?.namePt ?? terr.id;
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
      if (action.armies > currentPlayer.unplacedArmies) {
        throw new Error("Quantidade de exércitos superior ao disponível para posicionar.");
      }

      // If capital has not been explicitly chosen yet, establish this territory as capital
      if (!currentPlayer.capitalTerritoryId) {
        currentPlayer.capitalTerritoryId = terr.id;
        currentPlayer.isCapitalLost = false;
        currentPlayer.resources.money += 3;
        const capName = mapById.get(terr.id)?.namePt ?? terr.id;
        state.log.push(`⭐ ${currentPlayer.name} estabeleceu ${capName} como sua Capital Nacional!`);
      }

      terr.armies += action.armies;
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

      const maxAttackerDice = Math.min(3, fromTerr.armies - 1);
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

      if (attackerModifier > 0 && attackerDice.length > 0) {
        attackerDice[0] += attackerModifier;
      }
      if (defenderModifier > 0 && defenderDice.length > 0) {
        defenderDice[0] += defenderModifier;
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

      fromTerr.armies -= attackerLosses;
      toTerr.armies -= defenderLosses;

      const defenderId = toTerr.ownerId;
      const conquered = toTerr.armies === 0;

      state.lastCombat = {
        fromTerritoryId: fromTerr.id,
        toTerritoryId: toTerr.id,
        attackerDice,
        defenderDice,
        attackerLosses,
        defenderLosses,
        conquered,
        attackerModifier,
        defenderModifier,
        lastStandBonus,
      };

      const fromName = fromDef.namePt;
      const toName = mapById.get(toTerr.id)!.namePt;
      const capitalCombatTag = isDefendingCapital
        ? ` [⭐ Capital Fortificada${capitalTiesDefended > 0 ? ` (+${capitalTiesDefended} empates resistidos)` : ""}]`
        : "";
      const lastStandTag = lastStandBonus
        ? ` [⭐ Mobilização Total +${attackerModifier || defenderModifier}]`
        : "";
      state.log.push(
        `Combate ${fromName} [${attackerDice.join(",")}] vs ${toName}${capitalCombatTag}${lastStandTag} [${defenderDice.join(",")}] → baixas ATQ:${attackerLosses} DEF:${defenderLosses}`
      );

      if (conquered) {
        toTerr.ownerId = playerId;
        currentPlayer.conqueredThisTurn = true;
        state.worldTension = Math.min(100, (state.worldTension ?? 0) + 0.5);

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

        const maxMove = Math.min(attackerDiceCount, fromTerr.armies - 1);
        const minMove = 1;

        // Immediately move 1 army into the conquered territory (minimum required)
        fromTerr.armies -= 1;
        toTerr.armies = 1;

        // If up to 1 or 2 additional armies can be moved (up to maxMove total),
        // record pendingConquest as the remaining optional move (0..maxMove-1),
        // or if maxMove === 1, no further prompt is needed.
        if (maxMove <= 1) {
          state.pendingConquest = null;
        } else {
          state.pendingConquest = {
            fromTerritoryId: fromTerr.id,
            toTerritoryId: toTerr.id,
            minMove: 1,
            maxMove,
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
      const { fromTerritoryId, toTerritoryId, minMove, maxMove } = state.pendingConquest;
      if (action.armies < minMove || action.armies > maxMove) {
        throw new Error(`Você deve mover entre ${minMove} e ${maxMove} exércitos.`);
      }
      // 1 army was already moved immediately on conquest; move the additional (action.armies - 1)
      const additional = action.armies - 1;
      state.territories[fromTerritoryId].armies -= additional;
      state.territories[toTerritoryId].armies += additional;
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
        t.movedInArmies = 0;
      }
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

      // Each army can only move once per turn, and at least 1 army must stay behind
      const movableArmies = Math.max(
        0,
        fromTerr.armies - fromTerr.movedInArmies - 1
      );
      if (action.armies > movableArmies) {
        throw new Error(`Apenas ${movableArmies} exército(s) podem se mover deste território neste turno.`);
      }

      fromTerr.armies -= action.armies;
      toTerr.armies += action.armies;
      toTerr.movedInArmies += action.armies;

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

      actingPlayer.infamy = Math.min(100, (actingPlayer.infamy ?? 0) + 35);
      state.worldTension = Math.min(100, (state.worldTension ?? 0) + 15);

      const label = treaty.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão";
      state.log.push(
        `💥 TRAIÇÃO DIPLOMÁTICA! ${actingPlayer.name} rompeu unilateralmente o ${label} com ${otherP?.name}! (+35% de Infâmia, +15% de Tensão Mundial)`
      );
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
    t.movedInArmies = 0;
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
