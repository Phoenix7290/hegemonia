import { describe, expect, it } from "vitest";
import { CLASSIC_MAP, CLASSIC_OBJECTIVES } from "@hegemonia/maps";
import {
  applyAction,
  calculateTurnReinforcements,
  createGame,
  createPlayerView,
  createSeededRng,
  getTradeBonusArmies,
  isValidCardSet,
} from "./index.js";

describe("Classic Map Graph Integrity", () => {
  it("has exactly 42 territories across 6 continents", () => {
    expect(CLASSIC_MAP.territories.length).toBe(42);
    expect(CLASSIC_MAP.continents.length).toBe(6);

    const counts: Record<string, number> = {};
    for (const t of CLASSIC_MAP.territories) {
      counts[t.continent] = (counts[t.continent] ?? 0) + 1;
    }
    expect(counts).toEqual({
      south_america: 4,
      north_america: 9,
      europe: 7,
      africa: 6,
      asia: 12,
      oceania: 4,
    });
  });

  it("has symmetric adjacency (if A borders B, B borders A) and no self-loops", () => {
    const byId = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
    for (const t of CLASSIC_MAP.territories) {
      expect(t.neighbors).not.toContain(t.id);
      for (const nId of t.neighbors) {
        const neighbor = byId.get(nId);
        expect(neighbor, `Missing territory ${nId} referenced by ${t.id}`).toBeDefined();
        expect(
          neighbor!.neighbors,
          `Asymmetric border: ${t.id} -> ${nId}, but ${nId} does not list ${t.id}`
        ).toContain(t.id);
      }
    }
  });

  it("is a single connected graph (every territory reachable from Brasil)", () => {
    const byId = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const queue = ["brasil"];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const n of byId.get(curr)!.neighbors) {
        if (!visited.has(n)) queue.push(n);
      }
    }
    expect(visited.size).toBe(42);
  });
});

describe("War Classic Rules Engine", () => {
  it("computes classic card trade escalation (4, 6, 8, 10, 12, 15, 20...)", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(getTradeBonusArmies)).toEqual([
      4, 6, 8, 10, 12, 15, 20, 25,
    ]);
  });

  it("validates 3-card combinations (3 equal, 3 different, or with jokers)", () => {
    expect(
      isValidCardSet([
        { id: "1", territoryId: "a", symbol: "circle" },
        { id: "2", territoryId: "b", symbol: "circle" },
        { id: "3", territoryId: "c", symbol: "circle" },
      ])
    ).toBe(true);

    expect(
      isValidCardSet([
        { id: "1", territoryId: "a", symbol: "circle" },
        { id: "2", territoryId: "b", symbol: "square" },
        { id: "3", territoryId: "c", symbol: "triangle" },
      ])
    ).toBe(true);

    expect(
      isValidCardSet([
        { id: "1", territoryId: "a", symbol: "circle" },
        { id: "2", territoryId: "b", symbol: "circle" },
        { id: "3", territoryId: "c", symbol: "square" },
      ])
    ).toBe(false);

    expect(
      isValidCardSet([
        { id: "1", territoryId: "a", symbol: "circle" },
        { id: "2", territoryId: "b", symbol: "square" },
        { id: "3", territoryId: null, symbol: "joker" },
      ])
    ).toBe(true);
  });

  it("enforces Round 1 deploy-only rule (automatically advances turn after deploying)", () => {
    const seed = "test-seed-round1";
    const rng = createSeededRng(seed);
    let state = createGame({
      id: "g1",
      seed,
      players: [
        { id: "p1", name: "Ryan", color: "blue" },
        { id: "p2", name: "Bot", color: "red" },
        { id: "p3", name: "Amigo", color: "green" },
      ],
    });

    const firstPlayer = state.players[0];
    expect(state.round).toBe(1);
    expect(firstPlayer.unplacedArmies).toBe(7); // 42 / 3 = 14 territories -> floor(14/2) = 7

    const ownedTerritory = Object.values(state.territories).find(
      (t) => t.ownerId === firstPlayer.id
    )!;

    state = applyAction(
      state,
      firstPlayer.id,
      { type: "deploy", territoryId: ownedTerritory.id, armies: 7 },
      rng
    );

    // Since Round 1 forbids attacking, deploying all armies immediately advances to player 2!
    expect(state.turnIndex).toBe(1);
    expect(state.phase).toBe("deploy");
  });

  it("masks secret objectives and cards of opponents in createPlayerView", () => {
    const state = createGame({
      id: "g2",
      seed: "sec-seed",
      players: [
        { id: "p1", name: "Ryan", color: "blue" },
        { id: "p2", name: "Enemy", color: "red" },
      ],
    });

    const p1View = createPlayerView(state, "p1");
    expect(p1View.players.find((p) => p.id === "p1")!.objective.id).not.toBe("hidden");
    expect(p1View.players.find((p) => p.id === "p2")!.objective.id).toBe("hidden");
    expect(p1View.deck.length).toBe(0);
  });

  it("calculates reinforcements with floor(territories/2) min 3 + continent bonus", () => {
    const state = createGame({
      id: "g3",
      seed: "reinf-seed",
      players: [
        { id: "p1", name: "Ryan", color: "blue" },
        { id: "p2", name: "Enemy", color: "red" },
      ],
    });
    // Give p1 only South America (4 territories)
    for (const t of CLASSIC_MAP.territories) {
      state.territories[t.id].ownerId = t.continent === "south_america" ? "p1" : "p2";
    }
    const reinf = calculateTurnReinforcements(state, "p1");
    expect(reinf.baseArmies).toBe(3); // floor(4/2)=2, min 3 -> 3
    expect(reinf.continentBonus).toBe(2); // South America +2
    expect(reinf.total).toBe(5);
  });
});
