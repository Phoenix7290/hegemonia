import { CLASSIC_MAP } from "@hegemonia/maps";
import type {
  GameMapDef,
  GameState,
  TacticalScenarioId,
  UnitCounts,
} from "@hegemonia/shared";
import { TACTICAL_SCENARIOS, SCENARIO_BY_ID } from "@hegemonia/shared";
import { calculateTurnReinforcements, collectTurnEconomy } from "./index.js";

function makeUnits(u: Partial<UnitCounts>): UnitCounts {
  return {
    infantry: u.infantry ?? 0,
    tank: u.tank ?? 0,
    artillery: u.artillery ?? 0,
    aircraft: u.aircraft ?? 0,
    navy: u.navy ?? 0,
  };
}

function sumUnits(u: UnitCounts): number {
  return u.infantry + u.tank + u.artillery + u.aircraft + u.navy;
}

/**
 * Applies a tactical preset scenario to an initialized GameState.
 * Modifies territory control, troop allocations, buildings, initial resources,
 * and global tension to establish an asymmetric high-pressure strategic challenge.
 */
export function applyTacticalScenario(
  state: GameState,
  scenarioId: TacticalScenarioId,
  map: GameMapDef = CLASSIC_MAP
): void {
  if (!scenarioId || scenarioId === "standard" || !state.players || state.players.length < 2) {
    return;
  }

  const p0 = state.players[0]; // Host / Human Commander
  const p1 = state.players[1]; // Primary Opponent AI

  const scenario = SCENARIO_BY_ID[scenarioId];
  if (!scenario) return;

  state.worldTension = scenario.initialTension;

  if (scenarioId === "fortress_europe") {
    // Player 0 holds the European Bastion
    const bastionTerritoryIds = [
      "franca",
      "alemanha",
      "inglaterra",
      "italia",
      "espanha",
    ];

    // Surrounding hostile ring
    const enemyRingIds = [
      "polonia",
      "balcas",
      "moscou",
      "argelia",
      "egito",
      "islandia",
    ];

    for (const tId of bastionTerritoryIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p0.id;
        state.territories[tId].buildings = [{ type: "fortification", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 3, artillery: 2 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p0.capitalTerritoryId = "franca";
    p0.resources = { money: 6, steel: 15, oil: 2, gold: 2 };

    for (const tId of enemyRingIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p1.id;
        state.territories[tId].buildings = [{ type: "military_factory", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 4, tank: 4 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p1.capitalTerritoryId = "polonia";
    p1.resources = { money: 12, steel: 20, oil: 12, gold: 4 };

    state.log.push(
      `[CENÁRIO: ${scenario.codename}] Reduto da Fortaleza Europa sob cerco severo! Fortificações e artilharia pesada ativas.`
    );
  } else if (scenarioId === "oil_crisis") {
    // Player 0 has a powerful industrial base but 0 oil (tanks immobilized)
    const industrialTerritoryIds = [
      "franca",
      "alemanha",
      "inglaterra",
      "nova_york",
    ];

    const oilRichTerritoryIds = [
      "oriente_medio",
      "egito",
      "argelia",
      "aral",
    ];

    for (const tId of industrialTerritoryIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p0.id;
        state.territories[tId].buildings = [{ type: "industry", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 3, tank: 4, artillery: 1 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
        state.territories[tId].outOfFuel = true; // Paralyzed by energy crisis
      }
    }
    p0.capitalTerritoryId = "franca";
    p0.resources = { money: 10, steel: 18, oil: 0, gold: 3 };

    for (const tId of oilRichTerritoryIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p1.id;
        state.territories[tId].buildings = [{ type: "oil_well", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 4, tank: 2, aircraft: 1 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p1.capitalTerritoryId = "oriente_medio";
    p1.resources = { money: 14, steel: 12, oil: 28, gold: 5 };

    state.log.push(
      `[CENÁRIO: ${scenario.codename}] Crise Petrolífera! Reservas de petróleo zeradas e blindados imobilizados sem abastecimento.`
    );
  } else if (scenarioId === "pacific_theater") {
    // Island hopping and amphibious combat in the Pacific
    const pacificIslandIds = [
      "sumatra",
      "borneu",
      "nova_guine",
      "australia",
      "havai",
    ];

    const asianCoastIds = [
      "vietna",
      "china",
      "pequim",
      "japao",
    ];

    for (const tId of pacificIslandIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p0.id;
        state.territories[tId].buildings = [{ type: "airfield", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 3, aircraft: 1, navy: 2 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p0.capitalTerritoryId = "australia";
    p0.resources = { money: 12, steel: 10, oil: 12, gold: 4 };

    for (const tId of asianCoastIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p1.id;
        state.territories[tId].buildings = [{ type: "fortification", level: 1 }];
        state.territories[tId].units = makeUnits({ infantry: 4, artillery: 2, navy: 2 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p1.capitalTerritoryId = "pequim";
    p1.resources = { money: 15, steel: 16, oil: 14, gold: 4 };

    state.log.push(
      `[CENÁRIO: ${scenario.codename}] Bloqueio Naval no Pacífico! Combine salvas navais de canhão e apoio aéreo para desembarques anfíbios.`
    );
  } else if (scenarioId === "iron_curtain") {
    // Player 0 holds Western Europe
    const westernBlocIds = [
      "franca",
      "alemanha",
      "inglaterra",
      "italia",
      "espanha",
    ];

    // Player 1 holds Eastern Europe & Russia
    const easternBlocIds = [
      "polonia",
      "balcas",
      "moscou",
      "islandia",
    ];

    for (const tId of westernBlocIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p0.id;
        state.territories[tId].buildings = [
          { type: "fortification", level: 1 },
          { type: "military_factory", level: 1 },
        ];
        state.territories[tId].units = makeUnits({ infantry: 4, tank: 2, artillery: 1 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p0.capitalTerritoryId = "franca";
    p0.resources = { money: 14, steel: 18, oil: 10, gold: 4 };

    for (const tId of easternBlocIds) {
      if (state.territories[tId]) {
        state.territories[tId].ownerId = p1.id;
        state.territories[tId].buildings = [
          { type: "fortification", level: 1 },
          { type: "military_factory", level: 1 },
        ];
        state.territories[tId].units = makeUnits({ infantry: 4, tank: 3, artillery: 1 });
        state.territories[tId].armies = sumUnits(state.territories[tId].units);
      }
    }
    p1.capitalTerritoryId = "moscou";
    p1.resources = { money: 16, steel: 20, oil: 12, gold: 4 };

    state.worldTension = 50;

    state.log.push(
      `[CENÁRIO: ${scenario.codename}] Guerra Fria na Cortina de Ferro (Tensão Mundial em 50%)! Tratados de aliança militar já disponíveis.`
    );
  } else if (scenarioId === "defcon1_armageddon") {
    // Hyper-militarized total confrontation on the brink of nuclear war
    state.worldTension = 75;

    for (const [tId, terr] of Object.entries(state.territories)) {
      terr.armies = 5;
      terr.units = makeUnits({ infantry: 3, tank: 1, artillery: 1 });
    }

    // Give each player capital, infrastructure, and heavy starting war chests
    state.players.forEach((p) => {
      const owned = Object.values(state.territories).filter((t) => t.ownerId === p.id);
      if (owned.length > 0) {
        owned[0].buildings = [{ type: "fortification", level: 1 }];
        p.capitalTerritoryId = owned[0].id;
        if (owned.length > 1) owned[1].buildings = [{ type: "military_factory", level: 1 }];
        if (owned.length > 2) owned[2].buildings = [{ type: "airfield", level: 1 }];
      }
      p.resources = { money: 35, steel: 35, oil: 25, gold: 10 };
    });

    state.log.push(
      `[CENÁRIO: ${scenario.codename}] Alerta DEFCON 1 iminente (Tensão Mundial em 75%)! Cada ofensiva acarreta risco de catástrofe global.`
    );
  }

  // Recalculate round 1 turn 1 reinforcements and initial economy for the active player
  const activePlayer = state.players[0];
  const reinf = calculateTurnReinforcements(state, activePlayer.id, map);
  activePlayer.unplacedArmies = reinf.total;
  collectTurnEconomy(state, activePlayer.id, map);

  // If oil crisis, ensure active player starts turn 1 under severe embargo (oil 0)
  if (scenarioId === "oil_crisis") {
    activePlayer.resources.oil = 0;
  }
}
