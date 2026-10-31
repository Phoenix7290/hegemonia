import type { GameAction, GameState, Player, UnitCounts } from "@hegemonia/shared";

export interface GameDebugApi {
  getState: () => GameState | null;
  getMyPlayerId: () => string | null;
  getMyPlayer: () => Player | null;
  sendAction: (action: GameAction | any) => void;
  giveResources: (resources: { money?: number; steel?: number; oil?: number; gold?: number }) => void;
  setTroops: (territoryId: string, count: number, composition?: Partial<UnitCounts>) => void;
  setPhase: (phase: "deploy" | "attack" | "maneuver" | "game_over") => void;
  selectTerritory: (territoryId: string | null) => void;
  forceScenario: (scenarioName: string) => boolean;
}

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebugApi;
    __IS_E2E__?: boolean;
  }
}

export interface DebugHookContext {
  getGame: () => GameState | null;
  setGame: (game: GameState) => void;
  getMyPlayerId: () => string | null;
  sendAction: (action: any) => void;
  selectTerritory: (id: string | null) => void;
}

/**
 * Installs the authoritative __GAME_DEBUG__ hook onto the window object
 * for headless simulations, Playwright E2E tests and AI Exploratory testing.
 */
export function installGameDebugHook(ctx: DebugHookContext): () => void {
  const isDev = import.meta.env.DEV;
  const isE2E = typeof window !== "undefined" && Boolean(window.__IS_E2E__);

  if (!isDev && !isE2E) {
    return () => {};
  }

  const debugApi: GameDebugApi = {
    getState: () => ctx.getGame(),
    getMyPlayerId: () => ctx.getMyPlayerId(),
    getMyPlayer: () => {
      const g = ctx.getGame();
      const myId = ctx.getMyPlayerId();
      if (!g || !myId) return null;
      return g.players.find((p) => p.id === myId) ?? null;
    },
    sendAction: (action) => ctx.sendAction(action),
    giveResources: (res) => {
      const g = ctx.getGame();
      const myId = ctx.getMyPlayerId();
      if (!g || !myId) return;
      const clone = structuredClone(g);
      const player = clone.players.find((p) => p.id === myId);
      if (!player) return;
      player.resources = player.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 };
      if (res.money !== undefined) player.resources.money += res.money;
      if (res.steel !== undefined) player.resources.steel += res.steel;
      if (res.oil !== undefined) player.resources.oil += res.oil;
      if (res.gold !== undefined) player.resources.gold += res.gold;
      ctx.setGame(clone);
    },
    setTroops: (territoryId, count, composition) => {
      const g = ctx.getGame();
      if (!g || !g.territories[territoryId]) return;
      const clone = structuredClone(g);
      const terr = clone.territories[territoryId];
      terr.armies = count;
      terr.units = {
        infantry: composition?.infantry ?? count,
        tank: composition?.tank ?? 0,
        artillery: composition?.artillery ?? 0,
        aircraft: composition?.aircraft ?? 0,
        navy: composition?.navy ?? 0,
      };
      ctx.setGame(clone);
    },
    setPhase: (phase) => {
      const g = ctx.getGame();
      if (!g) return;
      const clone = structuredClone(g);
      clone.phase = phase;
      ctx.setGame(clone);
    },
    selectTerritory: (id) => ctx.selectTerritory(id),
    forceScenario: (scenarioName) => {
      const g = ctx.getGame();
      if (!g) return false;
      const clone = structuredClone(g);
      const myId = ctx.getMyPlayerId() ?? clone.players[0]?.id;
      const myPlayer = clone.players.find((p) => p.id === myId);
      if (!myPlayer) return false;

      switch (scenarioName) {
        case "rich_market":
          // Grants abundant funds to test dynamic market trading
          myPlayer.resources = { money: 500, steel: 50, oil: 50, gold: 50 };
          break;

        case "war_room_ready":
          // Grants multiple cards to test Card Exchange 2.0 modal
          myPlayer.cards = [
            { id: "debug_c1", territoryId: "brasil", type: "infantry" },
            { id: "debug_c2", territoryId: "argentina", type: "tank" },
            { id: "debug_c3", territoryId: "peru", type: "artillery" },
            { id: "debug_c4", territoryId: "venezuela", type: "joker" },
          ];
          break;

        case "encircled_capital":
          // Isolate capital to test supply line and encirclement UI badges
          if (myPlayer.capitalTerritoryId && clone.territories[myPlayer.capitalTerritoryId]) {
            for (const [id, t] of Object.entries(clone.territories)) {
              if (t.ownerId === myId && id !== myPlayer.capitalTerritoryId) {
                t.isEncircled = true;
                t.encircledRounds = 2;
              }
            }
          }
          break;

        case "combat_ready":
          // Prepares high troop concentration on Brasil ready to assault
          if (clone.territories["brasil"]) {
            clone.territories["brasil"].ownerId = myId;
            clone.territories["brasil"].armies = 15;
            clone.territories["brasil"].units = { infantry: 10, tank: 3, artillery: 2, aircraft: 0, navy: 0 };
          }
          clone.round = 2;
          clone.phase = "attack";
          break;

        default:
          return false;
      }

      ctx.setGame(clone);
      return true;
    },
  };

  window.__GAME_DEBUG__ = debugApi;

  return () => {
    delete window.__GAME_DEBUG__;
  };
}
