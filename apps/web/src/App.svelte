<script lang="ts">
  import { Client, type Room } from "colyseus.js";
  import {
    ASIA_SUBREGIONS,
    CLASSIC_MAP,
    GRATICULE_SVG_PATH,
    MAP_HEIGHT,
    MAP_WIDTH,
  } from "@hegemonia/maps";
  import {
    BUILDING_COSTS,
    DEFAULT_MARKET_CONFIG,
    FORTIFICATION_LEVEL_2_COST,
    calculateTurnEconomy,
    findValidTradeTriplet,
    getTerritoryBuildingLevel,
    getTerritoryMaxBuildingSlots,
    getTradeBonusArmies,
    hasTerritoryBuilding,
    playerHasMarket,
  } from "@hegemonia/engine";
  import type { BuildingType, GameState, PlayerColor, ResourceType } from "@hegemonia/shared";
  import { sound } from "./audio.js";
  import { estimateAttackWinOdds } from "./odds.js";
  import { auth } from "./lib/auth.svelte";
  import { ui } from "./lib/ui.svelte";
  import CommandCenter, {
    type LobbyPlayerView,
  } from "./components/CommandCenter.svelte";
  import FactionFlag from "./components/FactionFlag.svelte";
  import Icon from "./components/Icon.svelte";
  import VictoryModal from "./components/VictoryModal.svelte";
  import WarJournal from "./components/WarJournal.svelte";
  import { CommunicationsController } from "./lib/communications.svelte";
  import { t } from "./i18n/index.svelte";
  import {
    getTerritoryName,
    getContinentName,
    getSubregionName,
    getObjectiveDescription,
    getObjectiveTitle,
    getFactionName,
  } from "./i18n/content.svelte";

  const COLOR_HEX: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#f59e0b",
    black: "#475569",
    white: "#e2e8f0",
  };

  const FACTION_NAME_PT: Record<PlayerColor, string> = {
    blue: "União Atlântica (Azul)",
    red: "Diretório Vermelho",
    green: "Pacto Esmeralda (Verde)",
    yellow: "Império Áureo (Amarelo)",
    black: "Legião de Ferro (Preto)",
    white: "Coalizão Boreal (Branco)",
  };

  function getOrCreateToken(): string {
    const saved = localStorage.getItem("hegemonia_token");
    if (saved) return saved;
    const fresh = "plr_" + crypto.randomUUID();
    localStorage.setItem("hegemonia_token", fresh);
    return fresh;
  }

  function getInitialPlayerName(): string {
    const saved = localStorage.getItem("hegemonia_name");
    if (!saved || saved === "General Ryan") {
      localStorage.setItem("hegemonia_name", "General");
      return "General";
    }
    return saved;
  }

  // --- Reactive State (Svelte 5 Runes) ---
  let playerName = $state(getInitialPlayerName());
  let roomCodeInput = $state("");
  let connectedRoom = $state<Room | null>(null);
  let connecting = $state(false);
  let roomCode = $state("");
  let roomStatus = $state<"disconnected" | "lobby" | "playing">("disconnected");
  let myPlayerId = $state<string | null>(null);
  let lobbyPlayers = $state<LobbyPlayerView[]>([]);
  const communications = new CommunicationsController();
  let game = $state<GameState | null>(null);
  let turnDeadline = $state(0);
  let remainingSeconds = $state(120);
  let errorBanner = $state("");

  // Sync playerName with authenticated user display name when available
  $effect(() => {
    if (auth.user?.displayName) {
      playerName = auth.user.displayName;
    }
  });

  // Notify Shell whether we are in an active battle so global header hides during combat
  $effect(() => {
    ui.inActiveBattle = roomStatus === "playing";
    return () => {
      ui.inActiveBattle = false;
    };
  });

  // Map Rendering Mode: "cartographic" (HOI4 physical satellite relief + borders), "geopolitical" (Crisp War colors), or "regional" (Continents & Sub-Regions)
  let mapMode = $state<"cartographic" | "geopolitical" | "regional">("cartographic");
  let cleanMapMode = $state(false);

  const REGION_COLOR_HEX: Record<string, string> = {
    south_america: "#10b981",
    north_america: "#f59e0b",
    europe: "#3b82f6",
    africa: "#eab308",
    oceania: "#a855f7",
    asia_indo_arabia: "#f97316",
    asia_steppes: "#06b6d4",
    asia_east: "#ec4899",
  };

  const REGION_BANNERS: { label: string; bonus: string; x: number; y: number; color: string }[] = [
    { label: "AMÉRICA DO NORTE", bonus: "+5", x: 265, y: 125, color: "#f59e0b" },
    { label: "AMÉRICA DO SUL", bonus: "+2", x: 392, y: 382, color: "#10b981" },
    { label: "EUROPA", bonus: "+5", x: 645, y: 132, color: "#3b82f6" },
    { label: "ÁFRICA", bonus: "+3", x: 655, y: 295, color: "#eab308" },
    { label: "ÁSIA: INDO-ARÁBIA", bonus: "+2", x: 835, y: 228, color: "#f97316" },
    { label: "ÁSIA: ESTEPES & SIBÉRIA", bonus: "+2", x: 935, y: 108, color: "#06b6d4" },
    { label: "ÁSIA: LESTE ASIÁTICO", bonus: "+3", x: 995, y: 185, color: "#ec4899" },
    { label: "OCEANIA", bonus: "+2", x: 1015, y: 375, color: "#a855f7" },
  ];

  function getTerritoryRegionColor(t: { continent: string; subRegion?: string }): string {
    if (t.subRegion && REGION_COLOR_HEX[t.subRegion]) {
      return REGION_COLOR_HEX[t.subRegion];
    }
    return REGION_COLOR_HEX[t.continent] ?? "#64748b";
  }

  const COMPACT_BADGE_IDS = new Set([
    "islandia",
    "inglaterra",
    "alemanha",
    "polonia",
    "balcas",
    "franca",
    "egito",
    "tchita",
    "mongolia",
    "vietna",
    "borneu",
    "sumatra",
    "nova_guine",
    "madagascar",
    "havai",
  ]);

  // Continuous Wraparound Camera State (in SVG coordinate space: width=1200, height=620)
  let camX = $state(0);
  let camY = $state(0);
  let zoom = $state(1.05);
  let isDragging = $state(false);
  let lastMouseX = $state(0);
  let lastMouseY = $state(0);

  // Keyboard WASD + Arrow Smooth Panning State
  const pressedKeys = new Set<string>();

  // Map Selection & Hover Intelligence State
  let selectedFromId = $state<string | null>(null);
  let selectedToId = $state<string | null>(null);
  let hoveredTerritoryId = $state<string | null>(null);
  let sliderArmies = $state(1);
  let selectedAttackDice = $state<number | null>(null); // null = auto max dice

  // HUD Drawers (Mutually Exclusive on Right Panel to Prevent Overlap)
  let activeRightDrawer = $state<"cards" | "objective" | "audio" | "market" | null>(null);
  let showContinents = $state(false);
  let marketBatchQty = $state<number>(1);

  // Session Resilience & Reconnection State
  let isReconnecting = $state(false);
  let reconnectAttempts = $state(0);
  let reconnectTimeout: number | null = null;

  // Objective Map Visualizer State
  let highlightObjectiveTerritories = $state(false);

  // Modular HUD Dock Visibility State (Customizer)
  let showHudManager = $state(false);
  let isImmersiveMode = $state(false);
  let hudVisibility = $state({
    topBanner: true,
    warJournal: true,
    bottomDock: true,
    continents: true,
    mapControls: true,
    recon: true,
  });

  if (typeof window !== "undefined") {
    try {
      const savedHud = localStorage.getItem("hegemonia_hud_visibility");
      if (savedHud) {
        Object.assign(hudVisibility, JSON.parse(savedHud));
      }
    } catch {
      // ignore JSON parse error
    }
  }

  function toggleHudElement(key: keyof typeof hudVisibility) {
    sound.playClick();
    hudVisibility[key] = !hudVisibility[key];
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("hegemonia_hud_visibility", JSON.stringify(hudVisibility));
      } catch {
        // ignore storage error
      }
    }
  }

  function toggleImmersiveMode() {
    sound.playClick();
    isImmersiveMode = !isImmersiveMode;
  }

  function toggleRightDrawer(drawer: "cards" | "objective" | "audio" | "market") {
    sound.playClick();
    showHudManager = false;
    activeRightDrawer = activeRightDrawer === drawer ? null : drawer;
    if (activeRightDrawer === "objective") {
      highlightObjectiveTerritories = true;
    }
  }

  // Derived calculations
  let currentTurnPlayer = $derived(game ? game.players[game.turnIndex] : null);
  let isMyTurn = $derived(Boolean(game && currentTurnPlayer && currentTurnPlayer.id === myPlayerId));
  let myPlayerState = $derived(game?.players.find((p) => p.id === myPlayerId) ?? null);
  let validTradeTriplet = $derived(myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null);
  let nextTradeBonus = $derived(game ? getTradeBonusArmies(game.tradeCount) : 4);
  let amIHost = $derived(lobbyPlayers.find((p) => p.token === myPlayerId)?.isHost ?? false);
  let myHasMarket = $derived(
    Boolean(game && myPlayerId && playerHasMarket(game, myPlayerId))
  );
  let eligibleInvestmentPartners = $derived.by(() => {
    if (!game || !myPlayerId) return [];
    return game.players.filter(
      (p) =>
        p.id !== myPlayerId &&
        !p.eliminated &&
        playerHasMarket(game, p.id) &&
        (game.treaties ?? []).some(
          (tr) =>
            tr.status === "active" &&
            ((tr.fromPlayerId === myPlayerId && tr.toPlayerId === p.id) ||
              (tr.fromPlayerId === p.id && tr.toPlayerId === myPlayerId))
        ) &&
        !(game.investmentRoutes ?? []).some(
          (ir) =>
            (ir.playerAId === myPlayerId && ir.playerBId === p.id) ||
            (ir.playerAId === p.id && ir.playerBId === myPlayerId)
        )
    );
  });

  function getEstBuyCost(resource: ResourceType, qty: number): number {
    if (!game?.marketPrices) return 0;
    const cfg = DEFAULT_MARKET_CONFIG[resource];
    let cost = 0;
    let p = game.marketPrices[resource].buyPrice;
    for (let i = 0; i < qty; i++) {
      cost += p;
      p = Math.min(cfg.maxBuy, p + cfg.step);
    }
    return cost;
  }

  function getEstSellRevenue(resource: ResourceType, qty: number): number {
    if (!game?.marketPrices) return 0;
    const cfg = DEFAULT_MARKET_CONFIG[resource];
    let rev = 0;
    let p = game.marketPrices[resource].sellPrice;
    for (let i = 0; i < qty; i++) {
      rev += p;
      p = Math.max(cfg.minSell, p - cfg.step);
    }
    return rev;
  }

  // Diplomatic Dossier, World Tension & Treaties State
  let activeDiplomacyTargetId = $state<string | null>(null);
  let activeDiplomacyTarget = $derived(
    game?.players.find((p) => p.id === activeDiplomacyTargetId) ?? null
  );
  let incomingTreatyProposals = $derived(
    game?.treaties?.filter(
      (t) => t.status === "pending" && t.toPlayerId === myPlayerId
    ) ?? []
  );
  let targetTreatyWithMe = $derived.by(() => {
    if (!game || !activeDiplomacyTargetId || !myPlayerId) return null;
    return (
      game.treaties?.find(
        (t) =>
          t.status !== "broken" &&
          ((t.fromPlayerId === myPlayerId && t.toPlayerId === activeDiplomacyTargetId) ||
            (t.fromPlayerId === activeDiplomacyTargetId && t.toPlayerId === myPlayerId))
      ) ?? null
    );
  });
  let activeCoalitionAgainstTarget = $derived(
    game?.coalitions?.find((c) => c.targetPlayerId === activeDiplomacyTargetId) ?? null
  );
  let myEconomyIncome = $derived.by(() => {
    if (!game || !myPlayerId) return null;
    return calculateTurnEconomy(game, myPlayerId);
  });

  const SOUNDTRACKS = [
    { id: "ambient_procedural", label: "Marcha Tática (Sintetizador Web Audio)" },
    { id: "hoi4_axis_theme.mp3", label: "Hearts of Iron IV — Axis Theme" },
    { id: "hoi4_katyusha.mp3", label: "Hearts of Iron IV — Katyusha" },
    { id: "hoi4_great_patriotic_war.mp3", label: "Hearts of Iron IV — The Great Patriotic War" },
    { id: "hoi4_bella_ciao.mp3", label: "Hearts of Iron IV — Bella Ciao" },
    { id: "the_second_european_war.mp3", label: "The Fire Rises — The Second European War" },
    { id: "tno_taboritsky_theme.mp3", label: "TNO — The Mad Regent's Lullaby" },
    { id: "tno_burgundian_lullaby.mp3", label: "TNO — Burgundian Lullaby" },
    { id: "teufelslied.mp3", label: "Histórico — Teufelslied" },
  ];

  let objectiveTargetTerritoryIds = $derived.by(() => {
    if (!myPlayerState || !game) return new Set<string>();
    const rule = myPlayerState.objective.rule;
    const targetIds = new Set<string>();
    if (rule.type === "specific_territories") {
      for (const tid of rule.territoryIds) targetIds.add(tid);
      if (rule.extraAnyOf) {
        for (const grp of rule.extraAnyOf) {
          for (const tid of grp) targetIds.add(tid);
        }
      }
    } else if (rule.type === "continents") {
      for (const t of CLASSIC_MAP.territories) {
        if (rule.continents.includes(t.continent)) targetIds.add(t.id);
      }
    } else if (rule.type === "territory_count") {
      for (const t of CLASSIC_MAP.territories) {
        if (game.territories[t.id]?.ownerId !== myPlayerId) targetIds.add(t.id);
      }
    } else if (rule.type === "eliminate_color") {
      for (const t of CLASSIC_MAP.territories) {
        const owner = game.players.find((p) => p.id === game.territories[t.id]?.ownerId);
        if (owner && owner.color === rule.targetColor) targetIds.add(t.id);
      }
    }
    return targetIds;
  });

  let objectiveProgress = $derived.by(() => {
    if (!myPlayerState || !game) return null;
    const targetIds = objectiveTargetTerritoryIds;
    if (targetIds.size === 0) return null;
    let owned = 0;
    for (const tid of targetIds) {
      if (game.territories[tid]?.ownerId === myPlayerId) owned++;
    }
    const total = targetIds.size;
    return { owned, total, pct: Math.round((owned / total) * 100) };
  });

  let currentAttackOdds = $derived.by(() => {
    if (!game || !selectedFromId || !selectedToId) return null;
    const fromT = game.territories[selectedFromId];
    const toT = game.territories[selectedToId];
    if (!fromT || !toT) return null;
    return estimateAttackWinOdds(fromT.armies, toT.armies);
  });

  let maxAttackerDice = $derived.by(() => {
    if (!game || !selectedFromId) return 3;
    const fromT = game.territories[selectedFromId];
    if (!fromT) return 3;
    return Math.max(1, Math.min(3, fromT.armies - 1));
  });

  let playerMetrics = $derived.by(() => {
    if (!game) return [];
    const totalTerrs = CLASSIC_MAP.territories.length;
    return game.players.map((p) => {
      const owned = Object.values(game!.territories).filter((t) => t.ownerId === p.id);
      const terrCount = owned.length;
      const totalArmies = owned.reduce((sum, t) => sum + t.armies, 0);
      const sharePct = Math.round((terrCount / totalTerrs) * 100);
      return {
        player: p,
        terrCount,
        totalArmies,
        sharePct,
      };
    });
  });

  const territoryById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));
  const continentById = new Map(CLASSIC_MAP.continents.map((c) => [c.id, c]));

  let inspectedTerritory = $derived.by(() => {
    if (!game) return null;
    const targetId = hoveredTerritoryId ?? selectedToId ?? selectedFromId;
    if (!targetId) return null;
    const def = territoryById.get(targetId);
    const state = game.territories[targetId];
    if (!def || !state) return null;
    const owner = game.players.find((p) => p.id === state.ownerId) ?? null;
    const cont = continentById.get(def.continent);
    const asiaSub = ASIA_SUBREGIONS.find((s) => s.territoryIds.includes(def.id));
    return {
      def,
      state,
      owner,
      regionName: asiaSub
        ? `${getContinentName("asia")} — ${getSubregionName(asiaSub.id)} (+${asiaSub.bonus})`
        : `${getContinentName(def.continent)} (+${cont?.bonus ?? 0})`,
    };
  });

  // Direct Intra-Tile Sea Links
  const DIRECT_SEA_LINKS: [string, string][] = [
    ["brasil", "argelia"],
    ["argentina", "africa_do_sul"],
    ["california", "havai"],
    ["groenlandia", "islandia"],
    ["inglaterra", "islandia"],
    ["inglaterra", "suecia"],
    ["inglaterra", "franca"],
    ["inglaterra", "alemanha"],
    ["franca", "argelia"],
    ["franca", "egito"],
    ["balcas", "egito"],
    ["sudao", "madagascar"],
    ["africa_do_sul", "madagascar"],
    ["india", "sumatra"],
    ["sumatra", "australia"],
    ["vietna", "borneu"],
    ["borneu", "australia"],
    ["borneu", "nova_guine"],
    ["nova_guine", "australia"],
    ["vladivostok", "japao"],
    ["china", "japao"],
  ];

  // Trans-Pacific Wraparound Sea Links (westTerritoryId on left edge -> eastTerritoryId on right edge - MAP_WIDTH)
  const PACIFIC_WRAP_LINKS: [string, string][] = [
    ["alasca", "vladivostok"],
    ["havai", "japao"],
    ["havai", "nova_guine"],
    ["argentina", "australia"],
  ];

  function wrapCamX(x: number): number {
    const half = MAP_WIDTH / 2;
    let res = (((x + half) % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH - half;
    return res;
  }

  function clampCamY(y: number): number {
    const maxPanY = 260;
    return Math.max(-maxPanY, Math.min(maxPanY, y));
  }

  // Turn alert sound
  let lastTurnPlayerId = "";
  $effect(() => {
    if (game && currentTurnPlayer && currentTurnPlayer.id !== lastTurnPlayerId) {
      lastTurnPlayerId = currentTurnPlayer.id;
      selectedFromId = null;
      selectedToId = null;
      if (currentTurnPlayer.id === myPlayerId) {
        sound.playTurnChime();
      }
    }
  });

  // Countdown timer
  $effect(() => {
    const timer = setInterval(() => {
      if (turnDeadline > 0) {
        remainingSeconds = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      }
    }, 500);
    return () => clearInterval(timer);
  });

  // Smooth 60fps WASD + Arrow Key Camera Loop
  $effect(() => {
    let rafId = 0;
    const step = () => {
      if (pressedKeys.size > 0 && roomStatus === "playing") {
        const panSpeed = 7.5 / Math.sqrt(zoom);
        let dx = 0;
        let dy = 0;
        if (pressedKeys.has("w") || pressedKeys.has("arrowup")) dy += panSpeed;
        if (pressedKeys.has("s") || pressedKeys.has("arrowdown")) dy -= panSpeed;
        if (pressedKeys.has("a") || pressedKeys.has("arrowleft")) dx += panSpeed;
        if (pressedKeys.has("d") || pressedKeys.has("arrowright")) dx -= panSpeed;

        if (dx !== 0) camX = wrapCamX(camX + dx);
        if (dy !== 0) camY = clampCamY(camY + dy);

        if (pressedKeys.has("q")) zoom = Math.max(0.75, zoom * 0.985);
        if (pressedKeys.has("e")) zoom = Math.min(4.5, zoom * 1.015);
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  });

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isInputFocused()) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "q", "e"].includes(k)) {
      pressedKeys.add(k);
    } else if (e.key === "F1" || k === "1") {
      e.preventDefault();
      mapMode = "geopolitical";
    } else if (e.key === "F2" || k === "2") {
      e.preventDefault();
      mapMode = "cartographic";
    } else if (e.key === "F3" || k === "3") {
      e.preventDefault();
      mapMode = "regional";
    } else if (k === "h") {
      e.preventDefault();
      toggleImmersiveMode();
    } else if (e.key === "F4") {
      e.preventDefault();
      cleanMapMode = !cleanMapMode;
    } else if (e.key === "Escape") {
      selectedFromId = null;
      selectedToId = null;
      activeRightDrawer = null;
      showHudManager = false;
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    pressedKeys.delete(e.key.toLowerCase());
  }

  function resolveWsUrl(): string {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (envUrl) return envUrl;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.port === "5173") {
      return `${proto}//${window.location.hostname}:2567`;
    }
    return `${proto}//${window.location.host}`;
  }

  async function joinOrCreateRoom(createNew: boolean, forcedCode?: string) {
    errorBanner = "";
    sound.playClick();
    const cleanName = (auth.user?.displayName || playerName).trim() || "General";
    playerName = cleanName;
    localStorage.setItem("hegemonia_name", cleanName);
    const client = new Client(resolveWsUrl());
    const token = getOrCreateToken();
    connecting = true;

    try {
      const code = createNew ? undefined : (forcedCode || roomCodeInput).trim().toUpperCase();
      const room = await client.joinOrCreate("hegemonia", {
        name: cleanName,
        token,
        roomCode: code,
      });

      connectedRoom = room;
      communications.attach(room, token, lobbyPlayers);
      isReconnecting = false;
      reconnectAttempts = 0;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      // Persist active room for F5 resilience and bookmark sharing
      try {
        sessionStorage.setItem("hegemonia_active_room", room.id);
        const url = new URL(window.location.href);
        url.searchParams.set("room", room.id);
        window.history.replaceState({}, "", url.toString());
      } catch {
        // ignore storage error
      }

      room.onLeave((code) => {
        if (roomStatus === "disconnected") return;
        if (code !== 1000) {
          isReconnecting = true;
          reconnectAttempts++;
          if (reconnectAttempts <= 8) {
            reconnectTimeout = window.setTimeout(() => {
              if (roomStatus !== "disconnected") {
                joinOrCreateRoom(false, room.id);
              }
            }, 2000);
          } else {
            isReconnecting = false;
            errorBanner = "Conexão perdida com o quartel general. Tente reconectar.";
          }
        }
      });

      room.onMessage("room_state", (payload) => {
        const prevLastCombat = game?.lastCombat;
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        communications.setMyPlayerId(payload.myPlayerId);
        communications.setPlayers(payload.lobbyPlayers);
        game = payload.game;

        if (game?.pendingConquest) {
          sliderArmies = game.pendingConquest.maxMove;
        }

        if (game?.lastCombat && game.lastCombat !== prevLastCombat) {
          sound.playCombatAttack();
          sound.playDiceRoll();
          if (game.lastCombat.conquered) {
            setTimeout(() => sound.playConquest(), 300);
          }
        }
      });

      room.onMessage("error_msg", (payload: { message: string }) => {
        errorBanner = payload.message;
        setTimeout(() => {
          if (errorBanner === payload.message) errorBanner = "";
        }, 4200);
      });
    } catch (err: unknown) {
      errorBanner = err instanceof Error ? err.message : "Falha ao conectar ao servidor Hegemonia.";
    } finally {
      connecting = false;
    }
  }

  // Auto-reconnect to previous session on page refresh (F5) or direct room link
  $effect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get("room");
    const roomFromStorage = sessionStorage.getItem("hegemonia_active_room");
    const targetRoom = roomFromUrl || roomFromStorage;

    if (targetRoom && roomStatus === "disconnected" && !connecting && !connectedRoom) {
      roomCodeInput = targetRoom.toUpperCase();
      joinOrCreateRoom(false, targetRoom.toUpperCase());
    }
  });

  function leaveCurrentRoom() {
    sound.playClick();
    communications.detach();
    try {
      sessionStorage.removeItem("hegemonia_active_room");
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore
    }
    isReconnecting = false;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    try {
      connectedRoom?.leave();
    } catch {
      // ignore disconnect errors
    }
    connectedRoom = null;
    roomStatus = "disconnected";
    roomCode = "";
    game = null;
    lobbyPlayers = [];
    selectedFromId = null;
    selectedToId = null;
    activeRightDrawer = null;
    showHudManager = false;
  }

  function sendAction(action: unknown) {
    sound.playClick();
    connectedRoom?.send("game_action", action);
  }

  function handleProposeTreaty(targetPlayerId: string, treatyType: "nap" | "alliance") {
    sendAction({
      type: "propose_treaty",
      targetPlayerId,
      treatyType,
    });
  }

  function handleAcceptTreaty(treatyId: string) {
    sendAction({
      type: "accept_treaty",
      treatyId,
    });
  }

  function handleRejectTreaty(treatyId: string) {
    sendAction({
      type: "reject_treaty",
      treatyId,
    });
  }

  function handleBreakTreaty(treatyId: string) {
    sendAction({
      type: "break_treaty",
      treatyId,
    });
  }

  function handleFormCoalition(targetPlayerId: string) {
    sendAction({
      type: "form_coalition",
      targetPlayerId,
    });
  }

  function handleJoinCoalition(coalitionId: string) {
    sendAction({
      type: "join_coalition",
      coalitionId,
    });
  }

  function handleBuildStructure(territoryId: string, buildingType: BuildingType) {
    sendAction({
      type: "build_structure",
      territoryId,
      buildingType,
    });
  }

  function handleMarketTrade(resource: ResourceType, operation: "buy" | "sell") {
    sendAction({
      type: "market_trade",
      resource,
      operation,
      quantity: marketBatchQty,
    });
  }

  function handleProposeInvestment(targetPlayerId: string) {
    sendAction({
      type: "propose_investment",
      targetPlayerId,
    });
  }

  function handleAcceptInvestment(routeId: string) {
    sendAction({
      type: "accept_investment",
      routeId,
    });
  }

  function handleRejectInvestment(routeId: string) {
    sendAction({
      type: "reject_investment",
      routeId,
    });
  }

  function handleAcceptBorderTrade(dealId: string) {
    sendAction({
      type: "accept_border_trade",
      dealId,
    });
  }

  function handleRejectBorderTrade(dealId: string) {
    sendAction({
      type: "reject_border_trade",
      dealId,
    });
  }

  function onTerritoryClick(terrId: string) {
    if (!game || !isMyTurn || game.pendingConquest) return;
    sound.playClick();
    const tState = game.territories[terrId];
    const tDef = territoryById.get(terrId)!;

    if (game.phase === "deploy") {
      if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        if ((myPlayerState?.unplacedArmies ?? 0) > 0) {
          sliderArmies = myPlayerState!.unplacedArmies;
        }
      }
      return;
    }

    if (game.phase === "attack") {
      if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        selectedToId = null;
        selectedAttackDice = null;
      } else if (
        selectedFromId &&
        tState.ownerId !== myPlayerId &&
        (game.territories[selectedFromId]?.armies ?? 0) >= 2 &&
        territoryById.get(selectedFromId)!.neighbors.includes(terrId)
      ) {
        selectedToId = terrId;
      }
      return;
    }

    if (game.phase === "maneuver") {
      const fromT = selectedFromId ? game.territories[selectedFromId] : null;
      const isAirliftTarget =
        Boolean(selectedFromId) &&
        terrId !== selectedFromId &&
        tState.ownerId === myPlayerId &&
        Boolean(fromT && hasTerritoryBuilding(fromT, "airfield")) &&
        hasTerritoryBuilding(tState, "airfield") &&
        !fromT?.airliftedThisTurn;

      if (
        selectedFromId &&
        terrId !== selectedFromId &&
        tState.ownerId === myPlayerId &&
        (tDef.neighbors.includes(selectedFromId) || isAirliftTarget)
      ) {
        selectedToId = terrId;
      } else if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        selectedToId = null;
        sliderArmies = Math.max(1, tState.armies - tState.movedInArmies - 1);
      }
    }
  }

  function confirmDeploy() {
    if (!selectedFromId) return;
    sendAction({ type: "deploy", territoryId: selectedFromId, armies: sliderArmies });
    selectedFromId = null;
  }

  function confirmAttack() {
    if (!selectedFromId || !selectedToId) return;
    const payload: {
      type: "attack";
      fromTerritoryId: string;
      toTerritoryId: string;
      diceCount?: number;
    } = {
      type: "attack",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
    };
    if (selectedAttackDice !== null) {
      payload.diceCount = Math.min(selectedAttackDice, maxAttackerDice);
    }
    sendAction(payload);
  }

  function confirmManeuver() {
    if (!selectedFromId || !selectedToId) return;
    const isAdjacent = territoryById.get(selectedFromId)?.neighbors.includes(selectedToId);
    if (isAdjacent) {
      sendAction({
        type: "maneuver",
        fromTerritoryId: selectedFromId,
        toTerritoryId: selectedToId,
        armies: sliderArmies,
      });
    } else {
      sendAction({
        type: "airlift",
        fromTerritoryId: selectedFromId,
        toTerritoryId: selectedToId,
        armies: sliderArmies,
      });
    }
    selectedFromId = null;
    selectedToId = null;
  }

  // --- Mouse Drag & Wheel Camera Controls ---
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    if (target.closest(".hud-panel") || target.closest(".war-journal-panel")) return;
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dxPx = e.clientX - lastMouseX;
    const dyPx = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    const svgScale = MAP_WIDTH / Math.max(window.innerWidth, 320);
    camX = wrapCamX(camX + (dxPx * svgScale) / zoom);
    camY = clampCamY(camY + (dyPx * svgScale) / zoom);
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.14 : 0.88;
    zoom = Math.max(0.75, Math.min(4.5, zoom * zoomFactor));
  }

  function zoomIn() {
    zoom = Math.min(4.5, zoom + 0.3);
  }
  function zoomOut() {
    zoom = Math.max(0.75, zoom - 0.3);
  }
  function resetZoom() {
    zoom = 1.05;
    camX = 0;
    camY = 0;
  }
</script>

<svelte:window
  onmouseup={onMouseUp}
  onmousemove={onMouseMove}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
/>

<main class="hegemonia-app">
  {#if errorBanner}
    <div class="alert-toast" role="alert">
      <Icon name="shield" size={16} />
      <span>{errorBanner}</span>
    </div>
  {/if}

  {#if roomStatus === "disconnected" || roomStatus === "lobby"}
    <CommandCenter
      {roomStatus}
      bind:playerName
      bind:roomCodeInput
      {roomCode}
      {myPlayerId}
      {lobbyPlayers}
      {communications}
      {connecting}
      onCreateRoom={() => joinOrCreateRoom(true)}
      onJoinRoom={() => joinOrCreateRoom(false)}
      onLeaveRoom={leaveCurrentRoom}
      onChooseColor={(color) => connectedRoom?.send("choose_color", { color })}
      onAddBot={() => connectedRoom?.send("add_bot")}
      onRemoveBot={(token) => connectedRoom?.send("remove_bot", { token })}
      onStartGame={() => connectedRoom?.send("start_game")}
    />
  {:else if game}
    <!-- FULLSCREEN CONTINUOUS WRAPAROUND GEOPOLITICAL & CARTOGRAPHIC MAP (UNTOUCHED) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="map-viewport" onwheel={onWheel} onmousedown={onMouseDown}>
      {#if cleanMapMode}
        <div class="clean-map-indicator">
          <Icon name="eye" size={13} />
          <span>Visão Limpa Ativa — Pressione <strong>F4</strong> para restaurar marcadores</span>
        </div>
      {/if}
      <svg
        viewBox="0 0 {MAP_WIDTH} {MAP_HEIGHT}"
        preserveAspectRatio="xMidYMid slice"
        class="world-svg"
      >
        <defs>
          <!-- Tactical Grid Overlay -->
          <pattern id="tactical-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(30, 41, 59, 0.35)" stroke-width="0.6" />
          </pattern>

          <!-- Cartographic Topographic Relief Hatching Pattern -->
          <pattern id="topo-relief" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(15, 23, 42, 0.32)" stroke-width="1.4" />
          </pattern>

          <!-- Selection & Target Glow -->
          <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#facc15" flood-opacity="0.95" />
          </filter>

          <!-- Secret Objective Highlights -->
          <filter id="glow-green" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="0" stdDeviation="4.0" flood-color="#10b981" flood-opacity="1" />
          </filter>
          <filter id="glow-red" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#ef4444" flood-opacity="1" />
          </filter>
        </defs>

        <!-- CAMERA RIG: Pans & Zooms in Pure SVG Space with Seamless Horizontal Wraparound -->
        <g
          class="camera-rig"
          transform="translate({MAP_WIDTH / 2}, {MAP_HEIGHT / 2}) scale({zoom}) translate({-MAP_WIDTH / 2 + camX}, {-MAP_HEIGHT / 2 + camY})"
        >
          <!-- Deep Bathymetry Ocean Backdrop spanning all 3 wrapped world copies -->
          <rect
            id="ocean-bg"
            x={-MAP_WIDTH * 2}
            y={-MAP_HEIGHT}
            width={MAP_WIDTH * 5}
            height={MAP_HEIGHT * 3}
            fill={mapMode === "cartographic" ? "#061121" : "#08172e"}
          />
          <rect
            x={-MAP_WIDTH * 2}
            y={-MAP_HEIGHT}
            width={MAP_WIDTH * 5}
            height={MAP_HEIGHT * 3}
            fill="url(#tactical-grid)"
          />

          <!-- 3 HORIZONTAL WORLD COPIES (-1200, 0, +1200) FOR CONTINUOUS EU4/HOI4 GLOBE WRAPPING -->
          {#each [-MAP_WIDTH, 0, MAP_WIDTH] as offsetX (offsetX)}
            <g class="world-copy" transform="translate({offsetX}, 0)">
              {#if mapMode === "cartographic"}
                <!-- NASA Blue Marble Topography + Ocean Bathymetry Satellite Raster Layer (Exact Equirectangular Match: x=0..1200, y=20..620) -->
                <image
                  href="/maps/world-relief.jpg"
                  x="0"
                  y="20"
                  width={MAP_WIDTH}
                  height="600"
                  preserveAspectRatio="none"
                  opacity="0.94"
                  pointer-events="none"
                />
                <!-- Latitude / Longitude Graticule Lines -->
                <path
                  d={GRATICULE_SVG_PATH}
                  fill="none"
                  stroke="rgba(186, 230, 253, 0.13)"
                  stroke-width="0.5"
                  pointer-events="none"
                />
              {:else}
                <path
                  d={GRATICULE_SVG_PATH}
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.12)"
                  stroke-width="0.5"
                  pointer-events="none"
                />
              {/if}

              <!-- Direct Intra-Tile Maritime Connections -->
              {#each DIRECT_SEA_LINKS as [a, b]}
                {@const ta = territoryById.get(a)!}
                {@const tb = territoryById.get(b)!}
                <line
                  x1={ta.center[0]}
                  y1={ta.center[1]}
                  x2={tb.center[0]}
                  y2={tb.center[1]}
                  stroke={mapMode === "cartographic" ? "rgba(224, 242, 254, 0.65)" : "#64748b"}
                  stroke-dasharray="3.5,4"
                  stroke-width="1.35"
                  pointer-events="none"
                />
              {/each}

              <!-- Trans-Pacific Wraparound Sea Routes (Alaska<->Vladivostok, Hawaii<->Japan, Hawaii<->New Guinea, Argentina<->Australia) -->
              {#each PACIFIC_WRAP_LINKS as [westId, eastId]}
                {@const tw = territoryById.get(westId)!}
                {@const te = territoryById.get(eastId)!}
                <!-- Line crossing the Western seam (from westId to eastId in the left copy) -->
                <line
                  x1={tw.center[0]}
                  y1={tw.center[1]}
                  x2={te.center[0] - MAP_WIDTH}
                  y2={te.center[1]}
                  stroke={mapMode === "cartographic" ? "rgba(224, 242, 254, 0.72)" : "#94a3b8"}
                  stroke-dasharray="4,4"
                  stroke-width="1.5"
                  pointer-events="none"
                />
              {/each}

              <!-- 44 Natural Earth Admin-1 & Admin-0 Geopolitical Territories -->
              {#each CLASSIC_MAP.territories as t (t.id)}
                {@const tState = game.territories[t.id]}
                {@const owner = game.players.find((p) => p.id === tState.ownerId)}
                {@const ownerColor = owner ? COLOR_HEX[owner.color] : "#334155"}
                {@const regionColor = getTerritoryRegionColor(t as any)}
                {@const activeFill = mapMode === "regional" ? regionColor : ownerColor}
                {@const isSelected = selectedFromId === t.id || selectedToId === t.id}
                {@const fromTerrState = selectedFromId ? game.territories[selectedFromId] : null}
                {@const isAirliftDest =
                  Boolean(selectedFromId) &&
                  t.id !== selectedFromId &&
                  game.phase === "maneuver" &&
                  tState.ownerId === myPlayerId &&
                  Boolean(fromTerrState && hasTerritoryBuilding(fromTerrState, "airfield")) &&
                  hasTerritoryBuilding(tState, "airfield") &&
                  !fromTerrState?.airliftedThisTurn}
                {@const isValidTarget =
                  selectedFromId &&
                  ((game.phase === "attack" &&
                    tState.ownerId !== myPlayerId &&
                    (fromTerrState?.armies ?? 0) >= 2 &&
                    territoryById.get(selectedFromId)?.neighbors.includes(t.id)) ||
                   (game.phase === "maneuver" &&
                    tState.ownerId === myPlayerId &&
                    (territoryById.get(selectedFromId)?.neighbors.includes(t.id) || isAirliftDest)))}
                {@const isObjTarget = highlightObjectiveTerritories && objectiveTargetTerritoryIds.has(t.id)}
                {@const isObjOwned = isObjTarget && tState.ownerId === myPlayerId}
                {@const isObjPending = isObjTarget && tState.ownerId !== myPlayerId}
                {@const isObjDimmed = highlightObjectiveTerritories && objectiveTargetTerritoryIds.size > 0 && !isObjTarget}
                {@const isCapital = owner?.capitalTerritoryId === t.id}
                {@const originalCapitalOwner = game.players.find((p) => p.capitalTerritoryId === t.id)}
                {@const isFallenCapital = originalCapitalOwner && originalCapitalOwner.id !== tState.ownerId}
                {@const fortLevel = getTerritoryBuildingLevel(tState, "fortification")}

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g
                  class="territory-group"
                  onclick={() => onTerritoryClick(t.id)}
                  onmouseenter={() => (hoveredTerritoryId = t.id)}
                  onmouseleave={() => {
                    if (hoveredTerritoryId === t.id) hoveredTerritoryId = null;
                  }}
                >
                  <!-- Political or Regional Fill + Frontier Border -->
                  <path
                    d={t.svgPath}
                    fill={isObjOwned ? "#059669" : isObjPending ? "#dc2626" : activeFill}
                    fill-opacity={isObjTarget
                      ? "0.85"
                      : isSelected
                        ? "0.88"
                        : mapMode === "cartographic"
                          ? "0.42"
                          : mapMode === "regional"
                            ? "0.72"
                            : "0.84"}
                    stroke={isSelected
                      ? "#ffffff"
                      : isValidTarget
                        ? "#facc15"
                        : isObjPending
                          ? "#ef4444"
                          : isObjOwned
                            ? "#10b981"
                            : mapMode === "cartographic"
                              ? ownerColor
                              : "rgba(9, 13, 22, 0.9)"}
                    stroke-width={isSelected
                      ? "2.6"
                      : isValidTarget || isObjPending
                        ? "2.4"
                        : isObjOwned
                          ? "2.0"
                          : mapMode === "cartographic"
                            ? "1.6"
                            : "1.0"}
                    stroke-linejoin="round"
                    filter={isSelected || isValidTarget
                      ? "url(#glow-gold)"
                      : isObjPending
                        ? "url(#glow-red)"
                        : isObjOwned
                          ? "url(#glow-green)"
                          : undefined}
                    style={isObjDimmed ? "opacity: 0.28; transition: opacity 0.25s ease;" : "transition: opacity 0.25s ease;"}
                  />

                  {#if mapMode === "cartographic"}
                    <!-- Crisp Dark Inner Frontier Line so Neighboring Same-Color Provinces Remain Distinct Over Satellite Terrain -->
                    <path
                      d={t.svgPath}
                      fill="none"
                      stroke="rgba(6, 10, 18, 0.78)"
                      stroke-width="0.7"
                      pointer-events="none"
                    />
                  {/if}

                  {#if !cleanMapMode}
                    <!-- HOI4-STYLE MILITARY DIVISION COUNTER (COMPACT FLAG + TROOP COUNT) -->
                    <g
                      transform="translate({t.center[0]}, {t.center[1]}) scale({COMPACT_BADGE_IDS.has(t.id) ? 0.82 : 0.94})"
                      class="division-counter"
                    >
                      <!-- Capital Crown / Golden Star Crest -->
                      {#if isCapital}
                        <g transform="translate(0, -10.2)">
                          <circle cx="0" cy="0" r="4.2" fill="#090e1a" stroke="#f59e0b" stroke-width="1.3" />
                          <polygon points="0,-3.2 0.95,-0.9 3.2,-0.9 1.4,0.4 2.1,2.6 0,1.3 -2.1,2.6 -1.4,0.4 -3.2,-0.9 -0.95,-0.9" fill="#facc15" />
                        </g>
                      {:else if isFallenCapital}
                        <g transform="translate(0, -10.2)">
                          <circle cx="0" cy="0" r="4.2" fill="#090e1a" stroke="#ef4444" stroke-width="1.3" />
                          <polygon points="0,-3.2 0.95,-0.9 3.2,-0.9 1.4,0.4 2.1,2.6 0,1.3 -2.1,2.6 -1.4,0.4 -3.2,-0.9 -0.95,-0.9" fill="#94a3b8" />
                          <line x1="-2.8" y1="-2.8" x2="2.8" y2="2.8" stroke="#ef4444" stroke-width="1.2" />
                        </g>
                      {/if}

                      <rect
                        x="-13"
                        y="-6.5"
                        width="26"
                        height="13"
                        rx="2.2"
                        fill="#090e1a"
                        stroke={isCapital
                          ? "#f59e0b"
                          : isFallenCapital
                            ? "#ef4444"
                            : isSelected
                              ? "#ffffff"
                              : isValidTarget
                                ? "#facc15"
                                : isObjPending
                                  ? "#ef4444"
                                  : isObjOwned
                                    ? "#10b981"
                                    : ownerColor}
                        stroke-width={isCapital || isFallenCapital || isSelected || isValidTarget || isObjTarget ? "1.6" : "1.1"}
                        filter="drop-shadow(0 1.5px 3px rgba(0,0,0,0.85))"
                      />
                      <!-- Mini Faction Flag inside Left Half of Counter -->
                      {#if owner}
                        <g transform="translate(-11.2, -4.5) scale(0.75)">
                          {#if owner.color === "blue"}
                            <rect width="13" height="12" fill="#1d4ed8" />
                            <polygon points="6.5,2 8,5 11,6 8,7 6.5,10 5,7 2,6 5,5" fill="#f8fafc" />
                          {:else if owner.color === "red"}
                            <rect width="13" height="12" fill="#b91c1c" />
                            <polygon points="6.5,2.5 9.5,6 6.5,9.5 3.5,6" fill="#facc15" />
                          {:else if owner.color === "green"}
                            <rect width="13" height="12" fill="#047857" />
                            <polygon points="0,0 6,6 0,12" fill="#fcd34d" />
                          {:else if owner.color === "yellow"}
                            <rect width="13" height="12" fill="#d97706" />
                            <circle cx="6.5" cy="6" r="2.8" fill="#fef08a" />
                          {:else if owner.color === "black"}
                            <rect width="13" height="12" fill="#1e293b" />
                            <path d="M0,6 H13 M6.5,0 V12" stroke="#e2e8f0" stroke-width="2" />
                          {:else}
                            <rect width="13" height="12" fill="#e2e8f0" />
                            <path d="M0,6 H13 M5,0 V12" stroke="#1e293b" stroke-width="2.2" />
                          {/if}
                        </g>
                      {/if}
                      <!-- Divider Line -->
                      <line x1="-0.8" y1="-5.8" x2="-0.8" y2="5.8" stroke="rgba(148, 163, 184, 0.35)" stroke-width="0.7" />
                      <!-- Crisp Troop Count -->
                      <text
                        x="6"
                        y="0.4"
                        text-anchor="middle"
                        dominant-baseline="central"
                        fill="#ffffff"
                        font-size="8.2"
                        font-weight="800"
                        font-family="system-ui, -apple-system, sans-serif"
                        pointer-events="none"
                      >
                        {tState.armies}
                      </text>

                      <!-- Fortification Crest -->
                      {#if fortLevel > 0}
                        <g transform="translate(13.5, -4.5)">
                          <circle cx="0" cy="0" r="3.4" fill="#090e1a" stroke={fortLevel === 2 ? "#38bdf8" : "#94a3b8"} stroke-width="1.1" />
                          <polygon points="0,-1.8 1.4,-0.8 1.4,1 0,1.8 -1.4,1 -1.4,-0.8" fill={fortLevel === 2 ? "#38bdf8" : "#cbd5e1"} />
                        </g>
                      {/if}

                      <!-- Territory Label Underneath Counter -->
                      <text
                        x="0"
                        y="11.2"
                        text-anchor="middle"
                        fill={isCapital ? "#fde047" : "#e2e8f0"}
                        font-size="6.2"
                        font-weight="700"
                        letter-spacing="0.01em"
                        pointer-events="none"
                        style="paint-order: stroke; stroke: #050912; stroke-width: 2.4px; stroke-linejoin: round;"
                      >
                        {isCapital ? `⭐ ${getTerritoryName(t.id)}` : getTerritoryName(t.id)}
                      </text>

                      <!-- Structural Indicators (Dots for constructed infrastructure) -->
                      {#if tState.buildings && tState.buildings.length > 0}
                        <g transform="translate(0, 16.5)" pointer-events="none">
                          {#each tState.buildings as b, bIdx}
                            {@const xOffset = (bIdx - (tState.buildings.length - 1) / 2) * 5.2}
                            <circle
                              cx={xOffset}
                              cy="0"
                              r="1.7"
                              fill={b.type === "fortification"
                                ? (b.level === 2 ? "#38bdf8" : "#94a3b8")
                                : b.type === "market"
                                  ? "#f59e0b"
                                  : b.type === "industry"
                                    ? "#fb923c"
                                    : b.type === "airfield"
                                      ? "#60a5fa"
                                      : "#2dd4bf"}
                              stroke="#090e1a"
                              stroke-width="0.6"
                            />
                          {/each}
                        </g>
                      {/if}
                    </g>
                  {/if}
                </g>
              {/each}

              <!-- Floating Regional & Sub-Regional Theatre Banners in "regional" Map Mode -->
              {#if mapMode === "regional" && !cleanMapMode}
                {#each REGION_BANNERS as rb}
                  <g transform="translate({rb.x}, {rb.y})" pointer-events="none">
                    <rect
                      x="-68"
                      y="-11"
                      width="136"
                      height="20"
                      rx="4"
                      fill="rgba(6, 10, 18, 0.88)"
                      stroke={rb.color}
                      stroke-width="1.5"
                    />
                    <text
                      x="0"
                      y="-1"
                      text-anchor="middle"
                      dominant-baseline="central"
                      fill="#f8fafc"
                      font-size="7.8"
                      font-weight="900"
                      letter-spacing="0.06em"
                    >
                      {rb.label} ({rb.bonus})
                    </text>
                  </g>
                {/each}
              {/if}
            </g>
          {/each}
        </g>
      </svg>
    </div>

    <!-- POST-VICTORY DOSSIER MODAL (HEGEM-9) -->
    {#if game.winnerId}
      <VictoryModal
        {game}
        {myPlayerId}
        {playerMetrics}
        {amIHost}
        onReturnRoomToLobby={() => connectedRoom?.send("return_to_lobby")}
        onReturnToLobby={leaveCurrentRoom}
      />
    {/if}

    <!-- FLOATING SUPREME COMMAND HUD LAYER -->
    <div class="hud-layer">
      <!-- ⚡ REAL-TIME TREATY PROPOSALS TOAST -->
      {#if incomingTreatyProposals.length > 0}
        <div class="treaty-notifications-layer">
          {#each incomingTreatyProposals as prop}
            {@const sender = game.players.find((p) => p.id === prop.fromPlayerId)}
            <div class="treaty-notif-toast">
              <div class="toast-icon">
                <Icon name="handshake" size={18} />
              </div>
              <div class="toast-body">
                <strong>Proposta Diplomática Recebida</strong>
                <span>
                  {sender?.name ?? "General"} propôs um <strong>{prop.type === "alliance" ? "Tratado de Aliança Militar" : "Pacto de Não-Agressão (NAP)"}</strong>
                </span>
              </div>
              <div class="toast-actions">
                <button class="btn-toast-accept" onclick={() => handleAcceptTreaty(prop.id)}>
                  <Icon name="check" size={12} /> Aceitar
                </button>
                <button class="btn-toast-reject" onclick={() => handleRejectTreaty(prop.id)}>
                  <Icon name="close" size={12} /> Recusar
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- ↖ TOP-LEFT: HEGEMONIA BRANDING, BALANCE OF POWER & CONTINENT/ASIA SUB-REGIONS -->
      {#if !isImmersiveMode && hudVisibility.continents}
        <aside class="hud-panel top-left-panel">
        <div class="panel-header">
          <div class="brand-row">
            <img src="/hegemonia-logo.webp" alt="Hegemonia" class="hud-mini-logo" />
            <div class="brand-lockup">
              <strong>HEGEMONIA</strong>
              <small>OPERAÇÃO {roomCode}</small>
            </div>
            <span class="round-tag" title={t("round", { round: game.round })}>
              {t("round", { round: game.round }).toUpperCase()}
            </span>
          </div>
        </div>

        {#if game.round === 1}
          <div class="round1-treaty-banner">
            <Icon name="shield" size={13} />
            <span>{t("banner_round1_treaty")}</span>
          </div>
        {/if}

        <!-- Global World Tension Gauge (One-way Escalation) -->
        <div class="world-tension-wrap" title="Tensão Mundial: {game.worldTension ?? 0}% (Alianças Militares em 50%)">
          <div class="tension-top-row">
            <span class="tension-title"><Icon name="globe" size={12} /> TENSÃO MUNDIAL</span>
            <strong class="tension-value" class:high-tension={(game.worldTension ?? 0) >= 50}>{game.worldTension ?? 0}%</strong>
          </div>
          <div class="tension-gauge-bar">
            <div
              class="tension-gauge-fill"
              class:critical={(game.worldTension ?? 0) >= 66}
              class:elevated={(game.worldTension ?? 0) >= 34}
              style="width: {game.worldTension ?? 0}%;"
            ></div>
            <div class="tension-threshold-marker" style="left: 50%;" title="Desbloqueio de Alianças Militares (50%)"></div>
          </div>
          <div class="tension-subtext">
            {#if (game.worldTension ?? 0) < 50}
              <span>Alianças Militares bloqueadas (&ge; 50%)</span>
            {:else}
              <span class="unlocked-text">Alianças Militares Desbloqueadas</span>
            {/if}
          </div>
        </div>

        {#if activeDiplomacyTarget}
          <!-- DOSSIÊ DIPLOMÁTICO VIEW -->
          <div class="diplomacy-dossier">
            <div class="dossier-header">
              <button class="btn-dossier-back" onclick={() => (activeDiplomacyTargetId = null)}>
                <Icon name="back" size={13} />
                <span>Voltar ao Quadro Geral</span>
              </button>
            </div>

            <div class="dossier-target-card" style="border-left-color: {COLOR_HEX[activeDiplomacyTarget.color]};">
              <div class="target-card-top">
                <FactionFlag color={activeDiplomacyTarget.color} width={24} height={16} />
                <div class="target-card-info">
                  <strong>{activeDiplomacyTarget.name}</strong>
                  <small>DOSSIÊ DO GENERAL</small>
                </div>
              </div>

              <!-- Infamy Gauge -->
              <div class="infamy-wrap">
                <div class="infamy-row">
                  <span>INFÂMIA DO GENERAL</span>
                  <strong class="infamy-value" class:high-infamy={(activeDiplomacyTarget.infamy ?? 0) >= 50}>
                    {activeDiplomacyTarget.infamy ?? 0}%
                  </strong>
                </div>
                <div class="infamy-bar">
                  <div
                    class="infamy-fill"
                    class:grand-threat={(activeDiplomacyTarget.infamy ?? 0) >= 100}
                    class:bilateral-threat={(activeDiplomacyTarget.infamy ?? 0) >= 50}
                    style="width: {activeDiplomacyTarget.infamy ?? 0}%;"
                  ></div>
                  <div class="infamy-marker" style="left: 50%;" title="Coalizão Bilateral (50%)"></div>
                  <div class="infamy-marker" style="left: 100%;" title="Grande Coalizão (100%)"></div>
                </div>
              </div>
            </div>

            <!-- Treaty Status & Actions -->
            <div class="dossier-section">
              <div class="dossier-section-title">Status Diplomático Bilateral</div>
              {#if targetTreatyWithMe}
                {#if targetTreatyWithMe.status === "active"}
                  <div class="treaty-active-box">
                    <div class="treaty-active-badge">
                      <Icon name="shield" size={13} />
                      <span>{targetTreatyWithMe.type === "alliance" ? "Aliança Militar Ativa" : "Pacto de Não-Agressão (NAP) Ativo"}</span>
                    </div>
                    <p class="treaty-rule-desc">Ataques mútuos estão suspensos pelas leis de guerra.</p>
                    <button
                      class="btn-treaty-break"
                      onclick={() => handleBreakTreaty(targetTreatyWithMe.id)}
                      title="Rompe o tratado. Penalidade: +35% de Infâmia e +15% de Tensão Mundial."
                    >
                      <Icon name="swords" size={13} />
                      <span>Trair Tratado (+35% Infâmia)</span>
                    </button>
                  </div>
                {:else if targetTreatyWithMe.status === "pending"}
                  {#if targetTreatyWithMe.fromPlayerId === myPlayerId}
                    <div class="treaty-pending-box">
                      <span>Proposta de {targetTreatyWithMe.type === "alliance" ? "Aliança" : "NAP"} enviada.</span>
                      <button class="btn-ghost-sm" onclick={() => handleRejectTreaty(targetTreatyWithMe.id)}>
                        Cancelar Proposta
                      </button>
                    </div>
                  {:else}
                    <div class="treaty-incoming-box">
                      <strong>Proposta de {targetTreatyWithMe.type === "alliance" ? "Aliança Militar" : "Pacto de Não-Agressão"}</strong>
                      <div class="treaty-incoming-actions">
                        <button class="btn-tactical-success" onclick={() => handleAcceptTreaty(targetTreatyWithMe.id)}>
                          <Icon name="check" size={13} /> Aceitar
                        </button>
                        <button class="btn-tactical-danger" onclick={() => handleRejectTreaty(targetTreatyWithMe.id)}>
                          <Icon name="close" size={13} /> Recusar
                        </button>
                      </div>
                    </div>
                  {/if}
                {/if}
              {:else}
                <div class="treaty-propose-box">
                  <button
                    class="btn-treaty-propose"
                    onclick={() => handleProposeTreaty(activeDiplomacyTarget.id, "nap")}
                  >
                    <Icon name="handshake" size={13} />
                    <span>Propor Pacto de Não-Agressão (NAP)</span>
                  </button>
                  <button
                    class="btn-treaty-propose"
                    class:btn-disabled={(game.worldTension ?? 0) < 50}
                    disabled={(game.worldTension ?? 0) < 50}
                    onclick={() => handleProposeTreaty(activeDiplomacyTarget.id, "alliance")}
                    title={(game.worldTension ?? 0) < 50 ? "Requer Tensão Mundial de pelo menos 50%" : "Propor aliança militar mútua"}
                  >
                    <Icon name="crown" size={13} />
                    <span>Propor Aliança Militar {(game.worldTension ?? 0) < 50 ? "(Requer 50% Tensão)" : ""}</span>
                  </button>
                </div>
              {/if}
            </div>

            <!-- Coalitions Section -->
            <div class="dossier-section">
              <div class="dossier-section-title">Coalizões Militares de Contenção</div>
              {#if activeCoalitionAgainstTarget}
                <div class="coalition-active-box">
                  <div class="coalition-header">
                    <Icon name="swords" size={14} />
                    <span>COALIZÃO ATIVA ({activeCoalitionAgainstTarget.memberPlayerIds.length}/{(activeDiplomacyTarget.infamy ?? 0) >= 100 ? 3 : 2} Membros)</span>
                  </div>
                  <div class="coalition-members">
                    {#each activeCoalitionAgainstTarget.memberPlayerIds as mid}
                      {@const mem = game.players.find((p) => p.id === mid)}
                      {#if mem}
                        <span class="coalition-member-tag" style="border-color: {COLOR_HEX[mem.color]};">
                          <FactionFlag color={mem.color} width={14} height={9} />
                          {mem.name} {mid === myPlayerId ? "(Você)" : ""}
                        </span>
                      {/if}
                    {/each}
                  </div>

                  {#if !activeCoalitionAgainstTarget.memberPlayerIds.includes(myPlayerId)}
                    {@const maxMembers = (activeDiplomacyTarget.infamy ?? 0) >= 100 ? 3 : 2}
                    {#if activeCoalitionAgainstTarget.memberPlayerIds.length < maxMembers}
                      <button
                        class="btn-coalition-join"
                        onclick={() => handleJoinCoalition(activeCoalitionAgainstTarget.id)}
                      >
                        <Icon name="swords" size={13} />
                        <span>Unir-se à Coalizão contra {activeDiplomacyTarget.name}</span>
                      </button>
                    {:else}
                      <p class="coalition-full-note">Capacidade máxima da coalizão atingida.</p>
                    {/if}
                  {:else}
                    <div class="coalition-joined-badge">
                      <Icon name="check" size={12} /> Você é membro ativo desta coalizão
                    </div>
                  {/if}
                </div>
              {:else if (activeDiplomacyTarget.infamy ?? 0) >= 50}
                <div class="coalition-call-box">
                  <p class="coalition-call-desc">
                    A Infâmia de {activeDiplomacyTarget.name} ({activeDiplomacyTarget.infamy}%) ultrapassou o limiar de alarme global.
                  </p>
                  <button
                    class="btn-coalition-declare"
                    onclick={() => handleFormCoalition(activeDiplomacyTarget.id)}
                  >
                    <Icon name="swords" size={14} />
                    <span>Declarar Coalizão Militar</span>
                  </button>
                </div>
              {:else}
                <div class="coalition-locked-box">
                  <Icon name="lock" size={13} />
                  <span>Coalizões bloqueadas. Alvo possui apenas {activeDiplomacyTarget.infamy ?? 0}% de Infâmia (requer ≥ 50%).</span>
                </div>
              {/if}

              <!-- Hegemon Last Stand Alert -->
              {#if activeCoalitionAgainstTarget && activeCoalitionAgainstTarget.memberPlayerIds.length >= 2}
                {@const bonus = (activeDiplomacyTarget.infamy ?? 0) >= 100 && activeCoalitionAgainstTarget.memberPlayerIds.length >= 3 ? 2 : 1}
                <div class="hegemon-bonus-banner">
                  <span>⭐ Mobilização Total Hegemon: +{bonus} nos dados contra membros da coalizão</span>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <!-- Hegemony Power Bar (Segmented World Dominance %) -->
          <div class="hegemony-bar-wrap">
            <div class="hegemony-bar-label">
              <span>{t("hegemony_bar")}</span>
              <span>{t("territories_count", { count: 44 }).toUpperCase()}</span>
            </div>
            <div class="hegemony-bar" title={t("hegemony_bar")}>
              {#each playerMetrics as m}
                <div
                  class="hegemony-segment"
                  style="width: {m.sharePct}%; background: {COLOR_HEX[m.player.color]};"
                  title="{m.player.name}: {m.sharePct}% ({m.terrCount} {t('territories_count', { count: m.terrCount })}, {m.totalArmies} {t('divisions', { count: m.totalArmies })})"
                ></div>
              {/each}
            </div>
          </div>

          <!-- Generals Roster with Heraldic Flags & Strengths -->
          <div class="generals-table">
            {#each playerMetrics as m, idx}
              {@const isTurn = idx === game.turnIndex}
              <div
                class="general-row"
                class:active-turn={isTurn}
                class:eliminated={m.player.eliminated}
                style="border-left-color: {COLOR_HEX[m.player.color]};"
              >
                <div class="g-info">
                  <FactionFlag color={m.player.color} width={20} height={13} />
                  <span class="g-name">
                    {m.player.name}
                    {#if m.player.id === myPlayerId}
                      <small class="you-badge">{t("you")}</small>
                    {/if}
                  </span>
                  {#if isTurn}
                    <span class="turn-indicator" title={t("turn")}><Icon name="crown" size={13} /></span>
                  {/if}
                </div>
                <div class="g-stats">
                  <span title={t("territories_count", { count: m.terrCount })} class="stat-pill">T: {m.terrCount}</span>
                  <span title={t("divisions", { count: m.totalArmies })} class="stat-pill">D: {m.totalArmies}</span>
                  <span title={t("cards_title")} class="stat-pill">C: {m.player.cards.length}</span>
                  {#if (m.player.infamy ?? 0) > 0}
                    <span title="Infâmia do General" class="stat-pill infamy-pill">🔥 {m.player.infamy}%</span>
                  {/if}
                  {#if m.player.id !== myPlayerId && !m.player.eliminated}
                    <button
                      class="btn-diplomacy-icon"
                      class:active={activeDiplomacyTargetId === m.player.id}
                      title="Dossiê Diplomático com {m.player.name}"
                      onclick={() => (activeDiplomacyTargetId = activeDiplomacyTargetId === m.player.id ? null : m.player.id)}
                    >
                      <Icon name="handshake" size={12} />
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Continents & Asian Sub-Regions Toggle -->
        <div class="continents-toggle-row">
          <button class="btn-ghost" onclick={() => (showContinents = !showContinents)}>
            <span><Icon name="globe" size={14} /> {t("theatres_and_bonuses")}</span>
            <span>{showContinents ? "▲" : "▼"}</span>
          </button>
        </div>

        {#if showContinents}
          <div class="continents-dropdown">
            <div class="dropdown-section-title">{t("classic_continents_section")}</div>
            {#each CLASSIC_MAP.continents.filter((c) => c.id !== "asia") as c}
              {@const terrs = CLASSIC_MAP.territories.filter((t) => t.continent === c.id)}
              {@const ownerId = game.territories[terrs[0].id]?.ownerId}
              {@const isMonopoly = terrs.every((t) => game!.territories[t.id].ownerId === ownerId)}
              <div class="cont-pill">
                <span>{getContinentName(c.id)}</span>
                <div class="cont-right">
                  {#if isMonopoly}
                    {@const p = game.players.find((plr) => plr.id === ownerId)}
                    {#if p}<FactionFlag color={p.color} width={16} height={10} />{/if}
                  {/if}
                  <span class="bonus-tag">+{c.bonus}</span>
                </div>
              </div>
            {/each}

            <div class="dropdown-section-title">{t("asia_subregions_section")}</div>
            {#each ASIA_SUBREGIONS as sub}
              {@const ownerId = game.territories[sub.territoryIds[0]]?.ownerId}
              {@const isMonopoly = sub.territoryIds.every((tid) => game!.territories[tid]?.ownerId === ownerId)}
              <div class="cont-pill asia-sub-pill">
                <span>{getSubregionName(sub.id)}</span>
                <div class="cont-right">
                  {#if isMonopoly}
                    {@const p = game.players.find((plr) => plr.id === ownerId)}
                    {#if p}<FactionFlag color={p.color} width={16} height={10} />{/if}
                  {/if}
                  <span class="bonus-tag">+{sub.bonus}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </aside>
      {/if}

      <!-- ⬆ TOP-CENTER: ACTIVE COMMANDER BANNER & OPERATIONAL DIRECTIVE -->
      {#if !isImmersiveMode && hudVisibility.topBanner}
      <div class="top-center-banner" class:my-turn-banner={isMyTurn}>
        {#if currentTurnPlayer}
          <div class="tc-main-row">
            <FactionFlag color={currentTurnPlayer.color} width={24} height={15} />
            <div class="tc-text">
              <span class="tc-kicker">
                {isMyTurn ? t("banner_your_turn") : t("banner_waiting", { name: currentTurnPlayer.name.toUpperCase() })}
              </span>
              <strong class="tc-directive">
                {#if game.pendingConquest}
                  {t("phase_pending_conquest")}
                {:else if game.phase === "deploy"}
                  {isMyTurn
                    ? t("phase_deploy_my_turn", { count: myPlayerState?.unplacedArmies ?? 0 })
                    : t("phase_deploy_waiting")}
                {:else if game.phase === "attack"}
                  {isMyTurn
                    ? t("phase_attack_my_turn")
                    : t("phase_attack_waiting")}
                {:else if game.phase === "maneuver"}
                  {isMyTurn
                    ? t("phase_maneuver_my_turn")
                    : t("phase_maneuver_waiting")}
                {:else}
                  {t("phase_campaign_ended")}
                {/if}
              </strong>
            </div>
            <div class="tc-timer" class:timer-danger={remainingSeconds <= 20}>
              <Icon name="clock" size={14} />
              <span>{remainingSeconds}s</span>
            </div>
          </div>
        {/if}
      </div>
      {/if}

      <!-- ↗ TOP-RIGHT: PLAYER HEADQUARTERS, MAP MODE SWITCHER, CARDS, OBJECTIVE & EQUALIZER -->
      {#if !isImmersiveMode}
      <aside class="hud-panel top-right-panel">
        <div class="my-hq-row">
          {#if myPlayerState}
            <div class="hq-general">
              <FactionFlag color={myPlayerState.color} width={24} height={15} />
              <span class="hq-name">{myPlayerState.name}</span>
            </div>

            {#if isMyTurn && myPlayerState.unplacedArmies > 0}
              <div class="reserve-badge">
                <Icon name="shield" size={13} /> {t("reserve_badge", { count: myPlayerState.unplacedArmies })}
              </div>
            {/if}
          {/if}

          <div class="hq-buttons">
            <button
              class="hud-btn"
              class:highlight={Boolean(validTradeTriplet)}
              class:mandatory={Boolean(myPlayerState && myPlayerState.cards.length >= 5)}
              class:active={activeRightDrawer === "cards"}
              onclick={() => toggleRightDrawer("cards")}
              title={t("cards_title")}
            >
              <Icon name="cards" size={14} /> {myPlayerState?.cards.length ?? 0}/5
            </button>

            <button
              class="hud-btn"
              class:active={activeRightDrawer === "objective"}
              onclick={() => toggleRightDrawer("objective")}
              title={t("secret_objective_label")}
            >
              <Icon name="target" size={14} /> {t("secret_objective_label")}
            </button>

            <button
              class="hud-btn"
              class:highlight={Boolean(myHasMarket && isMyTurn)}
              class:active={activeRightDrawer === "market"}
              onclick={() => toggleRightDrawer("market")}
              title={t("market_btn_open")}
            >
              <Icon name="market" size={14} /> {t("market_btn_open")}
            </button>

            <button
              class="hud-btn"
              class:active={activeRightDrawer === "audio" || (ui.isMusicPlaying && !ui.isMuted)}
              onclick={() => toggleRightDrawer("audio")}
              title={t("audio_radio_eq")}
            >
              <Icon name={ui.isMuted ? "mute" : "radio"} size={14} />
              {ui.isMuted ? t("audio_muted") : ui.isMusicPlaying ? t("audio_radio_on") : t("audio_status")}
            </button>

            <button
              class="hud-btn"
              class:active={showHudManager}
              onclick={() => {
                sound.playClick();
                showHudManager = !showHudManager;
                if (showHudManager) activeRightDrawer = null;
              }}
              title={t("hud_vision_title")}
            >
              <Icon name="eye" size={14} /> HUD
            </button>

            <button
              class="hud-btn btn-exit-room"
              onclick={leaveCurrentRoom}
              title={t("victory_return_btn")}
            >
              <Icon name="back" size={14} />
            </button>
          </div>
        </div>

        {#if myPlayerState}
          {@const res = myPlayerState.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
          <div class="hq-economy-bar">
            <div class="econ-pill money" title={t("res_money")}>
              <Icon name="coins" size={13} />
              <span class="econ-val">${res.money}</span>
              {#if myEconomyIncome && myEconomyIncome.netMoney > 0}
                <span class="econ-delta">+{myEconomyIncome.netMoney}</span>
              {/if}
            </div>
            <div class="econ-pill steel" title={t("res_steel")}>
              <Icon name="steel" size={13} />
              <span class="econ-val">{res.steel}</span>
              {#if myEconomyIncome && myEconomyIncome.steel > 0}
                <span class="econ-delta">+{myEconomyIncome.steel}</span>
              {/if}
            </div>
            <div class="econ-pill oil" title={t("res_oil")}>
              <Icon name="oil" size={13} />
              <span class="econ-val">{res.oil}</span>
              {#if myEconomyIncome && myEconomyIncome.oil > 0}
                <span class="econ-delta">+{myEconomyIncome.oil}</span>
              {/if}
            </div>
            <div class="econ-pill gold" title={t("res_gold")}>
              <Icon name="gold" size={13} />
              <span class="econ-val">{res.gold}</span>
              {#if myEconomyIncome && myEconomyIncome.gold > 0}
                <span class="econ-delta">+{myEconomyIncome.gold}</span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Map Mode Switcher (Cartographic HOI4 vs Geopolitical Clean vs Regional Theatres) + Camera Controls -->
        {#if hudVisibility.mapControls}
        <div class="map-mode-bar">
          <div class="mode-tabs">
            <button
              class="mode-btn"
              class:active={mapMode === "cartographic"}
              onclick={() => (mapMode = "cartographic")}
              title={t("map_mode_cartographic_title")}
            >
              {t("map_mode_cartographic")}
            </button>
            <button
              class="mode-btn"
              class:active={mapMode === "geopolitical"}
              onclick={() => (mapMode = "geopolitical")}
              title={t("map_mode_geopolitical_title")}
            >
              {t("map_mode_geopolitical")}
            </button>
            <button
              class="mode-btn"
              class:active={mapMode === "regional"}
              onclick={() => (mapMode = "regional")}
              title={t("map_mode_regional_title")}
            >
              {t("map_mode_regional")}
            </button>
            <button
              class="mode-btn clean-mode-tab"
              class:active={cleanMapMode}
              onclick={() => (cleanMapMode = !cleanMapMode)}
              title={t("map_mode_clean_title")}
            >
              <Icon name="eye" size={12} /> {cleanMapMode ? t("mode_clean_active") : t("mode_clean_label")}
            </button>
          </div>

          <div class="zoom-cluster">
            <button class="tool-btn" onclick={zoomIn} title="Aproximar (E)">+</button>
            <button class="tool-btn" onclick={zoomOut} title="Afastar (Q)">-</button>
            <button class="tool-btn" onclick={resetZoom} title="Centralizar Mapa">RST</button>
          </div>
        </div>
        {/if}

        <!-- Audio Equalizer Drawer (HEGEM-10: Independent Music + SFX Sliders + Master Mute) -->
        {#if activeRightDrawer === "audio"}
          <div class="floating-drawer music-drawer">
            <div class="drawer-header">
              <h4><Icon name="radio" size={15} /> Equalizador & Rádio Militar</h4>
              <button class="btn-close" onclick={() => (activeRightDrawer = null)}>✕</button>
            </div>
            <div class="radio-controls">
              <div class="radio-top-btns">
                <button class="btn primary-gold" style="flex: 1;" onclick={() => ui.toggleMusic()}>
                  {ui.isMusicPlaying ? "Pausar Trilha" : "Iniciar Trilha"}
                </button>
                <button
                  class="btn secondary"
                  onclick={() => ui.toggleMute()}
                  title="Mute Geral (Música + SFX)"
                >
                  <Icon name={ui.isMuted ? "mute" : "volume"} size={15} />
                  {ui.isMuted ? "Ativar Som" : "Mute Geral"}
                </button>
              </div>

              <div class="eq-slider-block">
                <div class="eq-label-row">
                  <span>Volume da Música</span>
                  <strong>{Math.round(ui.musicVolume * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={ui.musicVolume}
                  oninput={(e) => ui.setMusicVolume(parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
              </div>

              <div class="eq-slider-block">
                <div class="eq-label-row">
                  <span>Efeitos de Combate (SFX)</span>
                  <strong>{Math.round(ui.sfxVolume * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={ui.sfxVolume}
                  oninput={(e) => ui.setSfxVolume(parseFloat((e.currentTarget as HTMLInputElement).value))}
                />
              </div>

              <div class="track-select">
                <span>Canal de Transmissão:</span>
                <div class="track-list-scroll">
                  {#each SOUNDTRACKS as track}
                    <button
                      class="track-option"
                      class:selected={ui.selectedTrack === track.id}
                      onclick={() => ui.setTrack(track.id)}
                    >
                      {track.label}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Secret Objective Drawer -->
        {#if activeRightDrawer === "objective" && myPlayerState}
          <div class="floating-drawer objective-drawer">
            <div class="drawer-header">
              <h4><Icon name="target" size={15} /> Diretriz Secreta de Alto Comando</h4>
              <button class="btn-close" onclick={() => (activeRightDrawer = null)}>✕</button>
            </div>
            <p class="objective-body">{getObjectiveDescription(myPlayerState.objective.id)}</p>
            {#if objectiveProgress}
              <div class="objective-progress-box">
                <div class="progress-bar-header">
                  <span>Progresso da Operação:</span>
                  <strong>{objectiveProgress.pct}% ({objectiveProgress.owned}/{objectiveProgress.total})</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width: {objectiveProgress.pct}%;"></div>
                </div>
              </div>
            {/if}

            <div class="objective-toggle-box">
              <button
                class="highlight-toggle-btn"
                class:active={highlightObjectiveTerritories}
                onclick={() => {
                  sound.playClick();
                  highlightObjectiveTerritories = !highlightObjectiveTerritories;
                }}
              >
                <Icon name={highlightObjectiveTerritories ? "eye" : "eye-off"} size={13} />
                {highlightObjectiveTerritories ? "Ocultar Alvos no Mapa" : "Destacar Alvos no Mapa (Verde / Vermelho)"}
              </button>
            </div>

            <small class="objective-note">
              Documento confidencial mascarado no servidor. O cumprimento garante vitória imediata.
            </small>
          </div>
        {/if}

        <!-- Modular HUD Visibility & Customizer Drawer -->
        {#if showHudManager}
          <div class="floating-drawer hud-drawer">
            <div class="drawer-header">
              <h4><Icon name="eye" size={15} /> Personalização da Interface (HUD)</h4>
              <button class="btn-close" onclick={() => (showHudManager = false)}>✕</button>
            </div>

            <div class="hud-immersive-box">
              <button
                class="btn full-width"
                class:primary-gold={isImmersiveMode}
                class:secondary={!isImmersiveMode}
                onclick={toggleImmersiveMode}
              >
                <Icon name={isImmersiveMode ? "eye" : "eye-off"} size={14} />
                {isImmersiveMode ? "Desativar Modo Imersivo" : "Modo Imersivo (Ocultar Tudo - Tecla H)"}
              </button>
              <small>Dica: Pressione <strong>H</strong> a qualquer momento para alternar o modo 100% mapa limpo.</small>
            </div>

            <div class="hud-toggle-list">
              <span class="hud-section-label">Painéis e Docks Visíveis:</span>

              <label class="hud-toggle-row">
                <span><Icon name="clock" size={13} /> Barra de Comando & Timer (Topo)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.topBanner}
                  onchange={() => toggleHudElement("topBanner")}
                />
              </label>

              <label class="hud-toggle-row">
                <span><Icon name="crown" size={13} /> Generais & Teatros (Esquerda)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.continents}
                  onchange={() => toggleHudElement("continents")}
                />
              </label>

              <label class="hud-toggle-row">
                <span><Icon name="shield" size={13} /> Console de Ordens & Fases (Inferior)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.bottomDock}
                  onchange={() => toggleHudElement("bottomDock")}
                />
              </label>

              <label class="hud-toggle-row">
                <span><Icon name="radio" size={13} /> Diário de Guerra & Chat (Direita)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.warJournal}
                  onchange={() => toggleHudElement("warJournal")}
                />
              </label>

              <label class="hud-toggle-row">
                <span><Icon name="globe" size={13} /> Modos de Mapa & Zoom (Superior)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.mapControls}
                  onchange={() => toggleHudElement("mapControls")}
                />
              </label>

              <label class="hud-toggle-row">
                <span><Icon name="target" size={13} /> Reconhecimento & Dicas (Inferior)</span>
                <input
                  type="checkbox"
                  checked={hudVisibility.recon}
                  onchange={() => toggleHudElement("recon")}
                />
              </label>
            </div>
          </div>
        {/if}

        <!-- Supply Cards & Escalation Drawer -->
        {#if activeRightDrawer === "cards" && myPlayerState}
          <div class="floating-drawer cards-drawer">
            <div class="drawer-header">
              <h4><Icon name="cards" size={15} /> {t("cards_count", { count: myPlayerState.cards.length })}</h4>
              <button class="btn-close" onclick={() => (activeRightDrawer = null)}>✕</button>
            </div>

            <div class="escalation-banner">
              <span>{t("cards_exchange_next", { count: (game.tradeCount ?? 0) + 1 })}</span>
              <strong>+{nextTradeBonus} {t("divisions", { count: nextTradeBonus })}</strong>
            </div>

            <div class="cards-grid">
              {#each myPlayerState.cards as c}
                <div class="card-item">
                  <span class="card-symbol">
                    {c.symbol === "circle"
                      ? t("card_symbol_circle")
                      : c.symbol === "square"
                        ? t("card_symbol_square")
                        : c.symbol === "triangle"
                          ? t("card_symbol_triangle")
                          : t("card_symbol_joker")}
                  </span>
                  <span class="card-territory">
                    {c.territoryId ? getTerritoryName(c.territoryId) : t("card_wildcard")}
                  </span>
                </div>
              {/each}
              {#if myPlayerState.cards.length === 0}
                <p class="empty-cards-note">
                  {t("cards_empty_note")}
                </p>
              {/if}
            </div>

            {#if isMyTurn && validTradeTriplet && (game.phase === "deploy" || myPlayerState.cards.length >= 5)}
              <button
                class="btn primary-gold full-width"
                onclick={() => sendAction({ type: "trade_cards", cardIds: validTradeTriplet })}
              >
                <Icon name="shield" size={15} /> {t("cards_exchange_btn", { armies: nextTradeBonus })}
              </button>
            {/if}

            {#if isMyTurn && game.phase === "deploy" && myPlayerState.cards.length < 5}
              {@const res = myPlayerState.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
              {@const canBuyGoldOnly = !myPlayerState.boughtCardWithGoldThisTurn && res.gold >= 2}
              {@const canBuyGoldMoney = !myPlayerState.boughtCardWithGoldThisTurn && res.gold >= 1 && res.money >= 4}
              <div class="gold-card-purchase-box">
                <div class="gold-card-purchase-head">
                  <Icon name="gold" size={13} />
                  <span>{t("cards_buy_gold_title")}</span>
                </div>
                <p class="gold-card-purchase-sub">{t("cards_buy_gold_sub")}</p>
                {#if myPlayerState.boughtCardWithGoldThisTurn}
                  <div class="gold-card-bought-tag">
                    <Icon name="check" size={12} /> {t("cards_buy_gold_done")}
                  </div>
                {:else}
                  <div class="gold-card-btn-row">
                    <button
                      class="hud-btn gold-buy-btn"
                      disabled={!canBuyGoldOnly}
                      onclick={() => sendAction({ type: "buy_card_with_gold", paymentMode: "gold_only" })}
                    >
                      <Icon name="gold" size={12} /> {t("cards_buy_gold_only_btn")}
                    </button>
                    <button
                      class="hud-btn gold-buy-btn"
                      disabled={!canBuyGoldMoney}
                      onclick={() => sendAction({ type: "buy_card_with_gold", paymentMode: "gold_and_money" })}
                    >
                      <Icon name="coins" size={12} /> {t("cards_buy_gold_money_btn")}
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Global Dynamic Market & Allied Trade Drawer (HEGEM-22) -->
        {#if activeRightDrawer === "market" && myPlayerState && game}
          <div class="floating-drawer market-drawer">
            <div class="drawer-header">
              <h4><Icon name="market" size={15} /> {t("market_modal_title")}</h4>
              <button class="btn-close" onclick={() => (activeRightDrawer = null)}>✕</button>
            </div>
            <p class="drawer-sub">{t("market_modal_sub")}</p>

            {#if !myHasMarket}
              <div class="market-locked-box">
                <Icon name="shield" size={16} />
                <span>{t("market_locked_notice")}</span>
              </div>
            {:else}
              <div class="market-active-banner">
                <div class="market-status-tag">
                  <Icon name="industry" size={13} /> {t("market_has_access")}
                </div>
                <div class="market-batch-selector">
                  <span class="batch-label">{t("market_batch_qty", { qty: "" })}</span>
                  <div class="batch-buttons">
                    {#each [1, 5, 10] as qty}
                      <button
                        class="batch-btn"
                        class:active={marketBatchQty === qty}
                        onclick={() => (marketBatchQty = qty)}
                      >
                        {qty}x
                      </button>
                    {/each}
                  </div>
                </div>
              </div>

              <!-- Commodities Grid -->
              <div class="market-commodities-grid">
                {#each (["steel", "oil", "gold"] as const) as res}
                  {@const stock = myPlayerState.resources[res] ?? 0}
                  {@const buyCost = getEstBuyCost(res, marketBatchQty)}
                  {@const sellRev = getEstSellRevenue(res, marketBatchQty)}
                  {@const currentPrice = game.marketPrices[res]}
                  {@const canAffordBuy = isMyTurn && myPlayerState.resources.money >= buyCost}
                  {@const canSell = isMyTurn && stock >= marketBatchQty}
                  <div class="commodity-card">
                    <div class="commodity-head">
                      <div class="res-badge">
                        <Icon name={res} size={15} />
                        <strong>{t(`res_${res}`)}</strong>
                      </div>
                      <span class="res-stock-count">{stock} {t("building_built_tag")}</span>
                    </div>
                    <div class="commodity-prices">
                      <div class="price-pill buy">
                        <span class="pill-lbl">{t("market_price_buy")}</span>
                        <span class="pill-val">${currentPrice.buyPrice}</span>
                      </div>
                      <div class="price-pill sell">
                        <span class="pill-lbl">{t("market_price_sell")}</span>
                        <span class="pill-val">${currentPrice.sellPrice}</span>
                      </div>
                    </div>
                    <div class="commodity-actions">
                      <button
                        class="btn-trade buy"
                        disabled={!canAffordBuy}
                        onclick={() => handleMarketTrade(res, "buy")}
                        title={!isMyTurn ? "Apenas no seu turno" : !canAffordBuy ? "Dinheiro insuficiente" : ""}
                      >
                        {t("market_btn_buy")} {marketBatchQty}x (-${buyCost})
                      </button>
                      <button
                        class="btn-trade sell"
                        disabled={!canSell}
                        onclick={() => handleMarketTrade(res, "sell")}
                        title={!isMyTurn ? "Apenas no seu turno" : !canSell ? "Estoque insuficiente" : ""}
                      >
                        {t("market_btn_sell")} {marketBatchQty}x (+${sellRev})
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Allied Investment Routes -->
            <div class="drawer-section-divider"></div>
            <div class="routes-section">
              <div class="routes-header">
                <h5><Icon name="handshake" size={14} /> {t("investment_routes_title")}</h5>
                <span class="routes-hint">{t("investment_routes_sub")}</span>
              </div>

              <!-- Active Routes -->
              {#if game.investmentRoutes && game.investmentRoutes.filter(r => r.status === "active" && (r.playerAId === myPlayerId || r.playerBId === myPlayerId)).length > 0}
                <div class="routes-list">
                  {#each game.investmentRoutes.filter(r => r.status === "active" && (r.playerAId === myPlayerId || r.playerBId === myPlayerId)) as r}
                    {@const partnerId = r.playerAId === myPlayerId ? r.playerBId : r.playerAId}
                    {@const partner = game.players.find(p => p.id === partnerId)}
                    <div class="route-item active">
                      <div class="route-info">
                        <FactionFlag color={partner?.color ?? "blue"} width={16} height={10} />
                        <strong>{partner?.name ?? "Aliado"}</strong>
                        <span class="route-badge">
                          {t("investment_status_active", { income: r.roundsActive >= 3 ? 3 : 2, rounds: r.roundsActive })}
                        </span>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Pending Proposals to Me -->
              {#if game.investmentRoutes && game.investmentRoutes.some(r => r.status === "pending" && r.playerBId === myPlayerId)}
                <div class="pending-proposals-list">
                  {#each game.investmentRoutes.filter(r => r.status === "pending" && r.playerBId === myPlayerId) as r}
                    {@const proposer = game.players.find(p => p.id === r.playerAId)}
                    <div class="route-item pending">
                      <div class="route-info">
                        <FactionFlag color={proposer?.color ?? "blue"} width={16} height={10} />
                        <span>{proposer?.name}: {t("investment_status_pending")}</span>
                      </div>
                      <div class="route-actions">
                        <button
                          class="btn-route accept"
                          disabled={myPlayerState.resources.money < 3}
                          onclick={() => handleAcceptInvestment(r.id)}
                        >
                          {t("investment_btn_accept")}
                        </button>
                        <button
                          class="btn-route reject"
                          onclick={() => handleRejectInvestment(r.id)}
                        >
                          {t("investment_btn_reject")}
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Eligible Partners to Propose -->
              {#if eligibleInvestmentPartners.length > 0}
                <div class="eligible-partners-list">
                  {#each eligibleInvestmentPartners as partner}
                    <div class="partner-row">
                      <div class="partner-name">
                        <FactionFlag color={partner.color} width={16} height={10} />
                        <span>{partner.name}</span>
                      </div>
                      <button
                        class="btn-propose-route"
                        disabled={myPlayerState.resources.money < 3}
                        onclick={() => handleProposeInvestment(partner.id)}
                      >
                        {t("investment_btn_propose")}
                      </button>
                    </div>
                  {/each}
                </div>
              {:else if (!game.investmentRoutes || !game.investmentRoutes.some(r => r.playerAId === myPlayerId || r.playerBId === myPlayerId))}
                <p class="empty-routes-hint">{t("investment_no_allies")}</p>
              {/if}
            </div>

            <!-- Border Trade Pending Deals -->
            {#if game.borderTrades && game.borderTrades.some(d => d.status === "pending" && d.toPlayerId === myPlayerId)}
              <div class="drawer-section-divider"></div>
              <div class="border-trade-section">
                <div class="routes-header">
                  <h5><Icon name="handshake" size={14} /> {t("border_trade_title")}</h5>
                  <span class="routes-hint">{t("border_trade_sub")}</span>
                </div>
                <div class="pending-proposals-list">
                  {#each game.borderTrades.filter(d => d.status === "pending" && d.toPlayerId === myPlayerId) as d}
                    {@const seller = game.players.find(p => p.id === d.fromPlayerId)}
                    <div class="route-item pending">
                      <div class="route-info">
                        <FactionFlag color={seller?.color ?? "blue"} width={16} height={10} />
                        <span>{t("border_trade_pending_desc", { from: getTerritoryName(d.fromTerritoryId), to: getTerritoryName(d.toTerritoryId), resource: t(`res_${d.resource}`), price: d.price })}</span>
                      </div>
                      <div class="route-actions">
                        <button
                          class="btn-route accept"
                          disabled={myPlayerState.resources.money < d.price}
                          onclick={() => handleAcceptBorderTrade(d.id)}
                        >
                          {t("border_trade_accept_btn", { price: d.price })}
                        </button>
                        <button
                          class="btn-route reject"
                          onclick={() => handleRejectBorderTrade(d.id)}
                        >
                          {t("border_trade_reject_btn")}
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </aside>
      {/if}

      <!-- ↙ BOTTOM-LEFT: LIVE TERRITORY RECON INSPECTOR & CONTROLS HINT -->
      {#if !isImmersiveMode && hudVisibility.recon}
      <div class="bottom-left-stack">
        {#if inspectedTerritory}
          {@const bldgs = inspectedTerritory.state.buildings ?? []}
          {@const maxSlots = getTerritoryMaxBuildingSlots(game, inspectedTerritory.def.id)}
          {@const isOwnedByMe = inspectedTerritory.state.ownerId === myPlayerId}
          {@const inspectedFortLevel = getTerritoryBuildingLevel(inspectedTerritory.state, "fortification")}
          {@const myRes = myPlayerState?.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
          <div class="recon-inspector-card">
            <div class="recon-head">
              {#if inspectedTerritory.owner}
                <FactionFlag color={inspectedTerritory.owner.color} width={20} height={13} />
              {/if}
              <strong>{getTerritoryName(inspectedTerritory.def.id)}</strong>
              <span class="recon-garrison">{inspectedTerritory.state.armies} {t("division_short", { count: inspectedTerritory.state.armies })}</span>
            </div>
            {#if inspectedTerritory.owner?.capitalTerritoryId === inspectedTerritory.def.id}
              <div class="recon-capital-tag gold">
                {t("capital_national")}
              </div>
            {:else if game.players.some((p) => p.capitalTerritoryId === inspectedTerritory.def.id)}
              {@const origOwner = game.players.find((p) => p.capitalTerritoryId === inspectedTerritory.def.id)}
              <div class="recon-capital-tag red">
                {t("capital_captured", { name: origOwner?.name ?? "" })}
              </div>
            {/if}
            <div class="recon-meta">
              <span>{inspectedTerritory.regionName}</span>
              <span>•</span>
              <span>{t("recon_occupant", { name: inspectedTerritory.owner?.name ?? t("recon_neutral") })}</span>
              <span>•</span>
              <span>{t("recon_borders", { count: inspectedTerritory.def.neighbors.length })}</span>
            </div>
            <div class="recon-economy-row">
              {#if inspectedTerritory.def.resource === "steel"}
                <span class="recon-res-badge steel">
                  <Icon name="steel" size={11} /> {t("res_steel")} (+1)
                </span>
              {:else if inspectedTerritory.def.resource === "oil"}
                <span class="recon-res-badge oil">
                  <Icon name="oil" size={11} /> {t("res_oil")} (+1)
                </span>
              {:else if inspectedTerritory.def.resource === "gold"}
                <span class="recon-res-badge gold">
                  <Icon name="gold" size={11} /> {t("res_gold")} (+1 / +$2)
                </span>
              {/if}
              {#if inspectedTerritory.def.tradeBonus && inspectedTerritory.def.tradeBonus > 0}
                <span class="recon-res-badge money">
                  <Icon name="coins" size={11} /> {t("res_trade_hub", { bonus: inspectedTerritory.def.tradeBonus })}
                </span>
              {/if}
              <span class="recon-res-badge geo">
                {#if inspectedTerritory.def.isCoastal !== false}
                  <Icon name="anchor" size={11} /> {t("res_coastal")}
                {:else}
                  <Icon name="shield" size={11} /> {t("res_landlocked")}
                {/if}
              </span>
            </div>

            <!-- Territorial Infrastructure Section (HEGEM-32) -->
            <div class="recon-infra-header">
              <span class="infra-title"><Icon name="industry" size={11} /> {t("building_section_title")}</span>
              <span class="infra-slots">{t("building_slots_count", { used: bldgs.length, max: maxSlots })}</span>
            </div>

            {#if bldgs.length > 0}
              <div class="recon-active-bldgs">
                {#each bldgs as b}
                  <span class="recon-bldg-chip {b.type}">
                    <Icon name={b.type === "fortification" ? "fortification" : b.type} size={11} />
                    {#if b.type === "fortification"}
                      {b.level === 2 ? t("building_fortification_l2") : t("building_fortification_l1")}
                    {:else if b.type === "market"}
                      {t("building_market")}
                    {:else if b.type === "industry"}
                      {t("building_industry")}
                    {:else if b.type === "airfield"}
                      {t("building_airfield")}
                    {:else if b.type === "port"}
                      {t("building_port")}
                    {/if}
                  </span>
                {/each}
              </div>
            {/if}

            {#if isOwnedByMe && isMyTurn && !game.pendingConquest && !game.winnerId}
              <div class="recon-build-grid">
                <!-- Market ($5) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "market")}
                  <button
                    class="btn-build-option"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "market")}
                    title={t("building_market_desc")}
                  >
                    <Icon name="market" size={11} />
                    <span>{t("building_market")}</span>
                    <strong class="cost-tag">$5</strong>
                  </button>
                {/if}

                <!-- Industry ($6, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "industry")}
                  <button
                    class="btn-build-option"
                    disabled={bldgs.length >= maxSlots || myRes.money < 6 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "industry")}
                    title={t("building_industry_desc")}
                  >
                    <Icon name="industry" size={11} />
                    <span>{t("building_industry")}</span>
                    <strong class="cost-tag">$6+1A</strong>
                  </button>
                {/if}

                <!-- Fortification (Casamata $4 / Fortaleza $4+1A) -->
                {#if inspectedFortLevel === 0}
                  <button
                    class="btn-build-option"
                    disabled={bldgs.length >= maxSlots || myRes.money < 4}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                    title={t("building_fortification_l1_desc")}
                  >
                    <Icon name="fortification" size={11} />
                    <span>{t("building_fortification_l1")}</span>
                    <strong class="cost-tag">$4</strong>
                  </button>
                {:else if inspectedFortLevel === 1}
                  <button
                    class="btn-build-option upgrade"
                    disabled={myRes.money < 4 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                    title={t("building_fortification_l2_desc")}
                  >
                    <Icon name="fortification" size={11} />
                    <span>{t("building_btn_upgrade_l2")}</span>
                    <strong class="cost-tag">$4+1A</strong>
                  </button>
                {/if}

                <!-- Airfield ($5, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "airfield")}
                  <button
                    class="btn-build-option"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "airfield")}
                    title={t("building_airfield_desc")}
                  >
                    <Icon name="airfield" size={11} />
                    <span>{t("building_airfield")}</span>
                    <strong class="cost-tag">$5+1A</strong>
                  </button>
                {/if}

                <!-- Port ($5, coastal only) -->
                {#if inspectedTerritory.def.isCoastal !== false && !hasTerritoryBuilding(inspectedTerritory.state, "port")}
                  <button
                    class="btn-build-option"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "port")}
                    title={t("building_port_desc")}
                  >
                    <Icon name="anchor" size={11} />
                    <span>{t("building_port")}</span>
                    <strong class="cost-tag">$5</strong>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <div class="bottom-left-hint">
          <span>{t("hints_nav")}</span>
        </div>
      </div>
      {/if}

      <!-- ⬇ BOTTOM-CENTER: TACTICAL ORDER CONSOLE & 1-2-3 PHASE STEPPER -->
      {#if !isImmersiveMode && hudVisibility.bottomDock}
      <footer class="hud-panel bottom-center-dock">
        {#if isMyTurn && !game.winnerId}
          {#if game.pendingConquest}
            <div class="action-popup">
              <div class="popup-head">
                <h4>
                  <Icon name="flag" size={14} /> {t("conquest_title")} — {t("conquest_prompt")}
                </h4>
              </div>
              <div class="slider-row">
                <button
                  class="preset-btn"
                  onclick={() => (sliderArmies = game!.pendingConquest!.minMove)}
                >
                  Min ({game.pendingConquest.minMove})
                </button>
                <input
                  type="range"
                  min={game.pendingConquest.minMove}
                  max={game.pendingConquest.maxMove}
                  bind:value={sliderArmies}
                />
                <button
                  class="preset-btn"
                  onclick={() => (sliderArmies = game!.pendingConquest!.maxMove)}
                >
                  Max ({game.pendingConquest.maxMove})
                </button>
                <button
                  class="btn primary-gold"
                  onclick={() => sendAction({ type: "occupy", armies: sliderArmies })}
                >
                  {t("conquest_advance", { count: sliderArmies })}
                </button>
              </div>
            </div>

          {:else if game.phase === "deploy"}
            {#if selectedFromId}
              {@const maxD = myPlayerState?.unplacedArmies ?? 1}
              <div class="action-popup">
                <div class="popup-head">
                  <h4>
                    {t("deploy_prompt", { territory: getTerritoryName(selectedFromId) })}
                  </h4>
                  <div class="quick-presets">
                    <button class="preset-btn" onclick={() => (sliderArmies = 1)}>+1</button>
                    {#if maxD >= 3}
                      <button class="preset-btn" onclick={() => (sliderArmies = Math.max(1, Math.floor(maxD / 2)))}>
                        50%
                      </button>
                    {/if}
                    <button class="preset-btn" onclick={() => (sliderArmies = maxD)}>
                      {t("total")} ({maxD})
                    </button>
                    <button class="preset-btn" onclick={() => (selectedFromId = null)}>✕</button>
                  </div>
                </div>
                <div class="slider-row">
                  <input type="range" min="1" max={maxD} bind:value={sliderArmies} />
                  {#if !myPlayerState?.capitalTerritoryId}
                    <button
                      class="btn secondary-btn select-cap-btn"
                      title={t("capital_select_hint")}
                      onclick={() => sendAction({ type: "select_capital", territoryId: selectedFromId })}
                    >
                      {t("capital_select_btn")}
                    </button>
                  {/if}
                  <button class="btn primary-gold" onclick={confirmDeploy}>
                    {t("deploy_confirm", { count: sliderArmies })}
                  </button>
                </div>
              </div>
            {/if}

          {:else if game.phase === "attack"}
            {#if selectedFromId && selectedToId}
              <div class="action-popup attack-popup">
                <div class="attack-matchup">
                  <span>
                    {t("combat_origin", { territory: getTerritoryName(selectedFromId) })} ({game.territories[selectedFromId].armies})
                  </span>
                  <span class="vs">{t("vs")}</span>
                  <span>
                    {t("combat_target", { territory: getTerritoryName(selectedToId) })} ({game.territories[selectedToId].armies})
                  </span>
                </div>

                <div class="attack-controls-row">
                  <div class="dice-selector">
                    <span>{t("attack_dice_label")}</span>
                    <button
                      class="preset-btn"
                      class:active={selectedAttackDice === null}
                      onclick={() => (selectedAttackDice = null)}
                    >
                      Max ({maxAttackerDice}D)
                    </button>
                    {#each [1, 2, 3] as dCount}
                      {#if dCount <= maxAttackerDice}
                        <button
                          class="preset-btn"
                          class:active={selectedAttackDice === dCount}
                          onclick={() => (selectedAttackDice = dCount)}
                        >
                          {dCount}D
                        </button>
                      {/if}
                    {/each}
                  </div>

                  {#if currentAttackOdds !== null}
                    <div class="odds-inline">
                      <span>{t("attack_odds_label")}</span>
                      <strong
                        style="color: {currentAttackOdds >= 60
                          ? '#6ee7b7'
                          : currentAttackOdds >= 40
                            ? '#fde047'
                            : '#fca5a5'}"
                      >
                        {currentAttackOdds}%
                      </strong>
                    </div>
                  {/if}
                </div>

                {#if currentAttackOdds !== null}
                  <div class="odds-bar">
                    <div class="odds-fill" style="width: {currentAttackOdds}%"></div>
                  </div>
                {/if}

                <div class="attack-cta-row">
                  <button
                    class="btn secondary"
                    onclick={() => {
                      selectedFromId = null;
                      selectedToId = null;
                    }}
                  >
                    {t("cancel")}
                  </button>
                  <button class="btn btn-attack" style="flex: 1;" onclick={confirmAttack}>
                    <Icon name="swords" size={15} /> {t("combat_execute")}
                  </button>
                </div>
              </div>
            {/if}

          {:else if game.phase === "maneuver"}
            {#if selectedFromId && selectedToId}
              {@const fromT = game.territories[selectedFromId]}
              {@const toT = game.territories[selectedToId]}
              {@const maxM = Math.max(1, fromT.armies - fromT.movedInArmies - 1)}
              {@const isAirlift =
                !territoryById.get(selectedFromId)?.neighbors.includes(selectedToId) &&
                hasTerritoryBuilding(fromT, "airfield") &&
                hasTerritoryBuilding(toT, "airfield")}
              <div class="action-popup">
                <div class="popup-head">
                  <h4>
                    {#if isAirlift}
                      <Icon name="airfield" size={14} /> {t("airlift_btn_label")} ({getTerritoryName(selectedFromId)} → {getTerritoryName(selectedToId)})
                    {:else}
                      {t("maneuver_prompt", { from: getTerritoryName(selectedFromId), to: getTerritoryName(selectedToId) })}
                    {/if}
                  </h4>
                  <div class="quick-presets">
                    <button class="preset-btn" onclick={() => (sliderArmies = 1)}>Min (1)</button>
                    <button class="preset-btn" onclick={() => (sliderArmies = maxM)}>Max ({maxM})</button>
                    <button
                      class="preset-btn"
                      onclick={() => {
                        selectedFromId = null;
                        selectedToId = null;
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div class="slider-row">
                  <input type="range" min="1" max={maxM} bind:value={sliderArmies} />
                  <button class="btn primary-gold" onclick={confirmManeuver}>
                    {#if isAirlift}
                      <Icon name="airfield" size={14} /> {t("airlift_btn_label")} ({sliderArmies})
                    {:else}
                      {t("maneuver_transfer", { count: sliderArmies })}
                    {/if}
                  </button>
                </div>
              </div>
            {/if}
          {/if}
        {/if}

        <!-- 1 - 2 - 3 Step Phase Navigator -->
        <div class="phase-stepper-row">
          <div class="phase-step" class:active-phase={game.phase === "deploy"}>
            <span class="num">1</span>
            <span class="label">{t("phase_deploy")}</span>
          </div>
          <div class="phase-arrow">›</div>
          <div class="phase-step" class:active-phase={game.phase === "attack"}>
            <span class="num">2</span>
            <span class="label">{t("phase_attack")}</span>
          </div>
          <div class="phase-arrow">›</div>
          <div class="phase-step" class:active-phase={game.phase === "maneuver"}>
            <span class="num">3</span>
            <span class="label">{t("phase_maneuver")}</span>
          </div>

          {#if isMyTurn && !game.winnerId}
            <div class="phase-action-slot">
              {#if game.phase === "attack" && !game.pendingConquest}
                <button class="btn secondary" onclick={() => sendAction({ type: "end_attack" })}>
                  {t("advance_to_maneuver")}
                </button>
              {:else if game.phase === "maneuver"}
                <button class="btn primary-gold" onclick={() => sendAction({ type: "end_turn" })}>
                  <Icon name="check" size={15} /> {t("end_turn")}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </footer>
      {/if}

      <!-- ↘ BOTTOM-RIGHT: WAR JOURNAL, DICE COMBAT TELEMETRY & COMMS (HEGEM-12) -->
      {#if !isImmersiveMode && hudVisibility.warJournal}
      <WarJournal
        logs={game.log}
        lastCombat={game.lastCombat}
        players={game.players}
        {communications}
      />
      {/if}

      <!-- Immersive Mode Exit Control -->
      {#if isImmersiveMode}
        <button
          class="immersive-exit-pill"
          onclick={toggleImmersiveMode}
          title="Clique ou pressione 'H' para restaurar a interface"
        >
          <Icon name="eye" size={13} /> MODO IMERSIVO (PRESSIONE 'H' PARA SAIR)
        </button>
      {/if}

      <!-- Reconnection Floating Toast -->
      {#if isReconnecting}
        <div class="reconnecting-toast">
          <div class="reconnecting-spinner"></div>
          <span>Reconectando ao Quartel-General... ({reconnectAttempts}/8)</span>
        </div>
      {/if}
    </div>
  {/if}
</main>

<style>
  .hegemonia-app {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }

  /* --- Fullscreen Continuous Map Viewport --- */
  .map-viewport {
    position: absolute;
    inset: 0;
    width: 100vw;
    height: 100vh;
    cursor: grab;
    background: #050b16;
  }
  .map-viewport:active {
    cursor: grabbing;
  }
  .world-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .territory-group {
    cursor: pointer;
  }
  .territory-group:hover path:first-child {
    filter: brightness(1.25);
  }
  .division-counter {
    pointer-events: none;
  }

  /* --- HUD Overlays (HOI4 / EU4 Grand Strategy Dark Brass Theme) --- */
  .hud-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    display: grid;
    grid-template-columns: 335px 1fr 365px;
    grid-template-rows: auto 1fr auto;
    padding: 0.75rem;
    gap: 0.65rem;
  }

  .hud-panel {
    pointer-events: auto;
    backdrop-filter: blur(14px);
    background: linear-gradient(180deg, rgba(11, 18, 33, 0.94) 0%, rgba(6, 11, 21, 0.96) 100%);
    border: 1px solid rgba(212, 175, 55, 0.44);
    border-radius: 7px;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    padding: 0.7rem 0.78rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Top-Left Panel */
  .top-left-panel {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: start;
    max-height: calc(100vh - 115px);
    overflow: hidden;
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .hud-mini-logo {
    height: 36px;
    width: auto;
    object-fit: contain;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.8));
  }
  .brand-lockup {
    display: flex;
    flex-direction: column;
  }
  .brand-lockup strong {
    font-family: var(--font-display);
    font-size: 0.92rem;
    letter-spacing: 0.14em;
    color: #fef08a;
  }
  .brand-lockup small {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .round-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    background: rgba(202, 138, 4, 0.16);
    border: 1px solid rgba(234, 179, 8, 0.45);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    color: #fef08a;
  }

  .round1-treaty-banner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: rgba(56, 189, 248, 0.14);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 600;
    color: #bae6fd;
  }

  .hegemony-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .hegemony-bar-label {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #94a3b8;
  }
  .hegemony-bar {
    display: flex;
    height: 7px;
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
    background: #1e293b;
    border: 1px solid rgba(15, 23, 42, 0.8);
  }
  .hegemony-segment {
    height: 100%;
    transition: width 0.35s ease;
  }

  .generals-table {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }
  .general-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.65);
    padding: 0.34rem 0.5rem;
    border-radius: 4px;
    border-left: 3px solid transparent;
    font-size: 0.78rem;
  }
  .general-row.active-turn {
    background: linear-gradient(90deg, rgba(234, 179, 8, 0.2), rgba(15, 23, 42, 0.75));
    border-right: 1px solid rgba(250, 204, 21, 0.5);
  }
  .general-row.eliminated {
    opacity: 0.38;
    text-decoration: line-through;
  }
  .g-info {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    min-width: 0;
  }
  .g-name {
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .you-badge {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 800;
    background: rgba(234, 179, 8, 0.22);
    color: #fef08a;
    padding: 1px 4px;
    border-radius: 2px;
  }
  .turn-indicator {
    color: #facc15;
    display: inline-flex;
  }
  .g-stats {
    display: flex;
    gap: 0.28rem;
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
  }
  .stat-pill {
    background: rgba(5, 9, 18, 0.75);
    padding: 0.1rem 0.32rem;
    border-radius: 3px;
  }

  /* World Tension Gauge */
  .world-tension-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    background: rgba(15, 23, 42, 0.7);
    padding: 0.35rem 0.5rem;
    border-radius: 5px;
    border: 1px solid rgba(234, 179, 8, 0.25);
  }
  .tension-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .tension-title {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tension-value {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 800;
    color: #facc15;
  }
  .tension-value.high-tension {
    color: #f87171;
    text-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  }
  .tension-gauge-bar {
    position: relative;
    height: 6px;
    width: 100%;
    background: #0f172a;
    border-radius: 3px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .tension-gauge-fill {
    height: 100%;
    background: linear-gradient(90deg, #38bdf8 0%, #facc15 50%, #ef4444 100%);
    transition: width 0.4s ease;
  }
  .tension-gauge-fill.critical {
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
  }
  .tension-threshold-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #ffffff;
    opacity: 0.75;
    pointer-events: none;
  }
  .tension-subtext {
    font-family: var(--font-mono);
    font-size: 0.56rem;
    color: #64748b;
  }
  .tension-subtext .unlocked-text {
    color: #4ade80;
    font-weight: 700;
  }

  /* Infamy Pill & Diplomacy Button in Generals Table */
  .infamy-pill {
    background: rgba(239, 68, 68, 0.22);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.45);
  }
  .btn-diplomacy-icon {
    background: rgba(212, 175, 55, 0.15);
    border: 1px solid rgba(212, 175, 55, 0.45);
    color: #fef08a;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .btn-diplomacy-icon:hover, .btn-diplomacy-icon.active {
    background: rgba(212, 175, 55, 0.4);
    box-shadow: 0 0 8px rgba(250, 204, 21, 0.4);
    transform: scale(1.05);
  }

  /* Diplomatic Dossier Panel */
  .diplomacy-dossier {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
    max-height: calc(100vh - 220px);
    padding-right: 0.15rem;
  }
  .dossier-header {
    display: flex;
    align-items: center;
  }
  .btn-dossier-back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 0.24rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-dossier-back:hover {
    background: rgba(51, 65, 85, 0.8);
    color: #ffffff;
  }
  .dossier-target-card {
    background: rgba(15, 23, 42, 0.75);
    border-left: 4px solid #475569;
    border-radius: 5px;
    padding: 0.45rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .target-card-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .target-card-info {
    display: flex;
    flex-direction: column;
  }
  .target-card-info strong {
    font-size: 0.84rem;
    color: #f8fafc;
  }
  .target-card-info small {
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    color: #94a3b8;
    letter-spacing: 0.08em;
  }
  .infamy-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .infamy-row {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-tactical);
    font-size: 0.6rem;
    font-weight: 700;
    color: #cbd5e1;
  }
  .infamy-value.high-infamy {
    color: #ef4444;
    font-weight: 800;
  }
  .infamy-bar {
    position: relative;
    height: 6px;
    width: 100%;
    background: #0f172a;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .infamy-fill {
    height: 100%;
    background: #f59e0b;
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .infamy-fill.bilateral-threat {
    background: #f97316;
  }
  .infamy-fill.grand-threat {
    background: #ef4444;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.7);
  }
  .infamy-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: rgba(255, 255, 255, 0.5);
  }

  .dossier-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 5px;
    padding: 0.45rem 0.55rem;
  }
  .dossier-section-title {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #eab308;
    text-transform: uppercase;
  }
  .treaty-active-box {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .treaty-active-badge {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(34, 197, 94, 0.16);
    border: 1px solid rgba(34, 197, 94, 0.4);
    color: #86efac;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.25rem 0.45rem;
    border-radius: 4px;
  }
  .treaty-rule-desc {
    margin: 0;
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .btn-treaty-break {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    padding: 0.32rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-treaty-break:hover {
    background: rgba(239, 68, 68, 0.35);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
  }
  .treaty-propose-box {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .btn-treaty-propose {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: rgba(30, 41, 59, 0.65);
    border: 1px solid rgba(212, 175, 55, 0.35);
    color: #fef08a;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-treaty-propose:hover:not(:disabled) {
    background: rgba(212, 175, 55, 0.25);
    border-color: #facc15;
  }
  .btn-treaty-propose.btn-disabled, .btn-treaty-propose:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    border-color: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }
  .treaty-pending-box {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.68rem;
    color: #cbd5e1;
    background: rgba(30, 41, 59, 0.4);
    padding: 0.3rem 0.45rem;
    border-radius: 4px;
  }
  .btn-ghost-sm {
    background: transparent;
    border: 1px solid #64748b;
    color: #cbd5e1;
    font-size: 0.6rem;
    padding: 1px 5px;
    border-radius: 3px;
    cursor: pointer;
  }
  .treaty-incoming-box {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.35);
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
  }
  .treaty-incoming-actions {
    display: flex;
    gap: 0.35rem;
  }
  .btn-tactical-success {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    background: rgba(16, 185, 129, 0.25);
    border: 1px solid #10b981;
    color: #6ee7b7;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.25rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .btn-tactical-danger {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    background: rgba(239, 68, 68, 0.25);
    border: 1px solid #ef4444;
    color: #fca5a5;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.25rem;
    border-radius: 3px;
    cursor: pointer;
  }

  /* Coalitions Widget */
  .coalition-active-box {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .coalition-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    color: #f87171;
  }
  .coalition-members {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .coalition-member-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: rgba(15, 23, 42, 0.8);
    border-left: 2px solid #64748b;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    font-size: 0.65rem;
    color: #f1f5f9;
  }
  .btn-coalition-join {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    background: rgba(220, 38, 38, 0.25);
    border: 1px solid #dc2626;
    color: #fca5a5;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.35rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-coalition-join:hover {
    background: rgba(220, 38, 38, 0.4);
  }
  .coalition-full-note {
    margin: 0;
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .coalition-joined-badge {
    font-size: 0.66rem;
    color: #4ade80;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .coalition-call-box {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .coalition-call-desc {
    margin: 0;
    font-size: 0.62rem;
    color: #cbd5e1;
  }
  .btn-coalition-declare {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    background: linear-gradient(90deg, rgba(220, 38, 38, 0.3), rgba(185, 28, 28, 0.3));
    border: 1px solid #ef4444;
    color: #fee2e2;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.35rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-coalition-declare:hover {
    background: rgba(220, 38, 38, 0.5);
  }
  .coalition-locked-box {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.62rem;
    color: #64748b;
  }
  .hegemon-bonus-banner {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.2), rgba(239, 68, 68, 0.2));
    border: 1px solid rgba(245, 158, 11, 0.4);
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    color: #fde047;
    text-align: center;
  }

  /* Floating Real-time Treaty Proposals Toast Banner */
  .treaty-notifications-layer {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: auto;
  }
  .treaty-notif-toast {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
    border: 1px solid rgba(234, 179, 8, 0.7);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.7);
    padding: 0.55rem 0.85rem;
    border-radius: 6px;
    color: #f8fafc;
    animation: toast-slide-down 0.25s ease-out;
  }
  @keyframes toast-slide-down {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .toast-icon {
    color: #facc15;
    display: flex;
  }
  .toast-body {
    display: flex;
    flex-direction: column;
  }
  .toast-body strong {
    font-size: 0.75rem;
    color: #fef08a;
  }
  .toast-body span {
    font-size: 0.7rem;
    color: #cbd5e1;
  }
  .toast-actions {
    display: flex;
    gap: 0.35rem;
    margin-left: 0.5rem;
  }
  .btn-toast-accept {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: #16a34a;
    border: none;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-toast-accept:hover {
    background: #15803d;
  }
  .btn-toast-reject {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: #dc2626;
    border: none;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-toast-reject:hover {
    background: #b91c1c;
  }

  .btn-ghost {
    background: rgba(30, 41, 59, 0.45);
    border: 1px solid rgba(100, 116, 139, 0.35);
    color: #cbd5e1;
    width: 100%;
    padding: 0.32rem 0.55rem;
    border-radius: 5px;
    font-size: 0.74rem;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .continents-dropdown {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    max-height: 175px;
    overflow-y: auto;
    padding-top: 0.15rem;
  }
  .dropdown-section-title {
    font-family: var(--font-tactical);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #eab308;
    margin-top: 0.2rem;
    font-weight: 800;
  }
  .cont-pill {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
    padding: 0.22rem 0.45rem;
    background: rgba(5, 9, 18, 0.75);
    border-radius: 4px;
  }
  .asia-sub-pill {
    border-left: 2px solid #eab308;
  }
  .cont-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .bonus-tag {
    font-family: var(--font-mono);
    color: #facc15;
    font-weight: 700;
  }

  /* Top-Center Active Commander Banner */
  .top-center-banner {
    pointer-events: auto;
    grid-column: 2;
    grid-row: 1;
    justify-self: center;
    align-self: start;
    background: linear-gradient(180deg, rgba(11, 18, 33, 0.94) 0%, rgba(6, 11, 21, 0.96) 100%);
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 7px;
    padding: 0.48rem 0.95rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(14px);
    max-width: 620px;
    width: fit-content;
  }
  .top-center-banner.my-turn-banner {
    border-color: rgba(234, 179, 8, 0.75);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(234, 179, 8, 0.18);
  }
  .tc-main-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  .tc-text {
    display: flex;
    flex-direction: column;
  }
  .tc-kicker {
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    color: #eab308;
  }
  .tc-directive {
    font-size: 0.78rem;
    color: #f8fafc;
    font-weight: 600;
  }
  .tc-timer {
    margin-left: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.86rem;
    font-weight: 800;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #fef08a;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tc-timer.timer-danger {
    color: #fca5a5;
    border-color: #ef4444;
    background: rgba(127, 29, 29, 0.45);
  }

  /* Top-Right Panel */
  .top-right-panel {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: start;
    position: relative;
  }
  .my-hq-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }
  .hq-general {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-tactical);
    font-weight: 700;
    font-size: 0.88rem;
    color: #f8fafc;
  }
  .reserve-badge {
    background: rgba(234, 179, 8, 0.2);
    border: 1px solid #facc15;
    color: #fef08a;
    padding: 0.14rem 0.45rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }
  .hq-buttons {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    flex-wrap: wrap;
    width: 100%;
    margin-top: 0.15rem;
  }
  .hud-btn {
    flex: 1 1 auto;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #e2e8f0;
    padding: 0.28rem 0.45rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.73rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.28rem;
    white-space: nowrap;
  }
  .hud-btn:hover,
  .hud-btn.active {
    background: rgba(202, 138, 4, 0.2);
    border-color: #eab308;
    color: #fef08a;
  }
  .hud-btn.highlight {
    background: rgba(16, 185, 129, 0.22);
    border-color: #10b981;
    color: #a7f3d0;
  }
  .hud-btn.mandatory {
    background: rgba(220, 38, 38, 0.28);
    border-color: #ef4444;
    color: #fecaca;
  }
  .btn-exit-room {
    flex: 0 0 auto;
    padding: 0.28rem 0.45rem;
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.35);
  }

  .map-mode-bar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
  }
  .mode-tabs {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.22rem;
    background: rgba(5, 9, 18, 0.85);
    padding: 0.2rem;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.18);
  }
  .mode-btn {
    background: transparent;
    border: 1px solid transparent;
    color: #94a3b8;
    padding: 0.24rem 0.35rem;
    border-radius: 3px;
    font-family: var(--font-tactical);
    font-size: 0.69rem;
    font-weight: 700;
    text-transform: uppercase;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    white-space: nowrap;
    transition: all 0.15s ease;
  }
  .mode-btn:hover {
    color: #e2e8f0;
    background: rgba(148, 163, 184, 0.12);
  }
  .mode-btn.active {
    background: linear-gradient(135deg, #ca8a04, #a16207);
    color: #ffffff;
    border-color: rgba(250, 204, 21, 0.4);
  }
  .mode-btn.clean-mode-tab {
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.25);
  }
  .mode-btn.clean-mode-tab.active {
    background: linear-gradient(135deg, #0284c7, #0369a1);
    color: #ffffff;
    border-color: #38bdf8;
  }
  .clean-map-indicator {
    position: absolute;
    top: 4.8rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(6, 11, 21, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #e0f2fe;
    padding: 0.35rem 0.9rem;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 600;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65);
    letter-spacing: 0.02em;
    backdrop-filter: blur(4px);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .mode-btn.clean-mode-tab {
    border-left: 1px solid rgba(148, 163, 184, 0.25);
    margin-left: 0.15rem;
    padding-left: 0.45rem;
    color: #38bdf8;
  }
  .mode-btn.clean-mode-tab.active {
    background: linear-gradient(135deg, #0284c7, #0369a1);
    color: #ffffff;
  }
  .clean-map-indicator {
    position: absolute;
    top: 4.8rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(6, 11, 21, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #e0f2fe;
    padding: 0.35rem 0.9rem;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 600;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65);
    letter-spacing: 0.02em;
    backdrop-filter: blur(4px);
  }
  .zoom-cluster {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    justify-content: center;
  }
  .tool-btn {
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    min-width: 25px;
    height: 18px;
    padding: 0 0.32rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tool-btn:hover {
    background: rgba(202, 138, 4, 0.25);
    border-color: #eab308;
    color: #fef08a;
  }

  /* Floating Drawers */
  .floating-drawer {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(212, 175, 55, 0.3);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    max-height: 235px;
    overflow-y: auto;
  }
  .floating-drawer.market-drawer {
    max-height: 480px;
  }
  .drawer-sub {
    font-size: 0.74rem;
    color: #94a3b8;
    line-height: 1.35;
    margin: 0;
  }
  .market-locked-box {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    padding: 0.5rem 0.65rem;
    border-radius: 4px;
    color: #fca5a5;
    font-size: 0.76rem;
    line-height: 1.35;
  }
  .market-active-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
  }
  .market-status-tag {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: #6ee7b7;
    font-weight: 600;
  }
  .market-batch-selector {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .batch-label {
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .batch-buttons {
    display: flex;
    gap: 2px;
  }
  .batch-btn {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #94a3b8;
    padding: 1px 6px;
    font-size: 0.68rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .batch-btn.active {
    background: #eab308;
    border-color: #fde047;
    color: #020617;
    font-weight: bold;
  }
  .market-commodities-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .commodity-card {
    background: rgba(10, 17, 34, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .commodity-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .res-badge {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: #f8fafc;
  }
  .res-stock-count {
    font-size: 0.7rem;
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .commodity-prices {
    display: flex;
    gap: 0.4rem;
  }
  .price-pill {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.7rem;
  }
  .price-pill.buy {
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.25);
    color: #93c5fd;
  }
  .price-pill.sell {
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.25);
    color: #fde047;
  }
  .commodity-actions {
    display: flex;
    gap: 0.35rem;
  }
  .btn-trade {
    flex: 1;
    padding: 3px 5px;
    font-size: 0.72rem;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
  }
  .btn-trade.buy {
    background: #1e3a8a;
    border: 1px solid #3b82f6;
    color: #eff6ff;
  }
  .btn-trade.buy:hover:not(:disabled) {
    background: #2563eb;
  }
  .btn-trade.sell {
    background: #854d0e;
    border: 1px solid #eab308;
    color: #fefce8;
  }
  .btn-trade.sell:hover:not(:disabled) {
    background: #ca8a04;
  }
  .btn-trade:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .drawer-section-divider {
    height: 1px;
    background: rgba(212, 175, 55, 0.2);
    margin: 0.2rem 0;
  }
  .routes-section, .border-trade-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .routes-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .routes-header h5 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: #fde047;
    margin: 0;
  }
  .routes-hint {
    font-size: 0.7rem;
    color: #94a3b8;
  }
  .routes-list, .pending-proposals-list, .eligible-partners-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .route-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    font-size: 0.74rem;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .route-item.active {
    border-color: rgba(16, 185, 129, 0.4);
  }
  .route-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: #f1f5f9;
  }
  .route-badge {
    color: #6ee7b7;
    font-size: 0.68rem;
    font-weight: 600;
  }
  .route-actions {
    display: flex;
    gap: 0.3rem;
  }
  .btn-route {
    padding: 2px 6px;
    font-size: 0.68rem;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
  }
  .btn-route.accept {
    background: #065f46;
    border: 1px solid #10b981;
    color: #ecfdf5;
  }
  .btn-route.reject {
    background: #7f1d1d;
    border: 1px solid #ef4444;
    color: #fef2f2;
  }
  .btn-route:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .partner-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0.45rem;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 3px;
  }
  .partner-name {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;
    color: #f1f5f9;
  }
  .btn-propose-route {
    background: #1e3a8a;
    border: 1px solid #3b82f6;
    color: #eff6ff;
    padding: 2px 7px;
    font-size: 0.7rem;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
  }
  .btn-propose-route:hover:not(:disabled) {
    background: #2563eb;
  }
  .btn-propose-route:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .empty-routes-hint {
    font-size: 0.7rem;
    color: #64748b;
    margin: 0;
    font-style: italic;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-tactical);
    font-size: 0.82rem;
    color: #fde047;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .drawer-header h4 {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .btn-close {
    background: transparent;
    border: none;
    color: #94a3b8;
    padding: 2px 6px;
    font-size: 0.85rem;
  }
  .objective-body {
    font-size: 0.82rem;
    line-height: 1.45;
    color: #f1f5f9;
    background: rgba(5, 9, 18, 0.85);
    padding: 0.6rem;
    border-radius: 4px;
    border-left: 3px solid #eab308;
  }
  .objective-progress-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: rgba(5, 9, 18, 0.65);
    padding: 0.45rem 0.55rem;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .progress-bar-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: #cbd5e1;
  }
  .progress-bar-header strong {
    font-family: var(--font-mono);
    color: #facc15;
  }
  .progress-track {
    height: 6px;
    background: rgba(15, 23, 42, 0.9);
    border-radius: 99px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #ca8a04, #10b981);
    transition: width 0.3s ease;
  }
  .track-list-scroll {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 110px;
    overflow-y: auto;
  }
  .objective-note {
    font-size: 0.68rem;
    color: #94a3b8;
  }

  .escalation-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(202, 138, 4, 0.14);
    border: 1px solid rgba(234, 179, 8, 0.35);
    padding: 0.32rem 0.55rem;
    border-radius: 4px;
    font-size: 0.72rem;
    color: #cbd5e1;
  }
  .escalation-banner strong {
    font-family: var(--font-mono);
    color: #fde047;
  }

  .cards-grid {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .card-item {
    display: flex;
    justify-content: space-between;
    background: rgba(5, 9, 18, 0.85);
    padding: 0.36rem 0.55rem;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    font-size: 0.73rem;
  }
  .card-symbol {
    font-family: var(--font-tactical);
    font-weight: 800;
    color: #eab308;
  }
  .empty-cards-note {
    font-size: 0.74rem;
    color: #94a3b8;
    text-align: center;
    padding: 0.5rem;
  }

  .radio-controls {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .radio-top-btns {
    display: flex;
    gap: 0.4rem;
  }
  .eq-slider-block {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .eq-label-row {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 700;
    color: #cbd5e1;
    text-transform: uppercase;
  }
  .eq-label-row strong {
    font-family: var(--font-mono);
    color: #fde047;
  }
  .track-select {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    font-size: 0.72rem;
    color: #94a3b8;
  }
  .track-option {
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
    padding: 0.32rem 0.5rem;
    border-radius: 4px;
    text-align: left;
    font-size: 0.72rem;
  }
  .track-option.selected {
    border-color: #eab308;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.16);
  }

  /* Bottom-Left Recon & Controls Stack */
  .bottom-left-stack {
    grid-column: 1;
    grid-row: 3;
    align-self: end;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .recon-inspector-card {
    background: linear-gradient(160deg, rgba(11, 18, 33, 0.94), rgba(6, 11, 21, 0.96));
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 6px;
    padding: 0.5rem 0.65rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.75);
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
  }
  .recon-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .recon-head strong {
    font-family: var(--font-display);
    font-size: 0.86rem;
    color: #f8fafc;
  }
  .recon-garrison {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    color: #fef08a;
    background: rgba(202, 138, 4, 0.18);
    border: 1px solid rgba(234, 179, 8, 0.4);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .recon-capital-tag {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    width: fit-content;
  }
  .recon-capital-tag.gold {
    background: rgba(234, 179, 8, 0.15);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.45);
  }
  .recon-capital-tag.red {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.45);
  }
  .select-cap-btn {
    white-space: nowrap;
    background: rgba(234, 179, 8, 0.2);
    border: 1px solid rgba(234, 179, 8, 0.6);
    color: #fef08a;
    font-size: 0.75rem;
    padding: 0.35rem 0.6rem;
  }
  .select-cap-btn:hover {
    background: rgba(234, 179, 8, 0.35);
  }
  .recon-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .bottom-left-hint {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 600;
    color: #94a3b8;
    background: rgba(6, 11, 21, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.25);
    padding: 0.35rem 0.6rem;
    border-radius: 5px;
    width: fit-content;
  }

  /* Bottom-Center Phase Dock */
  .bottom-center-dock {
    grid-column: 2;
    grid-row: 3;
    justify-self: center;
    align-self: end;
    width: min(100%, 640px);
  }
  .action-popup {
    background: rgba(5, 9, 18, 0.92);
    border: 1px solid rgba(234, 179, 8, 0.5);
    padding: 0.6rem 0.7rem;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .popup-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .action-popup h4 {
    font-size: 0.8rem;
    font-weight: 600;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .quick-presets {
    display: flex;
    gap: 0.25rem;
  }
  .preset-btn {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    padding: 0.18rem 0.45rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
  }
  .preset-btn.active {
    background: rgba(202, 138, 4, 0.25);
    border-color: #fde047;
    color: #fef08a;
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .slider-row input {
    flex: 1;
  }

  .attack-matchup {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
  }
  .vs {
    background: #991b1b;
    color: #fecaca;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.7rem;
  }
  .attack-controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.72rem;
  }
  .dice-selector {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    color: #94a3b8;
  }
  .odds-inline {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: #cbd5e1;
  }
  .odds-inline strong {
    font-family: var(--font-mono);
  }
  .odds-bar {
    height: 5px;
    background: #7f1d1d;
    border-radius: 999px;
    overflow: hidden;
  }
  .odds-fill {
    height: 100%;
    background: #10b981;
  }
  .attack-cta-row {
    display: flex;
    gap: 0.45rem;
  }

  .phase-stepper-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .phase-step {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.55rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.75);
    color: #64748b;
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .phase-step .num {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    background: #1e293b;
    font-family: var(--font-mono);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.68rem;
  }
  .phase-step.active-phase {
    background: rgba(234, 179, 8, 0.16);
    color: #fef08a;
    border-color: rgba(234, 179, 8, 0.55);
  }
  .phase-step.active-phase .num {
    background: #eab308;
    color: #090d16;
  }
  .phase-arrow {
    color: #475569;
    font-size: 0.95rem;
    font-weight: 700;
  }
  .phase-action-slot {
    margin-left: auto;
  }

  .btn {
    border-radius: 5px;
    padding: 0.48rem 0.85rem;
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.38rem;
  }
  .btn.primary-gold {
    background: linear-gradient(135deg, #eab308, #a16207);
    border: 1px solid #fef08a;
    color: #050911;
  }
  .btn.secondary {
    background: #1e293b;
    border: 1px solid #475569;
    color: #f8fafc;
  }
  .btn.btn-attack {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border: 1px solid rgba(252, 165, 165, 0.5);
    color: white;
  }
  .full-width {
    width: 100%;
  }

  .alert-toast {
    position: fixed;
    top: 78px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #991b1b, #7f1d1d);
    border: 1px solid #f87171;
    color: white;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    z-index: 250;
    font-family: var(--font-tactical);
    font-size: 0.86rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.8);
  }

  /* Objective Map Highlight Toggle */
  .objective-toggle-box {
    margin: 0.2rem 0;
  }
  .highlight-toggle-btn {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
    font-weight: 700;
    cursor: pointer;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    transition: all 0.2s ease;
  }
  .highlight-toggle-btn:hover {
    background: rgba(16, 185, 129, 0.2);
    border-color: #10b981;
    color: #a7f3d0;
  }
  .highlight-toggle-btn.active {
    background: rgba(16, 185, 129, 0.28);
    border-color: #10b981;
    color: #ecfdf5;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
  }

  /* Modular HUD Customizer Drawer */
  .hud-drawer {
    min-width: 260px;
  }
  .hud-immersive-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  }
  .hud-immersive-box small {
    font-size: 0.66rem;
    color: #94a3b8;
  }
  .hud-toggle-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .hud-section-label {
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hud-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.28rem 0.45rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    cursor: pointer;
    font-size: 0.72rem;
    color: #e2e8f0;
    transition: background 0.15s;
  }
  .hud-toggle-row:hover {
    background: rgba(15, 23, 42, 0.85);
    border-color: rgba(234, 179, 8, 0.3);
  }
  .hud-toggle-row span {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .hud-toggle-row input[type="checkbox"] {
    accent-color: #eab308;
    cursor: pointer;
    width: 14px;
    height: 14px;
  }

  /* Immersive Mode Exit Pill */
  .immersive-exit-pill {
    position: fixed;
    top: 1rem;
    right: 1.5rem;
    z-index: 999;
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid #eab308;
    color: #fef08a;
    padding: 0.4rem 0.9rem;
    border-radius: 999px;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.75), 0 0 12px rgba(234, 179, 8, 0.35);
    transition: all 0.2s ease;
  }
  .immersive-exit-pill:hover {
    transform: translateY(-1px);
    background: rgba(202, 138, 4, 0.3);
  }

  /* Reconnecting Toast & Spinner */
  .reconnecting-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid #f59e0b;
    color: #fef3c7;
    padding: 0.45rem 1rem;
    border-radius: 8px;
    font-family: var(--font-tactical);
    font-size: 0.78rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85), 0 0 15px rgba(245, 158, 11, 0.4);
    animation: pulseToast 2s infinite ease-in-out;
  }
  .reconnecting-spinner {
    width: 13px;
    height: 13px;
    border: 2px solid rgba(245, 158, 11, 0.3);
    border-top-color: #f59e0b;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes pulseToast {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.75;
    }
  }

  /* Responsive Widescreen & Laptop Adaptations (1366x768 -> 21:9) */
  @media (max-height: 800px) {
    .hud-layer {
      padding: 0.5rem;
      gap: 0.45rem;
    }
    .hud-panel {
      padding: 0.55rem 0.65rem;
      gap: 0.38rem;
    }
    .continents-dropdown {
      max-height: 120px;
    }
    .floating-drawer {
      max-height: 185px;
    }
  }

  @media (max-width: 1180px) {
    .hud-layer {
      grid-template-columns: 290px 1fr 310px;
    }
    .top-center-banner {
      max-width: 460px;
    }
  }

  /* War Economy Bar & Recon Resource Badges (HEGEM-18 & HEGEM-56) */
  .hq-economy-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.35rem;
    padding-top: 0.25rem;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
  }
  .econ-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.28rem;
    padding: 0.24rem 0.38rem;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.18);
    font-size: 0.74rem;
    font-weight: 700;
    color: #e2e8f0;
  }
  .econ-pill.money {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.28);
  }
  .econ-pill.steel {
    color: #94a3b8;
    border-color: rgba(148, 163, 184, 0.3);
  }
  .econ-pill.oil {
    color: #fb923c;
    border-color: rgba(251, 146, 60, 0.28);
  }
  .econ-pill.gold {
    color: #fbbf24;
    border-color: rgba(251, 191, 36, 0.32);
  }
  .econ-val {
    color: #f8fafc;
    font-variant-numeric: tabular-nums;
  }
  .econ-delta {
    font-size: 0.65rem;
    font-weight: 600;
    opacity: 0.88;
  }
  .gold-card-purchase-box {
    margin-top: 0.45rem;
    padding: 0.5rem 0.6rem;
    border-radius: 8px;
    background: rgba(251, 191, 36, 0.07);
    border: 1px solid rgba(251, 191, 36, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
  }
  .gold-card-purchase-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;
    font-weight: 700;
    color: #fbbf24;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .gold-card-purchase-sub {
    margin: 0;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .gold-card-btn-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  .gold-buy-btn {
    justify-content: center;
    font-size: 0.7rem;
    padding: 0.32rem 0.45rem;
    border-color: rgba(251, 191, 36, 0.35);
    color: #fde68a;
  }
  .gold-buy-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .gold-card-bought-tag {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: #34d399;
    font-weight: 600;
  }
  .recon-economy-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.28rem;
  }
  .recon-res-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    padding: 0.14rem 0.42rem;
    border-radius: 4px;
    font-size: 0.67rem;
    font-weight: 600;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
  }
  .recon-res-badge.steel {
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.35);
  }
  .recon-res-badge.oil {
    color: #fdba74;
    border-color: rgba(251, 146, 60, 0.35);
  }
  .recon-res-badge.gold {
    color: #fde047;
    border-color: rgba(250, 204, 21, 0.4);
  }
  .recon-res-badge.money {
    color: #6ee7b7;
    border-color: rgba(52, 211, 153, 0.35);
  }
  .recon-infra-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.35rem;
    padding-top: 0.3rem;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
  }
  .infra-title {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .infra-slots {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: #cbd5e1;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .recon-active-bldgs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  .recon-bldg-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.12rem 0.38rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }
  .recon-bldg-chip.market {
    color: #fde047;
    border-color: rgba(234, 179, 8, 0.4);
    background: rgba(234, 179, 8, 0.1);
  }
  .recon-bldg-chip.industry {
    color: #fb923c;
    border-color: rgba(251, 146, 60, 0.4);
    background: rgba(251, 146, 60, 0.1);
  }
  .recon-bldg-chip.fortification {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.1);
  }
  .recon-bldg-chip.airfield {
    color: #93c5fd;
    border-color: rgba(96, 165, 250, 0.4);
    background: rgba(96, 165, 250, 0.1);
  }
  .recon-bldg-chip.port {
    color: #5eead4;
    border-color: rgba(45, 212, 191, 0.4);
    background: rgba(45, 212, 191, 0.1);
  }
  .recon-build-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem;
    margin-top: 0.3rem;
  }
  .btn-build-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.2rem;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    font-size: 0.64rem;
    font-weight: 600;
    color: #e2e8f0;
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.25);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-build-option:hover:not(:disabled) {
    background: rgba(51, 65, 85, 0.85);
    border-color: #facc15;
    color: #ffffff;
  }
  .btn-build-option.upgrade {
    border-color: rgba(56, 189, 248, 0.45);
    color: #bae6fd;
  }
  .btn-build-option.upgrade:hover:not(:disabled) {
    border-color: #38bdf8;
    background: rgba(14, 116, 144, 0.35);
  }
  .btn-build-option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: grayscale(0.6);
  }
  .btn-build-option .cost-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: #facc15;
    background: rgba(0, 0, 0, 0.35);
    padding: 1px 3px;
    border-radius: 2px;
  }
</style>
