import type { TerritoryState, UnitCounts, UnitType } from "@hegemonia/shared";

export const UNIT_TYPES = [
  "infantry",
  "tank",
  "artillery",
  "aircraft",
  "navy",
] as const satisfies readonly UnitType[];

export function emptyUnitCounts(): UnitCounts {
  return { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };
}

export function singleUnitCount(unitType: UnitType, quantity = 1): UnitCounts {
  return { ...emptyUnitCounts(), [unitType]: quantity };
}

export function totalUnits(units: UnitCounts): number {
  return UNIT_TYPES.reduce((total, unitType) => total + units[unitType], 0);
}

function reconcileUnits(
  units: UnitCounts | undefined,
  legacyTotal: number
): UnitCounts {
  const targetTotal = Math.max(0, legacyTotal);
  if (!units) return singleUnitCount("infantry", targetTotal);

  const result = { ...units };
  const difference = targetTotal - totalUnits(result);
  if (difference > 0) result.infantry += difference;
  if (difference < 0) return removeCasualties(result, -difference).remaining;
  return result;
}

export function getTerritoryUnits(territory: TerritoryState): UnitCounts {
  return reconcileUnits(territory.units, territory.armies);
}

export function getMovedInUnits(territory: TerritoryState): UnitCounts {
  return reconcileUnits(territory.movedInUnits, territory.movedInArmies);
}

export function setTerritoryUnits(territory: TerritoryState, units: UnitCounts): void {
  territory.units = { ...units };
  territory.armies = totalUnits(units);
}

export function setMovedInUnits(territory: TerritoryState, units: UnitCounts): void {
  territory.movedInUnits = { ...units };
  territory.movedInArmies = totalUnits(units);
}

export function addUnits(base: UnitCounts, added: UnitCounts): UnitCounts {
  const result = { ...base };
  for (const unitType of UNIT_TYPES) result[unitType] += added[unitType];
  return result;
}

export function canSubtractUnits(base: UnitCounts, removed: UnitCounts): boolean {
  return UNIT_TYPES.every((unitType) => removed[unitType] <= base[unitType]);
}

export function subtractUnits(base: UnitCounts, removed: UnitCounts): UnitCounts {
  const result = { ...base };
  for (const unitType of UNIT_TYPES) result[unitType] -= removed[unitType];
  return result;
}

export function scaleUnits(units: UnitCounts, quantity: number): UnitCounts {
  const result = { ...units };
  for (const unitType of UNIT_TYPES) result[unitType] *= quantity;
  return result;
}

export function selectUnits(available: UnitCounts, quantity: number): UnitCounts {
  const selected = emptyUnitCounts();
  let remaining = quantity;
  for (const unitType of UNIT_TYPES) {
    selected[unitType] = Math.min(available[unitType], remaining);
    remaining -= selected[unitType];
  }
  return selected;
}

export function removeCasualties(
  units: UnitCounts,
  quantity: number
): { remaining: UnitCounts; losses: UnitCounts } {
  const losses = selectUnits(units, quantity);
  return { remaining: subtractUnits(units, losses), losses };
}
