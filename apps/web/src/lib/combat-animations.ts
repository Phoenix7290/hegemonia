import type {
  AirMissionType,
  CombatRollResult,
  TacticalStrikeEvent,
  UnitCounts,
  UnitType,
} from "@hegemonia/shared";

export type CombatAnimationSpeed = "normal" | "fast" | "off";

export const COMBAT_ANIMATION_STORAGE_KEY = "hegemonia_combat_animations";

export const COMBAT_ANIMATION_DURATIONS_MS: Record<CombatAnimationSpeed, number> = {
  normal: 620,
  fast: 400,
  off: 0,
};

export interface CombatVectorGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dx: number;
  dy: number;
  dist: number;
  angleDeg: number;
  midX: number;
  midY: number;
  borderX: number;
  borderY: number;
  arcControlX: number;
  arcControlY: number;
  parabolicPathD: string;
  directPathD: string;
}

export interface ActiveCombatAnimation {
  id: string;
  fromTerritoryId: string;
  toTerritoryId: string;
  categories: UnitType[];
  kind: "attack" | "artillery_barrage" | "air_mission";
  missionType?: AirMissionType;
  isMaritime: boolean;
  conquered: boolean;
  attackerLosses: number;
  defenderLosses: number;
  durationMs: number;
  createdAt: number;
}

export function loadCombatAnimationSpeed(): CombatAnimationSpeed {
  try {
    if (typeof localStorage === "undefined") return "normal";
    const raw = localStorage.getItem(COMBAT_ANIMATION_STORAGE_KEY);
    if (raw === "normal" || raw === "fast" || raw === "off") {
      return raw;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return "normal";
}

export function saveCombatAnimationSpeed(speed: CombatAnimationSpeed): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(COMBAT_ANIMATION_STORAGE_KEY, speed);
  } catch {
    // Ignore storage access errors
  }
}

export function getCombatAnimationDurationMs(speed: CombatAnimationSpeed): number {
  return COMBAT_ANIMATION_DURATIONS_MS[speed] ?? 620;
}

/**
 * Computes the shortest vector between two territory centers on the wrap-around world map.
 * Handles trans-Pacific crossings (e.g. Alaska <-> Vladivostok, Hawaii <-> Japan) seamlessly.
 */
export function resolveShortestMapVector(
  fromCenter: [number, number],
  toCenter: [number, number],
  mapWidth = 1200
): CombatVectorGeometry {
  const x1 = fromCenter[0];
  const y1 = fromCenter[1];
  let x2 = toCenter[0];
  const y2 = toCenter[1];

  const rawDx = x2 - x1;
  if (rawDx > mapWidth / 2) {
    x2 -= mapWidth;
  } else if (rawDx < -mapWidth / 2) {
    x2 += mapWidth;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  const midX = x1 + dx * 0.5;
  const midY = y1 + dy * 0.5;
  const borderX = x1 + dx * 0.4;
  const borderY = y1 + dy * 0.4;

  // High-arc parabolic trajectory control point for artillery salvos
  const arcLift = Math.min(72, Math.max(28, dist * 0.42));
  const arcControlX = midX;
  const arcControlY = midY - arcLift;

  const directPathD = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  const parabolicPathD = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${arcControlX.toFixed(1)} ${arcControlY.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;

  return {
    x1,
    y1,
    x2,
    y2,
    dx,
    dy,
    dist,
    angleDeg,
    midX,
    midY,
    borderX,
    borderY,
    arcControlX,
    arcControlY,
    parabolicPathD,
    directPathD,
  };
}

/**
 * Determines which troop categories (infantry, tank, artillery, aircraft, navy)
 * should render combined-arms visual effects for a combat roll.
 */
export function extractCombatCategories(
  combat: CombatRollResult,
  options?: {
    fallbackUnits?: Partial<UnitCounts> | null;
    isMaritime?: boolean;
  }
): UnitType[] {
  const units = combat.attackerUnits ?? options?.fallbackUnits ?? combat.attackerLossUnits;
  const categories = new Set<UnitType>();

  if (units) {
    if ((units.infantry ?? 0) > 0) categories.add("infantry");
    if ((units.tank ?? 0) > 0) categories.add("tank");
    if ((units.artillery ?? 0) > 0) categories.add("artillery");
    if ((units.aircraft ?? 0) > 0) categories.add("aircraft");
    if ((units.navy ?? 0) > 0) categories.add("navy");
  }

  if (combat.blitzkriegBonus) {
    categories.add("tank");
  }
  if (combat.casBonus) {
    categories.add("aircraft");
  }
  if (
    combat.coastalBombardmentBonus ||
    combat.navalBlockade ||
    (options?.isMaritime && (units?.navy ?? 0) > 0)
  ) {
    categories.add("navy");
  }

  if (categories.size === 0) {
    categories.add("infantry");
  }

  const ordered: UnitType[] = ["infantry", "tank", "artillery", "aircraft", "navy"];
  return ordered.filter((u) => categories.has(u));
}

export function createCombatAnimationFromRoll(
  combat: CombatRollResult,
  speed: CombatAnimationSpeed,
  options?: {
    fallbackUnits?: Partial<UnitCounts> | null;
    isMaritime?: boolean;
    now?: number;
  }
): ActiveCombatAnimation | null {
  const durationMs = getCombatAnimationDurationMs(speed);
  if (durationMs <= 0) return null;

  const now = options?.now ?? Date.now();
  const categories = extractCombatCategories(combat, options);

  return {
    id: `combat-${combat.fromTerritoryId}-${combat.toTerritoryId}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    fromTerritoryId: combat.fromTerritoryId,
    toTerritoryId: combat.toTerritoryId,
    categories,
    kind: "attack",
    isMaritime: Boolean(options?.isMaritime || combat.coastalBombardmentBonus || combat.navalBlockade),
    conquered: combat.conquered,
    attackerLosses: combat.attackerLosses,
    defenderLosses: combat.defenderLosses,
    durationMs,
    createdAt: now,
  };
}

export function createCombatAnimationFromStrike(
  strike: TacticalStrikeEvent,
  speed: CombatAnimationSpeed,
  options?: {
    isMaritime?: boolean;
    now?: number;
  }
): ActiveCombatAnimation | null {
  const durationMs = getCombatAnimationDurationMs(speed);
  if (durationMs <= 0) return null;

  const now = options?.now ?? Date.now();
  const categories: UnitType[] =
    strike.kind === "artillery_barrage" ? ["artillery"] : ["aircraft"];

  return {
    id: `strike-${strike.kind}-${strike.fromTerritoryId}-${strike.toTerritoryId}-${now}-${Math.random().toString(36).slice(2, 6)}`,
    fromTerritoryId: strike.fromTerritoryId,
    toTerritoryId: strike.toTerritoryId,
    categories,
    kind: strike.kind,
    missionType: strike.missionType,
    isMaritime: Boolean(options?.isMaritime),
    conquered: false,
    attackerLosses: 0,
    defenderLosses: strike.hits ?? 0,
    durationMs,
    createdAt: now,
  };
}
