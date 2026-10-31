import { describe, expect, it, beforeEach } from "vitest";
import { installGameDebugHook } from "./debug-hook";
import type { GameState } from "@hegemonia/shared";

describe("Design for Testability: window.__GAME_DEBUG__ Hook", () => {
  let mockGame: GameState;
  let actionsDispatched: any[];

  beforeEach(() => {
    (globalThis as any).window = globalThis;
    actionsDispatched = [];
    mockGame = {
      id: "debug_test_1",
      seed: "debug_seed",
      seedCommitHash: "hash",
      round: 1,
      phase: "deploy",
      turnIndex: 0,
      players: [
        {
          id: "p1",
          name: "General Alpha",
          color: "blue",
          isBot: false,
          armies: 10,
          unplacedArmies: 5,
          cards: [],
          resources: { money: 20, steel: 5, oil: 2, gold: 0 },
        } as any,
      ],
      territories: {
        brasil: {
          id: "brasil",
          ownerId: "p1",
          armies: 3,
          units: { infantry: 3, tank: 0, artillery: 0, aircraft: 0, navy: 0 },
        } as any,
      },
      log: [],
      worldTension: 0,
      treaties: [],
      coalitions: [],
      marketPrices: {
        steel: { buyPrice: 4, sellPrice: 2 },
        oil: { buyPrice: 5, sellPrice: 3 },
        gold: { buyPrice: 8, sellPrice: 5 },
      },
      investmentRoutes: [],
      borderTrades: [],
    };
  });

  it("installs debug hook and reads state, player and resources", () => {
    // Enable E2E simulation flag
    window.__IS_E2E__ = true;

    const uninstall = installGameDebugHook({
      getGame: () => mockGame,
      setGame: (g) => {
        mockGame = g;
      },
      getMyPlayerId: () => "p1",
      sendAction: (action) => actionsDispatched.push(action),
      selectTerritory: () => {},
    });

    expect(window.__GAME_DEBUG__).toBeDefined();
    expect(window.__GAME_DEBUG__?.getState()?.id).toBe("debug_test_1");
    expect(window.__GAME_DEBUG__?.getMyPlayerId()).toBe("p1");
    expect(window.__GAME_DEBUG__?.getMyPlayer()?.name).toBe("General Alpha");

    // Modify resources via debug hook
    window.__GAME_DEBUG__?.giveResources({ money: 100, steel: 10 });
    expect(mockGame.players[0].resources.money).toBe(120);
    expect(mockGame.players[0].resources.steel).toBe(15);

    // Modify troop counts via debug hook
    window.__GAME_DEBUG__?.setTroops("brasil", 10, { infantry: 8, tank: 2 });
    expect(mockGame.territories["brasil"].armies).toBe(10);
    expect(mockGame.territories["brasil"].units.tank).toBe(2);

    // Force scenario rich_market
    const applied = window.__GAME_DEBUG__?.forceScenario("rich_market");
    expect(applied).toBe(true);
    expect(mockGame.players[0].resources.money).toBe(500);

    // Dispatch action via debug hook
    window.__GAME_DEBUG__?.sendAction({ type: "end_attack" });
    expect(actionsDispatched).toHaveLength(1);
    expect(actionsDispatched[0]).toEqual({ type: "end_attack" });

    // Cleanup
    uninstall();
    expect(window.__GAME_DEBUG__).toBeUndefined();
  });
});
