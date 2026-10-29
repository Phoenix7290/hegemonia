<script lang="ts">
  import { Client, type Room } from "colyseus.js";
  import {
    ASIA_SUBREGIONS,
    CLASSIC_MAP,
    DIRECT_SEA_LINKS,
    GRATICULE_SVG_PATH,
    MAP_HEIGHT,
    MAP_WIDTH,
    PACIFIC_WRAP_LINKS,
    isSeaLink,
  } from "@hegemonia/maps";
  import {
    BUILDING_COSTS,
    FORTIFICATION_LEVEL_2_COST,
    UNIT_COSTS,
    UNIT_TYPES,
    addUnits,
    checkNavalBlockade,
    emptyUnitCounts,
    findAirMissionTargets,
    getMovedInUnits,
    getTerritoryBuildingLevel,
    getTerritoryMaxBuildingSlots,
    getTerritoryUnits,
    hasTerritoryBuilding,
    selectUnits,
    subtractUnits,
    totalUnits,
  } from "@hegemonia/engine";
  import { SESSION_REPLACED_CLOSE_CODE } from "@hegemonia/shared";
  import type {
    AirMissionType,
    BuildingType,
    GameState,
    PlayerColor,
    ResourceType,
    UnitCounts,
    UnitType,
  } from "@hegemonia/shared";
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
  import ReconInspector from "./components/ReconInspector.svelte";
  import ActionConsole from "./components/ActionConsole.svelte";
  import TopBar from "./components/TopBar.svelte";
  import { CommunicationsController } from "./lib/communications.svelte";
  import {
    InvalidRoomCodeError,
    connectToRoom,
    isRecoverableConnectionError,
    isRoomNotFoundError,
    resolveWebSocketUrl,
    retryWithBackoff,
  } from "./lib/multiplayer";
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

  // Map Rendering Mode: "cartographic" (HOI4 physical satellite relief + borders), "geopolitical" (Crisp War colors), "regional" (Continents & Sub-Regions), or "economic" (Resources & Buildings)
  let mapMode = $state<"cartographic" | "geopolitical" | "regional" | "economic">("cartographic");
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
  let selectedUnits = $state<UnitCounts>(emptyUnitCounts());
  let selectedUnitTotal = $derived(totalUnits(selectedUnits));
  let selectedAttackDice = $state<number | null>(null); // null = auto max dice

  // HUD Drawers (Mutually Exclusive on Right Panel to Prevent Overlap)
  let activeRightDrawer = $state<"cards" | "objective" | "audio" | "market" | null>(null);

  // Session Resilience & Reconnection State
  let isReconnecting = $state(false);
  let reconnectAttempts = $state(0);
  let connectionGeneration = 0;
  let autoConnectAttempted = false;

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

  // Derived calculations
  let currentTurnPlayer = $derived(game ? game.players[game.turnIndex] : null);
  let isMyTurn = $derived(Boolean(game && currentTurnPlayer && currentTurnPlayer.id === myPlayerId));
  let myPlayerState = $derived(game?.players.find((p) => p.id === myPlayerId) ?? null);
  let amIHost = $derived(lobbyPlayers.find((p) => p.token === myPlayerId)?.isHost ?? false);

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
    return estimateAttackWinOdds(selectedUnitTotal + 1, toT.armies);
  });

  let maxAttackerDice = $derived(Math.max(1, Math.min(3, selectedUnitTotal)));

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
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "q"].includes(k)) {
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
    } else if (e.key === "F5" || k === "4" || k === "e") {
      e.preventDefault();
      mapMode = mapMode === "economic" ? "cartographic" : "economic";
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

  interface RoomStateMessage {
    roomCode: string;
    status: "lobby" | "playing";
    turnDeadline: number;
    myPlayerId: string | null;
    lobbyPlayers: LobbyPlayerView[];
    game: GameState | null;
  }

  function clearPersistedRoom() {
    try {
      sessionStorage.removeItem("hegemonia_active_room");
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // Storage and history can be unavailable in restricted browser contexts.
    }
  }

  function resetRoomState() {
    communications.detach();
    connectedRoom = null;
    roomStatus = "disconnected";
    roomCode = "";
    roomCodeInput = "";
    myPlayerId = null;
    turnDeadline = 0;
    remainingSeconds = 120;
    game = null;
    lobbyPlayers = [];
    isReconnecting = false;
    reconnectAttempts = 0;
    selectedFromId = null;
    selectedToId = null;
    activeRightDrawer = null;
    showHudManager = false;
  }

  async function openRoom(
    createNew: boolean,
    forcedCode: string | undefined,
    generation: number,
    reconnecting: boolean
  ) {
    const client = new Client(
      resolveWebSocketUrl(window.location, import.meta.env.VITE_WS_URL as string | undefined)
    );
    const token = getOrCreateToken();
    const cleanName = (auth.user?.displayName || playerName).trim() || "General";
    connecting = true;
    isReconnecting = reconnecting;

    try {
      const room = await retryWithBackoff(
        () => connectToRoom<Room>(client, {
          create: createNew,
          roomCode: forcedCode ?? roomCodeInput,
          name: cleanName,
          token,
        }),
        {
          maxAttempts: reconnecting ? undefined : 1,
          shouldRetry: (error) =>
            generation === connectionGeneration && isRecoverableConnectionError(error),
          onAttempt: (attempt) => {
            if (generation === connectionGeneration) reconnectAttempts = attempt;
          },
        }
      );

      if (generation !== connectionGeneration) {
        room.removeAllListeners();
        void room.leave().catch(() => undefined);
        return;
      }

      connectedRoom = room;
      communications.attach(room, token, lobbyPlayers);
      isReconnecting = false;
      reconnectAttempts = 0;

      try {
        sessionStorage.setItem("hegemonia_active_room", room.roomId);
        const url = new URL(window.location.href);
        url.searchParams.set("room", room.roomId);
        window.history.replaceState({}, "", url.toString());
      } catch {
        // The connection remains usable without persistence.
      }

      room.onLeave((code) => {
        if (generation !== connectionGeneration) return;
        if (code === SESSION_REPLACED_CLOSE_CODE) {
          connectionGeneration++;
          resetRoomState();
          clearPersistedRoom();
          errorBanner = t("multiplayer_session_replaced");
          return;
        }
        connectedRoom = null;
        communications.detach();
        void openRoom(false, room.roomId, generation, true);
      });

      room.onError((code) => {
        if (generation === connectionGeneration) {
          errorBanner = t("multiplayer_room_error", { code });
        }
      });

      room.onMessage("room_state", (payload: RoomStateMessage) => {
        if (generation !== connectionGeneration) return;
        const prevLastCombat = game?.lastCombat;
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        communications.setMyPlayerId(payload.myPlayerId);
        communications.setPlayers(payload.lobbyPlayers);
        game = payload.game;

        resetSelectedForce();

        if (game?.lastCombat && game.lastCombat !== prevLastCombat) {
          sound.playCombatAttack();
          sound.playDiceRoll();
          if (game.lastCombat.conquered) {
            setTimeout(() => {
              if (generation === connectionGeneration) sound.playConquest();
            }, 300);
          }
        }
      });

      room.onMessage("error_msg", (payload: { message: string }) => {
        if (generation !== connectionGeneration) return;
        errorBanner = payload.message;
        setTimeout(() => {
          if (generation === connectionGeneration && errorBanner === payload.message) {
            errorBanner = "";
          }
        }, 4200);
      });
    } catch (error: unknown) {
      if (generation !== connectionGeneration) return;
      if (error instanceof InvalidRoomCodeError) {
        errorBanner = t("multiplayer_invalid_room_code");
      } else if (isRoomNotFoundError(error)) {
        errorBanner = t("multiplayer_room_not_found");
      } else {
        errorBanner = t(reconnecting
          ? "multiplayer_connection_lost"
          : "multiplayer_connection_failed");
      }
      resetRoomState();
      clearPersistedRoom();
    } finally {
      if (generation === connectionGeneration) connecting = false;
    }
  }

  async function joinOrCreateRoom(createNew: boolean, forcedCode?: string) {
    const generation = ++connectionGeneration;
    autoConnectAttempted = true;
    errorBanner = "";
    sound.playClick();
    const cleanName = (auth.user?.displayName || playerName).trim() || "General";
    playerName = cleanName;
    localStorage.setItem("hegemonia_name", cleanName);

    const previousRoom = connectedRoom;
    connectedRoom = null;
    communications.detach();
    if (previousRoom) {
      previousRoom.removeAllListeners();
      void previousRoom.leave().catch(() => undefined);
    }

    await openRoom(createNew, forcedCode, generation, false);
  }

  // Auto-reconnect to previous session on page refresh (F5) or direct room link
  $effect(() => {
    if (typeof window === "undefined" || autoConnectAttempted) return;
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get("room");
    const roomFromStorage = sessionStorage.getItem("hegemonia_active_room");
    const targetRoom = roomFromUrl || roomFromStorage;

    if (targetRoom && roomStatus === "disconnected" && !connecting && !connectedRoom) {
      autoConnectAttempted = true;
      roomCodeInput = targetRoom.toUpperCase();
      void joinOrCreateRoom(false, targetRoom);
    }
  });

  function leaveCurrentRoom() {
    sound.playClick();
    connectionGeneration++;
    const room = connectedRoom;
    resetRoomState();
    clearPersistedRoom();
    if (room) {
      room.removeAllListeners();
      void room.leave().catch(() => undefined);
    }
  }

  function sendAction(action: unknown) {
    sound.playClick();
    connectedRoom?.send("game_action", action);
  }

  function handleBuildStructure(territoryId: string, buildingType: BuildingType) {
    sendAction({
      type: "build_structure",
      territoryId,
      buildingType,
    });
  }

  const UNIT_BUILDING_REQUIREMENTS: Partial<Record<UnitType, BuildingType>> = {
    tank: "industry",
    artillery: "industry",
    aircraft: "airfield",
    navy: "port",
  };

  function canRecruitUnit(territoryId: string, unitType: UnitType): boolean {
    if (!game || !myPlayerState) return false;
    const territory = game.territories[territoryId];
    const definition = territoryById.get(territoryId);
    if (!territory || !definition) return false;
    const requirement = UNIT_BUILDING_REQUIREMENTS[unitType];
    if (requirement && !hasTerritoryBuilding(territory, requirement)) return false;
    if (unitType === "navy" && definition.isCoastal === false) return false;
    const cost = UNIT_COSTS[unitType];
    return (
      myPlayerState.resources.money >= cost.money &&
      myPlayerState.resources.steel >= cost.steel &&
      myPlayerState.resources.oil >= cost.oil
    );
  }

  function getRecruitRequirement(unitType: UnitType): string {
    const requirement = UNIT_BUILDING_REQUIREMENTS[unitType];
    return requirement
      ? t("unit_requires", { building: t(`building_${requirement}`) })
      : t("unit_no_requirement");
  }

  function handleRecruitUnit(territoryId: string, unitType: UnitType) {
    sendAction({ type: "recruit_unit", territoryId, unitType, quantity: 1 });
  }

  function resetAttackSelection() {
    if (!game || !selectedFromId) {
      selectedUnits = emptyUnitCounts();
      return;
    }
    const territory = game.territories[selectedFromId];
    selectedUnits = territory
      ? selectUnits(getTerritoryUnits(territory), Math.max(0, territory.armies - 1))
      : emptyUnitCounts();
  }

  function resetManeuverSelection() {
    if (!game || !selectedFromId) {
      selectedUnits = emptyUnitCounts();
      return;
    }
    const territory = game.territories[selectedFromId];
    if (!territory) {
      selectedUnits = emptyUnitCounts();
      return;
    }
    const available = subtractUnits(getTerritoryUnits(territory), getMovedInUnits(territory));
    selectedUnits = selectUnits(available, Math.max(0, totalUnits(available) - 1));
  }

  function getOccupationAvailable(): UnitCounts {
    if (!game?.pendingConquest) return emptyUnitCounts();
    const pending = game.pendingConquest;
    const destination = game.territories[pending.toTerritoryId];
    const origin = game.territories[pending.fromTerritoryId];
    const occupying = pending.occupyingUnits ?? selectUnits(getTerritoryUnits(destination), 1);
    const remaining = pending.remainingAttackers ?? getTerritoryUnits(origin);
    return addUnits(occupying, remaining);
  }

  function resetOccupationSelection() {
    if (!game?.pendingConquest) return;
    selectedUnits = selectUnits(getOccupationAvailable(), game.pendingConquest.maxMove);
    sliderArmies = totalUnits(selectedUnits);
  }

  function resetSelectedForce() {
    if (game?.pendingConquest) {
      resetOccupationSelection();
    } else if (game?.phase === "attack") {
      resetAttackSelection();
    } else if (game?.phase === "maneuver") {
      resetManeuverSelection();
    }
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
        resetAttackSelection();
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
        if (isAirliftTarget && fromT) {
          const available = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT));
          sliderArmies = Math.max(
            1,
            Math.min(available.infantry, totalUnits(available) - 1)
          );
        } else {
          resetManeuverSelection();
        }
      } else if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        selectedToId = null;
        resetManeuverSelection();
        sliderArmies = Math.max(1, tState.armies - tState.movedInArmies - 1);
      }
    }
  }

  function clearSelection() {
    selectedFromId = null;
    selectedToId = null;
  }

  function confirmDeploy() {
    if (!selectedFromId) return;
    sendAction({ type: "deploy", territoryId: selectedFromId, armies: sliderArmies });
    selectedFromId = null;
  }

  function confirmAttack() {
    if (!selectedFromId || !selectedToId || selectedUnitTotal < 1) return;
    const payload: {
      type: "attack";
      fromTerritoryId: string;
      toTerritoryId: string;
      diceCount?: number;
      units: UnitCounts;
    } = {
      type: "attack",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
      units: selectedUnits,
    };
    if (selectedAttackDice !== null) {
      payload.diceCount = Math.min(selectedAttackDice, maxAttackerDice);
    }
    sendAction(payload);
  }

  function confirmArtilleryBarrage() {
    if (!selectedFromId || !selectedToId) return;
    sendAction({
      type: "artillery_barrage",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
    });
  }

  function confirmAirMission(missionType: AirMissionType) {
    if (!selectedFromId || !selectedToId) return;
    sendAction({
      type: "air_mission",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
      missionType,
    });
  }

  function confirmOccupy() {
    if (!game?.pendingConquest) return;
    if (
      selectedUnitTotal < game.pendingConquest.minMove ||
      selectedUnitTotal > game.pendingConquest.maxMove
    ) return;
    sendAction({ type: "occupy", armies: selectedUnitTotal, units: selectedUnits });
    selectedFromId = null;
    selectedToId = null;
    selectedUnits = emptyUnitCounts();
  }

  function confirmManeuver() {
    if (!selectedFromId || !selectedToId) return;
    const isAdjacent = territoryById.get(selectedFromId)?.neighbors.includes(selectedToId);
    if (isAdjacent) {
      if (selectedUnitTotal < 1) return;
      sendAction({
        type: "maneuver",
        fromTerritoryId: selectedFromId,
        toTerritoryId: selectedToId,
        armies: selectedUnitTotal,
        units: selectedUnits,
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
    selectedUnits = emptyUnitCounts();
  }

  // --- Mouse Drag, Touch Pan (Tablet) & Wheel Camera Controls ---
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

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const target = e.target as Element;
    if (target.closest(".hud-panel") || target.closest(".war-journal-panel")) return;
    isDragging = true;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    const dxPx = e.touches[0].clientX - lastMouseX;
    const dyPx = e.touches[0].clientY - lastMouseY;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;

    const svgScale = MAP_WIDTH / Math.max(window.innerWidth, 320);
    camX = wrapCamX(camX + (dxPx * svgScale) / zoom);
    camY = clampCamY(camY + (dyPx * svgScale) / zoom);
  }

  function onTouchEnd() {
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
  ontouchend={onTouchEnd}
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
    <div
      class="map-viewport"
      onwheel={onWheel}
      onmousedown={onMouseDown}
      ontouchstart={onTouchStart}
      ontouchmove={onTouchMove}
    >
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

            </g>
          {/each}

          <!-- TERRITORY PASS: after all world-copy backgrounds -->
          {#each [-MAP_WIDTH, 0, MAP_WIDTH] as offsetX (offsetX)}
            <g class="world-copy" transform="translate({offsetX}, 0)">
              <!-- 44 Natural Earth Admin-1 & Admin-0 Geopolitical Territories -->
              {#each CLASSIC_MAP.territories as t (t.id)}
                {@const tState = game.territories[t.id]}
                {@const owner = game.players.find((p) => p.id === tState.ownerId)}
                {@const ownerColor = owner ? COLOR_HEX[owner.color] : "#334155"}
                {@const regionColor = getTerritoryRegionColor(t as any)}
                {@const economicProfileColor =
                  t.resource === "gold"
                    ? "#854d0e"
                    : t.resource === "oil"
                      ? "#451a03"
                      : t.resource === "steel"
                        ? "#1e293b"
                        : (t.tradeBonus && t.tradeBonus > 0)
                          ? "#064e3b"
                          : "#18181b"}
                {@const activeFill =
                  mapMode === "regional"
                    ? regionColor
                    : mapMode === "economic"
                      ? economicProfileColor
                      : ownerColor}
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
                            : mapMode === "economic"
                              ? "0.76"
                              : "0.84"}
                    stroke={isSelected
                      ? "#ffffff"
                      : isValidTarget
                        ? "#facc15"
                        : isObjPending
                          ? "#ef4444"
                          : isObjOwned
                            ? "#10b981"
                            : mapMode === "cartographic" || mapMode === "economic"
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
                    {#if mapMode === "economic"}
                      {@const maxSlots = isCapital ? 3 : 2}
                      {@const bldgs = tState.buildings ?? []}
                      <!-- ECONOMIC MAP MODE: RESOURCE PROFILE + BUILDING SLOTS (HEGEM-58) -->
                      <g
                        transform="translate({t.center[0]}, {t.center[1]}) scale({COMPACT_BADGE_IDS.has(t.id) ? 0.84 : 0.96})"
                        class="economic-counter"
                      >
                        <!-- Base Frame -->
                        <rect
                          x="-22"
                          y="-9.5"
                          width="44"
                          height="19"
                          rx="2.8"
                          fill="#090e1a"
                          stroke={isCapital
                            ? "#f59e0b"
                            : isSelected
                              ? "#ffffff"
                              : isValidTarget
                                ? "#facc15"
                                : ownerColor}
                          stroke-width={isCapital || isSelected || isValidTarget ? "1.6" : "1.1"}
                          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.85))"
                        />

                        <!-- Resource Icon on Left -->
                        {#if t.resource === "gold"}
                          <g transform="translate(-14, -0.5)">
                            <polygon points="-4.5,2.5 -2.5,-3.5 2.5,-3.5 4.5,2.5" fill="#facc15" stroke="#ca8a04" stroke-width="0.6" />
                            <polygon points="-5,5.5 -4.5,2.5 4.5,2.5 5,5.5" fill="#eab308" />
                          </g>
                        {:else if t.resource === "steel"}
                          <g transform="translate(-14, 0)">
                            <polygon points="-4.5,3.8 4.5,3.8 3,-3 -3,-3" fill="#94a3b8" stroke="#cbd5e1" stroke-width="0.6" />
                          </g>
                        {:else if t.resource === "oil"}
                          <g transform="translate(-14, -0.5)">
                            <path d="M0,-4.5 C-3,0 -3,3.5 0,4.5 C3,3.5 3,0 0,-4.5 Z" fill="#f59e0b" stroke="#b45309" stroke-width="0.6" />
                          </g>
                        {:else if t.tradeBonus && t.tradeBonus > 0}
                          <g transform="translate(-14, 0)">
                            <circle cx="0" cy="0" r="4.2" fill="#065f46" stroke="#10b981" stroke-width="0.8" />
                            <text x="0" y="0.5" text-anchor="middle" dominant-baseline="central" fill="#ecfdf5" font-size="4.8" font-weight="900">$</text>
                          </g>
                        {:else}
                          <g transform="translate(-14, 0)">
                            <circle cx="0" cy="0" r="2.8" fill="#1e293b" stroke="rgba(148, 163, 184, 0.4)" stroke-width="0.7" />
                          </g>
                        {/if}

                        <!-- Divider Line -->
                        <line x1="-7.5" y1="-8" x2="-7.5" y2="8" stroke="rgba(148, 163, 184, 0.3)" stroke-width="0.7" />

                        <!-- Building Slots on Right (2 for regular, 3 for active Capital) -->
                        <g transform="translate(6, 0)">
                          {#each Array(maxSlots) as _, slotIdx}
                            {@const b = bldgs[slotIdx]}
                            {@const slotX = (slotIdx - (maxSlots - 1) / 2) * 8.5}
                            <g transform="translate({slotX}, 0)">
                              {#if b}
                                <rect
                                  x="-3.5"
                                  y="-4.5"
                                  width="7"
                                  height="9"
                                  rx="1.2"
                                  fill={b.type === "market"
                                    ? "#78350f"
                                    : b.type === "industry"
                                      ? "#1e3a8a"
                                      : b.type === "fortification"
                                        ? (b.level === 2 ? "#0369a1" : "#334155")
                                        : b.type === "airfield"
                                          ? "#4c1d95"
                                          : "#065f46"}
                                  stroke={b.type === "fortification" && b.level === 2 ? "#38bdf8" : "rgba(255,255,255,0.3)"}
                                  stroke-width="0.7"
                                />
                                <text
                                  x="0"
                                  y="0.3"
                                  text-anchor="middle"
                                  dominant-baseline="central"
                                  fill="#ffffff"
                                  font-size="4.5"
                                  font-weight="bold"
                                >
                                  {b.type === "market"
                                    ? "M"
                                    : b.type === "industry"
                                      ? "I"
                                      : b.type === "fortification"
                                        ? (b.level === 2 ? "F2" : "F1")
                                        : b.type === "airfield"
                                          ? "A"
                                          : "P"}
                                </text>
                              {:else}
                                <rect
                                  x="-3.5"
                                  y="-4.5"
                                  width="7"
                                  height="9"
                                  rx="1.2"
                                  fill="rgba(15, 23, 42, 0.4)"
                                  stroke="rgba(148, 163, 184, 0.35)"
                                  stroke-dasharray="1.2, 1"
                                  stroke-width="0.6"
                                />
                              {/if}
                            </g>
                          {/each}
                        </g>

                        <!-- Territory Label Underneath -->
                        <text
                          x="0"
                          y="15.2"
                          text-anchor="middle"
                          fill={isCapital ? "#fde047" : "#e2e8f0"}
                          font-size="6.0"
                          font-weight="700"
                          letter-spacing="0.01em"
                          pointer-events="none"
                          style="paint-order: stroke; stroke: #050912; stroke-width: 2.2px; stroke-linejoin: round;"
                        >
                          {isCapital ? `⭐ ${getTerritoryName(t.id)}` : getTerritoryName(t.id)}
                        </text>
                      </g>
                    {:else}
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

                      <!-- Encirclement / Out of Supply Badge (HEGEM-35) -->
                      {#if tState.isEncircled}
                        <g transform="translate(-13.5, -4.5)" pointer-events="none">
                          <circle cx="0" cy="0" r="3.6" fill="#450a0a" stroke="#ef4444" stroke-width="1.1" />
                          <text x="0" y="0.8" text-anchor="middle" dominant-baseline="central" font-size="4.5" fill="#fca5a5" font-weight="900">📦</text>
                        </g>
                      {/if}

                      <!-- Fuel Starvation Badge (HEGEM-35) -->
                      {#if tState.outOfFuel}
                        <g transform="translate(-13.5, 4.5)" pointer-events="none">
                          <circle cx="0" cy="0" r="3.6" fill="#451a03" stroke="#f97316" stroke-width="1.1" />
                          <text x="0" y="0.8" text-anchor="middle" dominant-baseline="central" font-size="4.5" fill="#fdba74" font-weight="900">⛽</text>
                        </g>
                      {/if}

                      <!-- Blitzkrieg Spearhead Indicator (HEGEM-25) -->
                      {#if tState.blitzkriegAvailable}
                        <g transform="translate(13.5, 4.5)" pointer-events="none">
                          <circle cx="0" cy="0" r="3.6" fill="#422006" stroke="#eab308" stroke-width="1.1" />
                          <text x="0" y="0.8" text-anchor="middle" dominant-baseline="central" font-size="5" fill="#fef08a" font-weight="900">⚡</text>
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
      <!-- ⬆ SUPREME COMMAND TOP HUD (TREATY TOASTS, BRANDING, TELEMETRY, ORDERS, CONTROLS) -->
      <TopBar
        {game}
        {roomCode}
        {myPlayerId}
        {myPlayerState}
        {isMyTurn}
        {currentTurnPlayer}
        {remainingSeconds}
        {playerMetrics}
        {isImmersiveMode}
        {hudVisibility}
        bind:mapMode
        bind:cleanMapMode
        bind:highlightObjectiveTerritories
        bind:activeRightDrawer
        bind:showHudManager
        {objectiveProgress}
        {toggleImmersiveMode}
        {toggleHudElement}
        {zoomIn}
        {zoomOut}
        {resetZoom}
        {leaveCurrentRoom}
        {sendAction}
      />

      <!-- ↙ BOTTOM-LEFT: LIVE TERRITORY RECON INSPECTOR & CONTROLS HINT -->
      <ReconInspector
        {game}
        {myPlayerId}
        {myPlayerState}
        {isMyTurn}
        {inspectedTerritory}
        {isImmersiveMode}
        hudVisible={hudVisibility.recon}
        {handleBuildStructure}
        {handleRecruitUnit}
        {canRecruitUnit}
        {getRecruitRequirement}
        {getTerritoryName}
      />

      <!-- ⬇ BOTTOM-CENTER: TACTICAL ORDER CONSOLE & 1-2-3 PHASE STEPPER -->
      <ActionConsole
        {game}
        {myPlayerId}
        {myPlayerState}
        {isMyTurn}
        bind:selectedFromId
        bind:selectedToId
        bind:sliderArmies
        bind:selectedUnits
        bind:selectedAttackDice
        {maxAttackerDice}
        {currentAttackOdds}
        {selectedUnitTotal}
        {territoryById}
        {isImmersiveMode}
        hudVisible={hudVisibility.bottomDock}
        {confirmDeploy}
        {confirmOccupy}
        {confirmAttack}
        {confirmManeuver}
        {confirmArtilleryBarrage}
        {confirmAirMission}
        {sendAction}
        {getTerritoryName}
        {getOccupationAvailable}
        {clearSelection}
      />

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
          <span>{t("multiplayer_reconnecting", { attempt: reconnectAttempts })}</span>
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
  .division-counter,
  .economic-counter {
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

  /* Responsive Widescreen, Tablet Landscape & Tablet Portrait Adaptations */
  @media (max-height: 800px) {
    .hud-layer {
      padding: 0.5rem;
      gap: 0.45rem;
    }
  }

  @media (max-width: 1180px) {
    .hud-layer {
      grid-template-columns: 270px 1fr 290px;
    }
  }

  /* Tablet Landscape & Portrait (<= 1024px) */
  @media (max-width: 1024px) {
    .hud-layer {
      grid-template-columns: 250px 1fr 265px;
      padding: 0.5rem;
      gap: 0.4rem;
    }
  }

  /* Tablet Portrait (<= 820px) */
  @media (max-width: 820px) {
    .hud-layer {
      grid-template-columns: 220px 1fr 235px;
      padding: 0.4rem;
      gap: 0.35rem;
    }
  }
</style>
