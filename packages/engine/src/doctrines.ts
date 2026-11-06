import {
  DOCTRINES,
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
  player.doctrineId = doctrineId;
  const def = DOCTRINES[doctrineId];
  state.log.push(`[DOUTRINA] ${player.name} adotou a doutrina "${def.namePt}".`);
}

/**
 * Doutrina 1 (Blitzkrieg) e Doutrina 2 (Defesa em Profundidade):
 * Ajusta os dados ordenados (decrescentes) de ataque e defesa de forma 100% determinística.
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

  // 1. Blitzkrieg: +1 no maior dado de ataque no 1.º round de combate se tiver blindados com combustível
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

  // 2. Defesa em Profundidade: +1 no maior dado defensivo com infantaria dentro do continente natal
  if (defender && defender.doctrineId === "defense_in_depth" && defenderDice.length > 0) {
    const toDef = map.territories.find((t) => t.id === toTerritory.id);
    const nativeContinent = getPlayerNativeContinent(state, defender, map);
    if (
      defenderUnits.infantry > 0 &&
      toDef &&
      nativeContinent &&
      toDef.continent === nativeContinent
    ) {
      defenderDice[0] = Math.min(6, defenderDice[0] + 1);
      defenderBonusApplied = true;
    }
  }

  return { attackerBonusApplied, defenderBonusApplied };
}

/**
 * Doutrina 2 (Defesa em Profundidade):
 * Fortificações Nv. 1 só degradam em combate se o atacante empregar tanques ou artilharia.
 */
export function canDegradeFortificationInCombat(
  defender: PlayerState | undefined,
  committedAttackerUnits: UnitCounts
): boolean {
  if (defender?.doctrineId === "defense_in_depth") {
    return committedAttackerUnits.tank > 0 || committedAttackerUnits.artillery > 0;
  }
  return true;
}

/**
 * Doutrina 1 (Blitzkrieg):
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
 * Doutrina 3 (Frota em Potência / Projeção Aeronaval):
 * Reduz em $1 o custo de construção de Portos e Aeródromos.
 */
export function getEffectiveBuildingMoneyCost(
  player: PlayerState,
  buildingType: BuildingType,
  baseMoneyCost: number
): number {
  if (
    player.doctrineId === "fleet_in_being" &&
    (buildingType === "port" || buildingType === "airfield")
  ) {
    return Math.max(1, baseMoneyCost - 1);
  }
  return baseMoneyCost;
}

/**
 * Doutrina 3 (Frota em Potência / Projeção Aeronaval):
 * Permite realizar 1 Ponte Aérea (Airlift) adicional por turno (total = 2).
 */
export function getMaxAirliftsPerTurn(player: PlayerState): number {
  return player.doctrineId === "fleet_in_being" ? 2 : 1;
}

/**
 * Doutrina 4 (Guerra de Guerrilha / Resistência Insurgente):
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
  if (previousOwner.doctrineId !== "guerrilla_warfare") return false;
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
    previousOwner.eliminated = false;
    previousOwner.eliminatedBy = undefined;
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