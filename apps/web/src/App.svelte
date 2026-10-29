<script lang="ts">
  import { Client, type Room } from "colyseus.js";
  import {
    ASIA_SUBREGIONS,
    CLASSIC_MAP,
    GRATICULE_SVG_PATH,
    MAP_HEIGHT,
    MAP_WIDTH,
  } from "@hegemonia/maps";
  import { findValidTradeTriplet } from "@hegemonia/engine";
  import type { GameState, PlayerColor } from "@hegemonia/shared";
  import { sound } from "./audio.js";
  import { estimateAttackWinOdds } from "./odds.js";

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

  interface LobbyPlayerView {
    token: string;
    name: string;
    color: PlayerColor;
    isHost: boolean;
    isBot: boolean;
    connected: boolean;
  }

  function getOrCreateToken(): string {
    const saved = localStorage.getItem("hegemonia_token");
    if (saved) return saved;
    const fresh = "plr_" + Math.random().toString(36).slice(2, 10);
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
  let roomCode = $state("");
  let roomStatus = $state<"disconnected" | "lobby" | "playing">("disconnected");
  let myPlayerId = $state<string | null>(null);
  let lobbyPlayers = $state<LobbyPlayerView[]>([]);
  let game = $state<GameState | null>(null);
  let turnDeadline = $state(0);
  let remainingSeconds = $state(120);
  let errorBanner = $state("");

  // Map Rendering Mode: "cartographic" (HOI4 physical satellite relief + borders), "geopolitical" (Crisp War colors), or "regional" (Continents & Sub-Regions)
  let mapMode = $state<"cartographic" | "geopolitical" | "regional">("cartographic");

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

  // Map Selection State
  let selectedFromId = $state<string | null>(null);
  let selectedToId = $state<string | null>(null);
  let sliderArmies = $state(1);

  // HUD Visibility Toggles
  let showObjective = $state(false);
  let showCards = $state(false);
  let showContinents = $state(false);
  let showMusicPanel = $state(false);
  let logCollapsed = $state(false);
  let activeLogTab = $state<"log" | "chat">("log");
  let chatInput = $state("");

  // Audio State
  let isMusicPlaying = $state(sound.getIsPlaying());
  let musicVolume = $state(sound.getVolume());
  let selectedTrack = $state(sound.getCurrentTrack());

  // Derived calculations
  let currentTurnPlayer = $derived(game ? game.players[game.turnIndex] : null);
  let isMyTurn = $derived(Boolean(game && currentTurnPlayer && currentTurnPlayer.id === myPlayerId));
  let myPlayerState = $derived(game?.players.find((p) => p.id === myPlayerId) ?? null);
  let validTradeTriplet = $derived(myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null);

  let currentAttackOdds = $derived.by(() => {
    if (!game || !selectedFromId || !selectedToId) return null;
    const fromT = game.territories[selectedFromId];
    const toT = game.territories[selectedToId];
    if (!fromT || !toT) return null;
    return estimateAttackWinOdds(fromT.armies, toT.armies);
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
    let res = ((x + half) % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH - half;
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

  async function joinOrCreateRoom(createNew: boolean) {
    errorBanner = "";
    sound.playClick();
    const cleanName = playerName.trim() || "General";
    playerName = cleanName;
    localStorage.setItem("hegemonia_name", cleanName);
    const client = new Client(resolveWsUrl());
    const token = getOrCreateToken();

    try {
      const code = createNew ? undefined : roomCodeInput.trim().toUpperCase();
      const room = await client.joinOrCreate("hegemonia", {
        name: cleanName,
        token,
        roomCode: code,
      });

      connectedRoom = room;
      room.onMessage("room_state", (payload) => {
        const prevLastCombat = game?.lastCombat;
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        game = payload.game;

        if (game?.pendingConquest) {
          sliderArmies = game.pendingConquest.maxMove;
        }

        if (game?.lastCombat && game.lastCombat !== prevLastCombat) {
          sound.playDiceRoll();
          if (game.lastCombat.conquered) {
            setTimeout(() => sound.playConquest(), 250);
          }
        }
      });

      room.onMessage("error_msg", (payload: { message: string }) => {
        errorBanner = payload.message;
        setTimeout(() => {
          if (errorBanner === payload.message) errorBanner = "";
        }, 4000);
      });
    } catch (err: unknown) {
      errorBanner = err instanceof Error ? err.message : "Falha ao conectar ao servidor Hegemonia.";
    }
  }

  function sendAction(action: unknown) {
    sound.playClick();
    connectedRoom?.send("game_action", action);
  }

  function onTerritoryClick(terrId: string) {
    if (!game || !isMyTurn || game.pendingConquest) return;
    sound.playClick();
    const tState = game.territories[terrId];
    const tDef = territoryById.get(terrId)!;

    if (game.phase === "deploy") {
      if (tState.ownerId === myPlayerId && (myPlayerState?.unplacedArmies ?? 0) > 0) {
        selectedFromId = terrId;
        sliderArmies = myPlayerState!.unplacedArmies;
      }
      return;
    }

    if (game.phase === "attack") {
      if (tState.ownerId === myPlayerId && tState.armies >= 2) {
        selectedFromId = terrId;
        selectedToId = null;
      } else if (
        selectedFromId &&
        tState.ownerId !== myPlayerId &&
        territoryById.get(selectedFromId)!.neighbors.includes(terrId)
      ) {
        selectedToId = terrId;
      }
      return;
    }

    if (game.phase === "maneuver") {
      if (!selectedFromId && tState.ownerId === myPlayerId && tState.armies - tState.movedInArmies >= 2) {
        selectedFromId = terrId;
        selectedToId = null;
        sliderArmies = tState.armies - tState.movedInArmies - 1;
      } else if (
        selectedFromId &&
        terrId !== selectedFromId &&
        tState.ownerId === myPlayerId &&
        tDef.neighbors.includes(selectedFromId)
      ) {
        selectedToId = terrId;
      } else if (tState.ownerId === myPlayerId) {
        selectedFromId = terrId;
        selectedToId = null;
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
    sendAction({
      type: "attack",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
    });
  }

  function confirmManeuver() {
    if (!selectedFromId || !selectedToId) return;
    sendAction({
      type: "maneuver",
      fromTerritoryId: selectedFromId,
      toTerritoryId: selectedToId,
      armies: sliderArmies,
    });
    selectedFromId = null;
    selectedToId = null;
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    connectedRoom?.send("chat", { text: chatInput });
    chatInput = "";
  }

  // --- Mouse Drag & Wheel Camera Controls ---
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    if (target.closest(".hud-panel")) return;
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

  function toggleMusic() {
    isMusicPlaying = sound.toggleMusic();
  }
  function onVolumeChange(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    musicVolume = val;
    sound.setVolume(val);
  }
  function onTrackSelect(trackId: string) {
    selectedTrack = trackId;
    sound.setTrack(trackId);
    isMusicPlaying = sound.getIsPlaying();
  }
</script>

<svelte:window
  onmouseup={onMouseUp}
  onmousemove={onMouseMove}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
/>

<!-- HERALDIC FACTION FLAGS (PURE VECTOR SVG - ZERO EMOJIS) -->
{#snippet flagBadge(color: PlayerColor, width = 22, height = 14)}
  <svg
    {width}
    {height}
    viewBox="0 0 24 16"
    class="faction-flag-svg"
    style="border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.75); flex-shrink: 0;"
  >
    {#if color === "blue"}
      <rect width="24" height="16" fill="#1d4ed8" />
      <rect y="6.5" width="24" height="3" fill="#93c5fd" opacity="0.45" />
      <rect x="10.5" width="3" height="16" fill="#93c5fd" opacity="0.45" />
      <polygon points="12,2 14,6 18,8 14,10 12,14 10,10 6,8 10,6" fill="#f8fafc" />
    {:else if color === "red"}
      <rect width="24" height="16" fill="#b91c1c" />
      <path d="M0,0 L24,16 M24,0 L0,16" stroke="#fca5a5" stroke-width="2.2" opacity="0.5" />
      <polygon points="12,3 16,8 12,13 8,8" fill="#facc15" stroke="#7f1d1d" stroke-width="0.8" />
    {:else if color === "green"}
      <rect width="24" height="16" fill="#047857" />
      <polygon points="0,0 10,8 0,16" fill="#064e3b" />
      <polygon points="0,0 10,8 0,16" fill="none" stroke="#fcd34d" stroke-width="1.2" />
      <circle cx="15.5" cy="8" r="3.5" fill="none" stroke="#ecfdf5" stroke-width="1.5" />
    {:else if color === "yellow"}
      <rect width="24" height="16" fill="#d97706" />
      <rect y="0" width="24" height="4" fill="#1e293b" />
      <rect y="12" width="24" height="4" fill="#1e293b" />
      <circle cx="12" cy="8" r="3.2" fill="#fef08a" stroke="#0f172a" stroke-width="1" />
    {:else if color === "black"}
      <rect width="24" height="16" fill="#1e293b" />
      <path d="M0,8 H24 M12,0 V16" stroke="#94a3b8" stroke-width="3.2" />
      <path d="M0,8 H24 M12,0 V16" stroke="#0f172a" stroke-width="1.4" />
      <rect x="9.5" y="5.5" width="5" height="5" fill="#e2e8f0" />
    {:else}
      <rect width="24" height="16" fill="#e2e8f0" />
      <path d="M0,8 H24 M9,0 V16" stroke="#334155" stroke-width="3" />
      <circle cx="9" cy="8" r="2.2" fill="#f59e0b" />
    {/if}
    <rect width="24" height="16" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
  </svg>
{/snippet}

<!-- TACTICAL MONOCHROME / BRASS VECTOR ICONS (ZERO EMOJIS) -->
{#snippet icon(name: string, size = 15)}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="ui-svg-icon"
  >
    {#if name === "swords"}
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <polyline points="9.5 17.5 21 6 21 3 18 3 6.5 14.5" />
      <line x1="5" y1="13" x2="11" y2="19" />
      <line x1="4" y1="20" x2="8" y2="16" />
    {:else if name === "shield"}
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    {:else if name === "globe"}
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    {:else if name === "cards"}
      <rect x="3" y="4" width="13" height="17" rx="2" />
      <path d="M16 7h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1" />
    {:else if name === "target"}
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    {:else if name === "radio"}
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
    {:else if name === "crown"}
      <polygon points="2 18 5 7 9.5 12 12 5 14.5 12 19 7 22 18 2 18" />
    {:else if name === "clock"}
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    {:else if name === "log"}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    {:else if name === "chat"}
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    {:else if name === "bot"}
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M12 2v6" />
      <line x1="8" y1="14" x2="8" y2="14.01" />
      <line x1="16" y1="14" x2="16" y2="14.01" />
    {:else if name === "check"}
      <polyline points="20 6 9 17 4 12" />
    {:else if name === "plus"}
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    {/if}
  </svg>
{/snippet}

<main class="hegemonia-app">
  {#if errorBanner}
    <div class="alert-toast">{errorBanner}</div>
  {/if}

  {#if roomStatus === "disconnected"}
    <!-- FRONT SCREEN: GRAND STRATEGY COMMAND CENTER -->
    <div class="landing-overlay">
      <div class="war-room-modal">
        <div class="brand-crest">
          {@render icon("globe", 38)}
        </div>
        <div class="title-lockup">
          <span class="kicker">SIMULADOR GEOPOLÍTICO GLOBAL</span>
          <h1>HEGEMONIA</h1>
          <div class="brass-rule"></div>
        </div>
        <p class="subtitle">Comando Estratégico Multijogador • Cartografia Natural Earth • IPv6 Nativo</p>

        <div class="form-group">
          <label for="pname">PATENTE / IDENTIFICAÇÃO DE COMANDO</label>
          <input id="pname" bind:value={playerName} maxlength="24" placeholder="General" />
        </div>

        <button class="btn primary-gold" onclick={() => joinOrCreateRoom(true)}>
          {@render icon("plus", 16)} Criar Nova Sala de Guerra
        </button>

        <div class="divider"><span>OU INGRESSAR EM OPERAÇÃO EXISTENTE</span></div>

        <div class="join-box">
          <input bind:value={roomCodeInput} maxlength="6" placeholder="CÓDIGO (EX: A1B2C3)" />
          <button class="btn secondary" onclick={() => joinOrCreateRoom(false)}>Conectar</button>
        </div>
      </div>
    </div>

  {:else if roomStatus === "lobby"}
    <!-- PRE-GAME LOBBY WAR ROOM -->
    <div class="landing-overlay">
      <div class="war-room-modal lobby-modal">
        <div class="lobby-brand-header">
          <span class="lobby-brand-tag">HEGEMONIA // SALA DE COMANDO</span>
          <div class="row-between">
            <h2>Operação: <span class="code-highlight">{roomCode}</span></h2>
            <span class="badge-players">{lobbyPlayers.length}/6 Generais</span>
          </div>
        </div>
        <p class="subtitle">Compartilhe o código da operação ou adicione comandantes de IA para iniciar.</p>

        <div class="player-roster">
          {#each lobbyPlayers as p}
            <div class="roster-card">
              {@render flagBadge(p.color, 26, 17)}
              <div class="roster-meta">
                <strong>{p.name}</strong>
                <small>{FACTION_NAME_PT[p.color]}</small>
              </div>
              {#if p.isHost}<span class="tag-host">COMANDANTE</span>{/if}
              {#if p.isBot}<span class="tag-bot">IA</span>{/if}
              {#if p.isBot}
                <button class="btn-remove" onclick={() => connectedRoom?.send("remove_bot", { token: p.token })} title="Remover IA">✕</button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="color-selector">
          <span>Selecione sua Bandeira de Facção:</span>
          <div class="swatches">
            {#each ["blue", "red", "green", "yellow", "black", "white"] as PlayerColor[] as c}
              <button
                class="flag-swatch-btn"
                title={FACTION_NAME_PT[c]}
                onclick={() => connectedRoom?.send("choose_color", { color: c })}
              >
                {@render flagBadge(c, 32, 20)}
              </button>
            {/each}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn secondary" onclick={() => connectedRoom?.send("add_bot")}>
            {@render icon("bot", 16)} Adicionar General IA
          </button>
          <button class="btn primary-gold" onclick={() => connectedRoom?.send("start_game")}>
            {@render icon("swords", 16)} Iniciar Campanha Global
          </button>
        </div>
      </div>
    </div>

  {:else if game}
    <!-- FULLSCREEN CONTINUOUS WRAPAROUND GEOPOLITICAL & CARTOGRAPHIC MAP -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="map-viewport" onwheel={onWheel} onmousedown={onMouseDown}>
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
                {@const activeFill = mapMode === "regional" ? regionColor : ownerColor}
                {@const isSelected = selectedFromId === t.id || selectedToId === t.id}
                {@const isValidTarget =
                  selectedFromId &&
                  territoryById.get(selectedFromId)?.neighbors.includes(t.id) &&
                  ((game.phase === "attack" && tState.ownerId !== myPlayerId) ||
                    (game.phase === "maneuver" && tState.ownerId === myPlayerId))}

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g class="territory-group" onclick={() => onTerritoryClick(t.id)}>
                  <!-- Political or Regional Fill + Frontier Border -->
                  <path
                    d={t.svgPath}
                    fill={activeFill}
                    fill-opacity={isSelected
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
                        : mapMode === "cartographic"
                          ? ownerColor
                          : "rgba(9, 13, 22, 0.9)"}
                    stroke-width={isSelected
                      ? "2.6"
                      : isValidTarget
                        ? "2.2"
                        : mapMode === "cartographic"
                          ? "1.6"
                          : "1.0"}
                    stroke-linejoin="round"
                    filter={isSelected || isValidTarget ? "url(#glow-gold)" : undefined}
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

                  <!-- HOI4-STYLE MILITARY DIVISION COUNTER (COMPACT FLAG + TROOP COUNT) -->
                  <g
                    transform="translate({t.center[0]}, {t.center[1]}) scale({COMPACT_BADGE_IDS.has(t.id) ? 0.82 : 0.94})"
                    class="division-counter"
                  >
                    <rect
                      x="-13"
                      y="-6.5"
                      width="26"
                      height="13"
                      rx="2.2"
                      fill="#090e1a"
                      stroke={isSelected ? "#ffffff" : isValidTarget ? "#facc15" : ownerColor}
                      stroke-width={isSelected || isValidTarget ? "1.6" : "1.1"}
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

                    <!-- Territory Label Underneath Counter -->
                    <text
                      x="0"
                      y="11.2"
                      text-anchor="middle"
                      fill="#e2e8f0"
                      font-size="6.2"
                      font-weight="700"
                      letter-spacing="0.01em"
                      pointer-events="none"
                      style="paint-order: stroke; stroke: #050912; stroke-width: 2.4px; stroke-linejoin: round;"
                    >
                      {t.namePt}
                    </text>
                  </g>
                </g>
              {/each}

              <!-- Floating Regional & Sub-Regional Theatre Banners in "regional" Map Mode -->
              {#if mapMode === "regional"}
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

    <!-- FLOATING HUD (Z-INDEX OVERLAY - HOI4 / EU4 GRAND STRATEGY STYLE) -->
    <div class="hud-layer">
      <!-- ↖ TOP-LEFT: HEGEMONIA BRANDING, BALANCE OF POWER & CONTINENT/ASIA SUB-REGIONS -->
      <aside class="hud-panel top-left-panel">
        <div class="panel-header">
          <div class="brand-row">
            <span class="brass-icon">{@render icon("globe", 16)}</span>
            <strong>HEGEMONIA</strong>
            <span class="room-tag">OP: {roomCode} • R{game.round}</span>
          </div>
        </div>

        <!-- Hegemony Power Bar (Segmented World Dominance %) -->
        <div class="hegemony-bar" title="Balanço de Poder Global (% de Territórios)">
          {#each playerMetrics as m}
            <div
              class="hegemony-segment"
              style="width: {m.sharePct}%; background: {COLOR_HEX[m.player.color]};"
              title="{m.player.name}: {m.sharePct}% do Mundo ({m.terrCount} territórios, {m.totalArmies} divisões)"
            ></div>
          {/each}
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
                {@render flagBadge(m.player.color, 20, 13)}
                <span class="g-name">
                  {m.player.name} {m.player.id === myPlayerId ? "(Você)" : ""}
                </span>
                {#if isTurn}
                  <span class="turn-indicator" title="Turno Ativo">{@render icon("crown", 13)}</span>
                {/if}
              </div>
              <div class="g-stats">
                <span title="Territórios Controlados" class="stat-pill">T: {m.terrCount}</span>
                <span title="Total de Divisões" class="stat-pill">D: {m.totalArmies}</span>
                <span title="Cartas Táticas" class="stat-pill">C: {m.player.cards.length}</span>
              </div>
            </div>
          {/each}
        </div>

        <!-- Continents & Asian Sub-Regions Toggle -->
        <div class="continents-toggle-row">
          <button class="btn-ghost" onclick={() => (showContinents = !showContinents)}>
            <span>{@render icon("globe", 14)} Teatros & Bônus Regionais</span>
            <span>{showContinents ? "▲" : "▼"}</span>
          </button>
        </div>

        {#if showContinents}
          <div class="continents-dropdown">
            <div class="dropdown-section-title">Continentes Clássicos</div>
            {#each CLASSIC_MAP.continents.filter((c) => c.id !== "asia") as c}
              {@const terrs = CLASSIC_MAP.territories.filter((t) => t.continent === c.id)}
              {@const ownerId = game.territories[terrs[0].id]?.ownerId}
              {@const isMonopoly = terrs.every((t) => game!.territories[t.id].ownerId === ownerId)}
              <div class="cont-pill">
                <span>{c.namePt}</span>
                <div class="cont-right">
                  {#if isMonopoly}
                    {@const p = game.players.find((plr) => plr.id === ownerId)}
                    {#if p}{@render flagBadge(p.color, 16, 10)}{/if}
                  {/if}
                  <span class="bonus-tag">+{c.bonus}</span>
                </div>
              </div>
            {/each}

            <div class="dropdown-section-title">Sub-Regiões da Ásia (+7 Total)</div>
            {#each ASIA_SUBREGIONS as sub}
              {@const ownerId = game.territories[sub.territoryIds[0]]?.ownerId}
              {@const isMonopoly = sub.territoryIds.every((tid) => game!.territories[tid]?.ownerId === ownerId)}
              <div class="cont-pill asia-sub-pill">
                <span>{sub.namePt}</span>
                <div class="cont-right">
                  {#if isMonopoly}
                    {@const p = game.players.find((plr) => plr.id === ownerId)}
                    {#if p}{@render flagBadge(p.color, 16, 10)}{/if}
                  {/if}
                  <span class="bonus-tag">+{sub.bonus}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </aside>

      <!-- ↗ TOP-RIGHT: PLAYER HEADQUARTERS, MAP MODE SWITCHER, CARDS & RADIO -->
      <aside class="hud-panel top-right-panel">
        <div class="my-hq-row">
          {#if myPlayerState}
            <div class="hq-general">
              {@render flagBadge(myPlayerState.color, 24, 15)}
              <span class="hq-name">{myPlayerState.name}</span>
            </div>

            {#if isMyTurn && myPlayerState.unplacedArmies > 0}
              <div class="reserve-badge pulse">
                {@render icon("shield", 14)} +{myPlayerState.unplacedArmies} Reservas
              </div>
            {/if}
          {/if}

          <div class="hq-buttons">
            <button
              class="hud-btn"
              class:highlight={Boolean(validTradeTriplet)}
              class:active={showCards}
              onclick={() => (showCards = !showCards)}
              title="Cartas de Território"
            >
              {@render icon("cards", 14)} {myPlayerState?.cards.length ?? 0}/5
            </button>

            <button
              class="hud-btn"
              class:active={showObjective}
              onclick={() => (showObjective = !showObjective)}
              title="Diretriz de Objetivo Secreto"
            >
              {@render icon("target", 14)} Objetivo
            </button>

            <button
              class="hud-btn"
              class:active={isMusicPlaying}
              onclick={() => (showMusicPanel = !showMusicPanel)}
              title="Rádio Militar & Trilha Sonora"
            >
              {@render icon("radio", 14)} {isMusicPlaying ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <!-- Map Mode Switcher (Cartographic HOI4 vs Geopolitical Clean vs Regional Theatres) + Camera Controls -->
        <div class="map-mode-bar">
          <div class="mode-tabs">
            <button
              class="mode-btn"
              class:active={mapMode === "cartographic"}
              onclick={() => (mapMode = "cartographic")}
              title="Modo Cartográfico Físico Satelital (Tecla 2 / F2)"
            >
              Cartográfico
            </button>
            <button
              class="mode-btn"
              class:active={mapMode === "geopolitical"}
              onclick={() => (mapMode = "geopolitical")}
              title="Modo Geopolítico Limpo (Tecla 1 / F1)"
            >
              Geopolítico
            </button>
            <button
              class="mode-btn"
              class:active={mapMode === "regional"}
              onclick={() => (mapMode = "regional")}
              title="Modo de Regiões & Sub-Regiões (Tecla 3 / F3)"
            >
              Regional
            </button>
          </div>

          <div class="zoom-cluster">
            <button class="tool-btn" onclick={zoomIn} title="Aproximar (E)">+</button>
            <button class="tool-btn" onclick={zoomOut} title="Afastar (Q)">-</button>
            <button class="tool-btn" onclick={resetZoom} title="Centralizar Mapa">RST</button>
          </div>
        </div>

        <!-- Music Radio Drawer -->
        {#if showMusicPanel}
          <div class="floating-drawer music-drawer">
            <div class="drawer-header">
              <h4>{@render icon("radio", 15)} Rádio Militar & Trilha Sonora</h4>
              <button class="btn-close" onclick={() => (showMusicPanel = false)}>✕</button>
            </div>
            <div class="radio-controls">
              <button class="btn primary-gold" onclick={toggleMusic}>
                {isMusicPlaying ? "Pausar Transmissão" : "Iniciar Transmissão"}
              </button>
              <div class="volume-slider">
                <span>VOL</span>
                <input type="range" min="0" max="1" step="0.05" value={musicVolume} oninput={onVolumeChange} />
              </div>
              <div class="track-select">
                <span>Canal de Áudio:</span>
                <button
                  class="track-option"
                  class:selected={selectedTrack === "ambient_procedural"}
                  onclick={() => onTrackSelect("ambient_procedural")}
                >
                  Marcha Tática (Procedural Web Audio)
                </button>
                <button
                  class="track-option"
                  class:selected={selectedTrack === "track1.mp3"}
                  onclick={() => onTrackSelect("track1.mp3")}
                >
                  Faixa Customizada 1 (track1.mp3)
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Objective Drawer -->
        {#if showObjective && myPlayerState}
          <div class="floating-drawer objective-drawer">
            <div class="drawer-header">
              <h4>{@render icon("target", 15)} Diretriz Secreta de Alto Comando</h4>
              <button class="btn-close" onclick={() => (showObjective = false)}>✕</button>
            </div>
            <p class="objective-body">{myPlayerState.objective.descriptionPt}</p>
            <small class="objective-note">Documento confidencial. O cumprimento garante vitória imediata.</small>
          </div>
        {/if}

        <!-- Cards & Trades Drawer -->
        {#if showCards && myPlayerState}
          <div class="floating-drawer cards-drawer">
            <div class="drawer-header">
              <h4>{@render icon("cards", 15)} Cartas de Suprimento ({myPlayerState.cards.length}/5)</h4>
              <button class="btn-close" onclick={() => (showCards = false)}>✕</button>
            </div>
            <div class="cards-grid">
              {#each myPlayerState.cards as c}
                <div class="card-item">
                  <span class="card-symbol">
                    {c.symbol === "circle"
                      ? "INFANTARIA (Círculo)"
                      : c.symbol === "square"
                        ? "BLINDADOS (Quadrado)"
                        : c.symbol === "triangle"
                          ? "ARTILHARIA (Triângulo)"
                          : "COMANDO TOTAL (Coringa)"}
                  </span>
                  <span class="card-territory">
                    {c.territoryId ? territoryById.get(c.territoryId)?.namePt : "Qualquer Região"}
                  </span>
                </div>
              {/each}
              {#if myPlayerState.cards.length === 0}
                <p class="subtitle">Conquiste ao menos um território no turno para receber suprimentos.</p>
              {/if}
            </div>

            {#if isMyTurn && validTradeTriplet && (game.phase === "deploy" || myPlayerState.cards.length >= 5)}
              <button
                class="btn primary-gold full-width"
                onclick={() => sendAction({ type: "trade_cards", cardIds: validTradeTriplet })}
              >
                Requisitar Divisões Extras (Trocar 3 Cartas)
              </button>
            {/if}
          </div>
        {/if}
      </aside>

      <!-- ↙ BOTTOM-LEFT: NAVIGATION HINT -->
      <div class="bottom-left-hint">
        <span>WASD / Setas: Mover Mapa</span>
        <span>•</span>
        <span>Q / E / Scroll: Zoom</span>
        <span>•</span>
        <span>Globo Contínuo (Pacífico ↔ Atlântico)</span>
      </div>

      <!-- ⬇ BOTTOM-CENTER: 1-2-3 PHASE DOCK & TACTICAL ORDERS -->
      <footer class="hud-panel bottom-center-dock">
        {#if game.winnerId}
          {@const winner = game.players.find((p) => p.id === game!.winnerId)}
          <div class="action-popup victory-popup">
            <h3>HEGEMONIA ALCANÇADA POR {winner?.name?.toUpperCase()}</h3>
            <p>{winner?.objective.descriptionPt}</p>
            <small>Verificação Criptográfica (Seed): {game.revealedSeed}</small>
          </div>

        {:else if isMyTurn}
          {#if game.pendingConquest}
            <div class="action-popup">
              <h4>Território Conquistado — Quantas divisões avançar para ocupação?</h4>
              <div class="slider-row">
                <input
                  type="range"
                  min={game.pendingConquest.minMove}
                  max={game.pendingConquest.maxMove}
                  bind:value={sliderArmies}
                />
                <button class="btn primary-gold" onclick={() => sendAction({ type: "occupy", armies: sliderArmies })}>
                  Avançar {sliderArmies} Divisões
                </button>
              </div>
            </div>

          {:else if game.phase === "deploy"}
            {#if selectedFromId}
              <div class="action-popup">
                <h4>Posicionar reservas em <strong>{territoryById.get(selectedFromId)?.namePt}</strong>:</h4>
                <div class="slider-row">
                  <input
                    type="range"
                    min="1"
                    max={myPlayerState?.unplacedArmies ?? 1}
                    bind:value={sliderArmies}
                  />
                  <button class="btn primary-gold" onclick={confirmDeploy}>
                    Confirmar +{sliderArmies} Divisões
                  </button>
                </div>
              </div>
            {/if}

          {:else if game.phase === "attack"}
            {#if selectedFromId && selectedToId}
              <div class="action-popup attack-popup">
                <div class="attack-matchup">
                  <span>Origem: <strong>{territoryById.get(selectedFromId)?.namePt}</strong> ({game.territories[selectedFromId].armies})</span>
                  <span class="vs">VS</span>
                  <span>Alvo: <strong>{territoryById.get(selectedToId)?.namePt}</strong> ({game.territories[selectedToId].armies})</span>
                </div>

                {#if currentAttackOdds !== null}
                  <div class="odds-bar-container">
                    <div class="odds-label">
                      <span>Projeção Tática de Vitória:</span>
                      <strong>{currentAttackOdds}%</strong>
                    </div>
                    <div class="odds-bar">
                      <div class="odds-fill" style="width: {currentAttackOdds}%"></div>
                    </div>
                  </div>
                {/if}

                <button class="btn btn-attack full-width" onclick={confirmAttack}>
                  {@render icon("swords", 15)} Executar Ofensiva
                </button>
              </div>
            {/if}

          {:else if game.phase === "maneuver"}
            {#if selectedFromId && selectedToId}
              {@const fromT = game.territories[selectedFromId]}
              {@const maxM = Math.max(1, fromT.armies - fromT.movedInArmies - 1)}
              <div class="action-popup">
                <h4>Remanejar de {territoryById.get(selectedFromId)?.namePt} para {territoryById.get(selectedToId)?.namePt}:</h4>
                <div class="slider-row">
                  <input type="range" min="1" max={maxM} bind:value={sliderArmies} />
                  <button class="btn primary-gold" onclick={confirmManeuver}>
                    Transferir {sliderArmies}
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
            <span class="label">Posicionamento</span>
          </div>
          <div class="phase-arrow">›</div>
          <div class="phase-step" class:active-phase={game.phase === "attack"}>
            <span class="num">2</span>
            <span class="label">Ofensiva</span>
          </div>
          <div class="phase-arrow">›</div>
          <div class="phase-step" class:active-phase={game.phase === "maneuver"}>
            <span class="num">3</span>
            <span class="label">Manobra</span>
          </div>

          <div class="turn-timer" class:timer-danger={remainingSeconds <= 20}>
            {@render icon("clock", 14)} {remainingSeconds}s
          </div>

          {#if isMyTurn}
            {#if game.phase === "attack"}
              <button class="btn secondary" onclick={() => sendAction({ type: "end_attack" })}>
                Avançar para Manobra ›
              </button>
            {:else if game.phase === "maneuver"}
              <button class="btn primary-gold" onclick={() => sendAction({ type: "end_turn" })}>
                {@render icon("check", 15)} Encerrar Turno
              </button>
            {/if}
          {/if}
        </div>
      </footer>

      <!-- ↘ BOTTOM-RIGHT: WAR JOURNAL, DICE COMBAT TELEMETRY & COMMS -->
      <aside class="hud-panel bottom-right-panel" class:collapsed={logCollapsed}>
        <div class="panel-header">
          <div class="tab-buttons">
            <button class="tab-btn" class:active={activeLogTab === "log"} onclick={() => (activeLogTab = "log")}>
              {@render icon("log", 13)} Diário de Guerra
            </button>
            <button class="tab-btn" class:active={activeLogTab === "chat"} onclick={() => (activeLogTab = "chat")}>
              {@render icon("chat", 13)} Comms
            </button>
          </div>
          <button class="btn-collapse" onclick={() => (logCollapsed = !logCollapsed)}>
            {logCollapsed ? "▲" : "▼"}
          </button>
        </div>

        {#if !logCollapsed}
          {#if game.lastCombat}
            <div class="dice-history-box">
              <span class="dice-att">ATQ [{game.lastCombat.attackerDice.join(" • ")}]</span>
              <span class="dice-def">DEF [{game.lastCombat.defenderDice.join(" • ")}]</span>
            </div>
          {/if}

          {#if activeLogTab === "log"}
            <div class="log-scroller">
              {#each game.log.slice(-25) as entry}
                <div class="log-line">{entry}</div>
              {/each}
            </div>
          {:else}
            <div class="log-scroller chat-scroller">
              {#each game.log.filter((l) => l.startsWith("[COMMS]")).slice(-25) as entry}
                <div class="log-line chat-line">{entry.replace("[COMMS] ", "")}</div>
              {/each}
            </div>
            <div class="chat-input-row">
              <input
                bind:value={chatInput}
                placeholder="Transmitir mensagem..."
                onkeydown={(e) => e.key === "Enter" && sendChat()}
              />
              <button class="btn secondary" onclick={sendChat}>Enviar</button>
            </div>
          {/if}
        {/if}
      </aside>
    </div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  :global(body) {
    background: #050b16;
    color: #f8fafc;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
    user-select: none;
  }

  .ui-svg-icon {
    display: inline-block;
    vertical-align: -2px;
    flex-shrink: 0;
  }

  .hegemonia-app {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
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
    grid-template-columns: 350px 1fr 370px;
    grid-template-rows: auto 1fr auto;
    padding: 0.85rem;
    gap: 0.85rem;
  }

  .hud-panel {
    pointer-events: auto;
    backdrop-filter: blur(14px);
    background: linear-gradient(180deg, rgba(13, 20, 36, 0.93) 0%, rgba(8, 13, 24, 0.93) 100%);
    border: 1px solid rgba(180, 140, 68, 0.42);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  /* Top-Left Panel */
  .top-left-panel {
    grid-column: 1;
    grid-row: 1;
    align-self: start;
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.95rem;
    letter-spacing: 0.14em;
    color: #f8fafc;
  }
  .brass-icon {
    color: #eab308;
    display: inline-flex;
  }
  .room-tag {
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    background: rgba(30, 41, 59, 0.85);
    border: 1px solid rgba(100, 116, 139, 0.35);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    color: #cbd5e1;
    margin-left: auto;
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
    gap: 0.32rem;
  }
  .general-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.65);
    padding: 0.38rem 0.55rem;
    border-radius: 5px;
    border-left: 3px solid transparent;
    font-size: 0.8rem;
  }
  .general-row.active-turn {
    background: rgba(234, 179, 8, 0.14);
    border-right: 1px solid rgba(250, 204, 21, 0.45);
  }
  .general-row.eliminated {
    opacity: 0.38;
    text-decoration: line-through;
  }
  .g-info {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .g-name {
    font-weight: 600;
  }
  .turn-indicator {
    color: #facc15;
    display: inline-flex;
  }
  .g-stats {
    display: flex;
    gap: 0.35rem;
    color: #cbd5e1;
    font-size: 0.72rem;
    font-weight: 700;
  }
  .stat-pill {
    background: rgba(30, 41, 59, 0.8);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }
  .btn-ghost {
    background: rgba(30, 41, 59, 0.45);
    border: 1px solid rgba(100, 116, 139, 0.35);
    color: #cbd5e1;
    width: 100%;
    padding: 0.35rem 0.55rem;
    border-radius: 5px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn-ghost:hover {
    background: rgba(51, 65, 85, 0.55);
    color: #ffffff;
  }
  .continents-dropdown {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 220px;
    overflow-y: auto;
    padding-top: 0.2rem;
  }
  .dropdown-section-title {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #eab308;
    margin-top: 0.25rem;
    font-weight: 700;
  }
  .cont-pill {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    padding: 0.24rem 0.45rem;
    background: rgba(15, 23, 42, 0.75);
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
    color: #facc15;
    font-weight: 700;
  }

  /* Top-Right Panel */
  .top-right-panel {
    grid-column: 3;
    grid-row: 1;
    align-self: start;
    position: relative;
  }
  .my-hq-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .hq-general {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-weight: 700;
    font-size: 0.88rem;
  }
  .reserve-badge {
    background: rgba(234, 179, 8, 0.2);
    border: 1px solid #facc15;
    color: #fef08a;
    padding: 0.18rem 0.5rem;
    border-radius: 4px;
    font-size: 0.74rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .hq-buttons {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }
  .hud-btn {
    background: #162032;
    border: 1px solid #334155;
    color: #e2e8f0;
    padding: 0.32rem 0.55rem;
    border-radius: 5px;
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .hud-btn:hover,
  .hud-btn.active {
    background: #1e293b;
    border-color: #eab308;
    color: #fef08a;
  }
  .hud-btn.highlight {
    background: rgba(16, 185, 129, 0.22);
    border-color: #10b981;
    color: #a7f3d0;
  }

  .map-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding-top: 0.35rem;
    border-top: 1px solid rgba(51, 65, 85, 0.5);
  }
  .mode-tabs {
    display: flex;
    gap: 0.25rem;
    background: #090e1a;
    padding: 0.18rem;
    border-radius: 5px;
    border: 1px solid #1e293b;
  }
  .mode-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .mode-btn.active {
    background: linear-gradient(135deg, #ca8a04, #a16207);
    color: #ffffff;
  }
  .zoom-cluster {
    display: flex;
    gap: 0.2rem;
  }
  .tool-btn {
    background: #0f172a;
    border: 1px solid #334155;
    color: #cbd5e1;
    min-width: 26px;
    height: 24px;
    padding: 0 0.35rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .tool-btn:hover {
    background: #334155;
    color: #ffffff;
  }

  /* Floating Drawers */
  .floating-drawer {
    margin-top: 0.35rem;
    padding-top: 0.55rem;
    border-top: 1px solid #334155;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.82rem;
    color: #facc15;
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
    cursor: pointer;
    font-size: 0.9rem;
  }
  .objective-body {
    font-size: 0.86rem;
    line-height: 1.4;
    color: #f1f5f9;
    background: rgba(15, 23, 42, 0.8);
    padding: 0.6rem;
    border-radius: 5px;
    border-left: 3px solid #eab308;
  }
  .objective-note {
    font-size: 0.7rem;
    color: #94a3b8;
  }
  .cards-grid {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .card-item {
    display: flex;
    justify-content: space-between;
    background: rgba(15, 23, 42, 0.85);
    padding: 0.4rem 0.55rem;
    border-radius: 4px;
    border: 1px solid rgba(71, 85, 105, 0.4);
    font-size: 0.75rem;
  }
  .card-symbol {
    font-weight: 700;
    color: #eab308;
  }
  .radio-controls {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .volume-slider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: #94a3b8;
  }
  .volume-slider input {
    flex: 1;
  }
  .track-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.74rem;
  }
  .track-option {
    background: #0f172a;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    font-size: 0.74rem;
  }
  .track-option.selected {
    border-color: #eab308;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.14);
  }

  /* Bottom-Left Hint */
  .bottom-left-hint {
    grid-column: 1;
    grid-row: 3;
    align-self: end;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.7rem;
    color: #94a3b8;
    background: rgba(9, 14, 26, 0.82);
    border: 1px solid rgba(51, 65, 85, 0.6);
    padding: 0.4rem 0.65rem;
    border-radius: 6px;
    width: fit-content;
  }

  /* Bottom-Center Phase Dock */
  .bottom-center-dock {
    grid-column: 2;
    grid-row: 3;
    justify-self: center;
    align-self: end;
    min-width: 500px;
    max-width: 680px;
  }
  .action-popup {
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid rgba(234, 179, 8, 0.45);
    padding: 0.65rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .action-popup h4 {
    font-size: 0.84rem;
    font-weight: 600;
  }
  .victory-popup {
    border-color: #facc15;
    text-align: center;
  }
  .victory-popup h3 {
    color: #facc15;
    letter-spacing: 0.08em;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .slider-row input {
    flex: 1;
  }
  .attack-matchup {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.84rem;
  }
  .vs {
    background: #991b1b;
    color: #fecaca;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    font-weight: 800;
    font-size: 0.72rem;
  }
  .odds-bar-container {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
  }
  .odds-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.74rem;
    color: #cbd5e1;
  }
  .odds-bar {
    height: 6px;
    background: #7f1d1d;
    border-radius: 999px;
    overflow: hidden;
  }
  .odds-fill {
    height: 100%;
    background: #10b981;
  }

  .phase-stepper-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
  }
  .phase-step {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.65rem;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.7);
    color: #64748b;
    font-size: 0.78rem;
    font-weight: 700;
    border: 1px solid transparent;
  }
  .phase-step .num {
    width: 19px;
    height: 19px;
    border-radius: 4px;
    background: #1e293b;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
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
    font-size: 1rem;
    font-weight: 700;
  }
  .turn-timer {
    font-family: monospace;
    font-size: 0.85rem;
    font-weight: 700;
    padding: 0.28rem 0.5rem;
    border-radius: 5px;
    background: #0f172a;
    border: 1px solid #334155;
    color: #e2e8f0;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .turn-timer.timer-danger {
    color: #f87171;
    border-color: #ef4444;
  }

  /* Bottom-Right War Journal & Comms */
  .bottom-right-panel {
    grid-column: 3;
    grid-row: 3;
    align-self: end;
    max-height: 270px;
  }
  .bottom-right-panel.collapsed {
    max-height: 46px;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .tab-buttons {
    display: flex;
    gap: 0.35rem;
  }
  .tab-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 0.76rem;
    font-weight: 700;
    padding: 0.22rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tab-btn.active {
    background: #1e293b;
    color: #facc15;
  }
  .btn-collapse {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
  }
  .dice-history-box {
    display: flex;
    justify-content: space-between;
    background: rgba(15, 23, 42, 0.9);
    padding: 0.32rem 0.55rem;
    border-radius: 4px;
    border: 1px solid rgba(71, 85, 105, 0.4);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .dice-att {
    color: #f87171;
  }
  .dice-def {
    color: #93c5fd;
  }
  .log-scroller {
    overflow-y: auto;
    height: 135px;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.74rem;
    color: #cbd5e1;
    padding-right: 0.25rem;
  }
  .log-line {
    padding: 0.2rem 0.35rem;
    background: rgba(15, 23, 42, 0.45);
    border-radius: 3px;
    line-height: 1.35;
  }
  .chat-input-row {
    display: flex;
    gap: 0.35rem;
  }
  .chat-input-row input {
    flex: 1;
    background: #090e1a;
    border: 1px solid #334155;
    color: white;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-size: 0.76rem;
  }

  /* --- Front Screen & Lobby Modals --- */
  .landing-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(circle at center, rgba(20, 32, 58, 0.92), rgba(5, 10, 20, 0.98));
    z-index: 50;
  }
  .war-room-modal {
    width: 100%;
    max-width: 470px;
    background: linear-gradient(180deg, #0f172a 0%, #090e1a 100%);
    border: 1px solid rgba(202, 138, 4, 0.55);
    border-radius: 10px;
    padding: 2.1rem;
    display: flex;
    flex-direction: column;
    gap: 1.05rem;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  .lobby-modal {
    max-width: 560px;
  }
  .brand-crest {
    width: 64px;
    height: 64px;
    margin: 0 auto;
    border-radius: 50%;
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.5);
    color: #eab308;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .title-lockup {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .kicker {
    font-size: 0.68rem;
    letter-spacing: 0.24em;
    color: #eab308;
    font-weight: 700;
  }
  .war-room-modal h1 {
    text-align: center;
    letter-spacing: 0.22em;
    font-size: 2.25rem;
    font-weight: 900;
    color: #f8fafc;
    text-shadow: 0 2px 12px rgba(234, 179, 8, 0.25);
  }
  .brass-rule {
    width: 120px;
    height: 2px;
    background: linear-gradient(90deg, transparent, #eab308, transparent);
    margin-top: 0.2rem;
  }
  .lobby-brand-header {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .lobby-brand-tag {
    font-size: 0.68rem;
    letter-spacing: 0.18em;
    color: #eab308;
    font-weight: 800;
  }
  .subtitle {
    text-align: center;
    color: #94a3b8;
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
  }
  .form-group label {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: #cbd5e1;
    font-weight: 700;
  }
  input {
    background: #060a12;
    border: 1px solid #334155;
    color: white;
    padding: 0.68rem 0.8rem;
    border-radius: 6px;
    font-size: 0.92rem;
  }
  input:focus {
    outline: none;
    border-color: #eab308;
  }
  .btn {
    border: none;
    border-radius: 6px;
    padding: 0.68rem 1rem;
    font-weight: 700;
    cursor: pointer;
    font-size: 0.85rem;
    transition: filter 0.15s, transform 0.1s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }
  .btn:hover {
    filter: brightness(1.12);
  }
  .btn.primary-gold {
    background: linear-gradient(135deg, #ca8a04, #a16207);
    border: 1px solid rgba(254, 240, 138, 0.35);
    color: #ffffff;
  }
  .btn.secondary {
    background: #1e293b;
    border: 1px solid #475569;
    color: #f8fafc;
  }
  .btn.btn-attack {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border: 1px solid rgba(252, 165, 165, 0.4);
    color: white;
  }
  .full-width {
    width: 100%;
  }
  .divider {
    text-align: center;
    font-size: 0.68rem;
    color: #64748b;
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .join-box {
    display: flex;
    gap: 0.5rem;
  }
  .join-box input {
    flex: 1;
    text-transform: uppercase;
  }
  .row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .code-highlight {
    color: #facc15;
    font-family: monospace;
    letter-spacing: 0.08em;
  }
  .badge-players {
    background: #1e293b;
    border: 1px solid #334155;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    font-size: 0.76rem;
    font-weight: 700;
  }
  .player-roster {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .roster-card {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    background: #060a12;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    border: 1px solid #1e293b;
  }
  .roster-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .roster-meta small {
    font-size: 0.7rem;
    color: #94a3b8;
  }
  .tag-host,
  .tag-bot {
    font-size: 0.66rem;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    background: #1e293b;
    color: #eab308;
    font-weight: 700;
    letter-spacing: 0.06em;
    margin-left: auto;
  }
  .btn-remove {
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    font-weight: 700;
  }
  .color-selector {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .swatches {
    display: flex;
    gap: 0.4rem;
  }
  .flag-swatch-btn {
    background: #060a12;
    border: 1px solid #334155;
    padding: 0.2rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    transition: transform 0.12s, border-color 0.12s;
  }
  .flag-swatch-btn:hover {
    transform: translateY(-1px);
    border-color: #eab308;
  }
  .modal-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
  }
  .alert-toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #991b1b;
    color: white;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    z-index: 100;
    font-weight: 700;
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6);
  }
</style>