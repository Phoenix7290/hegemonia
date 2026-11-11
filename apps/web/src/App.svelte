<script lang="ts">
  import { onDestroy } from "svelte";
  import { Client, type Room } from "colyseus.js";
  import {
    ASIA_SUBREGIONS,
    CLASSIC_MAP,
    isSeaLink,
  } from "@hegemonia/maps";
  import {
    UNIT_COSTS,
    addUnits,
    applyAction,
    calculateObjectiveProgress,
    calculateTurnReinforcements,
    cloneGameState,
    createGame,
    createSeededRng,
    emptyUnitCounts,
    getMovedInUnits,
    getReachableManeuverTargets,
    getTerritoryUnits,
    hasTerritoryBuilding,
    isConnectedByFriendlyPath,
    selectUnits,
    subtractUnits,
    totalUnits,
  } from "@hegemonia/engine";
  import {
    IDLE_MATCHMAKING_STATUS,
    MATCHMAKING_RULESET_VERSION,
    SESSION_REPLACED_CLOSE_CODE,
  } from "@hegemonia/shared";
  import type {
    AirMissionType,
    BuildingType,
    CompetitionMode,
    DoctrineId,
    GameAction,
    GameState,
    MatchOrigin,
    MatchmakingStatus,
    PlayerColor,
    PublicQueueMode,
    TacticalScenarioId,
    UnitCounts,
    UnitType,
  } from "@hegemonia/shared";
  import { sound } from "./audio.js";
  import { estimateAttackWinOdds } from "./odds.js";
  import { api, ApiError } from "./lib/api";
  import { auth } from "./lib/auth.svelte";
  import { ui } from "./lib/ui.svelte";
  import { versionGuard } from "./lib/version.svelte";
  import CommandCenter, {
    type LobbyPlayerView,
  } from "./components/CommandCenter.svelte";
  import Icon from "./components/Icon.svelte";
  import ObjectiveSelectionModal from "./components/ObjectiveSelectionModal.svelte";
  import WonderAlertToast from "./components/WonderAlertToast.svelte";
  import TutorialGuideModal from "./components/TutorialGuideModal.svelte";
  import InGameTutorialGuide from "./components/InGameTutorialGuide.svelte";
  import VictoryModal from "./components/VictoryModal.svelte";
  import WarJournal from "./components/WarJournal.svelte";
  import ReconInspector from "./components/ReconInspector.svelte";
  import ActionConsole from "./components/ActionConsole.svelte";
  import TopBar from "./components/TopBar.svelte";
  import TacticalMap, { wrapCamX, clampCamY } from "./components/TacticalMap.svelte";
  import {
    loadMapPreferences,
    saveMapPreferences,
    type BaseMapMode,
    type MapOverlays,
  } from "./lib/map-preferences";
  import {
    type ActiveCombatAnimation,
    createCombatAnimationFromRoll,
    createCombatAnimationFromStrike,
  } from "./lib/combat-animations";
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
  } from "./i18n/content.svelte";
  import { installGameDebugHook } from "./lib/debug-hook";

  function getOrCreateToken(): string {
    const saved = localStorage.getItem("hegemonia_token");
    if (saved) return saved;
    const uuid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const fresh = "plr_" + uuid;
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
  let activeCombatAnimations = $state<ActiveCombatAnimation[]>([]);
  let turnDeadline = $state(0);

  function spawnCombatAnimation(anim: ActiveCombatAnimation | null) {
    if (!anim) return;
    activeCombatAnimations = [...activeCombatAnimations.slice(-5), anim];
    setTimeout(() => {
      activeCombatAnimations = activeCombatAnimations.filter((item) => item.id !== anim.id);
    }, anim.durationMs);
  }
  let remainingSeconds = $state(120);
  let errorBanner = $state("");
  let matchmakingStatus = $state<MatchmakingStatus>({ ...IDLE_MATCHMAKING_STATUS });
  let matchmakingBusy = $state(false);
  let competitionMode = $state<CompetitionMode>("custom");
  let matchOrigin = $state<MatchOrigin>("lobby");
  let selectedScenarioId = $state<TacticalScenarioId>("standard");
  let selectedDoctrineId = $state<DoctrineId>("superior_firepower");
  let selectedPlayerColor = $state<PlayerColor>("blue");
  let showTutorialModal = $state<boolean>(false);
  let showInGameTutorial = $state<boolean>(false);
  let activeTutorialStep = $state<number>(0);
  let matchmakingPollTimer: ReturnType<typeof setTimeout> | null = null;
  let matchmakingPollGeneration = 0;
  let matchmakingStatusUserId: string | null = null;
  let matchmakingConnectionCode: string | null = null;

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

  // Map Preferences (HEGEM-62: Decoupled Base Modes & Overlays with Local Persistence)
  const initialMapPrefs = loadMapPreferences();
  let baseMapMode = $state<BaseMapMode>(initialMapPrefs.base);
  let mapOverlays = $state<MapOverlays>(initialMapPrefs.overlays);
  let autoCameraFocus = $state<boolean>(initialMapPrefs.autoCameraFocus);
  let cleanMapMode = $state(false);

  $effect(() => {
    saveMapPreferences({
      base: baseMapMode,
      overlays: {
        regional: mapOverlays.regional,
        economic: mapOverlays.economic,
      },
      autoCameraFocus,
    });
  });

  // Continuous Wraparound Camera State (in SVG coordinate space: width=1200, height=620)
  let camX = $state(0);
  let camY = $state(0);
  let zoom = $state(1.05);
  let isCameraTransitioning = $state(false);

  function focusTerritory(territoryId: string, targetZoom = 1.35) {
    const terr = CLASSIC_MAP.territories.find((t) => t.id === territoryId);
    if (!terr) return;
    selectedFromId = territoryId;
    selectedToId = null;
    inspectedTerritoryId = territoryId;

    if (autoCameraFocus) {
      const [cx, cy] = terr.center;
      isCameraTransitioning = true;
      camX = wrapCamX(600 - cx); // 600 = MAP_WIDTH / 2
      camY = clampCamY(310 - cy); // 310 = MAP_HEIGHT / 2
      if (targetZoom) {
        zoom = Math.max(0.75, Math.min(4.5, targetZoom));
      }
      setTimeout(() => {
        isCameraTransitioning = false;
      }, 460);
    }
  }

  // Keyboard WASD + Arrow Smooth Panning State
  const pressedKeys = new Set<string>();

  // Map Selection & Hover Intelligence State
  let selectedFromId = $state<string | null>(null);
  let selectedToId = $state<string | null>(null);
  let inspectedTerritoryId = $state<string | null>(null);
  let hoveredTerritoryId = $state<string | null>(null);
  let sliderArmies = $state(1);
  let selectedUnits = $state<UnitCounts>(emptyUnitCounts());
  let selectedUnitTotal = $derived(totalUnits(selectedUnits));
  let selectedAttackDice = $state<number | null>(null); // null = auto max dice

  // HUD Drawers (Mutually Exclusive on Right Panel to Prevent Overlap)
  let activeRightDrawer = $state<"cards" | "objective" | "audio" | "market" | null>(null);

  // Game State Debug Hook (Design for Testability: Playwright E2E & AI Exploratory QA)
  const uninstallDebugHook = installGameDebugHook({
    getGame: () => game,
    setGame: (nextGame) => {
      game = nextGame;
    },
    getMyPlayerId: () => myPlayerId,
    sendAction,
    selectTerritory: (id) => {
      selectedFromId = id;
      inspectedTerritoryId = id;
    },
  });

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
    } else if (rule.type === "destroy_color") {
      const targetPlayer = game.players.find((p) => p.color === rule.targetColor);
      if (targetPlayer && targetPlayer.id !== myPlayerId && !targetPlayer.eliminated) {
        for (const t of CLASSIC_MAP.territories) {
          if (game.territories[t.id]?.ownerId === targetPlayer.id) targetIds.add(t.id);
        }
      }
    }
    return targetIds;
  });

  let objectiveProgress = $derived.by(() => {
    if (!myPlayerState || !game) return null;
    const prog = calculateObjectiveProgress(game, myPlayerId, CLASSIC_MAP);
    return {
      owned: prog.held,
      total: prog.total,
      pct: prog.completionPct,
      metrics: prog.metrics,
    };
  });

  let activeWonderInfo = $derived.by(() => {
    if (!game) return null;
    for (const t of Object.values(game.territories)) {
      if (hasTerritoryBuilding(t, "wonder")) {
        const owner = game.players.find((p) => p.id === t.ownerId);
        const terrDef = CLASSIC_MAP.territories.find((item) => item.id === t.id);
        return {
          territoryId: t.id,
          territoryName: terrDef?.namePt ?? t.id,
          builderName: owner?.name ?? "General Desconhecido",
          builderColor: owner?.color ?? "yellow",
          roundsHeld: owner?.wonderRoundsHeld ?? 0,
          roundsRequired: 3,
          isMine: t.ownerId === myPlayerId,
        };
      }
    }
    return null;
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
    const targetId = selectedToId ?? selectedFromId ?? inspectedTerritoryId;
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

  // Turn alert sound
  let lastTurnPlayerId = "";
  $effect(() => {
    if (game && currentTurnPlayer && currentTurnPlayer.id !== lastTurnPlayerId) {
      lastTurnPlayerId = currentTurnPlayer.id;
      selectedFromId = null;
      selectedToId = null;
      if (currentTurnPlayer.id === myPlayerId) {
        sound.playTurnRadioAlert();
      }
    }
  });

  // HEGEM-93: Global Tension Defcon 1 Alarm Tracking
  let prevWorldTension = 0;
  $effect(() => {
    if (game && typeof game.worldTension === "number") {
      const tensionVal = game.worldTension;
      if (prevWorldTension < 66 && tensionVal >= 66) {
        sound.playDefcon1Alert();
      }
      prevWorldTension = tensionVal;
    }
  });

  // Countdown timer
  $effect(() => {
    const timer = setInterval(() => {
      if (turnDeadline > 0) {
        remainingSeconds = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
        if (remainingSeconds <= 0 && !connectedRoom && game && roomStatus === "playing") {
          turnDeadline = Date.now() + 120_000;
          remainingSeconds = 120;
        }
      }
    }, 500);
    return () => clearInterval(timer);
  });

  // HEGEM-95: Tactical Audio & Ticks for Final 5 Seconds of Player's Turn
  let lastTimerTickSecond = -1;
  $effect(() => {
    if (
      isMyTurn &&
      !game?.winnerId &&
      remainingSeconds <= 5 &&
      remainingSeconds > 0 &&
      ui.turnTimerAlertsEnabled
    ) {
      if (lastTimerTickSecond !== remainingSeconds) {
        lastTimerTickSecond = remainingSeconds;
        sound.playTurnTimerTick(remainingSeconds);
      }
    } else if (remainingSeconds > 5 || !isMyTurn) {
      lastTimerTickSecond = -1;
    }
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
      baseMapMode = "geopolitical";
    } else if (e.key === "F2" || k === "2") {
      e.preventDefault();
      baseMapMode = "cartographic";
    } else if (e.key === "F3" || k === "3") {
      e.preventDefault();
      mapOverlays.regional = !mapOverlays.regional;
    } else if (k === "4" || k === "e") {
      e.preventDefault();
      mapOverlays.economic = !mapOverlays.economic;
    } else if (k === "h") {
      e.preventDefault();
      toggleImmersiveMode();
    } else if (e.key === "F4") {
      e.preventDefault();
      cleanMapMode = !cleanMapMode;
    } else if (e.key === "Escape") {
      selectedFromId = null;
      selectedToId = null;
      inspectedTerritoryId = null;
      activeRightDrawer = null;
      showHudManager = false;
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    pressedKeys.delete(e.key.toLowerCase());
  }

  interface RoomStateMessage {
    version?: string;
    roomCode: string;
    status: "lobby" | "playing";
    turnDeadline: number;
    myPlayerId: string | null;
    lobbyPlayers: LobbyPlayerView[];
    game: GameState | null;
    competitionMode: CompetitionMode;
    matchOrigin: MatchOrigin;
    selectedScenarioId?: TacticalScenarioId;
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
    connecting = false;
    communications.detach();
    connectedRoom = null;
    roomStatus = "disconnected";
    roomCode = "";
    roomCodeInput = "";
    myPlayerId = null;
    turnDeadline = 0;
    remainingSeconds = 120;
    game = null;
    activeCombatAnimations = [];
    lobbyPlayers = [];
    isReconnecting = false;
    reconnectAttempts = 0;
    selectedFromId = null;
    selectedToId = null;
    inspectedTerritoryId = null;
    activeRightDrawer = null;
    showHudManager = false;
    showInGameTutorial = false;
    activeTutorialStep = 0;
    competitionMode = "custom";
    matchOrigin = "lobby";
  }

  function stopMatchmakingPolling() {
    matchmakingPollGeneration++;
    if (matchmakingPollTimer !== null) {
      clearTimeout(matchmakingPollTimer);
      matchmakingPollTimer = null;
    }
  }

  function showMatchmakingError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      auth.dialogOpen = true;
    }
    errorBanner = error instanceof ApiError && error.code
      ? t(`error_${error.code}`)
      : t("error_matchmaking_unavailable");
  }

  async function connectToMatchedRoom(): Promise<boolean> {
    const code = matchmakingStatus.roomCode;
    if (!code || connectedRoom || matchmakingConnectionCode === code) return false;
    matchmakingConnectionCode = code;
    try {
      return await joinOrCreateRoom(false, code);
    } finally {
      matchmakingConnectionCode = null;
    }
  }

  async function pollMatchmakingStatus(generation: number) {
    if (generation !== matchmakingPollGeneration) return;
    try {
      const next = await api<MatchmakingStatus>("/api/matchmaking/status");
      if (generation !== matchmakingPollGeneration) return;
      matchmakingStatus = next;
      if (next.status === "matched") {
        stopMatchmakingPolling();
        await connectToMatchedRoom();
        return;
      }
    } catch (error) {
      if (generation !== matchmakingPollGeneration) return;
      if (error instanceof ApiError && error.status === 401) {
        stopMatchmakingPolling();
        matchmakingStatus = { ...IDLE_MATCHMAKING_STATUS };
        return;
      }
    }

    if (generation === matchmakingPollGeneration && matchmakingStatus.status === "queued") {
      matchmakingPollTimer = setTimeout(() => {
        void pollMatchmakingStatus(generation);
      }, 1_000);
    }
  }

  function startMatchmakingPolling() {
    stopMatchmakingPolling();
    void pollMatchmakingStatus(matchmakingPollGeneration);
  }

  async function queueForMatch(mode: PublicQueueMode) {
    if (!auth.user) {
      auth.dialogOpen = true;
      return;
    }
    if (matchmakingBusy || matchmakingStatus.status !== "idle") return;
    stopMatchmakingPolling();
    matchmakingBusy = true;
    errorBanner = "";
    sound.playClick();
    try {
      matchmakingStatus = await api<MatchmakingStatus>("/api/matchmaking/queue", {
        method: "POST",
        body: JSON.stringify({ mode, rulesetVersion: MATCHMAKING_RULESET_VERSION }),
      });
      if (matchmakingStatus.status === "matched") await connectToMatchedRoom();
      else startMatchmakingPolling();
    } catch (error) {
      showMatchmakingError(error);
      matchmakingStatus = { ...IDLE_MATCHMAKING_STATUS };
    } finally {
      matchmakingBusy = false;
    }
  }

  async function cancelMatchmakingQueue() {
    if (matchmakingBusy) return;
    matchmakingBusy = true;
    errorBanner = "";
    sound.playClick();
    try {
      matchmakingStatus = await api<MatchmakingStatus>("/api/matchmaking/queue", {
        method: "DELETE",
      });
      stopMatchmakingPolling();
    } catch (error) {
      showMatchmakingError(error);
    } finally {
      matchmakingBusy = false;
    }
  }

  $effect(() => {
    if (!auth.ready) return;
    const userId = auth.user?.id ?? null;
    if (userId === matchmakingStatusUserId) return;
    matchmakingStatusUserId = userId;
    stopMatchmakingPolling();
    matchmakingConnectionCode = null;
    matchmakingStatus = { ...IDLE_MATCHMAKING_STATUS };
    if (userId) startMatchmakingPolling();
  });

  onDestroy(() => {
    uninstallDebugHook();
    stopMatchmakingPolling();
    connectionGeneration++;
    communications.detach();
    if (connectedRoom) {
      connectedRoom.removeAllListeners();
      void connectedRoom.leave().catch(() => undefined);
    }
  });

  async function openRoom(
    createNew: boolean,
    forcedCode: string | undefined,
    generation: number,
    reconnecting: boolean
  ): Promise<boolean> {
    connecting = true;
    isReconnecting = reconnecting;

    try {
      const client = new Client(
        resolveWebSocketUrl(window.location, import.meta.env.VITE_WS_URL as string | undefined)
      );
      const token = getOrCreateToken();
      const cleanName = (auth.user?.displayName || playerName).trim() || "General";

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
        return false;
      }

      connectedRoom = room;
      communications.attach(room, token, lobbyPlayers);
      isReconnecting = false;
      reconnectAttempts = 0;
      stopMatchmakingPolling();

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
        if (payload.version) {
          versionGuard.checkServerVersion(payload.version, ui.inActiveBattle);
        }
        const hadPrevGame = game !== null;
        const prevLogLen = game?.log?.length ?? 0;
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        competitionMode = payload.competitionMode;
        matchOrigin = payload.matchOrigin;
        if (payload.selectedScenarioId) {
          selectedScenarioId = payload.selectedScenarioId;
        }
        communications.setMyPlayerId(payload.myPlayerId);
        communications.setPlayers(payload.lobbyPlayers);
        game = payload.game;

        resetSelectedForce();

        const newLogs =
          hadPrevGame && game?.log && game.log.length > prevLogLen
            ? game.log.slice(prevLogLen)
            : [];
        const hasNewCombatLog = newLogs.some((l) => l.startsWith("Combate "));
        const hasNewStrikeLog = newLogs.some(
          (l) =>
            l.includes("BARRAGEM") ||
            l.includes("MISSÃO AÉREA") ||
            l.includes("BOMBARDEIO ESTRATÉGICO") ||
            l.includes("RECONHECIMENTO AÉREO")
        );

        // HEGEM-93: Tactical Audio & SFX Triangulation
        const isDefendingMe =
          game?.lastCombat &&
          game.territories[game.lastCombat.toTerritoryId]?.occupierId === myPlayerId;
        const isAttackingMe =
          game?.lastCombat && game.lastCombat.attackerId === myPlayerId;

        if (hasNewCombatLog && game?.lastCombat) {
          const isMaritime = isSeaLink(
            game.lastCombat.fromTerritoryId,
            game.lastCombat.toTerritoryId
          );

          if (isDefendingMe) {
            sound.playDefensiveAlarm();
          } else if (isAttackingMe) {
            sound.playOffensiveOrder();
          }

          if (isMaritime) {
            sound.playNavalSalvo();
          } else {
            sound.playInfantryRifle();
          }

          sound.playDiceRoll();
          spawnCombatAnimation(
            createCombatAnimationFromRoll(game.lastCombat, ui.combatAnimationSpeed, {
              isMaritime,
            })
          );
          if (game.lastCombat.conquered) {
            setTimeout(() => {
              if (generation === connectionGeneration) sound.playConquest();
            }, 300);
          }
        } else if (hasNewStrikeLog && game?.lastStrike) {
          const isBarrage = newLogs.some((l) => l.includes("BARRAGEM"));
          if (isBarrage) {
            sound.playArtilleryBarrage();
          } else {
            sound.playAircraftStrike();
          }
          spawnCombatAnimation(
            createCombatAnimationFromStrike(game.lastStrike, ui.combatAnimationSpeed, {
              isMaritime: isSeaLink(
                game.lastStrike.fromTerritoryId,
                game.lastStrike.toTerritoryId
              ),
            })
          );
        }

        // Global triggers: treaty betrayal & faction elimination (Zero-emoji safe tokens)
        if (newLogs.some((l) => l.includes("quebrou o tratado") || l.includes("traição") || l.includes("rompeu"))) {
          sound.playTreatyBroken();
        }
        if (newLogs.some((l) => l.includes("ELIMINADO") || l.includes("eliminada") || l.includes("capitulou"))) {
          sound.playFactionEliminated();
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
      if (generation !== connectionGeneration) return false;
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
      return false;
    } finally {
      if (generation === connectionGeneration) connecting = false;
    }
    return true;
  }

  async function joinOrCreateRoom(createNew: boolean, forcedCode?: string): Promise<boolean> {
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

    return openRoom(createNew, forcedCode, generation, false);
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
    stopMatchmakingPolling();
    matchmakingStatus = { ...IDLE_MATCHMAKING_STATUS };
    const room = connectedRoom;
    resetRoomState();
    clearPersistedRoom();
    if (room) {
      room.removeAllListeners();
      void room.leave().catch(() => undefined);
    }
  }

  function selectScenario(scenarioId: TacticalScenarioId) {
    selectedScenarioId = scenarioId;
    if (connectedRoom) {
      connectedRoom.send("select_scenario", { scenarioId });
    }
  }

  let practiceRng = createSeededRng("tutorial-practice-runtime");

  function getPlainGameState(s: GameState): GameState {
    try {
      return $state.snapshot(s);
    } catch {
      return cloneGameState(s);
    }
  }

  function checkAndRunPracticeBotTurn() {
    if (!game || roomStatus !== "playing" || connectedRoom) return;
    const current = game.players[game.turnIndex];
    if (current && current.id !== "human" && !current.eliminated) {
      turnDeadline = Date.now() + 120_000;
      remainingSeconds = 120;
      setTimeout(() => {
        if (!game || roomStatus !== "playing" || connectedRoom) return;
        const active = game.players[game.turnIndex];
        if (active.id === current.id) {
          try {
            let stateStep = getPlainGameState(game);
            const myTerrs = Object.values(stateStep.territories).filter(
              (t) => t.ownerId === current.id
            );
            const activePlayer = stateStep.players[stateStep.turnIndex];
            if (activePlayer && activePlayer.unplacedArmies > 0 && myTerrs.length > 0) {
              stateStep = applyAction(
                stateStep,
                current.id,
                {
                  type: "deploy",
                  territoryId: myTerrs[0].id,
                  armies: activePlayer.unplacedArmies,
                },
                practiceRng,
                CLASSIC_MAP
              );
            }
            if (stateStep.round > 1 && stateStep.phase === "deploy") {
              stateStep = applyAction(
                stateStep,
                current.id,
                { type: "end_deploy" },
                practiceRng,
                CLASSIC_MAP
              );
            }
            stateStep = applyAction(
              stateStep,
              current.id,
              { type: "end_turn" },
              practiceRng,
              CLASSIC_MAP
            );
            game = stateStep;
            turnDeadline = Date.now() + 120_000;
            remainingSeconds = 120;
            checkAndRunPracticeBotTurn();
          } catch {
            const hIdx = game.players.findIndex((p) => p.id === "human");
            if (hIdx >= 0) {
              game.turnIndex = hIdx;
              turnDeadline = Date.now() + 120_000;
              remainingSeconds = 120;
            }
          }
        }
      }, 700);
    }
  }

  function practiceTutorialInMap() {
    showTutorialModal = false;
    connectionGeneration++;
    stopMatchmakingPolling();
    matchmakingStatus = { ...IDLE_MATCHMAKING_STATUS };
    const room = connectedRoom;
    connectedRoom = null;
    communications.detach();
    clearPersistedRoom();
    if (room) {
      room.removeAllListeners();
      void room.leave().catch(() => undefined);
    }
    selectedFromId = null;
    selectedToId = null;
    inspectedTerritoryId = null;
    activeCombatAnimations = [];

    try {
      const cleanName = (auth.user?.displayName || playerName).trim() || "Comandante";
      const availableColors: PlayerColor[] = (
        ["blue", "red", "green", "yellow", "black", "white"] as PlayerColor[]
      ).filter((c) => c !== selectedPlayerColor);
      const samplePlayers = [
        {
          id: "human",
          name: `${cleanName} (Você)`,
          color: selectedPlayerColor,
          doctrineId: selectedDoctrineId,
        },
        {
          id: "bot1",
          name: "General IA #1",
          color: availableColors[0] ?? "red",
          doctrineId: "mass_assault" as const,
        },
        {
          id: "bot2",
          name: "General IA #2",
          color: availableColors[1] ?? "green",
          doctrineId: "tall_sovereign" as const,
        },
      ];
      const newGame = createGame({
        id: "tutorial-practice",
        seed: "practice-seed-123",
        players: samplePlayers,
        scenarioId: selectedScenarioId !== "standard" ? selectedScenarioId : "standard",
      });

      // Ensure human player is ALWAYS first to play in tutorial practice
      const humanIndex = newGame.players.findIndex((p) => p.id === "human");
      if (humanIndex > 0) {
        const [humanPlayer] = newGame.players.splice(humanIndex, 1);
        newGame.players.unshift(humanPlayer);
      }
      newGame.turnIndex = 0;
      // Set round 2 so full combat, deployment and all phases are immediately active for learning
      newGame.round = 2;
      newGame.phase = "deploy";
      const activeHuman = newGame.players[0];
      const reinf = calculateTurnReinforcements(newGame, activeHuman.id, CLASSIC_MAP);
      activeHuman.unplacedArmies = Math.max(5, reinf.total);
      // Provide plenty of resources so user can buy/sell in Market, build fortifications, industries and test units
      activeHuman.resources = { money: 40, steel: 18, oil: 16, gold: 8 };

      // Ensure human owns at least 1 territory with a Market and a Capital
      const humanTerrs = Object.values(newGame.territories).filter((t) => t.ownerId === "human");
      if (humanTerrs.length > 0) {
        activeHuman.capitalTerritoryId = humanTerrs[0].id;
        humanTerrs[0].buildings = [{ type: "market", level: 1 }];
        // Give human a frontline territory with combined arms ready to attack
        for (const t of humanTerrs) {
          const mapTerr = CLASSIC_MAP.territories.find((m) => m.id === t.id);
          const hasEnemy = mapTerr?.neighbors.some(
            (nId) => newGame.territories[nId] && newGame.territories[nId].ownerId !== "human"
          );
          if (hasEnemy) {
            t.armies = 5;
            t.units = { infantry: 2, tank: 2, artillery: 1, aircraft: 0, navy: 0 };
            focusTerritory(t.id);
            break;
          }
        }
      }

      showInGameTutorial = true;
      activeTutorialStep = 0;
      game = cloneGameState(newGame);
      myPlayerId = "human";
      roomStatus = "playing";
      turnDeadline = Date.now() + 180_000;
      remainingSeconds = 180;
      sound.playTurnRadioAlert();
    } catch (err: any) {
      console.error("Falha ao iniciar tutorial interativo:", err);
      resetRoomState();
      errorBanner = "Erro ao iniciar simulação prática: " + (err?.message || err);
    }
  }

  function sendAction(action: unknown) {
    sound.playClick();
    if (connectedRoom) {
      connectedRoom.send("game_action", action);
      return;
    }
    if (game && myPlayerId && roomStatus === "playing") {
      try {
        const rawState = getPlainGameState(game);
        const prevCombat = rawState.lastCombat;
        const nextState = applyAction(
          rawState,
          myPlayerId,
          action as GameAction,
          practiceRng,
          CLASSIC_MAP
        );
        game = nextState;
        resetSelectedForce();
        if (game.lastCombat && game.lastCombat !== prevCombat) {
          const isMaritime = isSeaLink(
            game.lastCombat.fromTerritoryId,
            game.lastCombat.toTerritoryId
          );
          if (isMaritime) sound.playNavalSalvo();
          else sound.playInfantryRifle();
          sound.playDiceRoll();
          spawnCombatAnimation(
            createCombatAnimationFromRoll(game.lastCombat, ui.combatAnimationSpeed, {
              isMaritime,
            })
          );
          if (game.lastCombat.conquered) {
            setTimeout(() => {
              sound.playConquest();
            }, 300);
          }
        }
        checkAndRunPracticeBotTurn();
      } catch (err: any) {
        errorBanner = err?.message || "Ação inválida.";
        setTimeout(() => {
          if (errorBanner === err?.message) errorBanner = "";
        }, 3000);
      }
    }
  }

  function handleBuildStructure(territoryId: string, buildingType: BuildingType) {
    sendAction({
      type: "build_structure",
      territoryId,
      buildingType,
    });
  }

  function handleDemolishStructure(territoryId: string, buildingType: BuildingType) {
    sendAction({
      type: "demolish_structure",
      territoryId,
      buildingType,
    });
  }

  function handleExpandInfrastructure(territoryId: string) {
    sendAction({
      type: "expand_infrastructure",
      territoryId,
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
    if (
      myPlayerState.doctrineId === "mass_assault" &&
      (unitType === "tank" || unitType === "artillery" || unitType === "aircraft")
    ) {
      return false;
    }
    const requirement = UNIT_BUILDING_REQUIREMENTS[unitType];
    if (requirement) {
      let hasReq = hasTerritoryBuilding(territory, requirement);
      if (unitType === "tank" || unitType === "artillery") {
        hasReq = hasReq || hasTerritoryBuilding(territory, "military_factory");
      }
      if (unitType === "navy" && myPlayerState.doctrineId === "extermination") {
        hasReq = true;
      }
      if (!hasReq) return false;
    }
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
    if (!territory) {
      selectedUnits = emptyUnitCounts();
      return;
    }
    const isBlitzAdvance = territory.conqueredTurnRound === game.round;
    if (isBlitzAdvance && territory.blitzkriegAvailable) {
      // Em avanço imediato pós-conquista (Blitzkrieg), pré-seleciona apenas os blindados sobreviventes
      const tUnits = getTerritoryUnits(territory);
      const tankCount = Math.min(tUnits.tank, Math.max(0, territory.armies - 1));
      selectedUnits = { ...emptyUnitCounts(), tank: tankCount };
    } else {
      selectedUnits = selectUnits(getTerritoryUnits(territory), Math.max(0, territory.armies - 1));
    }
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
    const pool = addUnits(occupying, remaining);
    // Aeronaves não podem avançar na ocupação militar (permanecem nos aeródromos)
    return { ...pool, aircraft: 0 };
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
    if (!game) return;
    sound.playClick();
    inspectedTerritoryId = terrId;

    if (!isMyTurn || game.pendingConquest) return;
    const tState = game.territories[terrId];
    const tDef = territoryById.get(terrId)!;

    if (game.phase === "deploy") {
      if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        if ((myPlayerState?.unplacedArmies ?? 0) > 0) {
          sliderArmies = myPlayerState!.unplacedArmies;
        }
      } else {
        selectedFromId = null;
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
      if (selectedFromId === terrId) {
        selectedFromId = null;
        selectedToId = null;
        selectedUnits = emptyUnitCounts();
        return;
      }

      if (selectedToId === terrId) {
        selectedFromId = terrId;
        selectedToId = null;
        resetManeuverSelection();
        sliderArmies = Math.max(1, tState.armies - tState.movedInArmies - 1);
        return;
      }

      if (selectedFromId && myPlayerId) {
        const reachable = getReachableManeuverTargets(game, selectedFromId, myPlayerId);
        if (reachable.has(terrId)) {
          selectedToId = terrId;
          const fromT = game.territories[selectedFromId];
          const toT = game.territories[terrId];
          const isAdjacent = territoryById.get(selectedFromId)?.neighbors.includes(terrId);
          const isConnected = isAdjacent || isConnectedByFriendlyPath(game, selectedFromId, terrId, myPlayerId);
          const isAirliftTarget =
            !isConnected &&
            Boolean(fromT && hasTerritoryBuilding(fromT, "airfield")) &&
            hasTerritoryBuilding(toT, "airfield") &&
            !fromT?.airliftedThisTurn;

          if (isAirliftTarget && fromT) {
            const available = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT));
            sliderArmies = Math.max(
              1,
              Math.min(available.infantry, totalUnits(available) - 1)
            );
          } else {
            resetManeuverSelection();
          }
          return;
        }
      }

      if (tState.ownerId === myPlayerId) {
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

  function closeTerritoryInspector() {
    inspectedTerritoryId = null;
    selectedFromId = null;
    selectedToId = null;
  }

  function confirmDeploy() {
    if (!selectedFromId || !myPlayerState || (myPlayerState.unplacedArmies ?? 0) <= 0) return;
    const deployCount = Math.min(Math.max(1, sliderArmies), myPlayerState.unplacedArmies);
    sendAction({ type: "deploy", territoryId: selectedFromId, armies: deployCount });
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
    if (!selectedFromId || !selectedToId || !game || !myPlayerId) return;
    const isAdjacent = territoryById.get(selectedFromId)?.neighbors.includes(selectedToId);
    const isConnected = isAdjacent || isConnectedByFriendlyPath(game, selectedFromId, selectedToId, myPlayerId);
    if (isConnected) {
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
      {matchmakingStatus}
      {matchmakingBusy}
      {competitionMode}
      {matchOrigin}
      {selectedScenarioId}
      onQueue={queueForMatch}
      onCancelQueue={cancelMatchmakingQueue}
      onConnectMatch={connectToMatchedRoom}
      onCreateRoom={() => joinOrCreateRoom(true)}
      onJoinRoom={() => joinOrCreateRoom(false)}
      onLeaveRoom={leaveCurrentRoom}
      onChooseColor={(color) => {
        selectedPlayerColor = color;
        connectedRoom?.send("choose_color", { color });
      }}
      onChooseDoctrine={(doctrineId) => {
        selectedDoctrineId = doctrineId;
        connectedRoom?.send("choose_doctrine", { doctrineId });
      }}
      onSelectScenario={selectScenario}
      onOpenTutorial={() => (showTutorialModal = true)}
      onAddBot={() => connectedRoom?.send("add_bot")}
      onRemoveBot={(token) => connectedRoom?.send("remove_bot", { token })}
      onSetReady={(ready) => connectedRoom?.send("set_ready", { ready })}
      onStartGame={() => connectedRoom?.send("start_game")}
    />
  {:else if game}
    <!-- FULLSCREEN CONTINUOUS WRAPAROUND GEOPOLITICAL & CARTOGRAPHIC MAP -->
    <TacticalMap
      {game}
      {myPlayerId}
      {baseMapMode}
      overlays={mapOverlays}
      {cleanMapMode}
      {highlightObjectiveTerritories}
      {objectiveTargetTerritoryIds}
      combatAnimations={activeCombatAnimations}
      {isCameraTransitioning}
      bind:selectedFromId
      bind:selectedToId
      bind:hoveredTerritoryId
      bind:zoom
      bind:camX
      bind:camY
      {onTerritoryClick}
    />

    <!-- ROUND 1 SECRET OBJECTIVE SELECTION MODAL (HEGEM-117) -->
    {#if myPlayerState?.pendingObjectiveChoice && myPlayerState.availableObjectives && myPlayerState.availableObjectives.length > 0}
      <ObjectiveSelectionModal
        availableObjectives={myPlayerState.availableObjectives}
        doctrineId={myPlayerState.doctrineId}
        onSelect={(objectiveId) => sendAction({ type: "choose_objective", objectiveId })}
      />
    {/if}

    <!-- WONDER OF THE BASTION APOCALYPSE ALERT TOAST -->
    {#if activeWonderInfo && !game.winnerId}
      <WonderAlertToast
        wonder={activeWonderInfo}
        onFocusTerritory={focusTerritory}
      />
    {/if}

    <!-- POST-VICTORY DOSSIER MODAL (HEGEM-9) -->
    {#if game.winnerId}
      <VictoryModal
        {game}
        {myPlayerId}
        {playerMetrics}
        {competitionMode}
        {amIHost}
        onReturnRoomToLobby={() => connectedRoom?.send("return_to_lobby")}
        onReturnToLobby={leaveCurrentRoom}
      />
    {/if}

    <!-- HEGEM-95: Subtle Screen Edge Vignette on Imminent Turn Timeout -->
    {#if isMyTurn && !game.winnerId && remainingSeconds <= 10 && ui.turnTimerAlertsEnabled}
      <div
        class="turn-critical-vignette"
        class:extreme-urgency={remainingSeconds <= 3}
        aria-hidden="true"
      ></div>
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
        onFocusTerritory={focusTerritory}
        {autoCameraFocus}
        onToggleAutoCameraFocus={(val) => (autoCameraFocus = val)}
        bind:baseMapMode
        bind:overlays={mapOverlays}
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
        onReopenTutorial={!connectedRoom && !showInGameTutorial ? () => { sound.playClick(); showInGameTutorial = true; } : undefined}
      />

      <!-- ↖ LEFT SLIDE-OVER TERRITORY COMMAND DOSSIER & BOTTOM-LEFT CONTROLS HINT -->
      <ReconInspector
        {game}
        {myPlayerId}
        {myPlayerState}
        {isMyTurn}
        {inspectedTerritory}
        {isImmersiveMode}
        hudVisible={hudVisibility.recon}
        {handleBuildStructure}
        {handleDemolishStructure}
        {handleExpandInfrastructure}
        {handleRecruitUnit}
        {canRecruitUnit}
        {getRecruitRequirement}
        {getTerritoryName}
        onClose={closeTerritoryInspector}
        onSelectCapital={(territoryId) => sendAction({ type: "select_capital", territoryId })}
      />

      <!-- ⬇ BOTTOM-CENTER: TACTICAL ORDER CONSOLE & 1-2-3 PHASE STEPPER -->
      <ActionConsole
        {game}
        {myPlayerId}
        {myPlayerState}
        {isMyTurn}
        {remainingSeconds}
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

    <!-- IN-GAME INTERACTIVE TUTORIAL GUIDE (HEGEM-104) -->
    {#if showInGameTutorial}
      <InGameTutorialGuide
        {game}
        myPlayerId={myPlayerId ?? "human"}
        {isMyTurn}
        bind:activeStep={activeTutorialStep}
        onOpenMarket={() => (activeRightDrawer = "market")}
        onOpenObjective={() => (activeRightDrawer = "objective")}
        onInspectTerritory={(territoryId) => {
          inspectedTerritoryId = territoryId;
          focusTerritory(territoryId);
        }}
        onSelectCombatTerritories={(fromId, toId) => {
          selectedFromId = fromId;
          selectedToId = toId;
          focusTerritory(fromId);
        }}
        onAdvancePhase={() => {
          const human = game?.players.find((p) => p.id === myPlayerId);
          if (game?.phase === "deploy" && human?.unplacedArmies === 0) {
            sendAction({ type: "end_deploy" });
          } else if (game?.phase === "attack") {
            sendAction({ type: "end_attack" });
          }
        }}
        onClose={() => (showInGameTutorial = false)}
      />
    {/if}
  {/if}

  <TutorialGuideModal
    open={showTutorialModal}
    onClose={() => (showTutorialModal = false)}
    onPractice={practiceTutorialInMap}
  />
</main>

<style>
  .hegemonia-app {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    user-select: none;
  }

  /* --- HUD Overlays (HOI4 / EU4 Grand Strategy Dark Brass Theme) --- */
  .hud-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    display: grid;
    grid-template-columns: 355px 1fr 385px;
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
  /* HEGEM-95: Subtle Screen Edge Vignette on Imminent Turn Timeout */
  .turn-critical-vignette {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 15;
    box-shadow: inset 0 0 55px rgba(239, 68, 68, 0.28), inset 0 0 110px rgba(185, 28, 28, 0.18);
    animation: vignette-pulse 1.4s ease-in-out infinite alternate;
  }

  .turn-critical-vignette.extreme-urgency {
    box-shadow: inset 0 0 75px rgba(239, 68, 68, 0.45), inset 0 0 145px rgba(185, 28, 28, 0.3);
    animation: vignette-pulse-fast 0.7s ease-in-out infinite alternate;
  }

  @keyframes vignette-pulse {
    0% {
      opacity: 0.55;
    }
    100% {
      opacity: 0.95;
    }
  }

  @keyframes vignette-pulse-fast {
    0% {
      opacity: 0.7;
    }
    100% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .turn-critical-vignette,
    .turn-critical-vignette.extreme-urgency {
      animation: none;
      opacity: 0.75;
    }
  }
</style>
