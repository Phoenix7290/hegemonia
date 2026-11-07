import {
  DOCTRINES,
  isDoctrineAvailableInLobby,
  isObjectiveCompatibleWithDoctrine,
  type BuildingType,
  type DoctrineId,
  type GameMapDef,
  type GameState,
  type PlayerState,
  type TerritoryState,
  type UnitCounts,
} from "@hegemonia/shared";
import type { SeededRng } from "./rng.js";

/**
 * Identifica o continente natal do comandante:
 * 1. Continente registado em analytics.capitalContinentId
 * 2. Continente da Capital Nacional (capitalTerritoryId)
 * 3. Continente com maior número de territórios controlados pelo jogador
 */
export function getPlayerNativeContinent(
  state: GameState,
  player: PlayerState,
  map: GameMapDef
): string | null {
  if (player.analytics?.capitalContinentId) {
    return player.analytics.capitalContinentId;
  }
  if (player.capitalTerritoryId) {
    const capDef = map.territories.find((t) => t.id === player.capitalTerritoryId);
    if (capDef) return capDef.continent;
  }
  const counts = new Map<string, number>();
  for (const tDef of map.territories) {
    if (state.territories[tDef.id]?.ownerId === player.id) {
      counts.set(tDef.continent, (counts.get(tDef.continent) ?? 0) + 1);
    }
  }
  let bestContinent: string | null = null;
  let bestCount = 0;
  for (const [cont, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestContinent = cont;
    }
  }
  return bestContinent;
}

/**
 * Aplica a seleção de doutrina na Rodada 1 (Fase de Posicionamento)
 * com verificação estrita de limite de escolhas por partida.
 */
export function applySelectDoctrine(
  state: GameState,
  player: PlayerState,
  doctrineId: DoctrineId
): void {
  if (state.round > 1 || state.phase !== "deploy") {
    throw new Error("A Doutrina Militar Nacional só pode ser definida na Rodada 1 (Posicionamento).");
  }
  if (player.doctrineId) {
    throw new Error("A sua Doutrina Militar Nacional já foi definida para esta partida.");
  }

  // HEGEM-116: Limite de picks no lobby / partida (max 2 para comuns, max 1 para Extermínio)
  const currentSelections = state.players.map((p) => p.doctrineId);
  if (!isDoctrineAvailableInLobby(doctrineId, currentSelections)) {
    throw new Error(
      `O limite de generais com a doutrina "${DOCTRINES[doctrineId]?.namePt}" já foi atingido nesta partida.`
    );
  }

  // HEGEM-117: Compatibilidade estrita entre Doutrina e Objetivo Secreto
  if (player.objective && !isObjectiveCompatibleWithDoctrine(player.objective, doctrineId)) {
    throw new Error(
      `A doutrina militar "${DOCTRINES[doctrineId]?.namePt}" é incompatível com o seu Objetivo Secreto.`
    );
  }

  player.doctrineId = doctrineId;
  const def = DOCTRINES[doctrineId];

  // Extermínio inicia com 50% de Tensão Global e Infâmia
  if (doctrineId === "extermination") {
    state.worldTension = Math.max(state.worldTension ?? 0, 50);
    player.infamy = Math.max(player.infamy ?? 0, 50);
  }

  state.log.push(`[DOUTRINA] ${player.name} adotou a doutrina "${def.namePt}".`);
}

/**
 * Modificadores de Combate das 7 Doutrinas HoI4:
 * Ajusta os dados ordenados de ataque e defesa de forma 100% determinística.
 */
export function applyDoctrineCombatDiceModifiers(params: {
  state: GameState;
  map: GameMapDef;
  attacker: PlayerState;
  defender: PlayerState | undefined;
  fromTerritory: TerritoryState;
  toTerritory: TerritoryState;
  committedAttackerUnits: UnitCounts;
  defenderUnits: UnitCounts;
  attackerDice: number[];
  defenderDice: number[];
}): { attackerBonusApplied: boolean; defenderBonusApplied: boolean } {
  const {
    state,
    map,
    attacker,
    defender,
    fromTerritory,
    toTerritory,
    committedAttackerUnits,
    defenderUnits,
    attackerDice,
    defenderDice,
  } = params;

  let attackerBonusApplied = false;
  let defenderBonusApplied = false;

  const assaulted = new Set(attacker.assaultedTargetsThisTurn ?? []);
  const isFirstCombatRoundOnTarget = !assaulted.has(toTerritory.id);
  assaulted.add(toTerritory.id);
  attacker.assaultedTargetsThisTurn = [...assaulted];

  // 1. Extermínio (Total War): +1 em TODOS os dados de ataque ao invadir
  if (attacker.doctrineId === "extermination" && attackerDice.length > 0) {
    for (let i = 0; i < attackerDice.length; i++) {
      attackerDice[i] = Math.min(6, attackerDice[i] + 1);
    }
    attackerBonusApplied = true;
  }

  // 2. Blitzkrieg: +1 no maior dado de ataque no 1.º round com blindados abastecidos
  if (
    attacker.doctrineId === "blitzkrieg" &&
    isFirstCombatRoundOnTarget &&
    committedAttackerUnits.tank > 0 &&
    !fromTerritory.outOfFuel &&
    attackerDice.length > 0
  ) {
    attackerDice[0] = Math.min(6, attackerDice[0] + 1);
    attackerBonusApplied = true;
  }

  // 3. Grande Batalhão (Superior Firepower): Artilharia acoplada concede +1 no 2.º maior dado
  if (
    attacker.doctrineId === "superior_firepower" &&
    committedAttackerUnits.artillery >= 1 &&
    attackerDice.length >= 2
  ) {
    attackerDice[1] = Math.min(6, attackerDice[1] + 1);
    attackerBonusApplied = true;
  }

  // 4. Fortaleza Soberana (Tall) & Defesa em Profundidade:
  if (
    defender &&
    (defender.doctrineId === "tall_sovereign" || defender.doctrineId === "defense_in_depth") &&
    defenderDice.length > 0
  ) {
    const defTerrCount = Object.values(state.territories).filter(
      (t) => t.ownerId === defender.id
    ).length;

    // Se estiver em Overextension (> 5 territórios): penalidade de -1 DEF
    if (defTerrCount > 5) {
      defenderDice[0] = Math.max(1, defenderDice[0] - 1);
    } else if (defenderUnits.infantry > 0) {
      // Bastião concentrado (<= 5 territórios): +1 no maior dado de defesa
      defenderDice[0] = Math.min(6, defenderDice[0] + 1);
      defenderBonusApplied = true;
    }
  }

  return { attackerBonusApplied, defenderBonusApplied };
}

/**
 * Fortaleza Soberana / Defesa em Profundidade:
 * Fortificações Nv. 1 só degradam em combate se o atacante empregar tanques ou artilharia.
 */
export function canDegradeFortificationInCombat(
  defender: PlayerState | undefined,
  committedAttackerUnits: UnitCounts
): boolean {
  if (
    defender?.doctrineId === "defense_in_depth" ||
    defender?.doctrineId === "tall_sovereign"
  ) {
    return committedAttackerUnits.tank > 0 || committedAttackerUnits.artillery > 0;
  }
  return true;
}

/**
 * Blitzkrieg:
 * Reduz em 50% o custo de petróleo no primeiro avanço/ataque Blitz de cada turno.
 */
export function getEffectiveBlitzOilCost(
  player: PlayerState,
  baseOilCost: number
): number {
  if (player.doctrineId === "blitzkrieg" && (player.blitzCountThisTurn ?? 0) === 0) {
    return Math.floor(baseOilCost * 0.5);
  }
  return baseOilCost;
}

/**
 * Supremacia Aeronaval / Frota em Potência:
 * Reduz em $1 o custo de construção de Portos e Aeródromos.
 */
export function getEffectiveBuildingMoneyCost(
  player: PlayerState,
  buildingType: BuildingType,
  baseMoneyCost: number
): number {
  if (
    (player.doctrineId === "fleet_in_being" || player.doctrineId === "naval_supremacy") &&
    (buildingType === "port" || buildingType === "airfield")
  ) {
    return Math.max(1, baseMoneyCost - 1);
  }
  return baseMoneyCost;
}

/**
 * Supremacia Aeronaval:
 * Permite realizar até 2 Pontes Aéreas (Airlifts) por turno.
 */
export function getMaxAirliftsPerTurn(player: PlayerState): number {
  return player.doctrineId === "fleet_in_being" || player.doctrineId === "naval_supremacy" ? 2 : 1;
}

/**
 * Guerra de Guerrilha:
 * Quando um adversário conquista um território e avança deixando apenas 1 divisão de guarnição,
 * surge 1 divisão de partisan para contestar a posse imediatamente.
 */
export function resolveGuerrillaInsurgencyOnOccupy(params: {
  state: GameState;
  map: GameMapDef;
  rng: SeededRng;
  occupier: PlayerState;
  previousOwner: PlayerState | undefined;
  conqueredTerritory: TerritoryState;
}): boolean {
  const { state, map, rng, occupier, previousOwner, conqueredTerritory } = params;
  if (!previousOwner || previousOwner.id === occupier.id) return false;
  if (
    previousOwner.doctrineId !== "guerrilla_warfare" &&
    previousOwner.doctrineId !== "guerrilla"
  ) {
    return false;
  }
  if (conqueredTerritory.armies !== 1) return false;

  const partisanRoll = rng.nextInt(1, 6);
  const garrisonRoll = rng.nextInt(1, 6);
  const terrName =
    map.territories.find((t) => t.id === conqueredTerritory.id)?.namePt ??
    conqueredTerritory.id;

  if (partisanRoll >= garrisonRoll) {
    conqueredTerritory.ownerId = previousOwner.id;
    conqueredTerritory.armies = 1;
    conqueredTerritory.units = {
      infantry: 1,
      tank: 0,
      artillery: 0,
      aircraft: 0,
      navy: 0,
    };
    conqueredTerritory.conqueredTurnRound = undefined;
    conqueredTerritory.blitzkriegAvailable = false;
    conqueredTerritory.infantryAssaultFatigued = false;
    previousOwner.eliminated = false;
    previousOwner.eliminatedBy = undefined;
    if (state.lastCombat && state.lastCombat.toTerritoryId === conqueredTerritory.id) {
      state.lastCombat.guerrillaInsurgency = true;
    }
    state.log.push(
      `[GUERRILHA] Insurgência Partisan em ${terrName}! Guerrilheiros de ${previousOwner.name} emboscaram a guarnição solitária de ${occupier.name} ([${partisanRoll}] vs [${garrisonRoll}]) e retomaram o território!`
    );
    return true;
  }

  state.log.push(
    `[GUERRILHA] Insurgência Partisan em ${terrName}! A guarnição de ${occupier.name} conteve o levante partisan de ${previousOwner.name} ([${garrisonRoll}] vs [${partisanRoll}]).`
  );
  return false;
}

/**
 * Limpa os contadores por turno das doutrinas ao encerrar o turno do jogador.
 */
export function resetDoctrineTurnCounters(player: PlayerState): void {
  player.blitzCountThisTurn = 0;
  player.airliftsUsedThisTurn = 0;
  player.assaultedTargetsThisTurn = [];
}
