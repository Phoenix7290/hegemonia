<script lang="ts">
  import { Client, type Room } from "colyseus.js";
  import { CLASSIC_MAP } from "@hegemonia/maps";
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

  const COLOR_NAME_PT: Record<PlayerColor, string> = {
    blue: "Azul",
    red: "Vermelho",
    green: "Verde",
    yellow: "Amarelo",
    black: "Preto",
    white: "Branco",
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

  // --- Reactive State (Svelte 5 Runes) ---
  let playerName = $state(localStorage.getItem("hegemonia_name") ?? "General Ryan");
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

  // Map Pan & Zoom State
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  let isDragging = $state(false);
  let dragStartX = $state(0);
  let dragStartY = $state(0);

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

  // Derived calculations ($derived replaces React useMemo)
  let currentTurnPlayer = $derived(game ? game.players[game.turnIndex] : null);
  let isMyTurn = $derived(Boolean(game && currentTurnPlayer && currentTurnPlayer.id === myPlayerId));
  let myPlayerState = $derived(game?.players.find((p) => p.id === myPlayerId) ?? null);
  let validTradeTriplet = $derived(myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null);

  // Calculate battle win odds when attack target is selected
  let currentAttackOdds = $derived.by(() => {
    if (!game || !selectedFromId || !selectedToId) return null;
    const fromT = game.territories[selectedFromId];
    const toT = game.territories[selectedToId];
    if (!fromT || !toT) return null;
    return estimateAttackWinOdds(fromT.armies, toT.armies);
  });

  // Calculate Hegemony power metrics (% territories and total army sum for each player)
  let playerMetrics = $derived.by(() => {
    if (!game) return [];
    const totalTerrs = CLASSIC_MAP.territories.length; // 42
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

  // Intercontinental Sea Routes (Connecting realistic coordinates)
  const SEA_LINKS: [string, string][] = [
    ["brasil", "argelia"],
    ["groenlandia", "islandia"],
    ["inglaterra", "islandia"],
    ["inglaterra", "suecia"],
    ["inglaterra", "franca"],
    ["inglaterra", "alemanha"],
    ["franca", "argelia"],
    ["franca", "egito"],
    ["polonia", "egito"],
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

  // Turn alert sound and timer countdown effect
  let lastTurnPlayerId = "";
  $effect(() => {
    if (game && currentTurnPlayer && currentTurnPlayer.id !== lastTurnPlayerId) {
      lastTurnPlayerId = currentTurnPlayer.id;
      if (currentTurnPlayer.id === myPlayerId) {
        sound.playTurnChime();
      }
    }
  });

  $effect(() => {
    const timer = setInterval(() => {
      if (turnDeadline > 0) {
        remainingSeconds = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      }
    }, 500);
    return () => clearInterval(timer);
  });

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
    localStorage.setItem("hegemonia_name", playerName);
    const client = new Client(resolveWsUrl());
    const token = getOrCreateToken();

    try {
      const code = createNew ? undefined : roomCodeInput.trim().toUpperCase();
      const room = await client.joinOrCreate("hegemonia", {
        name: playerName,
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

        // SFX trigger on new combat
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

  // --- Map Interaction & Phases ---
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

  // --- Zoom & Pan Logic ---
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    // Only drag when clicking the board background, not nodes or HUD
    if ((e.target as HTMLElement).tagName === "svg" || (e.target as HTMLElement).id === "ocean-bg") {
      isDragging = true;
      dragStartX = e.clientX - panX;
      dragStartY = e.clientY - panY;
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(0.65, Math.min(4.5, zoom * zoomFactor));
    zoom = newZoom;
  }

  function zoomIn() {
    zoom = Math.min(4.5, zoom + 0.3);
  }
  function zoomOut() {
    zoom = Math.max(0.65, zoom - 0.3);
  }
  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  // Audio helper toggles
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

<svelte:window onmouseup={onMouseUp} onmousemove={onMouseMove} />

<main class="hegemonia-app">
  {#if errorBanner}
    <div class="alert-toast">{errorBanner}</div>
  {/if}

  {#if roomStatus === "disconnected"}
    <!-- Initial Landing & Lobby Setup -->
    <div class="landing-overlay">
      <div class="war-room-modal">
        <div class="modal-emblem">⚔️</div>
        <h1>HEGEMONIA</h1>
        <p class="subtitle">Estratégia Geopolítica Global Self-Hosted • IPv6 Nativo</p>

        <div class="form-group">
          <label for="pname">Seu Nome de General</label>
          <input id="pname" bind:value={playerName} maxlength="24" placeholder="Ex: General Ryan" />
        </div>

        <button class="btn primary-gold" onclick={() => joinOrCreateRoom(true)}>
          ➕ Criar Nova Sala de Guerra
        </button>

        <div class="divider"><span>OU ENTRE EM UMA SALA EXISTENTE</span></div>

        <div class="join-box">
          <input bind:value={roomCodeInput} maxlength="6" placeholder="Código (Ex: A1B2C3)" />
          <button class="btn secondary" onclick={() => joinOrCreateRoom(false)}>Entrar</button>
        </div>
      </div>
    </div>

  {:else if roomStatus === "lobby"}
    <!-- Pre-game Lobby War Room -->
    <div class="landing-overlay">
      <div class="war-room-modal lobby-modal">
        <div class="row-between">
          <h2>Sala de Espera: <span class="code-highlight">{roomCode}</span></h2>
          <span class="badge-players">{lobbyPlayers.length}/6 Generais</span>
        </div>
        <p class="subtitle">Envie o código aos seus amigos. Adicione bots de IA se desejar praticar.</p>

        <div class="player-roster">
          {#each lobbyPlayers as p}
            <div class="roster-card">
              <span class="color-badge" style="background: {COLOR_HEX[p.color]}"></span>
              <strong>{p.name}</strong>
              {#if p.isHost}<span class="tag-host">Anfitrião</span>{/if}
              {#if p.isBot}<span class="tag-bot">IA</span>{/if}
              {#if p.isBot}
                <button class="btn-remove" onclick={() => connectedRoom?.send("remove_bot", { token: p.token })}>✕</button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="color-selector">
          <span>Escolha sua Insígnia:</span>
          <div class="swatches">
            {#each ["blue", "red", "green", "yellow", "black", "white"] as PlayerColor[] as c}
              <button
                class="swatch-btn"
                style="background: {COLOR_HEX[c]}"
                title={COLOR_NAME_PT[c]}
                onclick={() => connectedRoom?.send("choose_color", { color: c })}
              ></button>
            {/each}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn secondary" onclick={() => connectedRoom?.send("add_bot")}>🤖 Adicionar Bot IA</button>
          <button class="btn primary-gold" onclick={() => connectedRoom?.send("start_game")}>🚀 Iniciar Campanha</button>
        </div>
      </div>
    </div>

  {:else if game}
    <!-- FULLSCREEN GEOPOLITICAL WAR MAP CANVAS -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="map-viewport" onwheel={onWheel} onmousedown={onMouseDown}>
      <svg
        viewBox="0 0 1024 680"
        class="world-svg"
        style="transform: translate({panX}px, {panY}px) scale({zoom});"
      >
        <defs>
          <!-- Tactical grid overlay for the ocean -->
          <pattern id="tactical-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(30, 41, 59, 0.45)" stroke-width="0.7" />
          </pattern>
          <filter id="glow-gold" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#facc15" flood-opacity="0.9" />
          </filter>
        </defs>

        <!-- Ocean Background -->
        <rect id="ocean-bg" x="-200" y="-200" width="1424" height="1080" fill="#070c18" />
        <rect x="-200" y="-200" width="1424" height="1080" fill="url(#tactical-grid)" />

        <!-- Alaska <-> Vladivostok Pacific Wraparound Route -->
        <line x1="68" y1="138" x2="0" y2="138" stroke="#64748b" stroke-dasharray="6,6" stroke-width="2" />
        <line x1="933" y1="161" x2="1024" y2="161" stroke="#64748b" stroke-dasharray="6,6" stroke-width="2" />

        <!-- Intercontinental / Maritime Routes -->
        {#each SEA_LINKS as [a, b]}
          {@const ta = territoryById.get(a)!}
          {@const tb = territoryById.get(b)!}
          <line
            x1={ta.center[0]}
            y1={ta.center[1]}
            x2={tb.center[0]}
            y2={tb.center[1]}
            stroke="#475569"
            stroke-dasharray="4,5"
            stroke-width="1.6"
            opacity="0.8"
          />
        {/each}

        <!-- 42 Geopolitical Territories with Realistic Coastlines -->
        {#each CLASSIC_MAP.territories as t}
          {@const tState = game.territories[t.id]}
          {@const owner = game.players.find((p) => p.id === tState.ownerId)}
          {@const fill = owner ? COLOR_HEX[owner.color] : "#334155"}
          {@const isSelected = selectedFromId === t.id || selectedToId === t.id}
          {@const isValidTarget =
            selectedFromId &&
            territoryById.get(selectedFromId)?.neighbors.includes(t.id) &&
            ((game.phase === "attack" && tState.ownerId !== myPlayerId) ||
              (game.phase === "maneuver" && tState.ownerId === myPlayerId))}

          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g class="territory-group" onclick={() => onTerritoryClick(t.id)}>
            <!-- Smooth Geopolitical Territory Polygon/Path -->
            <path
              d={t.svgPath}
              fill={fill}
              fill-opacity={isSelected ? "0.95" : "0.78"}
              stroke={isSelected ? "#ffffff" : isValidTarget ? "#facc15" : "rgba(15, 23, 42, 0.75)"}
              stroke-width={isSelected ? "3" : isValidTarget ? "2.4" : "1.1"}
              filter={isSelected || isValidTarget ? "url(#glow-gold)" : undefined}
            />

            <!-- High-Contrast Military Army Badge Insignia -->
            <g transform="translate({t.center[0]}, {t.center[1]})">
              <!-- Pill badge background -->
              <rect
                x="-14"
                y="-14"
                width="28"
                height="28"
                rx="6"
                fill="#090d16"
                stroke={fill}
                stroke-width="2.5"
                filter="drop-shadow(0 2px 5px rgba(0,0,0,0.8))"
              />
              <!-- Crisp, highly legible troop count -->
              <text
                x="0"
                y="0"
                text-anchor="middle"
                dominant-baseline="central"
                fill="#ffffff"
                font-size="13"
                font-weight="800"
                font-family="system-ui, -apple-system, sans-serif"
                pointer-events="none"
              >
                {tState.armies}
              </text>
              <!-- Territory label with stroke backing for perfect visibility -->
              <text
                x="0"
                y="22"
                text-anchor="middle"
                fill="#e2e8f0"
                font-size="9"
                font-weight="700"
                pointer-events="none"
                style="paint-order: stroke; stroke: #060a14; stroke-width: 3.5px; stroke-linejoin: round;"
              >
                {t.namePt}
              </text>
            </g>
          </g>
        {/each}
      </svg>
    </div>

    <!-- FLOATING HUD (Z-INDEX OVERLAY - GRAND STRATEGY STYLE) -->
    <div class="hud-layer">
      <!-- ↖ TOP-LEFT: GLOBAL INTEL & HEGEMONY BALANCE OF POWER -->
      <aside class="hud-panel top-left-panel">
        <div class="panel-header">
          <div class="brand-row">
            <span class="icon">⚔️</span>
            <strong>HEGEMONIA</strong>
            <span class="room-tag">Sala: {roomCode}</span>
          </div>
        </div>

        <!-- Hegemony Power Bar (Segmented World Dominance %) -->
        <div class="hegemony-bar" title="Balanço de Poder Global (% do Mundo)">
          {#each playerMetrics as m}
            <div
              class="hegemony-segment"
              style="width: {m.sharePct}%; background: {COLOR_HEX[m.player.color]};"
              title="{m.player.name}: {m.sharePct}% do Mundo ({m.terrCount} territórios, {m.totalArmies} tropas)"
            ></div>
          {/each}
        </div>

        <!-- Generals Roster & War Strengths -->
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
                <span class="g-dot" style="background: {COLOR_HEX[m.player.color]}"></span>
                <span class="g-name">
                  {m.player.name} {m.player.id === myPlayerId ? "(Você)" : ""}
                  {#if isTurn}<span class="turn-crown">👑</span>{/if}
                </span>
              </div>
              <div class="g-stats">
                <span title="Territórios">🏳️ {m.terrCount}</span>
                <span title="Total de Tropas">⚔️ {m.totalArmies}</span>
                <span title="Cartas">🃏 {m.player.cards.length}</span>
              </div>
            </div>
          {/each}
        </div>

        <!-- Continent Bonuses Popover Toggle -->
        <div class="continents-toggle-row">
          <button class="btn-ghost" onclick={() => (showContinents = !showContinents)}>
            🌍 Bônus de Continente {showContinents ? "▲" : "▼"}
          </button>
        </div>

        {#if showContinents}
          <div class="continents-dropdown">
            {#each CLASSIC_MAP.continents as c}
              {@const ownerId = Object.values(game.territories).filter((t) => territoryById.get(t.id)?.continent === c.id)[0]?.ownerId}
              {@const isMonopoly = CLASSIC_MAP.territories.filter((t) => t.continent === c.id).every((t) => game!.territories[t.id].ownerId === ownerId)}
              <div class="cont-pill">
                <span>{c.namePt}</span>
                <span class="bonus-tag">+{c.bonus}</span>
                {#if isMonopoly}
                  {@const p = game.players.find((plr) => plr.id === ownerId)}
                  <span class="mono-badge" style="background: {COLOR_HEX[p?.color ?? 'white']}">Domínio</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </aside>

      <!-- ↗ TOP-RIGHT: PLAYER HEADQUARTERS, CARDS & RADIO CONTROLS -->
      <aside class="hud-panel top-right-panel">
        <div class="my-hq-row">
          {#if myPlayerState}
            <div class="hq-general">
              <span class="color-badge" style="background: {COLOR_HEX[myPlayerState.color]}"></span>
              <span class="hq-name">{myPlayerState.name}</span>
            </div>

            {#if isMyTurn && myPlayerState.unplacedArmies > 0}
              <div class="reserve-badge pulse">
                🛡️ +{myPlayerState.unplacedArmies} Reservas
              </div>
            {/if}
          {/if}

          <!-- HUD Quick Drawers -->
          <div class="hq-buttons">
            <button
              class="hud-btn"
              class:highlight={Boolean(validTradeTriplet)}
              onclick={() => (showCards = !showCards)}
              title="Suas Cartas"
            >
              🃏 {myPlayerState?.cards.length ?? 0}/5
            </button>

            <button
              class="hud-btn"
              class:active={showObjective}
              onclick={() => (showObjective = !showObjective)}
              title="Objetivo Secreto"
            >
              🎯 Objetivo
            </button>

            <button
              class="hud-btn"
              class:active={isMusicPlaying}
              onclick={() => (showMusicPanel = !showMusicPanel)}
              title="Rádio Militar & Trilha"
            >
              🎵 {isMusicPlaying ? "▶" : "⏸"}
            </button>

            <!-- Zoom & Pan Controls -->
            <div class="zoom-cluster">
              <button class="tool-btn" onclick={zoomIn} title="Zoom In">+</button>
              <button class="tool-btn" onclick={zoomOut} title="Zoom Out">-</button>
              <button class="tool-btn" onclick={resetZoom} title="Resetar Câmera">⟲</button>
            </div>
          </div>
        </div>

        <!-- Music Radio Drawer -->
        {#if showMusicPanel}
          <div class="floating-drawer music-drawer">
            <div class="drawer-header">
              <h4>🎵 Sala de Rádio & Trilha Sonora</h4>
              <button class="btn-close" onclick={() => (showMusicPanel = false)}>✕</button>
            </div>
            <div class="radio-controls">
              <button class="btn primary-gold" onclick={toggleMusic}>
                {isMusicPlaying ? "⏸ Pausar Trilha" : "▶ Iniciar Trilha"}
              </button>
              <div class="volume-slider">
                <span>🔊</span>
                <input type="range" min="0" max="1" step="0.05" value={musicVolume} oninput={onVolumeChange} />
              </div>
              <div class="track-select">
                <span>Trilha:</span>
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
                  Faixa Personalizada 1 (track1.mp3)
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Objective Drawer -->
        {#if showObjective && myPlayerState}
          <div class="floating-drawer objective-drawer">
            <div class="drawer-header">
              <h4>🎯 Seu Objetivo Secreto</h4>
              <button class="btn-close" onclick={() => (showObjective = false)}>✕</button>
            </div>
            <p class="objective-body">{myPlayerState.objective.descriptionPt}</p>
            <small class="objective-note">Cumprir este objetivo garante a vitória imediata.</small>
          </div>
        {/if}

        <!-- Cards & Trades Drawer -->
        {#if showCards && myPlayerState}
          <div class="floating-drawer cards-drawer">
            <div class="drawer-header">
              <h4>🃏 Suas Cartas ({myPlayerState.cards.length}/5)</h4>
              <button class="btn-close" onclick={() => (showCards = false)}>✕</button>
            </div>
            <div class="cards-grid">
              {#each myPlayerState.cards as c}
                <div class="card-item">
                  <span class="card-symbol">
                    {c.symbol === "circle" ? "⚪ Círculo" : c.symbol === "square" ? "🟦 Quadrado" : c.symbol === "triangle" ? "🔺 Triângulo" : "🃏 Coringa"}
                  </span>
                  <span class="card-territory">
                    {c.territoryId ? territoryById.get(c.territoryId)?.namePt : "Qualquer Região"}
                  </span>
                </div>
              {/each}
              {#if myPlayerState.cards.length === 0}
                <p class="subtitle">Conquiste ao menos um território no seu turno para obter cartas.</p>
              {/if}
            </div>

            {#if isMyTurn && validTradeTriplet && (game.phase === "deploy" || myPlayerState.cards.length >= 5)}
              <button
                class="btn primary-gold full-width"
                onclick={() => sendAction({ type: "trade_cards", cardIds: validTradeTriplet })}
              >
                ♻️ Trocar 3 Cartas por Exércitos Extras!
              </button>
            {/if}
          </div>
        {/if}
      </aside>

      <!-- ⬇ BOTTOM-CENTER: 1-2-3 PHASE DOCK & CONTEXTUAL CONTROLS -->
      <footer class="hud-panel bottom-center-dock">
        <!-- Contextual Action Box (Pops up above the dock when actions are pending) -->
        {#if game.winnerId}
          {@const winner = game.players.find((p) => p.id === game.winnerId)}
          <div class="action-popup victory-popup">
            <h3>🏆 VITÓRIA DE {winner?.name}!</h3>
            <p>{winner?.objective.descriptionPt}</p>
            <small>Commit-Reveal Seed: {game.revealedSeed}</small>
          </div>

        {:else if isMyTurn}
          {#if game.pendingConquest}
            <div class="action-popup">
              <h4>Território Conquistado! Quantas tropas avançar?</h4>
              <div class="slider-row">
                <input
                  type="range"
                  min={game.pendingConquest.minMove}
                  max={game.pendingConquest.maxMove}
                  bind:value={sliderArmies}
                />
                <button class="btn primary-gold" onclick={() => sendAction({ type: "occupy", armies: sliderArmies })}>
                  Avançar {sliderArmies} Tropas
                </button>
              </div>
            </div>

          {:else if game.phase === "deploy"}
            {#if selectedFromId}
              <div class="action-popup">
                <h4>Posicionar em <strong>{territoryById.get(selectedFromId)?.namePt}</strong>:</h4>
                <div class="slider-row">
                  <input
                    type="range"
                    min="1"
                    max={myPlayerState?.unplacedArmies ?? 1}
                    bind:value={sliderArmies}
                  />
                  <button class="btn primary-gold" onclick={confirmDeploy}>
                    Confirmar +{sliderArmies} Tropas
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
                      <span>Probabilidade de Vitória do Atacante:</span>
                      <strong>{currentAttackOdds}%</strong>
                    </div>
                    <div class="odds-bar">
                      <div class="odds-fill" style="width: {currentAttackOdds}%"></div>
                    </div>
                  </div>
                {/if}

                <button class="btn btn-attack full-width" onclick={confirmAttack}>
                  🎲 Rolar Ataque!
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
                    Mover {sliderArmies}
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
            <span class="label">Posicionar</span>
          </div>
          <div class="phase-arrow">➔</div>
          <div class="phase-step" class:active-phase={game.phase === "attack"}>
            <span class="num">2</span>
            <span class="label">Atacar</span>
          </div>
          <div class="phase-arrow">➔</div>
          <div class="phase-step" class:active-phase={game.phase === "maneuver"}>
            <span class="num">3</span>
            <span class="label">Remanejar</span>
          </div>

          <!-- Turn Countdown Timer -->
          <div class="turn-timer" class:timer-danger={remainingSeconds <= 20}>
            ⏱️ {remainingSeconds}s
          </div>

          <!-- Advance Phase Button -->
          {#if isMyTurn}
            {#if game.phase === "attack"}
              <button class="btn secondary" onclick={() => sendAction({ type: "end_attack" })}>
                Ir para Remanejamento ➔
              </button>
            {:else if game.phase === "maneuver"}
              <button class="btn primary-gold" onclick={() => sendAction({ type: "end_turn" })}>
                Finalizar Turno ✅
              </button>
            {/if}
          {/if}
        </div>
      </footer>

      <!-- ↘ BOTTOM-RIGHT: WAR JOURNAL, DICE ROLL & CHAT -->
      <aside class="hud-panel bottom-right-panel" class:collapsed={logCollapsed}>
        <div class="panel-header">
          <div class="tab-buttons">
            <button class="tab-btn" class:active={activeLogTab === "log"} onclick={() => (activeLogTab = "log")}>
              📜 Diário
            </button>
            <button class="tab-btn" class:active={activeLogTab === "chat"} onclick={() => (activeLogTab = "chat")}>
              💬 Chat
            </button>
          </div>
          <button class="btn-collapse" onclick={() => (logCollapsed = !logCollapsed)}>
            {logCollapsed ? "▲" : "▼"}
          </button>
        </div>

        {#if !logCollapsed}
          <!-- Last Combat Dice Box -->
          {#if game.lastCombat}
            <div class="dice-history-box">
              <span class="dice-att">🔴 ATQ: [{game.lastCombat.attackerDice.join(", ")}]</span>
              <span class="dice-def">⚪ DEF: [{game.lastCombat.defenderDice.join(", ")}]</span>
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
              {#each game.log.filter((l) => l.startsWith("💬")).slice(-25) as entry}
                <div class="log-line chat-line">{entry}</div>
              {/each}
            </div>
            <div class="chat-input-row">
              <input
                bind:value={chatInput}
                placeholder="Mensagem para os generais..."
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
    background: #070c18;
    color: #f8fafc;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
    user-select: none;
  }

  .hegemonia-app {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  /* --- Fullscreen Map Viewport --- */
  .map-viewport {
    position: absolute;
    inset: 0;
    width: 100vw;
    height: 100vh;
    cursor: grab;
    background: #070c18;
  }
  .map-viewport:active {
    cursor: grabbing;
  }
  .world-svg {
    width: 100%;
    height: 100%;
    transform-origin: center center;
    transition: transform 0.05s ease-out;
  }

  .territory-group {
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .territory-group:hover path {
    filter: brightness(1.22);
  }

  /* --- HUD Overlays (Z-Index layer) --- */
  .hud-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    display: grid;
    grid-template-columns: 340px 1fr 340px;
    grid-template-rows: auto 1fr auto;
    padding: 1rem;
    gap: 1rem;
  }

  .hud-panel {
    pointer-events: auto;
    backdrop-filter: blur(14px);
    background: rgba(11, 17, 32, 0.88);
    border: 1px solid rgba(51, 65, 85, 0.75);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* Top-Left Quadrant */
  .top-left-panel {
    grid-column: 1;
    grid-row: 1;
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1rem;
    letter-spacing: 0.08em;
  }
  .room-tag {
    font-size: 0.72rem;
    background: #1e293b;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    color: #94a3b8;
    margin-left: auto;
  }
  .hegemony-bar {
    display: flex;
    height: 8px;
    width: 100%;
    border-radius: 999px;
    overflow: hidden;
    background: #1e293b;
  }
  .hegemony-segment {
    transition: width 0.4s ease;
  }
  .generals-table {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .general-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.7);
    padding: 0.4rem 0.55rem;
    border-radius: 5px;
    border-left: 3.5px solid transparent;
    font-size: 0.82rem;
  }
  .general-row.active-turn {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.4);
  }
  .general-row.eliminated {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .g-info {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .g-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .g-stats {
    display: flex;
    gap: 0.55rem;
    color: #cbd5e1;
    font-size: 0.78rem;
  }
  .continents-dropdown {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
    background: #090e1a;
    padding: 0.5rem;
    border-radius: 6px;
    font-size: 0.75rem;
  }
  .cont-pill {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .bonus-tag {
    color: #facc15;
    font-weight: 700;
  }
  .mono-badge {
    font-size: 0.65rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    color: #050811;
    font-weight: 800;
  }

  /* Top-Right Quadrant */
  .top-right-panel {
    grid-column: 3;
    grid-row: 1;
    position: relative;
  }
  .my-hq-row {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .hq-general {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 0.95rem;
  }
  .color-badge {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .reserve-badge {
    background: linear-gradient(135deg, #0284c7, #2563eb);
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.85rem;
    text-align: center;
    border: 1px solid #38bdf8;
  }
  .pulse {
    animation: pulseGlow 1.8s infinite;
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 5px rgba(56, 189, 248, 0.4); }
    50% { box-shadow: 0 0 15px rgba(56, 189, 248, 0.85); }
  }
  .hq-buttons {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .hud-btn {
    flex: 1;
    background: #1e293b;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.4rem 0.5rem;
    border-radius: 5px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .hud-btn.highlight {
    border-color: #facc15;
    background: rgba(250, 204, 21, 0.2);
    color: #facc15;
  }
  .zoom-cluster {
    display: flex;
    gap: 0.2rem;
  }
  .tool-btn {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-weight: 700;
    cursor: pointer;
  }

  /* Floating Drawers */
  .floating-drawer {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    width: 320px;
    background: rgba(11, 17, 32, 0.95);
    border: 1px solid #38bdf8;
    border-radius: 8px;
    padding: 0.85rem;
    box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    z-index: 50;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .drawer-header h4 {
    font-size: 0.88rem;
  }
  .btn-close {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .objective-body {
    background: #0f172a;
    border-left: 3px solid #facc15;
    padding: 0.6rem;
    font-size: 0.82rem;
    line-height: 1.4;
    border-radius: 4px;
  }
  .cards-grid {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .card-item {
    display: flex;
    justify-content: space-between;
    background: #1e293b;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    font-size: 0.78rem;
  }
  .radio-controls {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .volume-slider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .track-select {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.78rem;
  }
  .track-option {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.4rem;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    font-size: 0.75rem;
  }
  .track-option.selected {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.15);
    color: #f8fafc;
  }

  /* Bottom-Center Phase Dock */
  .bottom-center-dock {
    grid-column: 2;
    grid-row: 3;
    align-self: end;
    justify-self: center;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    min-width: 480px;
  }
  .phase-stepper-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .phase-step {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    background: #1e293b;
    border: 1px solid #334155;
    font-size: 0.82rem;
    color: #94a3b8;
  }
  .phase-step.active-phase {
    background: linear-gradient(135deg, #0284c7, #2563eb);
    border-color: #38bdf8;
    color: #ffffff;
    font-weight: 700;
  }
  .phase-step .num {
    background: rgba(0, 0, 0, 0.35);
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.75rem;
  }
  .phase-arrow {
    color: #475569;
    font-size: 0.85rem;
  }
  .turn-timer {
    background: #0f172a;
    border: 1px solid #334155;
    padding: 0.35rem 0.65rem;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .timer-danger {
    border-color: #ef4444;
    color: #f87171;
    animation: pulseDanger 1s infinite;
  }
  @keyframes pulseDanger {
    0%, 100% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.4); }
    50% { box-shadow: 0 0 15px rgba(239, 68, 68, 0.9); }
  }

  /* Contextual Action Popup */
  .action-popup {
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid #facc15;
    border-radius: 8px;
    padding: 0.85rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.7);
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .slider-row input {
    flex: 1;
  }
  .attack-popup {
    border-color: #ef4444;
  }
  .attack-matchup {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.82rem;
  }
  .vs {
    font-weight: 800;
    color: #f87171;
  }
  .odds-bar-container {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .odds-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #cbd5e1;
  }
  .odds-bar {
    height: 7px;
    border-radius: 999px;
    background: #334155;
    overflow: hidden;
  }
  .odds-fill {
    height: 100%;
    background: linear-gradient(90deg, #eab308, #10b981);
    transition: width 0.3s ease;
  }
  .btn-attack {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border-color: #f87171;
    color: #ffffff;
    padding: 0.55rem;
    font-weight: 700;
  }

  /* Bottom-Right Journal & Chat */
  .bottom-right-panel {
    grid-column: 3;
    grid-row: 3;
    align-self: end;
    max-height: 260px;
  }
  .bottom-right-panel.collapsed {
    max-height: 50px;
  }
  .tab-buttons {
    display: flex;
    gap: 0.4rem;
  }
  .tab-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
    padding-bottom: 0.2rem;
  }
  .tab-btn.active {
    color: #f8fafc;
    border-bottom: 2px solid #38bdf8;
  }
  .btn-collapse {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    margin-left: auto;
  }
  .dice-history-box {
    display: flex;
    justify-content: space-between;
    background: #060a14;
    padding: 0.35rem 0.55rem;
    border-radius: 5px;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .dice-att { color: #f87171; }
  .dice-def { color: #e2e8f0; }
  .log-scroller {
    max-height: 140px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.74rem;
    color: #94a3b8;
    background: #090e1a;
    padding: 0.45rem;
    border-radius: 5px;
  }
  .chat-input-row {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .chat-input-row input {
    flex: 1;
    background: #0f172a;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-size: 0.78rem;
  }

  /* Common Buttons & Modals */
  .btn {
    border: 1px solid #334155;
    background: #1e293b;
    color: #f8fafc;
    padding: 0.5rem 0.85rem;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn:hover:not(:disabled) {
    border-color: #38bdf8;
    background: #273549;
  }
  .btn.primary-gold {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    border-color: #facc15;
    color: #0b1120;
  }
  .btn.secondary {
    background: #1e293b;
  }
  .full-width {
    width: 100%;
  }

  .landing-overlay {
    position: fixed;
    inset: 0;
    background: radial-gradient(circle at center, rgba(15, 23, 42, 0.95), rgba(6, 9, 19, 0.98));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
  }
  .war-room-modal {
    max-width: 500px;
    width: 90%;
    background: #0b1120;
    border: 1px solid #38bdf8;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    text-align: center;
  }
  .modal-emblem {
    font-size: 2.2rem;
  }
  .subtitle {
    color: #94a3b8;
    font-size: 0.85rem;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-align: left;
  }
  .form-group input, .join-box input {
    background: #0f172a;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    font-size: 0.95rem;
  }
  .join-box {
    display: flex;
    gap: 0.5rem;
  }
  .join-box input {
    flex: 1;
  }
  .divider {
    display: flex;
    align-items: center;
    text-align: center;
    font-size: 0.72rem;
    color: #64748b;
  }
  .divider::before, .divider::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid #1e293b;
  }
  .divider span {
    padding: 0 0.5rem;
  }
  .player-roster {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: left;
  }
  .roster-card {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: #1e293b;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
  }
  .color-selector {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
  }
  .swatches {
    display: flex;
    gap: 0.4rem;
  }
  .swatch-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid #0f172a;
    cursor: pointer;
  }
  .tag-host, .tag-bot {
    font-size: 0.68rem;
    background: #334155;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }
  .btn-remove {
    background: transparent;
    border: none;
    color: #f87171;
    margin-left: auto;
    cursor: pointer;
  }
  .modal-actions {
    display: flex;
    gap: 0.8rem;
  }
  .modal-actions .btn {
    flex: 1;
  }
  .alert-toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(239, 68, 68, 0.9);
    border: 1px solid #f87171;
    color: #ffffff;
    padding: 0.5rem 1.2rem;
    border-radius: 6px;
    font-weight: 700;
    z-index: 150;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
  }
  .row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .code-highlight {
    color: #facc15;
    font-family: monospace;
    letter-spacing: 0.1em;
  }
  .btn-ghost {
    background: transparent;
    border: none;
    color: #38bdf8;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.2rem 0;
  }
</style>
