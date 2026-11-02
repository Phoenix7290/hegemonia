import { describe, expect, it } from "vitest";
import { formatCompactTroops } from "@hegemonia/shared";
import { ALL_OBJECTIVES, ASIA_SUBREGIONS, CLASSIC_MAP, CLASSIC_OBJECTIVES, ROLEPLAY_OBJECTIVES } from "@hegemonia/maps";
import {
  applyAction,
  calculateTurnEconomy,
  calculateTurnReinforcements,
  checkNavalBlockade,
  checkPlayerVictory,
  createGame,
  createPlayerView,
  createSeededRng,
  damageTerritoryFortification,
  findAirMissionTargets,
  getMovedInUnits,
  getTerritoryBuildingLevel,
  getTerritoryMaxBuildingSlots,
  getTerritoryUnits,
  getTradeBonusArmies,
  isValidCardSet,
  setTerritoryUnits,
  updateSupplyAndEncirclement,
} from "./index.js";

describe("Classic Map Graph Integrity", () => {
  it("has exactly 53 territories across 6 continents", () => {
    expect(CLASSIC_MAP.territories.length).toBe(53);
    expect(CLASSIC_MAP.continents.length).toBe(6);

    const counts: Record<string, number> = {};
    for (const t of CLASSIC_MAP.territories) {
      counts[t.continent] = (counts[t.continent] ?? 0) + 1;
    }
    expect(counts).toEqual({
      south_america: 6,
      north_america: 11,
      europe: 10,
      africa: 8,
      asia: 14,
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
    expect(visited.size).toBe(53);

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
    expect(firstPlayer.unplacedArmies).toBe(9); // 53 / 3 = 17 rem 2 -> 18 territories -> floor(18/2) = 9

    const ownedTerritory = Object.values(state.territories).find(
      (t) => t.ownerId === firstPlayer.id
    )!;

    state = applyAction(
      state,
      firstPlayer.id,
      { type: "deploy", territoryId: ownedTerritory.id, armies: 9 },
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
    // Give p1 only South America (6 territories)
    for (const t of CLASSIC_MAP.territories) {
      state.territories[t.id].ownerId = t.continent === "south_america" ? "p1" : "p2";
    }
    const reinf = calculateTurnReinforcements(state, "p1");
    expect(reinf.baseArmies).toBe(3); // floor(6/2)=3, min 3 -> 3
    expect(reinf.continentBonus).toBe(3); // South America +3
    expect(reinf.total).toBe(6);
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
    expect(byId.get("patagonia")!.neighbors).toContain("australia");
    expect(byId.get("patagonia")!.neighbors).toContain("africa_do_sul");
    expect(byId.get("havai")!.neighbors).toEqual(
      expect.arrayContaining(["california", "japao", "nova_guine"])
    );
    expect(byId.get("california")!.neighbors).not.toContain("japao");
    expect(byId.get("balcas")!.neighbors).toEqual(
      expect.arrayContaining(["alemanha", "italia", "polonia", "moscou", "oriente_medio", "egito"])
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

    // Give p1 all 13 required territories for Pax Britannica
    for (const tid of [
      "inglaterra", "ottawa", "labrador", "vancouver", "nova_york",
      "egito", "sudao", "mocambique", "africa_do_sul", "oriente_medio", "india", "borneu", "australia"
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

    // Option B: Without Moscow, but with China + Beijing + Mongolia
    state.territories["moscou"].ownerId = "p2";
    state.territories["china"].ownerId = "p1";
    state.territories["pequim"].ownerId = "p1";
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

    // Setup adjacent combat: attacker attacks defender's capital at argentina from sao_paulo
    state.round = 2; // Allow attack
    state.phase = "attack";
    attacker.unplacedArmies = 0;

    state.territories["sao_paulo"].ownerId = attacker.id;
    state.territories["sao_paulo"].armies = 20;

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
        { type: "attack", fromTerritoryId: "sao_paulo", toTerritoryId: "argentina", diceCount: 3 },
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

describe("Diplomacy, Treaties, World Tension and Coalitions", () => {
  it("allows proposing and accepting a NAP, and blocks attacks between signers", () => {
    const rng = createSeededRng("diplomacy-nap-test");
    let state = createGame({
      players: [
        { id: "p1", name: "Alpha", isBot: false },
        { id: "p2", name: "Bravo", isBot: false },
        { id: "p3", name: "Charlie", isBot: false },
      ],
      seed: "diplomacy-nap-test",
    });

    // p1 proposes NAP to p2
    state = applyAction(state, "p1", {
      type: "propose_treaty",
      targetPlayerId: "p2",
      treatyType: "nap",
    }, rng);

    expect(state.treaties.length).toBe(1);
    expect(state.treaties[0].status).toBe("pending");

    // p2 accepts NAP out of turn
    state = applyAction(state, "p2", {
      type: "accept_treaty",
      treatyId: state.treaties[0].id,
    }, rng);

    expect(state.treaties[0].status).toBe("active");

    // Advance to round 2 attack phase for p1
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.players[state.turnIndex].unplacedArmies = 0;
    state.territories["sao_paulo"].ownerId = "p1";
    state.territories["sao_paulo"].armies = 10;
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 2;

    // Attacking p2 should throw error due to active treaty
    expect(() =>
      applyAction(state, "p1", {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
      }, rng)
    ).toThrow(/tratado de paz ativo/);
  });

  it("blocks Alliance proposals when World Tension < 50% and allows when >= 50%", () => {
    const rng = createSeededRng("alliance-tension-test");
    let state = createGame({
      players: [
        { id: "p1", name: "Alpha", isBot: false },
        { id: "p2", name: "Bravo", isBot: false },
      ],
      seed: "alliance-tension-test",
    });

    state.worldTension = 40;
    expect(() =>
      applyAction(state, "p1", {
        type: "propose_treaty",
        targetPlayerId: "p2",
        treatyType: "alliance",
      }, rng)
    ).toThrow(/50%/);

    state.worldTension = 50;
    state = applyAction(state, "p1", {
      type: "propose_treaty",
      targetPlayerId: "p2",
      treatyType: "alliance",
    }, rng);

    expect(state.treaties[0].type).toBe("alliance");
    expect(state.treaties[0].status).toBe("pending");
  });

  it("penalizes treaty breaking (+35% infamy, +15% tension) and allows attack afterwards", () => {
    const rng = createSeededRng("treaty-betrayal-test");
    let state = createGame({
      players: [
        { id: "p1", name: "Alpha", isBot: false },
        { id: "p2", name: "Bravo", isBot: false },
      ],
      seed: "treaty-betrayal-test",
    });

    state.treaties.push({
      id: "treaty_test_1",
      fromPlayerId: "p1",
      toPlayerId: "p2",
      type: "nap",
      status: "active",
      createdRound: 1,
    });

    expect(state.players[0].infamy).toBe(0);
    expect(state.worldTension).toBe(0);

    // p1 breaks treaty
    state = applyAction(state, "p1", {
      type: "break_treaty",
      treatyId: "treaty_test_1",
    }, rng);

    expect(state.players[0].infamy).toBe(35);
    expect(state.worldTension).toBe(5);
    expect(state.treaties.length).toBe(0);
  });

  it("manages dynamic coalitions and applies Last Stand bonus in combat", () => {
    const rng = createSeededRng("coalition-combat-test");
    let state = createGame({
      players: [
        { id: "p1", name: "Warmonger", isBot: false },
        { id: "p2", name: "DefenderA", isBot: false },
        { id: "p3", name: "DefenderB", isBot: false },
        { id: "p4", name: "DefenderC", isBot: false },
      ],
      seed: "coalition-combat-test",
    });

    // P1 infamy is 0 -> cannot form coalition
    expect(() =>
      applyAction(state, "p2", {
        type: "form_coalition",
        targetPlayerId: "p1",
      }, rng)
    ).toThrow(/50%/);

    // Give P1 50% infamy -> allows 2-member coalition
    state.players[0].infamy = 50;
    state = applyAction(state, "p2", {
      type: "form_coalition",
      targetPlayerId: "p1",
    }, rng);
    expect(state.coalitions.length).toBe(1);
    expect(state.coalitions[0].memberPlayerIds).toEqual(["p2"]);

    // p3 joins coalition (now 2 members)
    state = applyAction(state, "p3", {
      type: "join_coalition",
      coalitionId: state.coalitions[0].id,
    }, rng);
    expect(state.coalitions[0].memberPlayerIds.length).toBe(2);

    // p4 cannot join because infamy is 50% (cap is 2)
    expect(() =>
      applyAction(state, "p4", {
        type: "join_coalition",
        coalitionId: state.coalitions[0].id,
      }, rng)
    ).toThrow(/limite máximo/);

    // Set p1 infamy to 100% -> p4 can now join (cap 3)
    state.players[0].infamy = 100;
    state = applyAction(state, "p4", {
      type: "join_coalition",
      coalitionId: state.coalitions[0].id,
    }, rng);
    expect(state.coalitions[0].memberPlayerIds.length).toBe(3);

    // Mutual non-aggression between coalition members (p2 attacking p3)
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p2");
    state.players[state.turnIndex].unplacedArmies = 0;
    state.territories["sao_paulo"].ownerId = "p2";
    state.territories["sao_paulo"].armies = 5;
    state.territories["argentina"].ownerId = "p3";
    state.territories["argentina"].armies = 2;

    expect(() =>
      applyAction(state, "p2", {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
      }, rng)
    ).toThrow(/mesma coalizão/);

    // When p2 attacks p1 (the 100% infamy hegemon), p1 gets +2 Last Stand modifier
    state.territories["argentina"].ownerId = "p1";
    state = applyAction(state, "p2", {
      type: "attack",
      fromTerritoryId: "sao_paulo",
      toTerritoryId: "argentina",
      diceCount: 1,
    }, rng);

    // Find the combat log or verify state
    const combatLog = state.log[state.log.length - 1];
    expect(combatLog).toContain("Mobilização");
  });

  it("increases Hegemon infamy (+5%) and tension (+0.5%) upon round advance when holding >= 38% of territories", () => {
    const rng = createSeededRng("hegemon-round-advance");
    let state = createGame({
      players: [
        { id: "p1", name: "Hegemon", isBot: false },
        { id: "p2", name: "Minor", isBot: false },
      ],
      seed: "hegemon-round-advance",
    });

    const territoryKeys = Object.keys(state.territories);
    const numToHold = Math.ceil(territoryKeys.length * 0.4); // 40% > 38%
    for (let i = 0; i < numToHold; i++) {
      state.territories[territoryKeys[i]].ownerId = "p1";
    }

    state.phase = "deploy";
    state.players[0].unplacedArmies = 0;
    state.turnIndex = 0;
    state = applyAction(state, "p1", { type: "end_turn" }, rng);

    // P2 turn now
    state.players[1].unplacedArmies = 0;
    state = applyAction(state, "p2", { type: "end_turn" }, rng);

    // Round advanced to 2
    expect(state.round).toBe(2);
    expect(state.worldTension).toBe(1.5);
    expect(state.players[0].infamy).toBe(5);
  });
});

describe("HEGEM-56: Cartographic Resource & Coastal Matrix (53 Territories)", () => {
  it("distributes 18 Steel, 15 Oil, 11 Gold, 19 Trade Hubs (+24$), 45 Coastal and 8 Landlocked territories", () => {
    const steelTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "steel");
    const oilTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "oil");
    const goldTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "gold");
    const tradeTerrs = CLASSIC_MAP.territories.filter((t) => (t.tradeBonus ?? 0) > 0);
    const coastalTerrs = CLASSIC_MAP.territories.filter((t) => t.isCoastal === true);
    const landlockedTerrs = CLASSIC_MAP.territories.filter((t) => t.isCoastal === false);

    expect(steelTerrs.length).toBe(18);
    expect(oilTerrs.length).toBe(15);
    expect(goldTerrs.length).toBe(11);
    expect(tradeTerrs.length).toBe(19);
    expect(tradeTerrs.reduce((sum, t) => sum + (t.tradeBonus ?? 0), 0)).toBe(24);
    expect(coastalTerrs.length).toBe(45);
    expect(landlockedTerrs.map((t) => t.id).sort()).toEqual(
      ["aral", "mongolia", "moscou", "omsk", "ottawa", "siberia", "tchita", "xinjiang"].sort()
    );
  });

  it("enforces asymmetric continental resource scarcity (Europe has 0 native Oil, East Asia has only Xinjiang Oil)", () => {
    const europeOil = CLASSIC_MAP.territories.filter(
      (t) => t.continent === "europe" && t.resource === "oil"
    );
    const europeSteel = CLASSIC_MAP.territories.filter(
      (t) => t.continent === "europe" && t.resource === "steel"
    );
    expect(europeOil.length).toBe(0);
    expect(europeSteel.length).toBe(6);

    const eastAsiaIds = ASIA_SUBREGIONS.find((s) => s.id === "asia_east")!.territoryIds;
    const eastAsiaOil = CLASSIC_MAP.territories.filter(
      (t) => eastAsiaIds.includes(t.id) && t.resource === "oil"
    );
    expect(eastAsiaOil.map((t) => t.id)).toEqual(["xinjiang"]);
  });
});

describe("HEGEM-18: Core War Economy (Money, Steel, Oil, Scarce Gold)", () => {
  it("calculates Capital (+3$), Trade Hubs, Gold passive (+2$ & +1 Gold), and 0.5x decapitation penalty", () => {
    let state = createGame({
      id: "econ-test",
      players: [
        { id: "p1", name: "Commander 1", color: "blue" },
        { id: "p2", name: "Commander 2", color: "red" },
      ],
      seed: "econ-seed-1",
    });

    // Clear ownership and assign specific territories to p1:
    // suecia (steel), venezuela (oil), peru (gold -> +1 gold, +2$), egito (oil + tradeBonus 2$)
    for (const t of Object.values(state.territories)) {
      t.ownerId = "p2";
      t.armies = 2;
    }
    state.territories["suecia"].ownerId = "p1";
    state.territories["venezuela"].ownerId = "p1";
    state.territories["peru"].ownerId = "p1";
    state.territories["egito"].ownerId = "p1";

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "suecia";
    p1.isCapitalLost = false;
    p1.economicPenaltyMultiplier = 1.0;

    const econ = calculateTurnEconomy(state, "p1");
    expect(econ.capitalMoney).toBe(3);
    expect(econ.tradeHubMoney).toBe(2); // egito (+2$)
    expect(econ.goldPassiveMoney).toBe(2); // peru (+2$)
    expect(econ.grossMoney).toBe(7);
    expect(econ.netMoney).toBe(7);
    expect(econ.steel).toBe(1); // suecia
    expect(econ.oil).toBe(2); // venezuela + egito
    expect(econ.gold).toBe(1); // peru

    // Simulate Capital Decapitation (50% penalty on Money)
    p1.isCapitalLost = true;
    p1.economicPenaltyMultiplier = 0.5;
    const penalizedEcon = calculateTurnEconomy(state, "p1");
    expect(penalizedEcon.grossMoney).toBe(7);
    expect(penalizedEcon.netMoney).toBe(3); // floor(7 * 0.5)
    expect(penalizedEcon.steel).toBe(1);
    expect(penalizedEcon.oil).toBe(2);
    expect(penalizedEcon.gold).toBe(1);
  });

  it("grants +3$ immediately when establishing a Capital for the first time", () => {
    const rng = createSeededRng("capital-treasury-seed");
    let state = createGame({
      id: "cap-treasury",
      players: [
        { id: "p1", name: "Alpha", color: "blue" },
        { id: "p2", name: "Bravo", color: "red" },
      ],
      seed: "capital-treasury-seed",
    });

    const activePlayer = state.players[state.turnIndex];
    const ownedTerrId = Object.values(state.territories).find(
      (t) => t.ownerId === activePlayer.id
    )!.id;
    const moneyBefore = activePlayer.resources.money;

    state = applyAction(
      state,
      activePlayer.id,
      { type: "select_capital", territoryId: ownedTerrId },
      rng
    );

    const updatedPlayer = state.players.find((p) => p.id === activePlayer.id)!;
    expect(updatedPlayer.capitalTerritoryId).toBe(ownedTerrId);
    expect(updatedPlayer.resources.money).toBe(moneyBefore + 3);
  });

  it("allows buying 1 supply card per turn with Gold (2 Gold OR 1 Gold + $4) during deploy phase", () => {
    const rng = createSeededRng("gold-card-buy-seed");
    let state = createGame({
      id: "gold-card-test",
      players: [
        { id: "p1", name: "Auric", color: "yellow" },
        { id: "p2", name: "Iron", color: "black" },
      ],
      seed: "gold-card-buy-seed",
    });

    const activeId = state.players[state.turnIndex].id;
    const activePlayer = state.players[state.turnIndex];
    activePlayer.resources = { money: 10, steel: 0, oil: 0, gold: 3 };
    const initialDeckCount = state.deck.length;

    // Buy card with 2 Gold
    state = applyAction(
      state,
      activeId,
      { type: "buy_card_with_gold", paymentMode: "gold_only" },
      rng
    );

    const afterFirstBuy = state.players.find((p) => p.id === activeId)!;
    expect(afterFirstBuy.cards.length).toBe(1);
    expect(afterFirstBuy.resources.gold).toBe(1);
    expect(afterFirstBuy.resources.money).toBe(10);
    expect(afterFirstBuy.boughtCardWithGoldThisTurn).toBe(true);
    expect(state.deck.length).toBe(initialDeckCount - 1);

    // Attempting a second purchase in the same turn must fail
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "buy_card_with_gold", paymentMode: "gold_and_money" },
        rng
      )
    ).toThrow(/1 carta de suprimento com Ouro por turno/);

    // Reset flag to test gold_and_money mode (1 Gold + $4)
    state.players[state.turnIndex].boughtCardWithGoldThisTurn = false;
    state = applyAction(
      state,
      activeId,
      { type: "buy_card_with_gold", paymentMode: "gold_and_money" },
      rng
    );
    const afterSecondBuy = state.players.find((p) => p.id === activeId)!;
    expect(afterSecondBuy.cards.length).toBe(2);
    expect(afterSecondBuy.resources.gold).toBe(0);
    expect(afterSecondBuy.resources.money).toBe(6);
  });
});

describe("Territorial Infrastructure & Building System (HEGEM-32)", () => {
  it("enforces slot limits (2 regular, 3 in active Capital), costs in $ and Steel, and coastal restriction for Ports", () => {
    const rng = createSeededRng("hegem-32-slots");
    let state = createGame({
      id: "g_buildings_slots",
      seed: "hegem-32-slots",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    const activeId = state.players[state.turnIndex].id;
    const activePlayer = state.players.find((p) => p.id === activeId)!;

    // Assign Brasil (coastal, steel) and Moscou (inland, steel) to activeId
    state.territories["brasil"].ownerId = activeId;
    state.territories["moscou"].ownerId = activeId;
    activePlayer.capitalTerritoryId = "brasil";
    activePlayer.isCapitalLost = false;
    activePlayer.resources = { money: 40, steel: 10, oil: 5, gold: 2 };

    expect(getTerritoryMaxBuildingSlots(state, "brasil")).toBe(3);
    expect(getTerritoryMaxBuildingSlots(state, "moscou")).toBe(2);

    // 1. Inland territory (Moscou) cannot build a Naval Port
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "build_structure", territoryId: "moscou", buildingType: "port" },
        rng
      )
    ).toThrow(/costeiros/i);

    // 2. Build Market ($5) and Industry ($6 + 1 Steel) in Moscou (reaches 2/2 slots)
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "moscou", buildingType: "market" },
      rng
    );
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "moscou", buildingType: "industry" },
      rng
    );

    expect(state.territories["moscou"].buildings?.length).toBe(2);
    // Duplicate building type rejected
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "build_structure", territoryId: "moscou", buildingType: "market" },
        rng
      )
    ).toThrow(/já possui/i);
    // 3rd building on regular territory rejected (max 2 slots)
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "build_structure", territoryId: "moscou", buildingType: "airfield" },
        rng
      )
    ).toThrow(/Limite máximo de 2/i);

    // 3. Active Capital (Brasil) supports 3 building slots (Port + Industry + Airfield)
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "brasil", buildingType: "port" },
      rng
    );
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "brasil", buildingType: "industry" },
      rng
    );
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "brasil", buildingType: "airfield" },
      rng
    );
    expect(state.territories["brasil"].buildings?.length).toBe(3);

    // 4th building on Capital rejected (max 3 slots)
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "build_structure", territoryId: "brasil", buildingType: "market" },
        rng
      )
    ).toThrow(/Limite máximo de 3/i);
  });

  it("calculates economic income and resource doubling from Market, Industry, and Port", () => {
    const state = createGame({
      id: "g_buildings_econ",
      seed: "hegem-32-econ",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    for (const t of Object.values(state.territories)) {
      t.ownerId = "p2";
      t.buildings = [];
    }

    // Give p1:
    // - suecia (Steel, coastal, no tradeBonus): Industry -> +2 Steel
    // - havai (No natural resource, coastal, tradeBonus +1$): Industry (+2$) + Market (+2$) + Port (+1$ trade hub bonus)
    // - venezuela (Oil): Industry -> +2 Oil
    state.territories["suecia"].ownerId = "p1";
    state.territories["suecia"].armies = 2;
    state.territories["suecia"].buildings = [{ type: "industry", level: 1 }];

    state.territories["havai"].ownerId = "p1";
    state.territories["havai"].armies = 2;
    state.territories["havai"].buildings = [
      { type: "industry", level: 1 },
      { type: "market", level: 1 },
      { type: "port", level: 1 },
    ];

    state.territories["venezuela"].ownerId = "p1";
    state.territories["venezuela"].armies = 2;
    state.territories["venezuela"].buildings = [{ type: "industry", level: 1 }];

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "havai";
    p1.isCapitalLost = false;

    const econ = calculateTurnEconomy(state, "p1");
    expect(econ.capitalMoney).toBe(3);
    expect(econ.tradeHubMoney).toBe(1); // Havai tradeBonus
    expect(econ.buildingMoney).toBe(5); // Market (+2$) + Non-resource Industry (+2$) + Port in Trade Hub (+1$)
    expect(econ.grossMoney).toBe(9);
    expect(econ.netMoney).toBe(9);
    expect(econ.steel).toBe(2); // Suecia with Industry -> +2 Steel
    expect(econ.oil).toBe(2); // Venezuela with Industry -> +2 Oil
  });

  it("applies Fortification Level 1 & Level 2 combat modifiers, preserves captured structures, and degrades Level 2 Fortress on conquest", () => {
    const rng = createSeededRng("hegem-32-fort");
    let state = createGame({
      id: "g_fort_combat",
      seed: "hegem-32-fort",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    state.round = 2;
    state.phase = "attack";
    const activeId = state.players[state.turnIndex].id;
    const defenderId = state.players.find((p) => p.id !== activeId)!.id;
    const activePlayer = state.players.find((p) => p.id === activeId)!;
    activePlayer.resources = { money: 20, steel: 5, oil: 0, gold: 0 };

    // Build Level 1 Casamata ($4) and upgrade to Level 2 Fortaleza ($4 + 1 Steel) on owned territory first
    state.territories["sao_paulo"].ownerId = activeId;
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "sao_paulo", buildingType: "fortification" },
      rng
    );
    expect(getTerritoryBuildingLevel(state.territories["sao_paulo"], "fortification")).toBe(1);

    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "sao_paulo", buildingType: "fortification" },
      rng
    );
    expect(getTerritoryBuildingLevel(state.territories["sao_paulo"], "fortification")).toBe(2);
    expect(state.territories["sao_paulo"].buildings?.length).toBe(1); // Upgrade reuses the same slot!

    // Set up Argentina as defender territory with Level 2 Fortress + Market and 1 army
    state.territories["sao_paulo"].armies = 20;
    state.territories["argentina"].ownerId = defenderId;
    state.territories["argentina"].armies = 1;
    state.territories["argentina"].buildings = [
      { type: "fortification", level: 2 },
      { type: "market", level: 1 },
    ];

    // Attack Argentina until conquered
    for (let i = 0; i < 20 && state.territories["argentina"].ownerId !== activeId; i++) {
      state.territories["sao_paulo"].armies = 10;
      state = applyAction(
        state,
        activeId,
        { type: "attack", fromTerritoryId: "sao_paulo", toTerritoryId: "argentina" },
        rng
      );
      expect(state.lastCombat?.fortificationLevel).toBe(2);
    }

    expect(state.territories["argentina"].ownerId).toBe(activeId);
    // Market is captured intact, while Level 2 Fortress degraded to Level 1 Casamata
    expect(getTerritoryBuildingLevel(state.territories["argentina"], "market")).toBe(1);
    expect(getTerritoryBuildingLevel(state.territories["argentina"], "fortification")).toBe(1);

    // Bombardment damage helper degrades L1 -> destroyed
    expect(damageTerritoryFortification(state.territories["argentina"])).toBe("destroyed");
    expect(getTerritoryBuildingLevel(state.territories["argentina"], "fortification")).toBe(0);
  });

  it("enables Strategic Airlift (airlift) between two allied Airfields during maneuver phase", () => {
    const rng = createSeededRng("hegem-32-airlift");
    let state = createGame({
      id: "g_airlift",
      seed: "hegem-32-airlift",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    state.round = 2;
    state.phase = "maneuver";
    const activeId = state.players[state.turnIndex].id;

    // Give active player Brasil (South America) and Japão (East Asia) - non-adjacent continents
    state.territories["brasil"].ownerId = activeId;
    state.territories["brasil"].armies = 5;
    state.territories["brasil"].buildings = [{ type: "airfield", level: 1 }];

    state.territories["japao"].ownerId = activeId;
    state.territories["japao"].armies = 1;
    state.territories["japao"].buildings = [];

    // Cannot airlift if destination lacks an Airfield
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "airlift", fromTerritoryId: "brasil", toTerritoryId: "japao", armies: 2 },
        rng
      )
    ).toThrow(/Aeródromo/i);

    // Add Airfield to Japão and perform airlift
    state.territories["japao"].buildings = [{ type: "airfield", level: 1 }];
    state = applyAction(
      state,
      activeId,
      { type: "airlift", fromTerritoryId: "brasil", toTerritoryId: "japao", armies: 2 },
      rng
    );

    expect(state.territories["brasil"].armies).toBe(3);
    expect(state.territories["japao"].armies).toBe(3);
    expect(state.territories["brasil"].airliftedThisTurn).toBe(true);

    // Cannot airlift a second time from the same Airfield in the same turn
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "airlift", fromTerritoryId: "brasil", toTerritoryId: "japao", armies: 1 },
        rng
      )
    ).toThrow(/já realizou/i);
  });

  it("handles AoE2 dynamic global market pricing, buy/sell variations, and access restrictions (HEGEM-22)", () => {
    const rng = createSeededRng("hegem-22-market");
    let state = createGame({
      id: "g_market",
      seed: "hegem-22-market",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    const activeId = state.players[state.turnIndex].id;
    const player = state.players.find((p) => p.id === activeId)!;

    // Ensure no markets initially
    for (const t of Object.values(state.territories)) {
      t.buildings = [];
    }

    player.resources = { money: 50, steel: 5, oil: 5, gold: 5 };

    // Cannot trade without a Market building
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "market_trade", resource: "steel", operation: "buy", quantity: 1 },
        rng
      )
    ).toThrow(/Mercado construído/i);

    // Give player a territory with a Market
    const ownedTerr = Object.values(state.territories).find((t) => t.ownerId === activeId)!;
    ownedTerr.buildings = [{ type: "market", level: 1 }];

    // Initial steel price: buy $4, sell $3
    expect(state.marketPrices.steel.buyPrice).toBe(4);
    expect(state.marketPrices.steel.sellPrice).toBe(3);

    // Buy 2 steel: unit 1 costs $4 (prices become buy $5, sell $4), unit 2 costs $5 (prices become buy $6, sell $5) -> total $9
    state = applyAction(
      state,
      activeId,
      { type: "market_trade", resource: "steel", operation: "buy", quantity: 2 },
      rng
    );

    const updatedP1 = state.players.find((p) => p.id === activeId)!;
    expect(updatedP1.resources.money).toBe(50 - 9);
    expect(updatedP1.resources.steel).toBe(5 + 2);
    expect(state.marketPrices.steel.buyPrice).toBe(6);
    expect(state.marketPrices.steel.sellPrice).toBe(5);

    // Sell 1 steel: unit 1 sells for $5 -> prices become sell $4, buy $5 -> revenue $5
    state = applyAction(
      state,
      activeId,
      { type: "market_trade", resource: "steel", operation: "sell", quantity: 1 },
      rng
    );

    const updatedP1AfterSell = state.players.find((p) => p.id === activeId)!;
    expect(updatedP1AfterSell.resources.money).toBe(41 + 5);
    expect(updatedP1AfterSell.resources.steel).toBe(6);
    expect(state.marketPrices.steel.buyPrice).toBe(5);
    expect(state.marketPrices.steel.sellPrice).toBe(4);

    // Dynamic Gold pricing: step $2, base buy $8, sell $6
    expect(state.marketPrices.gold.buyPrice).toBe(8);
    expect(state.marketPrices.gold.sellPrice).toBe(6);

    state = applyAction(
      state,
      activeId,
      { type: "market_trade", resource: "gold", operation: "buy", quantity: 1 },
      rng
    );
    expect(state.marketPrices.gold.buyPrice).toBe(10);
    expect(state.marketPrices.gold.sellPrice).toBe(8);
  });

  it("establishes Allied Investment Routes between treatied nations with Markets, generates escalating income, and dissolves upon treaty breach (HEGEM-22)", () => {
    const rng = createSeededRng("hegem-22-investment");
    let state = createGame({
      id: "g_inv",
      seed: "hegem-22-investment",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    const p1 = state.players[0];
    const p2 = state.players[1];

    p1.resources = { money: 10, steel: 0, oil: 0, gold: 0 };
    p2.resources = { money: 10, steel: 0, oil: 0, gold: 0 };

    // Give both players a territory with a Market
    const terr1 = Object.values(state.territories).find((t) => t.ownerId === p1.id)!;
    const terr2 = Object.values(state.territories).find((t) => t.ownerId === p2.id)!;
    terr1.buildings = [{ type: "market", level: 1 }];
    terr2.buildings = [{ type: "market", level: 1 }];

    // Cannot propose without a bilateral treaty
    expect(() =>
      applyAction(state, p1.id, { type: "propose_investment", targetPlayerId: p2.id }, rng)
    ).toThrow(/tratado ativo prévio/i);

    // Establish Non-Aggression Pact
    state = applyAction(
      state,
      p1.id,
      { type: "propose_treaty", targetPlayerId: p2.id, treatyType: "nap" },
      rng
    );
    const treatyProposal = state.treaties.find((t) => t.status === "pending")!;
    state = applyAction(state, p2.id, { type: "accept_treaty", treatyId: treatyProposal.id }, rng);

    // Now propose investment route
    state = applyAction(state, p1.id, { type: "propose_investment", targetPlayerId: p2.id }, rng);
    expect(state.investmentRoutes.length).toBe(1);
    expect(state.investmentRoutes[0].status).toBe("pending");

    // Bob accepts investment route: both pay $3 opening capital
    const route = state.investmentRoutes[0];
    state = applyAction(state, p2.id, { type: "accept_investment", routeId: route.id }, rng);

    expect(state.players.find((p) => p.id === p1.id)!.resources.money).toBe(7);
    expect(state.players.find((p) => p.id === p2.id)!.resources.money).toBe(7);
    expect(state.investmentRoutes[0].status).toBe("active");
    expect(state.investmentRoutes[0].roundsActive).toBe(0);

    // Check turn economy with active route: +$2 for route (plus +$2 market and +$3 capital)
    const econ = calculateTurnEconomy(state, p1.id);
    expect(econ.investmentMoney).toBe(2);

    // After 3 rounds active, escalates to +$3
    state.investmentRoutes[0].roundsActive = 3;
    const escalatedEcon = calculateTurnEconomy(state, p1.id);
    expect(escalatedEcon.investmentMoney).toBe(3);

    // If Alice breaks treaty, the route is immediately dissolved and confiscated
    const activeTreaty = state.treaties.find((t) => t.status === "active")!;
    state = applyAction(state, p1.id, { type: "break_treaty", treatyId: activeTreaty.id }, rng);

    expect(state.investmentRoutes.length).toBe(0);
    const dissolvedEcon = calculateTurnEconomy(state, p1.id);
    expect(dissolvedEcon.investmentMoney).toBe(0);
  });

  it("executes Border Trade between adjacent territories without impacting market inflation (HEGEM-22)", () => {
    const rng = createSeededRng("hegem-22-border-trade");
    let state = createGame({
      id: "g_btrade",
      seed: "hegem-22-border-trade",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    const p1 = state.players[0];
    const p2 = state.players[1];

    p1.resources = { money: 10, steel: 3, oil: 0, gold: 0 };
    p2.resources = { money: 15, steel: 0, oil: 0, gold: 0 };

    // Sao Paulo (p1) is adjacent to Argentina (p2)
    state.territories["sao_paulo"].ownerId = p1.id;
    state.territories["sao_paulo"].armies = 3;

    state.territories["argentina"].ownerId = p2.id;
    state.territories["argentina"].armies = 2;

    const initialSteelBuyPrice = state.marketPrices.steel.buyPrice;

    // Alice proposes border trade: 1 steel for $6
    state = applyAction(
      state,
      p1.id,
      {
        type: "propose_border_trade",
        targetPlayerId: p2.id,
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        resource: "steel",
        price: 6,
      },
      rng
    );

    expect(state.borderTrades.length).toBe(1);
    expect(state.borderTrades[0].status).toBe("pending");

    // Bob accepts the deal
    const dealId = state.borderTrades[0].id;
    state = applyAction(state, p2.id, { type: "accept_border_trade", dealId }, rng);

    // Resources transferred: Bob paid $6 and gained 1 steel; Alice gained $6 and lost 1 steel
    expect(state.players.find((p) => p.id === p2.id)!.resources.money).toBe(9);
    expect(state.players.find((p) => p.id === p2.id)!.resources.steel).toBe(1);
    expect(state.players.find((p) => p.id === p1.id)!.resources.money).toBe(16);
    expect(state.players.find((p) => p.id === p1.id)!.resources.steel).toBe(2);

    // Global market price remains untouched (zero inflation from border trade)
    expect(state.marketPrices.steel.buyPrice).toBe(initialSteelBuyPrice);
  });
});

describe("Combined Arms and Infantry Escort (HEGEM-27)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  const createUnitTestState = (phase: "deploy" | "attack" | "maneuver") => {
    const state = createGame({
      id: `g_units_${phase}`,
      seed: `units-${phase}`,
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = phase;
    return {
      state,
      activeId: state.players[state.turnIndex].id,
      defenderId: state.players.find((p) => p.id !== state.players[state.turnIndex].id)!.id,
    };
  };

  const combatRng = (rolls: number[]) => {
    const rng = createSeededRng("hegem-27-fixed-combat");
    rng.rollD6 = () => rolls.shift() ?? 6;
    return rng;
  };

  it("initializes infantry and reconciles legacy totals with unit compositions", () => {
    const { state } = createUnitTestState("deploy");
    for (const territory of Object.values(state.territories)) {
      expect(territory.armies).toBe(1);
      expect(getTerritoryUnits(territory)).toEqual(unitCounts(1));
      expect(getMovedInUnits(territory)).toEqual(unitCounts());
    }

    const territory = state.territories["brasil"];
    delete territory.units;
    territory.armies = 4;
    expect(getTerritoryUnits(territory)).toEqual(unitCounts(4));

    territory.units = unitCounts(1, 1);
    expect(getTerritoryUnits(territory)).toEqual(unitCounts(3, 1));
    territory.armies = 1;
    expect(getTerritoryUnits(territory)).toEqual(unitCounts(0, 1));
  });

  it("recruits all unit categories with their costs and infrastructure requirements", () => {
    const rng = createSeededRng("hegem-27-recruit");
    let { state } = createUnitTestState("deploy");
    const activeId = state.players[state.turnIndex].id;
    const player = state.players[state.turnIndex];
    player.resources = { money: 50, steel: 10, oil: 5, gold: 0 };
    state.territories["brasil"].ownerId = activeId;
    state.territories["brasil"].buildings = [];

    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "recruit_unit", territoryId: "brasil", unitType: "tank", quantity: 1 },
        rng
      )
    ).toThrow(/Indústria/);

    state.territories["brasil"].buildings = [
      { type: "industry", level: 1 },
      { type: "airfield", level: 1 },
      { type: "port", level: 1 },
    ];

    for (const unitType of ["infantry", "tank", "artillery", "aircraft", "navy"] as const) {
      state = applyAction(
        state,
        activeId,
        { type: "recruit_unit", territoryId: "brasil", unitType, quantity: 1 },
        rng
      );
    }

    expect(getTerritoryUnits(state.territories["brasil"])).toEqual(unitCounts(2, 1, 1, 1, 1));
    expect(state.territories["brasil"].armies).toBe(6);
    expect(state.players[state.turnIndex].resources).toEqual({
      money: 29,
      steel: 3,
      oil: 3,
      gold: 0,
    });
  });

  it("validates task forces and applies attacker casualties to infantry before specials", () => {
    let { state, activeId, defenderId } = createUnitTestState("attack");
    state.territories["sao_paulo"].ownerId = activeId;
    state.territories["sao_paulo"].units = unitCounts(2, 1);
    state.territories["sao_paulo"].armies = 3;
    state.territories["argentina"].ownerId = defenderId;
    state.territories["argentina"].units = unitCounts(1);
    state.territories["argentina"].armies = 1;

    expect(() =>
      applyAction(
        state,
        activeId,
        {
          type: "attack",
          fromTerritoryId: "sao_paulo",
          toTerritoryId: "argentina",
          units: unitCounts(0, 2),
        },
        combatRng([6, 1])
      )
    ).toThrow(/excede as unidades disponíveis/);

    state = applyAction(
      state,
      activeId,
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 3,
        units: unitCounts(1, 1),
      },
      combatRng([1, 6])
    );

    expect(state.lastCombat?.attackerDice).toHaveLength(2);
    expect(state.lastCombat?.attackerLossUnits).toEqual(unitCounts(1));
    expect(getTerritoryUnits(state.territories["sao_paulo"])).toEqual(unitCounts(1, 1));

    ({ state, activeId, defenderId } = createUnitTestState("attack"));
    state.territories["sao_paulo"].ownerId = activeId;
    state.territories["sao_paulo"].units = unitCounts(0, 2);
    state.territories["sao_paulo"].armies = 2;
    state.territories["argentina"].ownerId = defenderId;
    state = applyAction(
      state,
      activeId,
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 1,
        units: unitCounts(0, 1),
      },
      combatRng([1, 6])
    );

    expect(state.lastCombat?.attackerLossUnits).toEqual(unitCounts(0, 1));
    expect(getTerritoryUnits(state.territories["sao_paulo"])).toEqual(unitCounts(0, 1));
  });

  it("applies defender casualties to infantry before specials and records special losses", () => {
    let { state, activeId, defenderId } = createUnitTestState("attack");
    state.territories["sao_paulo"].ownerId = activeId;
    state.territories["sao_paulo"].armies = 3;
    state.territories["argentina"].ownerId = defenderId;
    state.territories["argentina"].units = unitCounts(1, 1);
    state.territories["argentina"].armies = 2;

    state = applyAction(
      state,
      activeId,
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 1,
        units: unitCounts(1),
      },
      combatRng([6, 1, 1])
    );

    expect(state.lastCombat?.defenderLossUnits).toEqual(unitCounts(1));
    expect(getTerritoryUnits(state.territories["argentina"])).toEqual(unitCounts(0, 1));

    state = applyAction(
      state,
      activeId,
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 1,
        units: unitCounts(1),
      },
      combatRng([6, 1])
    );

    expect(state.lastCombat?.defenderLossUnits).toEqual(unitCounts(0, 1));
    expect(state.lastCombat?.conquered).toBe(true);
    expect(getTerritoryUnits(state.territories["argentina"])).toEqual(unitCounts(1));
  });

  it("moves only surviving task-force units during conquest and composed occupation", () => {
    let { state, activeId, defenderId } = createUnitTestState("attack");
    state.territories["sao_paulo"].ownerId = activeId;
    state.territories["sao_paulo"].units = unitCounts(2, 2);
    state.territories["sao_paulo"].armies = 4;
    state.territories["argentina"].ownerId = defenderId;
    state.territories["argentina"].units = unitCounts(1);
    state.territories["argentina"].armies = 1;

    state = applyAction(
      state,
      activeId,
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 3,
        units: unitCounts(2, 1),
      },
      combatRng([6, 5, 4, 1])
    );

    expect(state.pendingConquest?.maxMove).toBe(3);
    expect(state.pendingConquest?.occupyingUnits).toEqual(unitCounts(1));
    expect(state.pendingConquest?.remainingAttackers).toEqual(unitCounts(1, 1));
    expect(getTerritoryUnits(state.territories["sao_paulo"])).toEqual(unitCounts(1, 2));

    state = applyAction(
      state,
      activeId,
      { type: "occupy", armies: 3, units: unitCounts(2, 1) },
      combatRng([])
    );

    expect(state.pendingConquest).toBeNull();
    expect(getTerritoryUnits(state.territories["sao_paulo"])).toEqual(unitCounts(0, 1));
    expect(getTerritoryUnits(state.territories["argentina"])).toEqual(unitCounts(2, 1));
    expect(state.territories["sao_paulo"].armies).toBe(1);
    expect(state.territories["argentina"].armies).toBe(3);
  });

  it("preserves compositions in maneuver, blocks second movement, and restricts airlift to infantry", () => {
    let { state, activeId } = createUnitTestState("maneuver");
    for (const territoryId of ["sao_paulo", "argentina", "peru", "japao"]) {
      state.territories[territoryId].ownerId = activeId;
    }
    state.territories["sao_paulo"].units = unitCounts(2, 1);
    state.territories["sao_paulo"].armies = 3;

    expect(() =>
      applyAction(
        state,
        activeId,
        {
          type: "maneuver",
          fromTerritoryId: "sao_paulo",
          toTerritoryId: "argentina",
          armies: 2,
          units: unitCounts(1),
        },
        createSeededRng("hegem-27-invalid-maneuver")
      )
    ).toThrow(/corresponder ao total/);

    state = applyAction(
      state,
      activeId,
      {
        type: "maneuver",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        armies: 1,
        units: unitCounts(0, 1),
      },
      createSeededRng("hegem-27-maneuver")
    );

    expect(getTerritoryUnits(state.territories["sao_paulo"])).toEqual(unitCounts(2));
    expect(getTerritoryUnits(state.territories["argentina"])).toEqual(unitCounts(1, 1));
    expect(getMovedInUnits(state.territories["argentina"])).toEqual(unitCounts(0, 1));

    expect(() =>
      applyAction(
        state,
        activeId,
        {
          type: "maneuver",
          fromTerritoryId: "argentina",
          toTerritoryId: "peru",
          armies: 1,
          units: unitCounts(0, 1),
        },
        createSeededRng("hegem-27-second-movement")
      )
    ).toThrow(/Apenas 0/);

    state.territories["sao_paulo"].units = unitCounts(0, 2);
    state.territories["sao_paulo"].armies = 2;
    state.territories["sao_paulo"].buildings = [{ type: "airfield", level: 1 }];
    state.territories["japao"].buildings = [{ type: "airfield", level: 1 }];
    expect(() =>
      applyAction(
        state,
        activeId,
        { type: "airlift", fromTerritoryId: "sao_paulo", toTerritoryId: "japao", armies: 1 },
        createSeededRng("hegem-27-airlift-infantry")
      )
    ).toThrow(/infantaria/);
  });
});

describe("Geoeconomic Telemetry & Continental Balance Analytics (HEGEM-59)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("initializes player analytics and tracks capital continent, economy, buildings, and recruitment", () => {
    let state = createGame({
      id: "g_telemetry_1",
      seed: "telemetry-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    let p1 = state.players.find((p) => p.id === "p1")!;
    expect(p1.analytics).toBeDefined();
    expect(p1.analytics?.totalMoneyEarned).toBe(0);
    expect(p1.analytics?.fuelStarvationTurns).toBe(0);

    // Give p1 Brasil and select capital
    state.phase = "deploy";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.territories["brasil"].ownerId = "p1";
    state = applyAction(
      state,
      "p1",
      { type: "select_capital", territoryId: "brasil" },
      createSeededRng("seed_cap")
    );
    p1 = state.players.find((p) => p.id === "p1")!;
    expect(p1.analytics?.capitalContinentId).toBe("south_america");

    // Build structure
    p1.resources.money = 20;
    p1.resources.steel = 10;
    state = applyAction(
      state,
      "p1",
      { type: "build_structure", territoryId: "brasil", buildingType: "industry" },
      createSeededRng("seed_b1")
    );
    p1 = state.players.find((p) => p.id === "p1")!;
    expect(p1.analytics?.buildingsConstructed.industry).toBe(1);

    // Recruit units
    state = applyAction(
      state,
      "p1",
      { type: "recruit_unit", territoryId: "brasil", unitType: "tank", quantity: 2 },
      createSeededRng("seed_r1")
    );
    p1 = state.players.find((p) => p.id === "p1")!;
    expect(p1.analytics?.unitsRecruited.tank).toBe(2);

    // End turn and check that turn economy accumulated in analytics
    p1.unplacedArmies = 0;
    state.round = 2;
    state = applyAction(state, "p1", { type: "end_turn" }, createSeededRng("seed_t1"));
    const activePlayer = state.players[state.turnIndex];
    expect(activePlayer.analytics?.totalMoneyEarned).toBeGreaterThan(0);
  });

  it("tracks fuel starvation turns and continent unification rounds", () => {
    let state = createGame({
      id: "g_telemetry_2",
      seed: "telemetry-seed-2",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    const p1 = state.players[state.turnIndex];
    p1.resources.oil = 0; // Starving oil!
    state.territories["brasil"].ownerId = p1.id;
    state.territories["brasil"].units = unitCounts(1, 2); // Owns tanks without oil

    // Give p1 all of South America
    for (const t of CLASSIC_MAP.territories.filter((t) => t.continent === "south_america")) {
      state.territories[t.id].ownerId = p1.id;
    }

    state.phase = "deploy";
    p1.unplacedArmies = 0;
    state = applyAction(state, p1.id, { type: "end_turn" }, createSeededRng("end_turn_fuel"));

    // Check that p1 had fuel starvation turns incremented and continent unification recorded
    const p1After = state.players.find((p) => p.id === "p1")!;
    expect(p1After.analytics?.fuelStarvationTurns).toBe(1);
    expect(p1After.analytics?.unificationRounds.south_america).toBe(state.round);
  });
});

describe("Military Supply Lines, Fuel Starvation & Encirclement (HEGEM-35)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("evaluates land connectivity to capital and marks isolated territory as encircled", () => {
    const state = createGame({
      id: "g_supply_1",
      seed: "supply-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    const p1 = state.players[0];
    p1.capitalTerritoryId = "brasil";
    state.territories["brasil"].ownerId = p1.id;
    state.territories["sao_paulo"].ownerId = p1.id;
    state.territories["argentina"].ownerId = p1.id; // connected by land to Brasil via São Paulo -> supplied

    // Peru is owned by enemy p2, severing land access to Venezuela if Argentina doesn't connect
    state.territories["peru"].ownerId = "p2";
    state.territories["venezuela"].ownerId = "p1"; // borders Peru and Brasil; since it borders Brasil directly, it is supplied

    // Let's isolate an overseas or cut-off territory: e.g. Japão owned by p1 without any friendly ports or neighbors
    state.territories["japao"].ownerId = p1.id;
    state.territories["vladivostok"].ownerId = "p2";
    state.territories["china"].ownerId = "p2";
    state.territories["havai"].ownerId = "p2";

    updateSupplyAndEncirclement(state, CLASSIC_MAP);

    expect(state.territories["brasil"].isEncircled).toBe(false);
    expect(state.territories["sao_paulo"].isEncircled).toBe(false);
    expect(state.territories["argentina"].isEncircled).toBe(false);
    expect(state.territories["japao"].isEncircled).toBe(true);
    expect(state.territories["japao"].encircledRounds).toBeGreaterThanOrEqual(1);

    // Deploying to encircled territory is blocked
    state.phase = "deploy";
    state.turnIndex = 0;
    p1.unplacedArmies = 3;
    expect(() =>
      applyAction(
        state,
        p1.id,
        { type: "deploy", territoryId: "japao", armies: 1 },
        createSeededRng("deploy_encircled")
      )
    ).toThrow(/cerco militar/);
  });

  it("maintains maritime supply line across unblockaded sea link (e.g. China to Japan)", () => {
    const state = createGame({
      id: "g_supply_port",
      seed: "supply-port-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "brasil";
    state.territories["brasil"].ownerId = p1.id;

    // Connect Brasil -> Venezuela -> Mexico -> California -> Havai -> Japão and China
    for (const t of ["venezuela", "mexico", "california", "havai", "china", "japao"]) {
      state.territories[t].ownerId = p1.id;
    }

    // Direct sea link China <-> Japan is unblockaded: Japão is supplied by default without ports!
    updateSupplyAndEncirclement(state, CLASSIC_MAP);
    expect(state.territories["japao"].isEncircled).toBe(false);

    // If severed from Capital (all neighbors of Japan owned by enemy p2):
    state.territories["china"].ownerId = "p2";
    state.territories["vladivostok"].ownerId = "p2";
    state.territories["havai"].ownerId = "p2";
    updateSupplyAndEncirclement(state, CLASSIC_MAP);
    expect(state.territories["japao"].isEncircled).toBe(true);
  });

  it("applies defense penalty (-1 or -2) when attacking an encircled territory", () => {
    let state = createGame({
      id: "g_supply_combat",
      seed: "supply-combat-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");

    state.territories["sao_paulo"].ownerId = "p1";
    state.territories["sao_paulo"].armies = 4;
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 2;
    state.territories["argentina"].isEncircled = true;
    state.territories["argentina"].encircledRounds = 2;

    const rng = createSeededRng("combat_pen");
    rng.rollD6 = () => 5; // Defender rolls 5, but encircled penalty -2 brings highest to 3

    state = applyAction(
      state,
      "p1",
      { type: "attack", fromTerritoryId: "sao_paulo", toTerritoryId: "argentina", diceCount: 1 },
      rng
    );

    expect(state.lastCombat?.encircledDefenderPenalty).toBe(2);
    expect(state.lastCombat?.defenderDice[0]).toBe(3); // 5 - 2 = 3
  });

  it("flags outOfFuel when national oil is zero and territory has mechanized units", () => {
    const state = createGame({
      id: "g_fuel_starve",
      seed: "fuel-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.resources.oil = 0;
    state.territories["brasil"].ownerId = p1.id;
    state.territories["brasil"].units = unitCounts(2, 1); // 2 infantry, 1 tank

    updateSupplyAndEncirclement(state, CLASSIC_MAP);
    expect(state.territories["brasil"].outOfFuel).toBe(true);

    p1.resources.oil = 2;
    updateSupplyAndEncirclement(state, CLASSIC_MAP);
    expect(state.territories["brasil"].outOfFuel).toBe(false);
  });
});

describe("Asymmetric Naval Blockade & Coastal Bombardment (HEGEM-57)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("allows free amphibious crossing by default when neither side has naval forces", () => {
    const state = createGame({
      id: "g_nav_1",
      seed: "nav-seed-1",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    const blockade = checkNavalBlockade(state, "brasil", "nigeria", "p1");
    expect(blockade.isBlockaded).toBe(false);
  });

  it("enforces asymmetric naval blockade when defender has more navy in connected port than attacker", () => {
    const state = createGame({
      id: "g_nav_block",
      seed: "nav-seed-block",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");

    state.players[0].resources.oil = 3;
    state.players[1].resources.oil = 3;

    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].armies = 4;
    state.territories["nigeria"].ownerId = "p2";
    state.territories["nigeria"].armies = 3;

    // Defender builds port with 2 navies
    state.territories["nigeria"].buildings = [{ type: "port", level: 1 }];
    state.territories["nigeria"].units = unitCounts(1, 0, 0, 0, 2);

    // Attacker has no navy: blocked!
    expect(() =>
      applyAction(
        state,
        "p1",
        { type: "attack", fromTerritoryId: "brasil", toTerritoryId: "nigeria" },
        createSeededRng("atk_block")
      )
    ).toThrow(/bloqueada por frotas inimigas/);

    // Attacker builds port and stations 2 navies (ties defender): blockade broken!
    state.territories["brasil"].buildings = [{ type: "port", level: 1 }];
    state.territories["brasil"].units = unitCounts(2, 0, 0, 0, 2);

    const check = checkNavalBlockade(state, "brasil", "nigeria", "p1");
    expect(check.isBlockaded).toBe(false);
  });

  it("awards coastal bombardment bonus (+1 attack die) when attacker possesses navy in connected port", () => {
    let state = createGame({
      id: "g_nav_bombard",
      seed: "nav-bombard",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.players.find((p) => p.id === "p1")!.resources.oil = 2;

    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].armies = 4;
    state.territories["brasil"].buildings = [{ type: "port", level: 1 }];
    state.territories["brasil"].units = unitCounts(3, 0, 0, 0, 1);

    state.territories["nigeria"].ownerId = "p2";
    state.territories["nigeria"].armies = 2;

    const rng = createSeededRng("nav_combat");
    rng.rollD6 = () => 4; // Rolls 4, coastal bombardment +1 brings highest to 5

    state = applyAction(
      state,
      "p1",
      { type: "attack", fromTerritoryId: "brasil", toTerritoryId: "nigeria", diceCount: 1 },
      rng
    );

    expect(state.lastCombat?.coastalBombardmentBonus).toBe(true);
    expect(state.lastCombat?.attackerDice[0]).toBe(5); // 4 + 1 = 5
  });
});

describe("Tanks, Blitzkrieg Spearhead & Infantry Assault Fatigue (HEGEM-25)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("re-rolls attack dice rolling 1 when attacking with tanks and fuel", () => {
    let state = createGame({
      id: "g_tank_reroll",
      seed: "tank-reroll",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.players.find((p) => p.id === "p1")!.resources.oil = 2;

    state.territories["sao_paulo"].ownerId = "p1";
    state.territories["sao_paulo"].units = unitCounts(1, 2);
    state.territories["sao_paulo"].armies = 3;
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 2;

    const rolls = [1, 3, 2, 5]; // Attacker first rolls 1, defender rolls 3 & 2, re-roll produces 5
    const rng = createSeededRng("tank_combat");
    rng.rollD6 = () => rolls.shift() ?? 6;

    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        diceCount: 1,
        units: unitCounts(0, 1),
      },
      rng
    );

    expect(state.lastCombat?.blitzkriegBonus).toBe(true);
    expect(state.lastCombat?.attackerDice[0]).toBe(5); // 1 was re-rolled into 5!
  });

  it("grants Blitzkrieg capability upon conquest with surviving tanks and blocks fatigued infantry", () => {
    let state = createGame({
      id: "g_blitzkrieg",
      seed: "blitz-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.players.find((p) => p.id === "p1")!.resources.oil = 3;

    state.territories["sao_paulo"].ownerId = "p1";
    setTerritoryUnits(state.territories["sao_paulo"], unitCounts(2, 2));
    state.territories["argentina"].ownerId = "p2";
    setTerritoryUnits(state.territories["argentina"], unitCounts(1, 0));

    // São Paulo conquers Argentina
    const rolls = [6, 6, 6, 1, 6, 1];
    const rng = createSeededRng("blitz_conquer");
    rng.rollD6 = () => rolls.shift() ?? 1;

    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        units: unitCounts(1, 2),
      },
      rng
    );

    // Conquered territory has blitzkriegAvailable enabled because tanks survived
    expect(state.territories["argentina"].blitzkriegAvailable).toBe(true);
    expect(state.territories["argentina"].infantryAssaultFatigued).toBe(true);

    // Complete conquest occupation
    state = applyAction(
      state,
      "p1",
      {
        type: "occupy",
        armies: 3,
        units: unitCounts(1, 2),
      },
      rng
    );

    // Secondary attack from Argentina with fatigued infantry fails
    state.territories["peru"].ownerId = "p2";
    setTerritoryUnits(state.territories["peru"], unitCounts(1, 0));

    expect(() =>
      applyAction(
        state,
        "p1",
        {
          type: "attack",
          fromTerritoryId: "argentina",
          toTerritoryId: "peru",
          units: unitCounts(1, 1), // includes infantry!
        },
        createSeededRng("blitz_fail")
      )
    ).toThrow(/Apenas blindados/);

    // Secondary attack led exclusively by surviving tanks succeeds in Blitzkrieg!
    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: "argentina",
        toTerritoryId: "peru",
        units: unitCounts(0, 1), // only tanks!
      },
      rng
    );
    expect(state.territories["peru"].ownerId).toBe("p1");
  });
});

describe("Artillery Barrage & Airfield Air Missions (HEGEM-26, HEGEM-30)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("fires artillery barrage against adjacent territory, suppressing fortification and destroying units", () => {
    let state = createGame({
      id: "g_artillery",
      seed: "artillery-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");

    state.territories["sao_paulo"].ownerId = "p1";
    setTerritoryUnits(state.territories["sao_paulo"], unitCounts(2, 0, 2)); // 2 inf, 2 artillery = 4 armies
    state.territories["argentina"].ownerId = "p2";
    setTerritoryUnits(state.territories["argentina"], unitCounts(3, 0, 0)); // 3 inf = 3 armies
    state.territories["argentina"].buildings = [{ type: "fortification", level: 2 }];

    const rolls = [5, 4]; // 2 hits
    const rng = createSeededRng("art_rng");
    rng.rollD6 = () => rolls.shift() ?? 6;

    state = applyAction(
      state,
      "p1",
      { type: "artillery_barrage", fromTerritoryId: "sao_paulo", toTerritoryId: "argentina" },
      rng
    );

    // 1st hit degraded fortress from lvl 2 to lvl 1, 2nd hit destroyed 1 defender unit
    expect(getTerritoryBuildingLevel(state.territories["argentina"], "fortification")).toBe(1);
    expect(state.territories["argentina"].armies).toBe(2);
    expect(state.territories["sao_paulo"].artilleryBarrageFiredThisTurn).toBe(true);
  });

  it("executes air missions (CAS, Strategic Bombing, Recon) within BFS range <= 2 and <= 1 sea crossing", () => {
    let state = createGame({
      id: "g_air",
      seed: "air-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");
    state.players.find((p) => p.id === "p1")!.resources.oil = 5;

    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].buildings = [{ type: "airfield", level: 1 }];
    state.territories["brasil"].units = unitCounts(2, 0, 0, 2); // 2 aircraft
    state.territories["sao_paulo"].ownerId = "p2";
    state.territories["sao_paulo"].armies = 2;

    // Verify operational range
    const targets = findAirMissionTargets(state, "brasil", CLASSIC_MAP);
    expect(targets).toContain("argentina"); // distance 2
    expect(targets).toContain("nigeria"); // 1 sea link
    expect(targets).toContain("argelia"); // 1 sea link + 1 land border (distance 2, 1 sea crossing)
    expect(targets).toContain("egito"); // 1 sea link + 1 land border (distance 2, 1 sea crossing)

    // Execute CAS mission (requires adjacent target)
    state = applyAction(
      state,
      "p1",
      { type: "air_mission", fromTerritoryId: "brasil", toTerritoryId: "sao_paulo", missionType: "cas" },
      createSeededRng("cas_rng")
    );
    expect(state.territories["sao_paulo"].casBonusAttackerId).toBe("p1");
    expect(state.players.find((p) => p.id === "p1")!.resources.oil).toBe(4); // 1 oil consumed
  });
});

describe("Compact Division Troop Formatter (HEGEM-70)", () => {
  it("formats troop counts cleanly preventing text overflow on SVG badges and HUDs", () => {
    // Under 1000: exact numbers
    expect(formatCompactTroops(0)).toBe("0");
    expect(formatCompactTroops(1)).toBe("1");
    expect(formatCompactTroops(45)).toBe("45");
    expect(formatCompactTroops(999)).toBe("999");

    // 1000 to 9999: 1 decimal place with 'k', stripping trailing .0
    expect(formatCompactTroops(1000)).toBe("1k");
    expect(formatCompactTroops(1050)).toBe("1.1k");
    expect(formatCompactTroops(1500)).toBe("1.5k");
    expect(formatCompactTroops(2648)).toBe("2.6k");
    expect(formatCompactTroops(9900)).toBe("9.9k");

    // 10k to 999k: whole thousands with 'k'
    expect(formatCompactTroops(10000)).toBe("10k");
    expect(formatCompactTroops(12345)).toBe("12k");
    expect(formatCompactTroops(450000)).toBe("450k");
    expect(formatCompactTroops(999000)).toBe("999k");

    // 1.0M+: 1 decimal place with 'M', stripping trailing .0
    expect(formatCompactTroops(1000000)).toBe("1M");
    expect(formatCompactTroops(1500000)).toBe("1.5M");
    expect(formatCompactTroops(2400000)).toBe("2.4M");
  });
});

describe("Advanced Artillery Mechanics, Maintenance & Escort Vulnerability (HEGEM-26)", () => {
  const unitCounts = (
    infantry = 0,
    tank = 0,
    artillery = 0,
    aircraft = 0,
    navy = 0
  ) => ({ infantry, tank, artillery, aircraft, navy });

  it("calculates ammunition maintenance ($1/turn per active artillery) in turn economy", () => {
    let state = createGame({
      id: "g_art_econ",
      seed: "art-econ-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    for (const t of Object.values(state.territories)) {
      t.ownerId = "p2";
      t.armies = 2;
      t.units = unitCounts(2);
      t.buildings = [];
    }

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "brasil";
    p1.isCapitalLost = false;
    p1.resources.money = 10;

    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].units = unitCounts(2, 0, 2); // 2 artillery
    state.territories["brasil"].armies = 4;

    state.territories["argentina"].ownerId = "p1";
    state.territories["argentina"].units = unitCounts(1, 0, 1); // 1 artillery
    state.territories["argentina"].armies = 2;

    const econ = calculateTurnEconomy(state, "p1");
    // Capital gives +3$, 1 trade bonus from Argentina gives +1$, Brasil gold passive gives +2$ => grossMoney = 6
    expect(econ.grossMoney).toBe(6);
    // 3 total artillery units across Brasil and Argentina => $3 maintenance
    expect(econ.artilleryUpkeep).toBe(3);
    // Net money: 6 - 3 = 3
    expect(econ.netMoney).toBe(3);

    // If p1 loses capital, grossMoney is halved: floor(6 * 0.5) = 3, netMoney = 3 - 3 = 0
    p1.isCapitalLost = true;
    p1.economicPenaltyMultiplier = 0.5;
    const decapitatedEcon = calculateTurnEconomy(state, "p1");
    expect(decapitatedEcon.grossMoney).toBe(6);
    expect(decapitatedEcon.artilleryUpkeep).toBe(3);
    expect(decapitatedEcon.netMoney).toBe(0);
  });

  it("applies vulnerability penalty (-1 to highest defense die) when defender has artillery without infantry/tank escort", () => {
    let state = createGame({
      id: "g_art_vuln",
      seed: "art-vuln-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");

    state.territories["sao_paulo"].ownerId = "p1";
    state.territories["sao_paulo"].armies = 4;
    state.territories["sao_paulo"].units = unitCounts(3, 0, 1); // 3 infantry, 1 artillery

    // Argentina defended by Bob with 3 artillery units and 0 infantry/tanks (unescorted!)
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 3;
    state.territories["argentina"].units = unitCounts(0, 0, 3);

    const rolls = [5, 5, 5, 5, 4]; // Attacker [5, 5, 5], Defender [5, 4]
    const rng = createSeededRng("vuln_rng");
    rng.rollD6 = () => rolls.shift() ?? 4;

    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        units: unitCounts(3, 0, 0), // attack with 3 infantry
      },
      rng
    );

    // Defender rolled 5, 4. But because artillery was unescorted, highest die (5) took -1 penalty -> became 4!
    expect(state.lastCombat?.unescortedArtilleryPenalty).toBe(true);
    expect(state.lastCombat?.defenderDice[0]).toBe(4);
    expect(state.log.some((l) => l.includes("Artilharia Desprotegida -1 DEF"))).toBe(true);

    // Now test WITH infantry escort in fresh attack: penalty should NOT apply
    state.pendingConquest = null;
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 3;
    state.territories["argentina"].units = unitCounts(2, 0, 1); // 2 infantry + 1 artillery
    state.territories["sao_paulo"].armies = 4;
    state.territories["sao_paulo"].units = unitCounts(3, 0, 1);

    const rolls2 = [5, 5, 5, 5, 4];
    const rng2 = createSeededRng("escort_rng");
    rng2.rollD6 = () => rolls2.shift() ?? 4;

    state = applyAction(
      state,
      "p1",
      {
        type: "attack",
        fromTerritoryId: "sao_paulo",
        toTerritoryId: "argentina",
        units: unitCounts(3, 0, 0),
      },
      rng2
    );

    expect(state.lastCombat?.unescortedArtilleryPenalty).toBeUndefined();
    expect(state.lastCombat?.defenderDice[0]).toBe(5);
  });

  it("executes coastal artillery barrage across direct sea links and respects enemy naval blockades", () => {
    let state = createGame({
      id: "g_art_sea",
      seed: "art-sea-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });
    state.round = 2;
    state.phase = "attack";
    state.turnIndex = state.players.findIndex((p) => p.id === "p1");

    // Alice owns Groelândia with 2 artillery units
    state.territories["groenlandia"].ownerId = "p1";
    state.territories["groenlandia"].armies = 3;
    state.territories["groenlandia"].units = unitCounts(1, 0, 2);

    // Bob owns Islândia with a Casamata fortification, Port, 2 infantry and 2 navies fueled by oil
    state.territories["islandia"].ownerId = "p2";
    state.territories["islandia"].armies = 4;
    state.territories["islandia"].buildings = [
      { type: "fortification", level: 1 },
      { type: "port", level: 1 },
    ];
    state.territories["islandia"].units = unitCounts(2, 0, 0, 0, 2); // 2 navies
    state.players.find((p) => p.id === "p2")!.resources.oil = 3;

    // 1. With active naval blockade in Islândia: artillery barrage is blocked
    expect(() =>
      applyAction(
        state,
        "p1",
        { type: "artillery_barrage", fromTerritoryId: "groenlandia", toTerritoryId: "islandia" },
        createSeededRng("blocked_art")
      )
    ).toThrow(/bloqueio naval/);

    // 2. Clear enemy navy: coastal bombardment proceeds across direct sea link
    state.territories["islandia"].units = unitCounts(2, 0, 0, 0, 0);
    state.territories["islandia"].armies = 2;
    const rolls = [5, 4]; // 2 hits (>= 4)
    const rng = createSeededRng("coastal_art");
    rng.rollD6 = () => rolls.shift() ?? 6;

    state = applyAction(
      state,
      "p1",
      { type: "artillery_barrage", fromTerritoryId: "groenlandia", toTerritoryId: "islandia" },
      rng
    );

    // Fortification destroyed, 1 defender unit destroyed, log shows coastal barrage
    expect(getTerritoryBuildingLevel(state.territories["islandia"], "fortification")).toBe(0);
    expect(state.territories["islandia"].armies).toBe(1);
    expect(state.territories["groenlandia"].artilleryBarrageFiredThisTurn).toBe(true);
    expect(state.log.some((l) => l.includes("BARRAGEM COSTEIRA DE ARTILHARIA"))).toBe(true);
  });

  describe("HEGEM-76: Calibração da Curva de Tensão Mundial (Alvo: ~100% no Round 25)", () => {
    it("respects rebalanced tension increments across combat, diplomacy and round rollovers", () => {
      const rng = createSeededRng("tension-calibration-seed");
      let state = createGame({
        id: "tension_test",
        seed: "tension-calibration-seed",
        players: [
          { id: "p1", name: "Alpha", color: "blue" },
          { id: "p2", name: "Bravo", color: "red" },
        ],
      });

      expect(state.worldTension).toBe(0);

      // 1. Round advancement should increase by +1.5%
      state.round = 1;
      state.phase = "maneuver";
      state.turnIndex = state.players.length - 1;
      const lastPlayer = state.players[state.turnIndex];
      state = applyAction(state, lastPlayer.id, { type: "end_turn" }, rng);
      expect(state.round).toBe(2);
      expect(state.worldTension).toBe(1.5);

      // 2. Artillery barrage should add +0.2%
      const currP = state.players[state.turnIndex];
      currP.unplacedArmies = 0;
      state.phase = "attack";
      state.territories["brasil"].ownerId = currP.id;
      state.territories["brasil"].units = unitCounts(1, 0, 1, 0, 0); // 1 infantry + 1 artillery
      state.territories["brasil"].armies = 2;
      const otherP = state.players.find((p) => p.id !== currP.id)!;
      state.territories["venezuela"].ownerId = otherP.id;
      state.territories["venezuela"].units = unitCounts(3, 0, 0, 0, 0);
      state.territories["venezuela"].armies = 3;

      state = applyAction(
        state,
        currP.id,
        { type: "artillery_barrage", fromTerritoryId: "brasil", toTerritoryId: "venezuela" },
        rng
      );
      expect(state.worldTension).toBe(1.7);

      // 3. Common conquest should add +0.1%
      state.territories["brasil"].units = unitCounts(10, 0, 0, 0, 0);
      state.territories["brasil"].armies = 10;
      state.territories["venezuela"].units = unitCounts(1, 0, 0, 0, 0);
      state.territories["venezuela"].armies = 1;

      // Mock roll so attacker rolls 6 and defender rolls 1
      let rollCount = 0;
      rng.rollD6 = () => {
        rollCount++;
        return rollCount <= 3 ? 6 : 1;
      };
      state = applyAction(
        state,
        currP.id,
        { type: "attack", fromTerritoryId: "brasil", toTerritoryId: "venezuela" },
        rng
      );
      expect(state.worldTension).toBe(1.8); // 1.7 + 0.1
      expect(state.lastCombat?.attackerUnits).toEqual(unitCounts(9, 0, 0, 0, 0));
      expect(state.lastStrike).toEqual({
        kind: "artillery_barrage",
        fromTerritoryId: "brasil",
        toTerritoryId: "venezuela",
        hits: expect.any(Number),
        round: 2,
      });
    });
  });
});

