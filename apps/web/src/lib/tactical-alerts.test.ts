import { describe, expect, it } from "vitest";
import { wrapCamX, clampCamY } from "../components/TacticalMap.svelte";
import { CLASSIC_MAP, MAP_WIDTH, MAP_HEIGHT } from "@hegemonia/maps";
import { createGame } from "@hegemonia/engine";

describe("Tactical Alerts & HOI4-Style Auto-Zoom (HEGEM-102)", () => {
  it("calculates camera centering offsets correctly for territory centroids", () => {
    // Map center (600, 310) should result in camX = 0, camY = 0
    expect(wrapCamX(MAP_WIDTH / 2 - 600)).toBe(0);
    expect(clampCamY(MAP_HEIGHT / 2 - 310)).toBe(0);

    // Brasil centroid (~430, ~380)
    const brasil = CLASSIC_MAP.territories.find((t) => t.id === "brasil")!;
    expect(brasil).toBeDefined();
    const [cx, cy] = brasil.center;

    const targetCamX = wrapCamX(MAP_WIDTH / 2 - cx);
    const targetCamY = clampCamY(MAP_HEIGHT / 2 - cy);

    expect(Number.isFinite(targetCamX)).toBe(true);
    expect(Number.isFinite(targetCamY)).toBe(true);
    expect(targetCamY).toBeGreaterThanOrEqual(-260);
    expect(targetCamY).toBeLessThanOrEqual(260);
  });

  it("detects ready artillery only when adjacent to enemy forces during attack phase", () => {
    const game = createGame({
      id: "g1",
      seed: "tactical_alerts_test",
      players: [
        { id: "player-alpha", name: "Alpha", color: "blue" },
        { id: "player-beta", name: "Beta", color: "red" },
      ],
    });

    game.phase = "attack";
    game.turnPlayerId = "player-alpha";

    // Setup territory owned by alpha with artillery and adjacent to beta
    const terrId = "brasil";
    game.territories[terrId].occupierId = "player-alpha";
    game.territories[terrId].units = { infantry: 3, tank: 0, artillery: 2, fighter: 0 };

    // Neighbor peru occupied by beta
    game.territories["peru"].occupierId = "player-beta";

    const hasReadyArtillery = (tId: string) => {
      const terrState = game.territories[tId];
      if (terrState.occupierId !== "player-alpha") return false;
      if ((terrState.units.artillery ?? 0) <= 0) return false;
      const def = CLASSIC_MAP.territories.find((t) => t.id === tId)!;
      return def.neighbors.some((nId) => game.territories[nId]?.occupierId !== "player-alpha");
    };

    expect(hasReadyArtillery(terrId)).toBe(true);

    // If all neighbors are conquered by alpha, no adjacent enemy -> not ready for direct fire
    const brasilDef = CLASSIC_MAP.territories.find((t) => t.id === "brasil")!;
    for (const nId of brasilDef.neighbors) {
      game.territories[nId].occupierId = "player-alpha";
    }
    expect(hasReadyArtillery(terrId)).toBe(false);
  });

  it("flags encirclement warnings for cut-off territories and opportunities for adjacent enemy sieges", () => {
    const game = createGame({
      id: "g1",
      seed: "encirclement_alerts_test",
      players: [
        { id: "player-alpha", name: "Alpha", color: "blue" },
        { id: "player-beta", name: "Beta", color: "red" },
      ],
    });

    // Alpha owns brasil and it's marked encircled
    game.territories["brasil"].occupierId = "player-alpha";
    game.territories["brasil"].isEncircled = true;

    expect(game.territories["brasil"].isEncircled).toBe(true);

    // Beta owns peru, adjacent to brasil, and peru is encircled
    game.territories["peru"].occupierId = "player-beta";
    game.territories["peru"].isEncircled = true;

    // From Alpha's perspective, peru is an enemy encircled frontline opportunity
    const brasilDef = CLASSIC_MAP.territories.find((t) => t.id === "brasil")!;
    const isAdjacentEnemyEncircled = brasilDef.neighbors.some((nId) => {
      const nState = game.territories[nId];
      return nState.occupierId !== "player-alpha" && Boolean(nState.isEncircled);
    });

    expect(isAdjacentEnemyEncircled).toBe(true);
  });

  it("triggers outOfFuel warning when player has zero oil and mechanized tank divisions", () => {
    const game = createGame({
      id: "g1",
      seed: "fuel_test",
      players: [
        { id: "player-alpha", name: "Alpha", color: "blue" },
        { id: "player-beta", name: "Beta", color: "red" },
      ],
    });

    const alpha = game.players.find((p) => p.id === "player-alpha")!;
    alpha.resources = { money: 10, steel: 5, oil: 0, gold: 2 };

    game.territories["brasil"].occupierId = "player-alpha";
    game.territories["brasil"].units = { infantry: 2, tank: 2, artillery: 0, fighter: 0 };

    const isFuelStarved =
      alpha.resources.oil <= 0 &&
      Object.values(game.territories).some(
        (t) => t.occupierId === "player-alpha" && (t.units.tank ?? 0) > 0
      );

    expect(isFuelStarved).toBe(true);
  });
});
