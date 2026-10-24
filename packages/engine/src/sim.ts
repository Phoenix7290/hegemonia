import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  applyAction,
  createGame,
  createSeededRng,
  findValidTradeTriplet,
} from "./index.js";

function runSimulation(seed = "hegemonia-sim-2026") {
  const rng = createSeededRng(seed);
  let state = createGame({
    id: "sim_match_1",
    seed,
    players: [
      { id: "p1", name: "General Azul", color: "blue" },
      { id: "p2", name: "General Vermelho", color: "red" },
      { id: "p3", name: "General Verde", color: "green" },
      { id: "p4", name: "General Amarelo", color: "yellow" },
    ],
  });

  const mapById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
  console.log("=== 🎲 HEGEMONIA CLI SIMULATION ===");
  for (const p of state.players) {
    console.log(`- ${p.name} (${p.color}): Objetivo -> ${p.objective.descriptionPt}`);
  }

  let steps = 0;
  const maxSteps = 5000;

  while (state.phase !== "game_over" && steps < maxSteps) {
    steps++;
    const player = state.players[state.turnIndex];

    // 1. If in deploy phase (or holding 5+ cards), trade cards if possible
    const triplet = findValidTradeTriplet(player.cards);
    if (triplet && (state.phase === "deploy" || player.cards.length >= 5)) {
      state = applyAction(state, player.id, { type: "trade_cards", cardIds: triplet }, rng);
      continue;
    }

    // 2. Deploy all unplaced armies onto a front-line territory (prioritizing target continents if any)
    if (state.phase === "deploy") {
      const owned = Object.values(state.territories).filter((t) => t.ownerId === player.id);
      const frontline = owned.filter((t) =>
        mapById.get(t.id)!.neighbors.some((nId) => state.territories[nId].ownerId !== player.id)
      );
      const candidates = frontline.length > 0 ? frontline : owned;
      // Pick the candidate with the weakest adjacent enemy so we can break through
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
      state = applyAction(
        state,
        player.id,
        { type: "deploy", territoryId: target.id, armies: player.unplacedArmies },
        rng
      );
      continue;
    }

      // 3. Occupy if pending conquest: move all available troops from the attacking stack
      if (state.pendingConquest) {
        const fromT = state.territories[state.pendingConquest.fromTerritoryId];
        // In War, you can only move 1..maxMove (1..3) on conquest; wait—let's check why bots stalled:
        state = applyAction(
          state,
          player.id,
          { type: "occupy", armies: state.pendingConquest.maxMove },
          rng
        );
        continue;
      }

    // 4. Attack while we have any territory with >= 3 armies adjacent to an enemy
    if (state.phase === "attack") {
      if (player.cards.length >= 5) {
        const forced = findValidTradeTriplet(player.cards)!;
        state = applyAction(state, player.id, { type: "trade_cards", cardIds: forced }, rng);
        continue;
      }

      const owned = Object.values(state.territories)
        .filter((t) => t.ownerId === player.id && t.armies >= 3)
        .sort((a, b) => b.armies - a.armies);

      let attackFound = false;
      for (const from of owned) {
        const enemies = mapById
          .get(from.id)!
          .neighbors.map((nId) => state.territories[nId])
          .filter((n) => n.ownerId !== player.id && from.armies >= n.armies + 1);
        if (enemies.length > 0) {
          enemies.sort((a, b) => a.armies - b.armies);
          const target = enemies[0];
          state = applyAction(
            state,
            player.id,
            { type: "attack", fromTerritoryId: from.id, toTerritoryId: target.id },
            rng
          );
          attackFound = true;
          break;
        }
      }
      if (!attackFound) {
        state = applyAction(state, player.id, { type: "end_attack" }, rng);
      }
      continue;
    }

    // 5. Maneuver phase -> move interior armies toward frontline, then end turn
    if (state.phase === "maneuver") {
      let moved = false;
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
            state = applyAction(
              state,
              player.id,
              { type: "maneuver", fromTerritoryId: from.id, toTerritoryId: destId, armies: movable },
              rng
            );
            moved = true;
            break;
          }
        }
      }
      if (!moved) {
        state = applyAction(state, player.id, { type: "end_turn" }, rng);
      }
      continue;
    }
  }

  console.log(`\nPartida finalizada em ${steps} ações (Rodada ${state.round}).`);
  if (state.winnerId) {
    const winner = state.players.find((p) => p.id === state.winnerId)!;
    const count = Object.values(state.territories).filter((t) => t.ownerId === winner.id).length;
    console.log(`🏆 VENCEDOR: ${winner.name} (${winner.color}) com ${count}/42 territórios!`);
    console.log(`📜 Objetivo cumprido: ${winner.objective.descriptionPt}`);
  } else {
    console.log("Limite de passos atingido.");
  }
}

runSimulation();
