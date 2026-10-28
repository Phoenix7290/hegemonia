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
  };

  // Give first player their initial turn reinforcements
  const firstPlayer = state.players[0];
  const reinf = calculateTurnReinforcements(state, firstPlayer.id, map);
  firstPlayer.unplacedArmies = reinf.total;
  state.log.push(`${firstPlayer.name} recebe ${reinf.total} exércitos para posicionar.`);

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
  if (!currentPlayer || currentPlayer.id !== playerId) {
    throw new Error("Não é o seu turno.");
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

    case "select_capital": {
      if (state.phase !== "deploy") {
        throw new Error("A capital só pode ser selecionada durante a fase de posicionamento.");
      }
      const terr = state.territories[action.territoryId];
      if (!terr || terr.ownerId !== playerId) {
        throw new Error("Você só pode estabelecer a capital em um território sob seu controle.");
      }
      currentPlayer.capitalTerritoryId = action.territoryId;
      currentPlayer.isCapitalLost = false;
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

      const defenderPlayer = state.players.find((p) => p.id === toTerr.ownerId);
      const isDefendingCapital =
        defenderPlayer?.capitalTerritoryId === toTerr.id &&
        toTerr.ownerId === defenderPlayer.id;

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
      };

      const fromName = fromDef.namePt;
      const toName = mapById.get(toTerr.id)!.namePt;
      const capitalCombatTag = isDefendingCapital
        ? ` [⭐ Capital Fortificada${capitalTiesDefended > 0 ? ` (+${capitalTiesDefended} empates resistidos)` : ""}]`
        : "";
      state.log.push(
        `Combate ${fromName} [${attackerDice.join(",")}] vs ${toName}${capitalCombatTag} [${defenderDice.join(",")}] → baixas ATQ:${attackerLosses} DEF:${defenderLosses}`
      );

      if (conquered) {
        toTerr.ownerId = playerId;
        currentPlayer.conqueredThisTurn = true;

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

  for (const t of Object.values(state.territories)) {
    t.movedInArmies = 0;
  }

  // Advance to next non-eliminated player
  const totalPlayers = state.players.length;
  for (let step = 1; step <= totalPlayers; step++) {
    const nextIdx = (state.turnIndex + step) % totalPlayers;
    if (nextIdx < state.turnIndex || (state.turnIndex === totalPlayers - 1 && nextIdx === 0)) {
      state.round += 1;
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
      if (candidate.moralePenalty && candidate.moralePenalty > 0) {
        // One-turn penalty applied; clear penalty for subsequent turns
        candidate.moralePenalty = 0;
      }
      const capTag = reinf.capitalBonus > 0 ? " (+1 bônus Capital)" : "";
      const penTag = reinf.moralePenalty > 0 ? ` (-${reinf.moralePenalty} penalidade moral)` : "";
      state.log.push(
        `Turno de ${candidate.name} (Rodada ${state.round}): +${reinf.total} exércitos${capTag}${penTag}.`
      );
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
