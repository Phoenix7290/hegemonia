import { describe, expect, it, beforeEach } from "vitest";
import {
  COMBAT_ANIMATION_STORAGE_KEY,
  createCombatAnimationFromRoll,
  createCombatAnimationFromStrike,
  extractCombatCategories,
  getCombatAnimationDurationMs,
  loadCombatAnimationSpeed,
  resolveShortestMapVector,
  saveCombatAnimationSpeed,
} from "./combat-animations.js";
import type { CombatRollResult } from "@hegemonia/shared";

describe("HEGEM-80: Combat Tactical Animations Helper", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
      configurable: true,
    });
  });

  it("persists and loads combat animation speed preference", () => {
    expect(loadCombatAnimationSpeed()).toBe("normal");
    expect(getCombatAnimationDurationMs("normal")).toBeGreaterThanOrEqual(400);
    expect(getCombatAnimationDurationMs("normal")).toBeLessThanOrEqual(700);

    saveCombatAnimationSpeed("fast");
    expect(store.get(COMBAT_ANIMATION_STORAGE_KEY)).toBe("fast");
    expect(loadCombatAnimationSpeed()).toBe("fast");
    expect(getCombatAnimationDurationMs("fast")).toBe(400);

    saveCombatAnimationSpeed("off");
    expect(loadCombatAnimationSpeed()).toBe("off");
    expect(getCombatAnimationDurationMs("off")).toBe(0);
  });

  it("computes shortest-path vector across standard and trans-Pacific wraparound borders", () => {
    // Standard adjacent border: Brasil (382, 425) -> Venezuela (312, 345)
    const direct = resolveShortestMapVector([382, 425], [312, 345], 1200);
    expect(direct.dx).toBe(-70);
    expect(direct.dy).toBe(-80);
    expect(direct.arcControlY).toBeLessThan(direct.midY);

    // Trans-Pacific border: Alasca (106, 118) -> Vladivostok (1036, 134)
    const pacificWest = resolveShortestMapVector([106, 118], [1036, 134], 1200);
    expect(pacificWest.x2).toBe(1036 - 1200); // -164
    expect(pacificWest.dx).toBe(-270);
    expect(pacificWest.dist).toBeLessThan(300);

    // Reverse trans-Pacific border: Vladivostok (1036, 134) -> Alasca (106, 118)
    const pacificEast = resolveShortestMapVector([1036, 134], [106, 118], 1200);
    expect(pacificEast.x2).toBe(106 + 1200); // 1306
    expect(pacificEast.dx).toBe(270);
  });

  it("extracts all 5 troop categories from combined-arms combat rolls and bonuses", () => {
    const baseRoll: CombatRollResult = {
      fromTerritoryId: "brasil",
      toTerritoryId: "argelia",
      attackerDice: [6, 5, 4],
      defenderDice: [3, 2],
      attackerLosses: 0,
      defenderLosses: 2,
      conquered: true,
    };

    // Fallback when no units are specified -> defaults to infantry
    expect(extractCombatCategories(baseRoll)).toEqual(["infantry"]);

    // Full combined-arms task force
    const combinedRoll: CombatRollResult = {
      ...baseRoll,
      attackerUnits: {
        infantry: 3,
        tank: 2,
        artillery: 1,
        aircraft: 1,
        navy: 1,
      },
    };
    expect(extractCombatCategories(combinedRoll, { isMaritime: true })).toEqual([
      "infantry",
      "tank",
      "artillery",
      "aircraft",
      "navy",
    ]);

    // Implicit bonuses (CAS, Blitzkrieg, Coastal Bombardment)
    const bonusRoll: CombatRollResult = {
      ...baseRoll,
      attackerUnits: {
        infantry: 0,
        tank: 1,
        artillery: 0,
        aircraft: 0,
        navy: 0,
      },
      casBonus: true,
      blitzkriegBonus: true,
      coastalBombardmentBonus: true,
    };
    expect(extractCombatCategories(bonusRoll)).toEqual(["tank", "aircraft", "navy"]);
  });

  it("creates non-blocking animation descriptors for rolls and tactical strikes, or null when off", () => {
    const roll: CombatRollResult = {
      fromTerritoryId: "alemanha",
      toTerritoryId: "polonia",
      attackerDice: [6, 6],
      defenderDice: [2],
      attackerLosses: 0,
      defenderLosses: 1,
      attackerUnits: { infantry: 2, tank: 1, artillery: 0, aircraft: 0, navy: 0 },
      conquered: true,
    };

    expect(createCombatAnimationFromRoll(roll, "off")).toBeNull();

    const normalAnim = createCombatAnimationFromRoll(roll, "normal", { now: 1000 });
    expect(normalAnim).not.toBeNull();
    expect(normalAnim?.categories).toEqual(["infantry", "tank"]);
    expect(normalAnim?.durationMs).toBe(620);

    const barrageAnim = createCombatAnimationFromStrike(
      {
        kind: "artillery_barrage",
        fromTerritoryId: "franca",
        toTerritoryId: "alemanha",
        hits: 2,
        round: 3,
      },
      "fast",
      { now: 2000 }
    );
    expect(barrageAnim?.categories).toEqual(["artillery"]);
    expect(barrageAnim?.durationMs).toBe(400);

    const airAnim = createCombatAnimationFromStrike(
      {
        kind: "air_mission",
        missionType: "bombardment",
        fromTerritoryId: "inglaterra",
        toTerritoryId: "alemanha",
        round: 3,
      },
      "normal",
      { now: 3000 }
    );
    expect(airAnim?.categories).toEqual(["aircraft"]);
    expect(airAnim?.missionType).toBe("bombardment");
  });
});
