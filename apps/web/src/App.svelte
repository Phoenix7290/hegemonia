<script lang="ts">
  import { Client, type Room } from "colyseus.js";
  import { CLASSIC_MAP } from "@hegemonia/maps";
  import { findValidTradeTriplet } from "@hegemonia/engine";
  import type { GameState, PlayerColor } from "@hegemonia/shared";

  const COLOR_HEX: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#eab308",
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

  // Persistent local session token (no login/password needed!)
  function getOrCreateToken(): string {
    const saved = localStorage.getItem("hegemonia_token");
    if (saved) return saved;
    const fresh = "plr_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("hegemonia_token", fresh);
    return fresh;
  }

  // Svelte 5 Runes ($state) -> replaces React useState!
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

  // Map interaction state
  let selectedFromId = $state<string | null>(null);
  let selectedToId = $state<string | null>(null);
  let sliderArmies = $state(1);
  let showObjective = $state(false);
  let chatInput = $state("");

  // Svelte 5 $derived -> replaces React useMemo!
  let currentTurnPlayer = $derived(
    game ? game.players[game.turnIndex] : null
  );
  let isMyTurn = $derived(
    Boolean(game && currentTurnPlayer && currentTurnPlayer.id === myPlayerId)
  );
  let myPlayerState = $derived(
    game?.players.find((p) => p.id === myPlayerId) ?? null
  );
  let validTradeTriplet = $derived(
    myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null
  );

  // Build visual sea-route lines between intercontinental neighbors
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

  const territoryById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

  // Timer countdown interval
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
        roomCode = payload.roomCode;
        roomStatus = payload.status;
        turnDeadline = payload.turnDeadline;
        myPlayerId = payload.myPlayerId;
        lobbyPlayers = payload.lobbyPlayers;
        game = payload.game;

        if (game?.pendingConquest) {
          sliderArmies = game.pendingConquest.maxMove;
        }
      });

      room.onMessage("error_msg", (payload: { message: string }) => {
        errorBanner = payload.message;
        setTimeout(() => {
          if (errorBanner === payload.message) errorBanner = "";
        }, 4000);
      });
    } catch (err: unknown) {
      errorBanner =
        err instanceof Error ? err.message : "Falha ao conectar ao servidor Hegemonia.";
    }
  }

  function sendAction(action: unknown) {
    connectedRoom?.send("game_action", action);
  }

  function onTerritoryClick(terrId: string) {
    if (!game || !isMyTurn || game.pendingConquest) return;
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
</script>

<main class="shell">
  <header class="topbar">
    <div class="brand">
      <span class="emblem">⚔️</span>
      <div>
        <h1>HEGEMONIA</h1>
        <small>Estratégia Geopolítica Self-Hosted (IPv6 Ready)</small>
      </div>
    </div>

    {#if roomStatus !== "disconnected"}
      <div class="room-pill">
        <span>Sala: <strong>{roomCode}</strong></span>
        {#if roomStatus === "playing" && currentTurnPlayer}
          <span class="turn-badge" style="border-color: {COLOR_HEX[currentTurnPlayer.color]}">
            Rodada {game?.round} • Turno: <strong>{currentTurnPlayer.name}</strong> ({remainingSeconds}s)
          </span>
        {/if}
      </div>
    {/if}
  </header>

  {#if errorBanner}
    <div class="alert-error">{errorBanner}</div>
  {/if}

  {#if roomStatus === "disconnected"}
    <section class="card-center">
      <h2>Entrar no Comando de Guerra</h2>
      <p class="subtitle">Sem conta ou login. Seu assento na partida é protegido automaticamente.</p>

      <label>
        <span>Seu Nome de General</span>
        <input bind:value={playerName} maxlength="24" placeholder="Ex: General Ryan" />
      </label>

      <div class="actions-row">
        <button class="primary" onclick={() => joinOrCreateRoom(true)}>
          ➕ Criar Nova Sala
        </button>
      </div>

      <hr />

      <label>
        <span>Ou entrar com Código da Sala</span>
        <div class="join-row">
          <input bind:value={roomCodeInput} maxlength="6" placeholder="Ex: A1B2C3" />
          <button onclick={() => joinOrCreateRoom(false)}>Entrar</button>
        </div>
      </label>
    </section>

  {:else if roomStatus === "lobby"}
    <section class="card-center">
      <h2>Sala de Espera — Código: <span class="code">{roomCode}</span></h2>
      <p class="subtitle">Compartilhe este código com seus amigos (3 a 6 jogadores clássico, mín. 2 para testar).</p>

      <div class="player-list">
        {#each lobbyPlayers as p}
          <div class="player-item">
            <span class="swatch" style="background: {COLOR_HEX[p.color]}"></span>
            <strong>{p.name}</strong>
            {#if p.isHost}<span class="tag">Anfitrião</span>{/if}
            {#if p.isBot}<span class="tag">IA</span>{/if}
            {#if p.isBot}
              <button onclick={() => connectedRoom?.send("remove_bot", { token: p.token })}>✕</button>
            {/if}
          </div>
        {/each}
      </div>

      <div class="color-picker">
        <span>Escolher Cor:</span>
        {#each ["blue", "red", "green", "yellow", "black", "white"] as PlayerColor[] as c}
          <button
            class="color-btn"
            style="background: {COLOR_HEX[c]}"
            title={COLOR_NAME_PT[c]}
            onclick={() => connectedRoom?.send("choose_color", { color: c })}
          ></button>
        {/each}
      </div>

      <div class="actions-row">
        <button onclick={() => connectedRoom?.send("add_bot")}>🤖 Adicionar Bot IA</button>
        <button class="primary" onclick={() => connectedRoom?.send("start_game")}>
          🚀 Iniciar Partida
        </button>
      </div>
    </section>

  {:else if game}
    <div class="war-room">
      <!-- SVG Interactive Board -->
      <div class="map-panel">
        <svg viewBox="0 0 1000 560" class="board-svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.7" />
            </pattern>
          </defs>
          <rect width="1000" height="560" fill="url(#grid)" />

          <!-- Alaska <-> Vladivostok wraparound sea lines -->
          <line x1="45" y1="85" x2="0" y2="85" stroke="#475569" stroke-dasharray="5,5" stroke-width="2" />
          <line x1="945" y1="115" x2="1000" y2="115" stroke="#475569" stroke-dasharray="5,5" stroke-width="2" />

          <!-- Intercontinental / Sea Routes -->
          {#each SEA_LINKS as [a, b]}
            {@const ta = territoryById.get(a)!}
            {@const tb = territoryById.get(b)!}
            <line
              x1={ta.center[0]}
              y1={ta.center[1]}
              x2={tb.center[0]}
              y2={tb.center[1]}
              stroke="#64748b"
              stroke-dasharray="4,4"
              stroke-width="1.8"
            />
          {/each}

          <!-- Territories -->
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
            <g class="territory-node" onclick={() => onTerritoryClick(t.id)}>
              <path
                d={t.svgPath}
                fill={fill}
                fill-opacity={isSelected ? "0.95" : "0.72"}
                stroke={isSelected ? "#ffffff" : isValidTarget ? "#facc15" : "#0f172a"}
                stroke-width={isSelected ? "3.5" : isValidTarget ? "2.5" : "1.6"}
              />
              <circle
                cx={t.center[0]}
                cy={t.center[1] - 4}
                r="13"
                fill="#0f172a"
                stroke={fill}
                stroke-width="2.5"
              />
              <text
                x={t.center[0]}
                y={t.center[1]}
                text-anchor="middle"
                fill="#f8fafc"
                font-size="11"
                font-weight="bold"
              >
                {tState.armies}
              </text>
              <text
                x={t.center[0]}
                y={t.center[1] + 19}
                text-anchor="middle"
                fill="#e2e8f0"
                font-size="9.5"
                font-weight="600"
                style="paint-order: stroke; stroke: #090d16; stroke-width: 3px;"
              >
                {t.namePt}
              </text>
            </g>
          {/each}
        </svg>

        <!-- Continent Bonus Legend -->
        <div class="continent-bar">
          {#each CLASSIC_MAP.continents as c}
            <span>{c.namePt}: <strong>+{c.bonus}</strong></span>
          {/each}
        </div>
      </div>

      <!-- Command Sidebar -->
      <aside class="sidebar">
        <!-- Players Summary -->
        <div class="panel-box">
          <h3>Generais na Partida</h3>
          {#each game.players as p, idx}
            {@const terrCount = Object.values(game.territories).filter((t) => t.ownerId === p.id).length}
            <div class="general-row" class:active={idx === game.turnIndex} class:eliminated={p.eliminated}>
              <span class="swatch" style="background: {COLOR_HEX[p.color]}"></span>
              <span class="g-name">{p.name} {p.id === myPlayerId ? "(Você)" : ""}</span>
              <span class="g-stats">{terrCount} terr • 🃏 {p.cards.length}</span>
            </div>
          {/each}
        </div>

        <!-- Secret Objective & Hand -->
        {#if myPlayerState}
          <div class="panel-box">
            <div class="row-between">
              <h3>🎯 Seu Objetivo Secreto</h3>
              <button onclick={() => (showObjective = !showObjective)}>
                {showObjective ? "Ocultar" : "Revelar"}
              </button>
            </div>
            {#if showObjective}
              <p class="objective-text">{myPlayerState.objective.descriptionPt}</p>
            {:else}
              <p class="subtitle">Clique em "Revelar" para consultar seu objetivo.</p>
            {/if}

            <div class="cards-section">
              <h4>🃏 Suas Cartas ({myPlayerState.cards.length}/5)</h4>
              <div class="cards-list">
                {#each myPlayerState.cards as c}
                  <span class="card-chip">
                    {c.symbol === "circle" ? "⚪" : c.symbol === "square" ? "🟦" : c.symbol === "triangle" ? "🔺" : "🃏"}
                    {c.territoryId ? territoryById.get(c.territoryId)?.namePt : "Coringa"}
                  </span>
                {/each}
              </div>
              {#if isMyTurn && validTradeTriplet && (game.phase === "deploy" || myPlayerState.cards.length >= 5)}
                <button
                  class="primary full-btn"
                  onclick={() => sendAction({ type: "trade_cards", cardIds: validTradeTriplet })}
                >
                  ♻️ Trocar 3 Cartas por Tropas Extras!
                </button>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Active Phase Controls -->
        <div class="panel-box">
          <h3>⚡ Fase: {game.phase === "deploy" ? "Posicionamento" : game.phase === "attack" ? "Ataque" : game.phase === "maneuver" ? "Remanejamento" : "Fim de Jogo"}</h3>

          {#if game.winnerId}
            {@const winner = game.players.find((p) => p.id === game.winnerId)}
            <div class="victory-box">
              <h4>🏆 Vitória de {winner?.name}!</h4>
              <p>{winner?.objective.descriptionPt}</p>
              <small>Seed Revelada (Commit-Reveal): {game.revealedSeed}</small>
            </div>

          {:else if isMyTurn}
            {#if game.pendingConquest}
              <div class="control-group">
                <p>Território conquistado! Quantos exércitos deseja avançar?</p>
                <input
                  type="range"
                  min={game.pendingConquest.minMove}
                  max={game.pendingConquest.maxMove}
                  bind:value={sliderArmies}
                />
                <button class="primary" onclick={() => sendAction({ type: "occupy", armies: sliderArmies })}>
                  Avançar {sliderArmies} exército(s)
                </button>
              </div>

            {:else if game.phase === "deploy"}
              <p>Tropas para posicionar: <strong>{myPlayerState?.unplacedArmies ?? 0}</strong></p>
              <small class="subtitle">Clique em um território seu no mapa para posicionar.</small>
              {#if selectedFromId}
                <div class="control-group">
                  <p>Posicionar em <strong>{territoryById.get(selectedFromId)?.namePt}</strong>:</p>
                  <input
                    type="range"
                    min="1"
                    max={myPlayerState?.unplacedArmies ?? 1}
                    bind:value={sliderArmies}
                  />
                  <button class="primary" onclick={confirmDeploy}>
                    Confirmar +{sliderArmies}
                  </button>
                </div>
              {/if}

            {:else if game.phase === "attack"}
              <small class="subtitle">
                1. Clique no seu território atacante (mín. 2 tropas).<br />
                2. Clique no território inimigo vizinho.
              </small>
              {#if selectedFromId}
                <p>Origem: <strong>{territoryById.get(selectedFromId)?.namePt}</strong></p>
              {/if}
              {#if selectedToId}
                <p>Alvo: <strong>{territoryById.get(selectedToId)?.namePt}</strong></p>
                <button class="danger full-btn" onclick={confirmAttack}>
                  🎲 Rolar Dados de Ataque!
                </button>
              {/if}
              <button class="full-btn" onclick={() => sendAction({ type: "end_attack" })}>
                ➡️ Encerrar Ataques (Ir para Remanejamento)
              </button>

            {:else if game.phase === "maneuver"}
              <small class="subtitle">Mova exércitos entre territórios vizinhos seus ou encerre o turno.</small>
              {#if selectedFromId && selectedToId}
                {@const fromT = game.territories[selectedFromId]}
                {@const maxM = Math.max(1, fromT.armies - fromT.movedInArmies - 1)}
                <div class="control-group">
                  <p>Mover de {territoryById.get(selectedFromId)?.namePt} para {territoryById.get(selectedToId)?.namePt}:</p>
                  <input type="range" min="1" max={maxM} bind:value={sliderArmies} />
                  <button class="primary" onclick={confirmManeuver}>Mover {sliderArmies}</button>
                </div>
              {/if}
              <button class="primary full-btn" onclick={() => sendAction({ type: "end_turn" })}>
                ✅ Finalizar Turno
              </button>
            {/if}
          {:else}
            <p class="subtitle">Aguardando jogada de <strong>{currentTurnPlayer?.name}</strong>...</p>
          {/if}

          {#if game.lastCombat}
            <div class="dice-box">
              <span>🔴 ATQ: [{game.lastCombat.attackerDice.join(", ")}]</span>
              <span>⚪ DEF: [{game.lastCombat.defenderDice.join(", ")}]</span>
            </div>
          {/if}
        </div>

        <!-- Battle Log + Chat -->
        <div class="panel-box log-box">
          <h3>📜 Diário de Guerra & Chat</h3>
          <div class="log-entries">
            {#each game.log.slice(-18) as entry}
              <div class="log-line">{entry}</div>
            {/each}
          </div>
          <div class="join-row">
            <input
              bind:value={chatInput}
              placeholder="Mensagem para a sala..."
              onkeydown={(e) => e.key === "Enter" && sendChat()}
            />
            <button onclick={sendChat}>Enviar</button>
          </div>
        </div>
      </aside>
    </div>
  {/if}
</main>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: rgba(17, 24, 39, 0.92);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .emblem {
    font-size: 1.75rem;
  }
  .brand h1 {
    font-size: 1.25rem;
    letter-spacing: 0.1em;
  }
  .brand small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .room-pill {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .turn-badge {
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    border: 2px solid var(--accent);
    background: var(--bg-card);
    font-size: 0.85rem;
  }
  .alert-error {
    background: rgba(239, 68, 68, 0.2);
    border-bottom: 1px solid var(--danger);
    color: #fecaca;
    padding: 0.6rem 1.5rem;
    text-align: center;
    font-weight: 600;
  }
  .card-center {
    max-width: 520px;
    width: 92%;
    margin: 3.5rem auto;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .subtitle {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .join-row, .actions-row {
    display: flex;
    gap: 0.6rem;
  }
  .join-row input {
    flex: 1;
  }
  .player-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .player-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--bg-card);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: inline-block;
  }
  .tag {
    font-size: 0.7rem;
    background: #334155;
    padding: 0.15rem 0.45rem;
    border-radius: 0.3rem;
  }
  .color-picker {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .color-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    padding: 0;
  }
  .war-room {
    display: grid;
    grid-template-columns: 1fr 370px;
    gap: 1rem;
    padding: 1rem;
    flex: 1;
  }
  @media (max-width: 1024px) {
    .war-room {
      grid-template-columns: 1fr;
    }
  }
  .map-panel {
    background: #080d1a;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .board-svg {
    width: 100%;
    height: auto;
    max-height: 78vh;
  }
  .territory-node {
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .territory-node:hover path {
    filter: brightness(1.18);
  }
  .continent-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-around;
    gap: 0.5rem;
    padding: 0.55rem;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .panel-box {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .panel-box h3 {
    font-size: 0.95rem;
  }
  .general-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .general-row.active {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid var(--accent);
  }
  .general-row.eliminated {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .g-name {
    flex: 1;
    font-weight: 600;
  }
  .row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .objective-text {
    background: #1e293b;
    border-left: 3px solid var(--gold);
    padding: 0.55rem;
    font-size: 0.85rem;
    border-radius: 0.3rem;
  }
  .cards-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }
  .card-chip {
    background: var(--bg-card);
    border: 1px solid var(--border);
    padding: 0.2rem 0.45rem;
    border-radius: 0.35rem;
    font-size: 0.75rem;
  }
  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: var(--bg-card);
    padding: 0.6rem;
    border-radius: 0.5rem;
  }
  .full-btn {
    width: 100%;
    margin-top: 0.25rem;
  }
  .dice-box {
    display: flex;
    justify-content: space-between;
    background: #0f172a;
    padding: 0.45rem 0.65rem;
    border-radius: 0.4rem;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .log-box {
    flex: 1;
  }
  .log-entries {
    max-height: 170px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: #cbd5e1;
    background: #090d16;
    padding: 0.5rem;
    border-radius: 0.4rem;
  }
</style>
