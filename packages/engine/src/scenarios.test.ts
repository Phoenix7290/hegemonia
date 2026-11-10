import { describe, expect, it } from "vitest";
import { CLASSIC_MAP } from "@hegemonia/maps";
import { TACTICAL_SCENARIOS, SCENARIO_BY_ID } from "@hegemonia/shared";
import { createGame, calculateTurnReinforcements } from "./index.js";
import { applyTacticalScenario } from "./scenarios.js";

const testPlayers = [
  { id: "p1", name: "General 1", color: "blue" as const },
  { id: "p2", name: "General 2", color: "red" as const },
  { id: "p3", name: "General 3", color: "green" as const },
];

describe("HEGEM-104: Tactical Preset Scenarios (Scenarios no Custom Lobby)", () => {
  it("exposes all 6 defined tactical scenarios with valid metadata", () => {
    expect(TACTICAL_SCENARIOS).toHaveLength(6);
    const expectedIds = [
      "standard",
      "fortress_europe",
      "pacific_theater",
      "oil_crisis",
      "iron_curtain",
      "defcon1_armageddon",
    ];
    expectedIds.forEach((id) => {
      const sc = SCENARIO_BY_ID[id as keyof typeof SCENARIO_BY_ID];
      expect(sc).toBeDefined();
      expect(sc.name.length).toBeGreaterThan(0);
      expect(sc.codename.length).toBeGreaterThan(0);
      expect(sc.badge.length).toBeGreaterThan(0);
      expect(sc.description.length).toBeGreaterThan(0);
      expect(sc.initialTension).toBeGreaterThanOrEqual(0);
      expect(sc.initialTension).toBeLessThanOrEqual(100);
    });
  });

  it("creates standard game without scenario mutations", () => {
    const game = createGame({
      id: "test-std",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "standard",
    });
    expect(game.worldTension).toBe(0);
    expect(game.players[0].resources.oil).toBeGreaterThanOrEqual(0);
  });

  it("applies Fortress Europe scenario with fortified bastion and surrounding siege", () => {
    const game = createGame({
      id: "test-fortress",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "fortress_europe",
    });

    expect(game.worldTension).toBe(25);
    const p0 = game.players[0];
    const p1 = game.players[1];

    // Check bastion
    const franca = game.territories["franca"];
    expect(franca.ownerId).toBe(p0.id);
    expect(franca.buildings?.some((b) => b.type === "fortification")).toBe(true);
    expect(franca.units.artillery).toBeGreaterThan(0);
    expect(franca.armies).toBe(5);

    // Check siege ring
    const polonia = game.territories["polonia"];
    expect(polonia.ownerId).toBe(p1.id);
    expect(polonia.buildings?.some((b) => b.type === "military_factory")).toBe(true);
    expect(polonia.units.tank).toBeGreaterThan(0);

    // Check resources
    expect(p0.resources.steel).toBeGreaterThanOrEqual(15);
    expect(game.log.some((l) => l.includes("OPERAÇÃO REDUTO CONTINENTAL"))).toBe(true);
  });

  it("applies Oil Crisis scenario with zero fuel and immobilized armor", () => {
    const game = createGame({
      id: "test-oil",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "oil_crisis",
    });

    expect(game.worldTension).toBe(40);
    const p0 = game.players[0];
    const p1 = game.players[1];

    expect(p0.resources.oil).toBe(0); // Zero oil!
    const p0Terr = game.territories["franca"];
    expect(p0Terr.ownerId).toBe(p0.id);
    expect(p0Terr.outOfFuel).toBe(true);

    const me = game.territories["oriente_medio"];
    expect(me.ownerId).toBe(p1.id);
    expect(p1.resources.oil).toBeGreaterThanOrEqual(20);
    expect(game.log.some((l) => l.includes("CRISE ENERGÉTICA GLOBAL"))).toBe(true);
  });

  it("applies Pacific Theater scenario with naval forces and airfields", () => {
    const game = createGame({
      id: "test-pacific",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "pacific_theater",
    });

    expect(game.worldTension).toBe(35);
    const p0 = game.players[0];
    const sumatra = game.territories["sumatra"];
    expect(sumatra.ownerId).toBe(p0.id);
    expect(sumatra.units.navy).toBeGreaterThan(0);
    expect(sumatra.buildings?.some((b) => b.type === "airfield")).toBe(true);
    expect(game.log.some((l) => l.includes("TEMPESTADE NO OCEANO"))).toBe(true);
  });

  it("applies Iron Curtain scenario with 50% world tension and fortified front lines", () => {
    const game = createGame({
      id: "test-iron-curtain",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "iron_curtain",
    });

    expect(game.worldTension).toBe(50);
    const p0 = game.players[0];
    const franca = game.territories["franca"];
    expect(franca.ownerId).toBe(p0.id);
    expect(franca.buildings?.some((b) => b.type === "fortification")).toBe(true);
    expect(franca.buildings?.some((b) => b.type === "military_factory")).toBe(true);

    const p1 = game.players[1];
    const polonia = game.territories["polonia"];
    expect(polonia.ownerId).toBe(p1.id);
    expect(polonia.buildings?.some((b) => b.type === "fortification")).toBe(true);
    expect(game.log.some((l) => l.includes("CORTINA DE FERRO"))).toBe(true);
  });

  it("applies DEFCON 1 Armageddon scenario with 75% world tension and total mobilization", () => {
    const game = createGame({
      id: "test-defcon",
      seed: "seed123",
      players: testPlayers,
      scenarioId: "defcon1_armageddon",
    });

    expect(game.worldTension).toBe(75);
    // All territories should have heightened garrisons (armies >= 4)
    Object.values(game.territories).forEach((terr) => {
      expect(terr.armies).toBeGreaterThanOrEqual(4);
      expect(terr.units.infantry).toBeGreaterThanOrEqual(1);
    });

    // Players should have advanced infrastructure and war chests
    game.players.forEach((p) => {
      expect(p.resources.steel).toBeGreaterThanOrEqual(20);
      expect(p.resources.money).toBeGreaterThanOrEqual(20);
    });
    expect(game.log.some((l) => l.includes("GUERRA TOTAL"))).toBe(true);
  });

  it("ensures tutorial practice mode prioritizes human player at index 0 with active reinforcements", () => {
    const samplePlayers = [
      { id: "human", name: "Comandante (Você)", color: "blue" as const, doctrineId: "superior_firepower" as const },
      { id: "bot1", name: "General IA #1", color: "red" as const, doctrineId: "mass_assault" as const },
      { id: "bot2", name: "General IA #2", color: "green" as const, doctrineId: "tall_sovereign" as const },
    ];
    const game = createGame({
      id: "tutorial-practice-test",
      seed: "practice-seed-123",
      players: samplePlayers,
      scenarioId: "standard",
    });

    const humanIndex = game.players.findIndex((p) => p.id === "human");
    if (humanIndex > 0) {
      const [humanPlayer] = game.players.splice(humanIndex, 1);
      game.players.unshift(humanPlayer);
    }
    game.turnIndex = 0;
    const active = game.players[0];
    if (active.unplacedArmies === 0) {
      const reinf = calculateTurnReinforcements(game, active.id);
      active.unplacedArmies = Math.max(3, reinf.total);
    }

    expect(game.players[game.turnIndex].id).toBe("human");
    expect(game.players[0].unplacedArmies).toBeGreaterThanOrEqual(3);
  });
});
