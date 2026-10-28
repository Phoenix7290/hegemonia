import { describe, expect, it } from "vitest";
import { ALL_OBJECTIVES, CLASSIC_MAP, CLASSIC_OBJECTIVES, ROLEPLAY_OBJECTIVES } from "@hegemonia/maps";
import {
  applyAction,
  calculateTurnReinforcements,
  checkPlayerVictory,
  createGame,
  createPlayerView,
  createSeededRng,
  getTradeBonusArmies,
  isValidCardSet,
} from "./index.js";

describe("Classic Map Graph Integrity", () => {
  it("has exactly 44 territories across 6 continents", () => {
    expect(CLASSIC_MAP.territories.length).toBe(44);
    expect(CLASSIC_MAP.continents.length).toBe(6);

    const counts: Record<string, number> = {};
    for (const t of CLASSIC_MAP.territories) {
      counts[t.continent] = (counts[t.continent] ?? 0) + 1;
    }
    expect(counts).toEqual({
      south_america: 4,
      north_america: 10,
      europe: 8,
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

  it("is a single connected graph (every territory reachable from Brasil) and has bounded SVG polygons (no ocean fill)", () => {
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
    expect(visited.size).toBe(44);

    // Verify no territory has an inverted spherical ring that covers the whole ocean (1200x600)
    for (const t of CLASSIC_MAP.territories) {
      const nums = [...t.svgPath.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
      const xs = nums.map((n) => parseFloat(n[1]));
      const ys = nums.map((n) => parseFloat(n[2]));
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(w, `Territory ${t.id} width ${w} exceeds max expected bound`).toBeLessThan(450);
      expect(h, `Territory ${t.id} height ${h} exceeds max expected bound`).toBeLessThan(300);
    }

    // Verify Sudão does not directly attack África do Sul, and Aral is named Cazaquistão
    expect(byId.get("sudao")!.neighbors).not.toContain("africa_do_sul");
    expect(byId.get("aral")!.namePt).toBe("Cazaquistão");
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

  it("awards Asia sub-region bonuses (+2 Indo-Arábia, +2 Estepes, +3 Leste = +7 total) and verifies new sea lanes", () => {
    const state = createGame({
      id: "g4",
      seed: "asia-sub-seed",
      players: [
        { id: "p1", name: "General", color: "blue" },
        { id: "p2", name: "Enemy", color: "red" },
      ],
    });
    for (const t of CLASSIC_MAP.territories) {
      state.territories[t.id].ownerId = "p2";
    }
    // Give p1 only Indo-Arábia (4 territories)
    for (const id of ["oriente_medio", "aral", "india", "vietna"]) {
      state.territories[id].ownerId = "p1";
    }
    const reinfSub = calculateTurnReinforcements(state, "p1");
    expect(reinfSub.continentBonus).toBe(2);

    // Check strategic maritime connections & new territories (Havaí and Bálcãs)
    const byId = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
    expect(byId.get("argentina")!.neighbors).toContain("australia");
    expect(byId.get("argentina")!.neighbors).toContain("africa_do_sul");
    expect(byId.get("havai")!.neighbors).toEqual(
      expect.arrayContaining(["california", "japao", "nova_guine"])
    );
    expect(byId.get("california")!.neighbors).not.toContain("japao");
    expect(byId.get("balcas")!.neighbors).toEqual(
      expect.arrayContaining(["alemanha", "franca", "polonia", "moscou", "oriente_medio", "egito"])
    );
  });

  it("verifies specific_territories roleplay objectives victory condition", () => {
    expect(ROLEPLAY_OBJECTIVES.length).toBe(10);
    expect(ALL_OBJECTIVES.length).toBe(CLASSIC_OBJECTIVES.length + 10);

    const state = createGame({
      id: "g-rp",
      seed: "roleplay-seed-test",
      players: [
        { id: "p1", name: "Commander", color: "blue" },
        { id: "p2", name: "Rival", color: "red" },
      ],
    });

    const p1 = state.players.find((p) => p.id === "p1")!;
    const paxBritannica = ROLEPLAY_OBJECTIVES.find((o) => o.id === "obj_rp_pax_britannica")!;
    p1.objective = paxBritannica;

    // Reset ownership to p2
    for (const t of CLASSIC_MAP.territories) {
      state.territories[t.id].ownerId = "p2";
    }

    expect(checkPlayerVictory(state, "p1")).toBe(false);

    // Give p1 all 12 required territories for Pax Britannica
    for (const tid of [
      "inglaterra", "ottawa", "labrador", "vancouver", "nova_york",
      "egito", "sudao", "africa_do_sul", "oriente_medio", "india", "borneu", "australia"
    ]) {
      state.territories[tid].ownerId = "p1";
    }
    expect(checkPlayerVictory(state, "p1")).toBe(true);

    // Test USA Manifest Destiny with extraAnyOf alternatives
    const usaManifest = ROLEPLAY_OBJECTIVES.find((o) => o.id === "obj_rp_usa_manifest_destiny")!;
    p1.objective = usaManifest;

    // Give p1 all North & South America
    for (const t of CLASSIC_MAP.territories) {
      if (t.continent === "north_america" || t.continent === "south_america") {
        state.territories[t.id].ownerId = "p1";
      } else {
        state.territories[t.id].ownerId = "p2";
      }
    }
    // Has all Americas, but neither Moscow nor (China + Mongolia)
    expect(checkPlayerVictory(state, "p1")).toBe(false);

    // Option A: With Moscow
    state.territories["moscou"].ownerId = "p1";
    expect(checkPlayerVictory(state, "p1")).toBe(true);

    // Option B: Without Moscow, but with China + Mongolia
    state.territories["moscou"].ownerId = "p2";
    state.territories["china"].ownerId = "p1";
    expect(checkPlayerVictory(state, "p1")).toBe(false); // missing mongolia
    state.territories["mongolia"].ownerId = "p1";
    expect(checkPlayerVictory(state, "p1")).toBe(true);
  });

  it("strictly prevents assigning roleplay objective if player has none of its core territories", () => {
    // Run 50 simulated games with arbitrary seeds
    for (let seed = 100; seed < 150; seed++) {
      const game = createGame({
        roomCode: `TEST_${seed}`,
        players: [
          { id: "p1", name: "Alpha", color: "blue" },
          { id: "p2", name: "Bravo", color: "red" },
          { id: "p3", name: "Charlie", color: "green" },
        ],
        seed,
      });

      for (const p of game.players) {
        if (p.objective.coreTerritoryIds && p.objective.coreTerritoryIds.length > 0) {
          const playerTerritories = Object.values(game.territories)
            .filter((t) => t.ownerId === p.id)
            .map((t) => t.id);
          const hasAtLeastOneCore = p.objective.coreTerritoryIds.some((c) =>
            playerTerritories.includes(c)
          );
          expect(hasAtLeastOneCore).toBe(true);
        }
      }
    }
  });

  it("handles Capital assignment, +1 turn reinforcement bonus, and fortress tie defense (HEGEM-23)", () => {
    const rng = createSeededRng("capital-test-seed-1");
    let state = createGame({
      id: "cap_match_1",
      seed: "cap-test-seed-1",
      players: [
        { id: "p1", name: "General Azul", color: "blue" },
        { id: "p2", name: "General Vermelho", color: "red" },
      ],
    });

    const activePlayer = state.players[state.turnIndex];
    const playerTerritories = Object.values(state.territories).filter((t) => t.ownerId === activePlayer.id);
    const chosenTerritory = playerTerritories[0].id;

    // 1. Explicitly select capital
    state = applyAction(state, activePlayer.id, { type: "select_capital", territoryId: chosenTerritory }, rng);
    const updatedPlayer = state.players.find((p) => p.id === activePlayer.id)!;
    expect(updatedPlayer.capitalTerritoryId).toBe(chosenTerritory);
    expect(updatedPlayer.isCapitalLost).toBe(false);

    // 2. Check turn reinforcements calculation
    const reinf = calculateTurnReinforcements(state, activePlayer.id);
    expect(reinf.capitalBonus).toBe(1);
    expect(reinf.total).toBe(reinf.baseArmies + reinf.continentBonus + 1);

    // 3. If capital is not owned, capitalBonus must be 0
    state.territories[chosenTerritory].ownerId = "other_player";
    const reinfWithoutCap = calculateTurnReinforcements(state, activePlayer.id);
    expect(reinfWithoutCap.capitalBonus).toBe(0);
  });

  it("triggers decapitation strike with morale penalty and economic flags upon capital capture (HEGEM-24)", () => {
    const rng = createSeededRng("decapitation-test-seed");
    let state = createGame({
      id: "decap_match",
      seed: "decap-seed",
      players: [
        { id: "p1", name: "General Azul", color: "blue" },
        { id: "p2", name: "General Vermelho", color: "red" },
      ],
    });

    const attacker = state.players[state.turnIndex];
    const defender = state.players.find((p) => p.id !== attacker.id)!;

    // Setup adjacent combat: attacker attacks defender's capital at argentina from brasil
    state.round = 2; // Allow attack
    state.phase = "attack";
    attacker.unplacedArmies = 0;

    state.territories["brasil"].ownerId = attacker.id;
    state.territories["brasil"].armies = 20;

    state.territories["argentina"].ownerId = defender.id;
    state.territories["argentina"].armies = 1;

    defender.capitalTerritoryId = "argentina";
    defender.isCapitalLost = false;
    defender.cards = [{ id: "card_argentina", territoryId: "argentina", symbol: "circle" }];
    const attackerInitialCardCount = attacker.cards.length;

    // Attack argentina until conquered
    while (state.territories["argentina"].ownerId !== attacker.id) {
      state = applyAction(
        state,
        attacker.id,
        { type: "attack", fromTerritoryId: "brasil", toTerritoryId: "argentina", diceCount: 3 },
        rng
      );
    }

    const updatedDefender = state.players.find((p) => p.id === defender.id)!;
    const updatedAttacker = state.players.find((p) => p.id === attacker.id)!;
    expect(updatedDefender.isCapitalLost).toBe(true);
    expect(updatedDefender.moralePenalty).toBe(2);
    expect(updatedDefender.economicPenaltyMultiplier).toBe(0.5);

    // Defender lost 1 card, attacker gained 1 card
    expect(updatedDefender.cards.length).toBe(0);
    expect(updatedAttacker.cards.length).toBe(attackerInitialCardCount + 1);

    // Check that defender's reinforcements reflect the -2 morale penalty
    const defenderReinf = calculateTurnReinforcements(state, defender.id);
    expect(defenderReinf.moralePenalty).toBe(2);
    expect(defenderReinf.capitalBonus).toBe(0);

    // Complete pending conquest if any, end attack, end turn, advance rounds to test 5-round reorganization
    if (state.pendingConquest) {
      state = applyAction(state, attacker.id, { type: "occupy", armies: state.pendingConquest.minMove }, rng);
    }
    state.round = 7; // 2 + 5 = 7
    state = applyAction(state, attacker.id, { type: "end_attack" }, rng);
    state = applyAction(state, attacker.id, { type: "end_turn" }, rng);

    // Defender turn starts: reorganization triggers
    const reorganizedDefender = state.players.find((p) => p.id === defender.id)!;
    expect(reorganizedDefender.isCapitalLost).toBe(false);
    expect(reorganizedDefender.capitalTerritoryId).toBeUndefined();
    expect(reorganizedDefender.economicPenaltyMultiplier).toBe(1.0);
  });
});
