<script lang="ts">
  import { onDestroy } from "svelte";
  import { Client, type Room } from "colyseus.js";
  import {
    ASIA_SUBREGIONS,
    CLASSIC_MAP,

  } from "@hegemonia/maps";
  import {
    UNIT_COSTS,
    addUnits,
    emptyUnitCounts,
    getMovedInUnits,
    getTerritoryUnits,
    hasTerritoryBuilding,
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
    GameState,
    MatchOrigin,
    MatchmakingStatus,
    PublicQueueMode,
    UnitCounts,
    UnitType,
  } from "@hegemonia/shared";
  import { sound } from "./audio.js";
  import { estimateAttackWinOdds } from "./odds.js";
  import { api, ApiError } from "./lib/api";
  import { auth } from "./lib/auth.svelte";
  import { ui } from "./lib/ui.svelte";
  import CommandCenter, {
    type LobbyPlayerView,
  } from "./components/CommandCenter.svelte";
  import Icon from "./components/Icon.svelte";
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
  let matchmakingStatus = $state<MatchmakingStatus>({ ...IDLE_MATCHMAKING_STATUS });
  let matchmakingBusy = $state(false);
  let competitionMode = $state<CompetitionMode>("custom");
  let matchOrigin = $state<MatchOrigin>("lobby");
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
  let cleanMapMode = $state(false);

  $effect(() => {
    saveMapPreferences({
      base: baseMapMode,
      overlays: {
        regional: mapOverlays.regional,
        economic: mapOverlays.economic,
      },
    });
  });

  // Continuous Wraparound Camera State (in SVG coordinate space: width=1200, height=620)
  let camX = $state(0);
  let camY = $state(0);
  let zoom = $state(1.05);

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
    competitionMode: CompetitionMode;
    matchOrigin: MatchOrigin;
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
        const prevLastCombat = game?.lastCombat;
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        competitionMode = payload.competitionMode;
        matchOrigin = payload.matchOrigin;
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
      onQueue={queueForMatch}
      onCancelQueue={cancelMatchmakingQueue}
      onConnectMatch={connectToMatchedRoom}
      onCreateRoom={() => joinOrCreateRoom(true)}
      onJoinRoom={() => joinOrCreateRoom(false)}
      onLeaveRoom={leaveCurrentRoom}
      onChooseColor={(color) => connectedRoom?.send("choose_color", { color })}
      onAddBot={() => connectedRoom?.send("add_bot")}
      onRemoveBot={(token) => connectedRoom?.send("remove_bot", { token })}
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
      bind:selectedFromId
      bind:selectedToId
      bind:hoveredTerritoryId
      bind:zoom
      bind:camX
      bind:camY
      {onTerritoryClick}
    />

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
