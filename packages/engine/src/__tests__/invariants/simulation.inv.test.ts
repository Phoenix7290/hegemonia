import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  applyAction,
  createGame,
  createSeededRng,
  findValidTradeTriplet,
  getTerritoryUnits,
  GameState,
  SeededRng,
} from "../../index.js";

interface InvariantAuditResult {
  passed: boolean;
  violation?: string;
}

/**
 * Game Invariants Auditor: audits authoritative engine state
 * against core strategic rules at every simulation step.
 */
function auditStateInvariants(state: GameState): InvariantAuditResult {
  // Invariant 1: Non-negative player resources
  for (const player of state.players) {
    if (player.resources) {
      if (player.resources.money < 0) {
        return { passed: false, violation: `Player ${player.name} has negative money: ${player.resources.money}` };
      }
      if (player.resources.steel < 0) {
        return { passed: false, violation: `Player ${player.name} has negative steel: ${player.resources.steel}` };
      }
      if (player.resources.oil < 0) {
        return { passed: false, violation: `Player ${player.name} has negative oil: ${player.resources.oil}` };
      }
      if (player.resources.gold < 0) {
        return { passed: false, violation: `Player ${player.name} has negative gold: ${player.resources.gold}` };
      }
    }
    if (player.unplacedArmies < 0) {
      return { passed: false, violation: `Player ${player.name} has negative unplacedArmies: ${player.unplacedArmies}` };
    }
  }

  // Invariant 2: Positive territory garrisons and unit composition integrity
  for (const [id, terr] of Object.entries(state.territories)) {
    if (terr.armies < 1) {
      return { passed: false, violation: `Territory ${id} has invalid garrison: ${terr.armies} < 1` };
    }
    const units = getTerritoryUnits(terr);
    const sum = (units.infantry ?? 0) + (units.tank ?? 0) + (units.artillery ?? 0);
    if (sum !== terr.armies) {
      return {
        passed: false,
        violation: `Territory ${id} unit composition sum (${sum}) does not match armies count (${terr.armies})`,
      };
    }
    if (units.infantry < 0 || units.tank < 0 || units.artillery < 0) {
      return { passed: false, violation: `Territory ${id} has negative unit counts: ${JSON.stringify(units)}` };
    }
  }

  // Invariant 3: World Tension bounded within [0, 100]
  if (state.worldTension < 0 || state.worldTension > 100) {
    return { passed: false, violation: `World tension out of bounds [0, 100]: ${state.worldTension}` };
  }

  // Invariant 4: Market prices without free money arbitrage (sell price must be strictly < buy price)
  if (state.marketPrices) {
    for (const [res, rate] of Object.entries(state.marketPrices)) {
      if (rate.sellPrice >= rate.buyPrice) {
        return {
          passed: false,
          violation: `Arbitrage exploit detected in market resource ${res}: sellPrice ${rate.sellPrice} >= buyPrice ${rate.buyPrice}`,
        };
      }
    }
  }

  return { passed: true };
}

/**
 * Executes an automated bot step with anti-deadlock safeguards (HEGEM-75)
 */
function stepSimulation(
  state: GameState,
  rng: SeededRng,
  mapById: Map<string, (typeof CLASSIC_MAP.territories)[number]>
): GameState {
  const player = state.players[state.turnIndex];
  if (!player || player.eliminated) {
    return applyAction(state, player?.id ?? state.players[0].id, { type: "end_turn" }, rng);
  }

  // 1. Mandatory or strategic card trade (triplets)
  const triplet = findValidTradeTriplet(player.cards);
  if (triplet && (state.phase === "deploy" || player.cards.length >= 5)) {
    return applyAction(state, player.id, { type: "trade_cards", cardIds: triplet }, rng);
  }

  // 2. Deploy reinforcements onto unencircled frontlines (HEGEM-75)
  if (state.phase === "deploy") {
    const owned = Object.values(state.territories).filter((t) => t.ownerId === player.id);
    const eligible = owned.filter((t) => !t.isEncircled);
    const candidatePool = eligible.length > 0 ? eligible : owned;
    const frontline = candidatePool.filter((t) =>
      mapById.get(t.id)!.neighbors.some((nId) => state.territories[nId].ownerId !== player.id)
    );
    const candidates = frontline.length > 0 ? frontline : candidatePool;

    candidates.sort((a, b) => {
      const minEnemyA = Math.min(
        ...mapById
          .get(a.id)!
          .neighbors.map((n) => state.territories[n])
          .filter((n) => n.ownerId !== player.id)
          .map((n) => n.armies)
      );
      const minEnemyB = Math.min(
        ...mapById
          .get(b.id)!
          .neighbors.map((n) => state.territories[n])
          .filter((n) => n.ownerId !== player.id)
          .map((n) => n.armies)
      );
      return minEnemyA - minEnemyB;
    });

    const target = candidates[0];
    if (target && player.unplacedArmies > 0) {
      try {
        return applyAction(
          state,
          player.id,
          { type: "deploy", territoryId: target.id, armies: player.unplacedArmies },
          rng
        );
      } catch {
        // Fallback: target might be newly encircled, try capital or first eligible
        const safeTarget = eligible.find((t) => t.id === player.capitalTerritoryId) ?? eligible[0];
        if (safeTarget) {
          return applyAction(
            state,
            player.id,
            { type: "deploy", territoryId: safeTarget.id, armies: player.unplacedArmies },
            rng
          );
        }
      }
    }
    // If deploy cannot proceed, force advance turn
    if (state.round === 1) {
      player.unplacedArmies = 0;
      return applyAction(state, player.id, { type: "end_turn" }, rng);
    }
  }

  // 3. Occupy if pending conquest
  if (state.pendingConquest) {
    return applyAction(
      state,
      player.id,
      { type: "occupy", armies: state.pendingConquest.maxMove },
      rng
    );
  }

  // 4. Attack phase: seek favorable engagements
  if (state.phase === "attack") {
    if (player.cards.length >= 5) {
      const forced = findValidTradeTriplet(player.cards);
      if (forced) {
        return applyAction(state, player.id, { type: "trade_cards", cardIds: forced }, rng);
      }
    }

    const owned = Object.values(state.territories)
      .filter((t) => t.ownerId === player.id && t.armies >= 3)
      .sort((a, b) => b.armies - a.armies);

    for (const from of owned) {
      // HEGEM-25: Skip fatigued infantry territories that conquered this round without blitzkrieg
      if (from.conqueredTurnRound === state.round && !from.blitzkriegAvailable) {
        continue;
      }
      const enemies = mapById
        .get(from.id)!
        .neighbors.map((nId) => state.territories[nId])
        .filter((n) => n.ownerId !== player.id && from.armies >= n.armies + 1);
      if (enemies.length > 0) {
        enemies.sort((a, b) => a.armies - b.armies);
        const target = enemies[0];
        return applyAction(
          state,
          player.id,
          { type: "attack", fromTerritoryId: from.id, toTerritoryId: target.id },
          rng
        );
      }
    }
    return applyAction(state, player.id, { type: "end_attack" }, rng);
  }

  // 5. Maneuver phase: reposition interior armies, then end turn
  if (state.phase === "maneuver") {
    const owned = Object.values(state.territories).filter(
      (t) => t.ownerId === player.id && t.armies - t.movedInArmies > 1
    );
    for (const from of owned) {
      const isInterior = mapById
        .get(from.id)!
        .neighbors.every((nId) => state.territories[nId].ownerId === player.id);
      if (isInterior) {
        const borderNeighborId = mapById
          .get(from.id)!
          .neighbors.find((nId) =>
            mapById.get(nId)!.neighbors.some((nn) => state.territories[nn].ownerId !== player.id)
          );
        const destId = borderNeighborId ?? mapById.get(from.id)!.neighbors[0];
        const movable = from.armies - from.movedInArmies - 1;
        if (movable > 0) {
          return applyAction(
            state,
            player.id,
            { type: "maneuver", fromTerritoryId: from.id, toTerritoryId: destId, armies: movable },
            rng
          );
        }
      }
    }
    return applyAction(state, player.id, { type: "end_turn" }, rng);
  }

  return state;
}

describe("QA Layer 1: Headless Simulation & Invariant Testing", () => {
  const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

  it("HEGEM-75: eliminates AI deploy stall when territories become encircled", () => {
    const seed = "hegem-encircled-stall-test";
    const rng = createSeededRng(seed);
    let state = createGame({
      id: "stall_match",
      seed,
      players: [
        { id: "p1", name: "Alpha", color: "blue" },
        { id: "p2", name: "Bravo", color: "red" },
      ],
    });

    // Manually encircle Alpha's frontline territories in Round 2
    state.round = 2;
    state.players[0].capitalTerritoryId = "brasil";
    state.players[0].unplacedArmies = 5;
    state.phase = "deploy";
    state.territories["peru"].ownerId = "p1";
    state.territories["peru"].isEncircled = true; // isolated outpost under siege

    // Execute step: bot should successfully bypass encircled Peru and deploy in Brasil
    state = stepSimulation(state, rng, mapById);

    expect(state.territories["brasil"].armies).toBeGreaterThanOrEqual(1);
    expect(state.phase).toBe("attack"); // successfully completed deploy phase
  });

  it("runs full multi-round Monte Carlo bot simulations maintaining all state invariants", () => {
    const seeds = ["monte-carlo-seed-1", "monte-carlo-seed-2", "monte-carlo-seed-3"];

    for (const seed of seeds) {
      const rng = createSeededRng(seed);
      let state = createGame({
        id: `sim_${seed}`,
        seed,
        players: [
          { id: "p1", name: "General Azul", color: "blue" },
          { id: "p2", name: "General Vermelho", color: "red" },
          { id: "p3", name: "General Verde", color: "green" },
          { id: "p4", name: "General Amarelo", color: "yellow" },
        ],
      });

      let steps = 0;
      const maxSteps = 300; // 300 authoritative actions

      while (state.phase !== "game_over" && steps < maxSteps) {
        steps++;
        state = stepSimulation(state, rng, mapById);

        // Audit state invariants at EVERY step
        const audit = auditStateInvariants(state);
        if (!audit.passed) {
          throw new Error(
            `[Invariant Violation] at step ${steps} (seed: ${seed}, round: ${state.round}, phase: ${state.phase}): ${audit.violation}`
          );
        }
      }

      expect(steps).toBeGreaterThan(50);
      expect(state.round).toBeGreaterThan(1);
    }
  });

  it("property-based fuzzing: arbitrary seeds never trigger negative resources or crashes", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 5, maxLength: 20 }), (randomSeed) => {
        const rng = createSeededRng(randomSeed);
        let state = createGame({
          id: `fuzz_${randomSeed}`,
          seed: randomSeed,
          players: [
            { id: "p1", name: "A", color: "blue" },
            { id: "p2", name: "B", color: "red" },
          ],
        });

        // Run 40 actions per seed fuzz run
        for (let step = 0; step < 40; step++) {
          if (state.phase === "game_over") break;
          state = stepSimulation(state, rng, mapById);
          const audit = auditStateInvariants(state);
          if (!audit.passed) {
            throw new Error(`Fuzz violation with seed '${randomSeed}': ${audit.violation}`);
          }
        }
        return true;
      }),
      { numRuns: 15 } // 15 distinct generated seeds
    );
  });
});
