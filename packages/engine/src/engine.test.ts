import { describe, expect, it } from "vitest";
import { ALL_OBJECTIVES, ASIA_SUBREGIONS, CLASSIC_MAP, CLASSIC_OBJECTIVES, ROLEPLAY_OBJECTIVES } from "@hegemonia/maps";
import {
  applyAction,
  calculateTurnEconomy,
  calculateTurnReinforcements,
  checkPlayerVictory,
  createGame,
  createPlayerView,
  createSeededRng,
  damageTerritoryFortification,
  getTerritoryBuildingLevel,
  getTerritoryMaxBuildingSlots,
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
    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].armies = 10;
    state.territories["argentina"].ownerId = "p2";
    state.territories["argentina"].armies = 2;

    // Attacking p2 should throw error due to active treaty
    expect(() =>
      applyAction(state, "p1", {
        type: "attack",
        fromTerritoryId: "brasil",
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
    expect(state.worldTension).toBe(15);
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
    state.territories["brasil"].ownerId = "p2";
    state.territories["brasil"].armies = 5;
    state.territories["argentina"].ownerId = "p3";
    state.territories["argentina"].armies = 2;

    expect(() =>
      applyAction(state, "p2", {
        type: "attack",
        fromTerritoryId: "brasil",
        toTerritoryId: "argentina",
      }, rng)
    ).toThrow(/mesma coalizão/);

    // When p2 attacks p1 (the 100% infamy hegemon), p1 gets +2 Last Stand modifier
    state.territories["argentina"].ownerId = "p1";
    state = applyAction(state, "p2", {
      type: "attack",
      fromTerritoryId: "brasil",
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
    expect(state.worldTension).toBe(0.5);
    expect(state.players[0].infamy).toBe(5);
  });
});

describe("HEGEM-56: Cartographic Resource & Coastal Matrix (44 Territories)", () => {
  it("distributes 15 Steel, 11 Oil, 6 Gold, 12 Trade Hubs (+17$), 37 Coastal and 7 Landlocked territories", () => {
    const steelTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "steel");
    const oilTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "oil");
    const goldTerrs = CLASSIC_MAP.territories.filter((t) => t.resource === "gold");
    const tradeTerrs = CLASSIC_MAP.territories.filter((t) => (t.tradeBonus ?? 0) > 0);
    const coastalTerrs = CLASSIC_MAP.territories.filter((t) => t.isCoastal === true);
    const landlockedTerrs = CLASSIC_MAP.territories.filter((t) => t.isCoastal === false);

    expect(steelTerrs.length).toBe(15);
    expect(oilTerrs.length).toBe(11);
    expect(goldTerrs.length).toBe(6);
    expect(tradeTerrs.length).toBe(12);
    expect(tradeTerrs.reduce((sum, t) => sum + (t.tradeBonus ?? 0), 0)).toBe(17);
    expect(coastalTerrs.length).toBe(37);
    expect(landlockedTerrs.map((t) => t.id).sort()).toEqual(
      ["aral", "mongolia", "moscou", "omsk", "ottawa", "siberia", "tchita"].sort()
    );
  });

  it("enforces asymmetric continental resource scarcity (Europe & East Asia have 0 native Oil)", () => {
    const europeOil = CLASSIC_MAP.territories.filter(
      (t) => t.continent === "europe" && t.resource === "oil"
    );
    const europeSteel = CLASSIC_MAP.territories.filter(
      (t) => t.continent === "europe" && t.resource === "steel"
    );
    expect(europeOil.length).toBe(0);
    expect(europeSteel.length).toBe(4);

    const eastAsiaIds = ASIA_SUBREGIONS.find((s) => s.id === "asia_east")!.territoryIds;
    const eastAsiaOil = CLASSIC_MAP.territories.filter(
      (t) => eastAsiaIds.includes(t.id) && t.resource === "oil"
    );
    expect(eastAsiaOil.length).toBe(0);
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
    // brasil (steel), venezuela (oil), peru (gold -> +1 gold, +2$), egito (oil + tradeBonus 2$)
    for (const t of Object.values(state.territories)) {
      t.ownerId = "p2";
      t.armies = 2;
    }
    state.territories["brasil"].ownerId = "p1";
    state.territories["venezuela"].ownerId = "p1";
    state.territories["peru"].ownerId = "p1";
    state.territories["egito"].ownerId = "p1";

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "brasil";
    p1.isCapitalLost = false;
    p1.economicPenaltyMultiplier = 1.0;

    const econ = calculateTurnEconomy(state, "p1");
    expect(econ.capitalMoney).toBe(3);
    expect(econ.tradeHubMoney).toBe(2); // egito (+2$)
    expect(econ.goldPassiveMoney).toBe(2); // peru (+2$)
    expect(econ.grossMoney).toBe(7);
    expect(econ.netMoney).toBe(7);
    expect(econ.steel).toBe(1); // brasil
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
    // - brasil (Steel, coastal, no tradeBonus): Industry -> +2 Steel
    // - argentina (No natural resource, coastal, tradeBonus +1$): Industry (+2$) + Market (+2$) + Port (+1$ trade hub bonus)
    // - venezuela (Oil): Industry -> +2 Oil
    state.territories["brasil"].ownerId = "p1";
    state.territories["brasil"].armies = 2;
    state.territories["brasil"].buildings = [{ type: "industry", level: 1 }];

    state.territories["argentina"].ownerId = "p1";
    state.territories["argentina"].armies = 2;
    state.territories["argentina"].buildings = [
      { type: "industry", level: 1 },
      { type: "market", level: 1 },
      { type: "port", level: 1 },
    ];

    state.territories["venezuela"].ownerId = "p1";
    state.territories["venezuela"].armies = 2;
    state.territories["venezuela"].buildings = [{ type: "industry", level: 1 }];

    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.capitalTerritoryId = "argentina";
    p1.isCapitalLost = false;

    const econ = calculateTurnEconomy(state, "p1");
    expect(econ.capitalMoney).toBe(3);
    expect(econ.tradeHubMoney).toBe(1); // Argentina tradeBonus
    expect(econ.buildingMoney).toBe(5); // Market (+2$) + Non-resource Industry (+2$) + Port in Trade Hub (+1$)
    expect(econ.grossMoney).toBe(9);
    expect(econ.netMoney).toBe(9);
    expect(econ.steel).toBe(2); // Brasil with Industry -> +2 Steel
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
    state.territories["brasil"].ownerId = activeId;
    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "brasil", buildingType: "fortification" },
      rng
    );
    expect(getTerritoryBuildingLevel(state.territories["brasil"], "fortification")).toBe(1);

    state = applyAction(
      state,
      activeId,
      { type: "build_structure", territoryId: "brasil", buildingType: "fortification" },
      rng
    );
    expect(getTerritoryBuildingLevel(state.territories["brasil"], "fortification")).toBe(2);
    expect(state.territories["brasil"].buildings?.length).toBe(1); // Upgrade reuses the same slot!

    // Set up Argentina as defender territory with Level 2 Fortress + Market and 1 army
    state.territories["brasil"].armies = 20;
    state.territories["argentina"].ownerId = defenderId;
    state.territories["argentina"].armies = 1;
    state.territories["argentina"].buildings = [
      { type: "fortification", level: 2 },
      { type: "market", level: 1 },
    ];

    // Attack Argentina until conquered
    for (let i = 0; i < 20 && state.territories["argentina"].ownerId !== activeId; i++) {
      state.territories["brasil"].armies = 10;
      state = applyAction(
        state,
        activeId,
        { type: "attack", fromTerritoryId: "brasil", toTerritoryId: "argentina" },
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
});
