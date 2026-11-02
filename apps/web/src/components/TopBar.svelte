<script lang="ts">
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../i18n/index.svelte";
  import {
    getTerritoryName,
    getContinentName,
    getSubregionName,
    getObjectiveDescription,
  } from "../i18n/content.svelte";
  import { sound } from "../audio.js";
  import { ui } from "../lib/ui.svelte";
  import { CLASSIC_MAP, ASIA_SUBREGIONS } from "@hegemonia/maps";
  import {
    calculateTurnEconomy,
    DEFAULT_MARKET_CONFIG,
    findValidTradeTriplet,
    getTradeBonusArmies,
    playerHasMarket,
  } from "@hegemonia/engine";
  import type {
    GameState,
    PlayerColor,
    PlayerState,
    ResourceType,
  } from "@hegemonia/shared";
  import type { BaseMapMode, MapOverlays } from "../lib/map-preferences";

  const COLOR_HEX: Record<PlayerColor, string> = {
    red: "#ef4444",
    blue: "#3b82f6",
    green: "#22c55e",
    yellow: "#eab308",
    purple: "#a855f7",
    orange: "#f97316",
  };

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

  interface PlayerMetric {
    player: PlayerState;
    terrCount: number;
    totalArmies: number;
    sharePct: number;
  }

  interface Props {
    game: GameState;
    roomCode: string;
    myPlayerId: string | null;
    myPlayerState: PlayerState | undefined;
    isMyTurn: boolean;
    currentTurnPlayer: PlayerState | null;
    remainingSeconds: number;
    playerMetrics: PlayerMetric[];
    isImmersiveMode?: boolean;
    hudVisibility: {
      topBanner: boolean;
      continents: boolean;
      bottomDock: boolean;
      warJournal: boolean;
      mapControls: boolean;
      recon: boolean;
    };
    baseMapMode?: BaseMapMode;
    overlays?: MapOverlays;
    mapMode?: "cartographic" | "geopolitical" | "regional" | "economic";
    cleanMapMode: boolean;
    highlightObjectiveTerritories: boolean;
    activeRightDrawer?: "cards" | "objective" | "audio" | "market" | null;
    showHudManager?: boolean;
    objectiveProgress: { owned: number; total: number; pct: number } | null;
    toggleImmersiveMode: () => void;
    toggleHudElement: (key: any) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
    leaveCurrentRoom: () => void;
    sendAction: (action: any) => void;
  }

  let {
    game,
    roomCode,
    myPlayerId,
    myPlayerState,
    isMyTurn,
    currentTurnPlayer,
    remainingSeconds,
    playerMetrics,
    isImmersiveMode = false,
    hudVisibility,
    baseMapMode = $bindable("cartographic"),
    overlays = $bindable({ regional: false, economic: false }),
    mapMode = $bindable(),
    cleanMapMode = $bindable(),
    highlightObjectiveTerritories = $bindable(),
    activeRightDrawer = $bindable(null),
    showHudManager = $bindable(false),
    objectiveProgress,
    toggleImmersiveMode,
    toggleHudElement,
    zoomIn,
    zoomOut,
    resetZoom,
    leaveCurrentRoom,
    sendAction,
  }: Props = $props();

  let activeDiplomacyTargetId = $state<string | null>(null);
  let showContinents = $state(false);
  let marketBatchQty = $state(1);

  // HEGEM-62: Backward compatibility bridge for callers using legacy mapMode
  $effect(() => {
    if (mapMode !== undefined) {
      mapMode = overlays.economic
        ? "economic"
        : overlays.regional
          ? "regional"
          : baseMapMode;
    }
  });

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

  let validTradeTriplet = $derived(
    myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null
  );

  let nextTradeBonus = $derived(
    game ? getTradeBonusArmies(game.tradeCount) : 4
  );

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

  function toggleRightDrawer(drawer: "cards" | "objective" | "audio" | "market") {
    sound.playClick();
    showHudManager = false;
    activeRightDrawer = activeRightDrawer === drawer ? null : drawer;
    if (activeRightDrawer === "objective") {
      highlightObjectiveTerritories = true;
    }
  }

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

  function handleProposeTreaty(targetPlayerId: string, type: "alliance" | "nap") {
    sendAction({
      type: "propose_treaty",
      targetPlayerId,
      treatyType: type,
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
</script>

<!-- REAL-TIME TREATY PROPOSALS TOAST -->
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
    <div class="world-tension-wrap" data-testid="world-tension-badge" title="Tensão Mundial: {game.worldTension ?? 0}% (Alianças Militares em 50%)">
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
                <span title="Infâmia do General" class="stat-pill infamy-pill"><Icon name="infamy" size={11} /> {m.player.infamy}%</span>
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
        <Icon name={showContinents ? "chevron-up" : "chevron-down"} size={14} />
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
          data-testid="btn-open-cards"
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
          data-testid="btn-open-objective"
          class:active={activeRightDrawer === "objective"}
          onclick={() => toggleRightDrawer("objective")}
          title={t("secret_objective_label")}
        >
          <Icon name="target" size={14} /> {t("secret_objective_label")}
        </button>

        <button
          class="hud-btn"
          data-testid="btn-open-market"
          class:highlight={Boolean(myHasMarket && isMyTurn)}
          class:active={activeRightDrawer === "market"}
          onclick={() => toggleRightDrawer("market")}
          title={t("market_btn_open")}
        >
          <Icon name="market" size={14} /> {t("market_btn_open")}
        </button>

        <button
          class="hud-btn"
          data-testid="btn-open-audio"
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
        <div class="econ-pill money" data-testid="res-money" title={t("res_money")}>
          <Icon name="coins" size={13} />
          <span class="econ-val">${res.money}</span>
          {#if myEconomyIncome && myEconomyIncome.netMoney > 0}
            <span class="econ-delta">+{myEconomyIncome.netMoney}</span>
          {/if}
        </div>
        <div class="econ-pill steel" data-testid="res-steel" title={t("res_steel")}>
          <Icon name="steel" size={13} />
          <span class="econ-val">{res.steel}</span>
          {#if myEconomyIncome && myEconomyIncome.steel > 0}
            <span class="econ-delta">+{myEconomyIncome.steel}</span>
          {/if}
        </div>
        <div class="econ-pill oil" data-testid="res-oil" title={t("res_oil")}>
          <Icon name="oil" size={13} />
          <span class="econ-val">{res.oil}</span>
          {#if myEconomyIncome && myEconomyIncome.oil > 0}
            <span class="econ-delta">+{myEconomyIncome.oil}</span>
          {/if}
        </div>
        <div class="econ-pill gold" data-testid="res-gold" title={t("res_gold")}>
          <Icon name="gold" size={13} />
          <span class="econ-val">{res.gold}</span>
          {#if myEconomyIncome && myEconomyIncome.gold > 0}
            <span class="econ-delta">+{myEconomyIncome.gold}</span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Map Mode Switcher & Overlays (HEGEM-62) + Camera Controls -->
    {#if hudVisibility.mapControls}
      <div class="map-mode-bar">
        <!-- Group 1: Base Modes (Segmented Control) -->
        <div class="mode-group base-group" title={t("map_base_label")}>
          <span class="group-label">{t("map_base_label")}</span>
          <div class="segmented-control">
            <button
              class="mode-btn base-btn"
              class:active={baseMapMode === "cartographic"}
              onclick={() => (baseMapMode = "cartographic")}
              title={t("map_mode_cartographic_title")}
            >
              {t("map_mode_cartographic")}
            </button>
            <button
              class="mode-btn base-btn"
              class:active={baseMapMode === "geopolitical"}
              onclick={() => (baseMapMode = "geopolitical")}
              title={t("map_mode_geopolitical_title")}
            >
              {t("map_mode_geopolitical")}
            </button>
          </div>
        </div>

        <div class="mode-divider"></div>

        <!-- Group 2: Overlays (Toggles + Clear) -->
        <div class="mode-group overlay-group" title={t("map_overlays_label")}>
          <span class="group-label">{t("map_overlays_label")}</span>
          <div class="toggle-buttons">
            <button
              class="mode-btn overlay-btn"
              class:active={overlays.regional}
              onclick={() => (overlays.regional = !overlays.regional)}
              title={t("map_mode_regional_title")}
            >
              <Icon name="globe" size={12} /> {t("map_mode_regional")}
            </button>
            <button
              class="mode-btn overlay-btn"
              class:active={overlays.economic}
              onclick={() => (overlays.economic = !overlays.economic)}
              title={t("map_mode_economic_title")}
            >
              <Icon name="coins" size={12} /> {t("map_mode_economic")}
            </button>
            {#if overlays.regional || overlays.economic}
              <button
                class="mode-btn clear-layers-btn"
                onclick={() => {
                  overlays.regional = false;
                  overlays.economic = false;
                }}
                title={t("map_clear_overlays_title")}
              >
                <Icon name="close" size={10} /> {t("map_clear_overlays")}
              </button>
            {/if}
          </div>
        </div>

        <div class="mode-divider"></div>

        <!-- Group 3: Display & Zoom Controls -->
        <div class="mode-group display-group">
          <button
            class="mode-btn clean-mode-tab"
            class:active={cleanMapMode}
            onclick={() => (cleanMapMode = !cleanMapMode)}
            title={t("map_mode_clean_title")}
          >
            <Icon name="eye" size={12} /> {cleanMapMode ? t("mode_clean_active") : t("mode_clean_label")}
          </button>

          <div class="zoom-cluster">
            <button class="tool-btn" onclick={zoomIn} title="Aproximar (+)">+</button>
            <button class="tool-btn" onclick={zoomOut} title="Afastar (Q)">-</button>
            <button class="tool-btn" onclick={resetZoom} title="Centralizar Mapa">RST</button>
          </div>
        </div>
      </div>

      <!-- Contextual Overlay Indicator Chip Bar -->
      {#if (overlays.regional || overlays.economic) && !cleanMapMode}
        <div class="contextual-map-legend">
          {#if overlays.regional}
            <span class="legend-chip regional-chip">
              <span class="chip-dot regional-dot"></span>
              {t("map_mode_regional")}
            </span>
          {/if}
          {#if overlays.economic}
            <span class="legend-chip econ-chip">
              <span class="chip-dot econ-dot"></span>
              {t("map_mode_economic")}
            </span>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Audio Equalizer Drawer (HEGEM-10: Independent Music + SFX Sliders + Master Mute) -->
    {#if activeRightDrawer === "audio"}
      <div class="floating-drawer music-drawer">
        <div class="drawer-header">
          <h4><Icon name="radio" size={15} /> Equalizador & Rádio Militar</h4>
          <button class="btn-close" onclick={() => (activeRightDrawer = null)} aria-label={t("close")}><Icon name="close" size={14} /></button>
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

          <div class="combat-anim-settings">
            <span class="combat-anim-label"><Icon name="swords" size={12} /> {t("settings_combat_anim_label")}:</span>
            <div class="combat-anim-btn-group">
              <button
                class="combat-anim-opt"
                class:selected={ui.combatAnimationSpeed === "normal"}
                onclick={() => ui.setCombatAnimationSpeed("normal")}
              >
                {t("settings_combat_anim_normal")}
              </button>
              <button
                class="combat-anim-opt"
                class:selected={ui.combatAnimationSpeed === "fast"}
                onclick={() => ui.setCombatAnimationSpeed("fast")}
              >
                {t("settings_combat_anim_fast")}
              </button>
              <button
                class="combat-anim-opt"
                class:selected={ui.combatAnimationSpeed === "off"}
                onclick={() => ui.setCombatAnimationSpeed("off")}
              >
                {t("settings_combat_anim_off")}
              </button>
            </div>
            <small class="combat-anim-hint">{t("settings_combat_anim_hint")}</small>
          </div>
        </div>
      </div>
    {/if}

    <!-- Secret Objective Drawer -->
    {#if activeRightDrawer === "objective" && myPlayerState}
      <div class="floating-drawer objective-drawer">
        <div class="drawer-header">
          <h4><Icon name="target" size={15} /> Diretriz Secreta de Alto Comando</h4>
          <button class="btn-close" onclick={() => (activeRightDrawer = null)} aria-label={t("close")}><Icon name="close" size={14} /></button>
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
          <button class="btn-close" onclick={() => (showHudManager = false)} aria-label={t("close")}><Icon name="close" size={14} /></button>
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

        <div class="combat-anim-settings">
          <span class="combat-anim-label"><Icon name="swords" size={12} /> {t("settings_combat_anim_label")}:</span>
          <div class="combat-anim-btn-group">
            <button
              class="combat-anim-opt"
              class:selected={ui.combatAnimationSpeed === "normal"}
              onclick={() => ui.setCombatAnimationSpeed("normal")}
            >
              {t("settings_combat_anim_normal")}
            </button>
            <button
              class="combat-anim-opt"
              class:selected={ui.combatAnimationSpeed === "fast"}
              onclick={() => ui.setCombatAnimationSpeed("fast")}
            >
              {t("settings_combat_anim_fast")}
            </button>
            <button
              class="combat-anim-opt"
              class:selected={ui.combatAnimationSpeed === "off"}
              onclick={() => ui.setCombatAnimationSpeed("off")}
            >
              {t("settings_combat_anim_off")}
            </button>
          </div>
          <small class="combat-anim-hint">{t("settings_combat_anim_hint")}</small>
        </div>
      </div>
    {/if}

    <!-- Supply Cards & Escalation Drawer -->
    {#if activeRightDrawer === "cards" && myPlayerState}
      <div class="floating-drawer cards-drawer">
        <div class="drawer-header">
          <h4><Icon name="cards" size={15} /> {t("cards_count", { count: myPlayerState.cards.length })}</h4>
          <button class="btn-close" onclick={() => (activeRightDrawer = null)} aria-label={t("close")}><Icon name="close" size={14} /></button>
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
      <div class="floating-drawer market-drawer" data-testid="market-modal">
        <div class="drawer-header">
          <h4><Icon name="market" size={15} /> {t("market_modal_title")}</h4>
          <button class="btn-close" onclick={() => (activeRightDrawer = null)} aria-label={t("close")}><Icon name="close" size={14} /></button>
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
                    data-testid="market-buy-{res}"
                    disabled={!canAffordBuy}
                    onclick={() => handleMarketTrade(res, "buy")}
                    title={!isMyTurn ? "Apenas no seu turno" : !canAffordBuy ? "Dinheiro insuficiente" : ""}
                  >
                    {t("market_btn_buy")} {marketBatchQty}x (-${buyCost})
                  </button>
                  <button
                    class="btn-trade sell"
                    data-testid="market-sell-{res}"
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

<style>
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

  /* Real-time Treaty Toast */
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
    justify-content: space-between;
    gap: 0.45rem;
  }
  .hud-mini-logo {
    width: 26px;
    height: 26px;
    object-fit: contain;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.7));
  }
  .brand-lockup {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .brand-lockup strong {
    font-family: var(--font-tactical);
    font-size: 0.88rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #fef08a;
  }
  .brand-lockup small {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: #94a3b8;
    letter-spacing: 0.05em;
  }
  .round-tag {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    background: rgba(234, 179, 8, 0.14);
    border: 1px solid rgba(234, 179, 8, 0.35);
    color: #fef08a;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .round1-treaty-banner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(59, 130, 246, 0.18);
    border: 1px solid rgba(96, 165, 250, 0.35);
    color: #93c5fd;
    padding: 0.32rem 0.55rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .world-tension-wrap {
    background: rgba(5, 9, 18, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 5px;
    padding: 0.38rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .tension-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.68rem;
    font-weight: 700;
  }
  .tension-title {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: #94a3b8;
    letter-spacing: 0.05em;
  }
  .tension-value {
    font-family: var(--font-mono);
    color: #fef08a;
  }
  .tension-value.high-tension {
    color: #ef4444;
    text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  }
  .tension-gauge-bar {
    position: relative;
    height: 6px;
    background: rgba(15, 23, 42, 0.85);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .tension-gauge-fill {
    height: 100%;
    background: #eab308;
    transition: width 0.4s ease;
  }
  .tension-gauge-fill.elevated {
    background: #f97316;
  }
  .tension-gauge-fill.critical {
    background: #ef4444;
  }
  .tension-threshold-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #38bdf8;
    z-index: 2;
  }
  .tension-subtext {
    font-size: 0.62rem;
    color: #64748b;
    display: flex;
    justify-content: space-between;
  }
  .tension-subtext .unlocked-text {
    color: #38bdf8;
    font-weight: 600;
  }

  /* Hegemony Bar */
  .hegemony-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .hegemony-bar-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.64rem;
    color: #94a3b8;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .hegemony-bar {
    height: 7px;
    border-radius: 999px;
    overflow: hidden;
    display: flex;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .hegemony-segment {
    height: 100%;
    transition: width 0.3s ease;
  }

  /* Generals Table */
  .generals-table {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
    max-height: calc(100vh - 350px);
    overflow-y: auto;
    padding-right: 0.2rem;
  }
  .general-row {
    background: rgba(5, 9, 18, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-left: 3px solid #64748b;
    border-radius: 4px;
    padding: 0.32rem 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
  }
  .general-row.active-turn {
    background: rgba(234, 179, 8, 0.12);
    border-color: rgba(234, 179, 8, 0.4);
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.15);
  }
  .general-row.eliminated {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .g-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .g-name {
    font-size: 0.74rem;
    font-weight: 600;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .you-badge {
    background: #3b82f6;
    color: #eff6ff;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.58rem;
    font-weight: 800;
  }
  .turn-indicator {
    color: #eab308;
    display: inline-flex;
  }
  .g-stats {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .stat-pill {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 0.64rem;
    padding: 0.1rem 0.32rem;
    border-radius: 3px;
    font-weight: 700;
  }
  .stat-pill.infamy-pill {
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.35);
  }
  .btn-diplomacy-icon {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    padding: 0.18rem 0.35rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .btn-diplomacy-icon.active {
    background: rgba(234, 179, 8, 0.25);
    border-color: #fde047;
    color: #fef08a;
  }

  /* Continents & Asian Sub-Regions Toggle */
  .continents-toggle-row {
    margin-top: 0.1rem;
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
    cursor: pointer;
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
    color: #cbd5e1;
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

  /* Diplomatic Dossier */
  .diplomacy-dossier {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 5px;
    padding: 0.5rem;
  }
  .btn-dossier-back {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .btn-dossier-back:hover {
    color: #f8fafc;
  }
  .dossier-target-card {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-left: 3px solid #64748b;
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .target-card-top {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .target-card-info strong {
    font-size: 0.8rem;
    color: #f8fafc;
  }
  .target-card-info small {
    display: block;
    font-size: 0.58rem;
    color: #94a3b8;
    letter-spacing: 0.05em;
  }
  .infamy-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .infamy-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.62rem;
    color: #94a3b8;
    font-weight: 700;
  }
  .infamy-value.high-infamy {
    color: #ef4444;
  }
  .infamy-bar {
    position: relative;
    height: 5px;
    background: rgba(5, 9, 18, 0.9);
    border-radius: 999px;
    overflow: hidden;
  }
  .infamy-fill {
    height: 100%;
    background: #eab308;
  }
  .infamy-fill.bilateral-threat {
    background: #f97316;
  }
  .infamy-fill.grand-threat {
    background: #ef4444;
  }
  .infamy-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #ffffff;
  }
  .dossier-section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .dossier-section-title {
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    color: #eab308;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: 0.05em;
  }
  .treaty-active-box {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.35);
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .treaty-active-badge {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: #6ee7b7;
  }
  .treaty-rule-desc {
    margin: 0;
    font-size: 0.64rem;
    color: #a7f3d0;
  }
  .btn-treaty-break {
    background: rgba(220, 38, 38, 0.25);
    border: 1px solid #ef4444;
    color: #fca5a5;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.28rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .btn-treaty-break:hover {
    background: #dc2626;
    color: #ffffff;
  }
  .treaty-pending-box {
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    font-size: 0.68rem;
    color: #fef08a;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn-ghost-sm {
    background: none;
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    font-size: 0.62rem;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .treaty-incoming-box {
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .treaty-incoming-box strong {
    font-size: 0.72rem;
    color: #93c5fd;
  }
  .treaty-incoming-actions {
    display: flex;
    gap: 0.35rem;
  }
  .btn-tactical-success {
    background: #16a34a;
    border: none;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    padding: 0.22rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .btn-tactical-danger {
    background: #dc2626;
    border: none;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 800;
    padding: 0.22rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .treaty-propose-box {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .btn-treaty-propose {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .btn-treaty-propose:hover:not(:disabled) {
    background: rgba(30, 41, 59, 0.95);
    border-color: #fde047;
    color: #fef08a;
  }
  .btn-treaty-propose.btn-disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .coalition-active-box {
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .coalition-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.7rem;
    font-weight: 800;
    color: #fca5a5;
  }
  .coalition-members {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .coalition-member-tag {
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid #64748b;
    border-radius: 3px;
    padding: 0.12rem 0.35rem;
    font-size: 0.64rem;
    color: #e2e8f0;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .btn-coalition-join {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border: 1px solid #f87171;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.3rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .coalition-full-note {
    margin: 0;
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .coalition-joined-badge {
    font-size: 0.66rem;
    color: #6ee7b7;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .coalition-call-box {
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .coalition-call-desc {
    margin: 0;
    font-size: 0.64rem;
    color: #fef08a;
  }
  .btn-coalition-declare {
    background: linear-gradient(135deg, #ea580c, #c2410c);
    border: 1px solid #fdba74;
    color: #ffffff;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.3rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .coalition-locked-box {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    font-size: 0.62rem;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .hegemon-bonus-banner {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 4px;
    padding: 0.32rem 0.5rem;
    font-size: 0.66rem;
    color: #fef08a;
    font-weight: 700;
  }

  /* Top-Center Banner */
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
    gap: 0.45rem;
  }
  .hq-name {
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.84rem;
    color: #f8fafc;
  }
  .reserve-badge {
    background: rgba(234, 179, 8, 0.16);
    border: 1px solid rgba(234, 179, 8, 0.45);
    color: #fef08a;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.18rem 0.45rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .hq-buttons {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    flex-wrap: wrap;
  }
  .hud-btn {
    background: rgba(15, 23, 42, 0.88);
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.28rem 0.52rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    transition: all 0.15s ease;
  }
  .hud-btn:hover {
    background: rgba(30, 41, 59, 0.95);
    border-color: rgba(234, 179, 8, 0.5);
    color: #fef08a;
  }
  .hud-btn.active {
    background: rgba(234, 179, 8, 0.22);
    border-color: #fde047;
    color: #fef08a;
  }
  .hud-btn.highlight {
    border-color: #eab308;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.45);
    animation: pulseBadge 1.8s infinite;
  }
  .hud-btn.mandatory {
    border-color: #ef4444;
    color: #fca5a5;
    animation: pulseAlert 1.2s infinite;
  }
  @keyframes pulseBadge {
    0%, 100% { box-shadow: 0 0 4px rgba(234, 179, 8, 0.3); }
    50% { box-shadow: 0 0 14px rgba(234, 179, 8, 0.75); }
  }
  @keyframes pulseAlert {
    0%, 100% { box-shadow: 0 0 4px rgba(239, 68, 68, 0.4); }
    50% { box-shadow: 0 0 14px rgba(239, 68, 68, 0.85); }
  }
  .btn-exit-room {
    color: #94a3b8;
  }

  /* Economy Bar */
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

  /* Map Mode Bar & Overlays (HEGEM-62) */
  .map-mode-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    padding-top: 0.25rem;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
  }
  .mode-group {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .group-label {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    font-weight: 700;
    font-family: var(--font-tactical);
    user-select: none;
  }
  .segmented-control,
  .toggle-buttons {
    display: inline-flex;
    gap: 0.2rem;
    align-items: center;
  }
  .mode-divider {
    width: 1px;
    height: 16px;
    background: rgba(148, 163, 184, 0.2);
  }
  .mode-btn {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #94a3b8;
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 700;
    padding: 0.2rem 0.42rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    transition: all 0.15s ease;
  }
  .mode-btn:hover {
    color: #f8fafc;
    border-color: rgba(234, 179, 8, 0.4);
  }
  .mode-btn.active {
    background: rgba(234, 179, 8, 0.2);
    border-color: #fde047;
    color: #fef08a;
  }
  .mode-btn.overlay-btn.active {
    background: rgba(56, 189, 248, 0.16);
    border-color: #38bdf8;
    color: #bae6fd;
  }
  .mode-btn.clear-layers-btn {
    font-size: 0.6rem;
    padding: 0.18rem 0.35rem;
    border: 1px dashed rgba(248, 113, 113, 0.4);
    color: #fca5a5;
    background: rgba(15, 23, 42, 0.6);
  }
  .mode-btn.clear-layers-btn:hover {
    border-color: #ef4444;
    color: #fee2e2;
    background: rgba(239, 68, 68, 0.2);
  }
  .mode-btn.clean-mode-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .zoom-cluster {
    display: flex;
    gap: 0.2rem;
  }
  .contextual-map-legend {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0.5rem;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 3px;
    font-size: 0.62rem;
    font-family: var(--font-tactical);
    color: #94a3b8;
    animation: fadeIn 0.15s ease;
  }
  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 600;
  }
  .chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .regional-dot {
    background: #38bdf8;
    box-shadow: 0 0 4px #38bdf8;
  }
  .econ-dot {
    background: #f59e0b;
    box-shadow: 0 0 4px #f59e0b;
  }
  .tool-btn {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    min-width: 24px;
    height: 22px;
    padding: 0 0.3rem;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tool-btn:hover {
    border-color: #fde047;
    color: #fef08a;
  }

  /* Floating Drawers */
  .floating-drawer {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background: linear-gradient(180deg, rgba(11, 18, 33, 0.97) 0%, rgba(6, 11, 21, 0.98) 100%);
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 7px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(16px);
    padding: 0.65rem 0.8rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    padding-bottom: 0.35rem;
  }
  .drawer-header h4 {
    margin: 0;
    font-size: 0.78rem;
    color: #fef08a;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .btn-close {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .btn-close:hover {
    color: #f8fafc;
  }

  /* Music Drawer */
  .music-drawer {
    width: 320px;
  }
  .radio-controls {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .radio-top-btns {
    display: flex;
    gap: 0.35rem;
  }
  .eq-slider-block {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .eq-label-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.66rem;
    color: #cbd5e1;
  }
  .eq-slider-block input[type="range"] {
    width: 100%;
    accent-color: #eab308;
  }
  .track-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.66rem;
    color: #94a3b8;
  }
  .track-list-scroll {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 120px;
    overflow-y: auto;
  }
  .track-option {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.18);
    color: #cbd5e1;
    padding: 0.25rem 0.4rem;
    border-radius: 3px;
    font-size: 0.64rem;
    text-align: left;
    cursor: pointer;
  }
  .track-option:hover {
    background: rgba(30, 41, 59, 0.8);
    color: #f8fafc;
  }
  .track-option.selected {
    background: rgba(234, 179, 8, 0.2);
    border-color: #fde047;
    color: #fef08a;
    font-weight: 700;
  }

  /* Objective Drawer */
  .objective-drawer {
    width: 320px;
  }
  .objective-body {
    margin: 0;
    font-size: 0.74rem;
    color: #f8fafc;
    line-height: 1.4;
  }
  .objective-progress-box {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    background: rgba(15, 23, 42, 0.7);
    padding: 0.35rem 0.45rem;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.18);
  }
  .progress-bar-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.66rem;
    color: #cbd5e1;
  }
  .progress-track {
    height: 6px;
    background: rgba(5, 9, 18, 0.8);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #34d399);
  }
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
  .objective-note {
    font-size: 0.62rem;
    color: #64748b;
  }

  /* HUD Drawer */
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

  /* Cards Drawer */
  .cards-drawer {
    width: 320px;
  }
  .escalation-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(234, 179, 8, 0.14);
    border: 1px solid rgba(234, 179, 8, 0.35);
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    color: #fef08a;
  }
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.35rem;
    max-height: 160px;
    overflow-y: auto;
  }
  .card-item {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 4px;
    padding: 0.35rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .card-symbol {
    font-size: 0.76rem;
    font-weight: 700;
    color: #facc15;
  }
  .card-territory {
    font-size: 0.65rem;
    color: #cbd5e1;
  }
  .empty-cards-note {
    grid-column: 1 / -1;
    margin: 0.4rem 0;
    font-size: 0.7rem;
    color: #94a3b8;
    text-align: center;
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

  /* Market Drawer */
  .market-drawer {
    width: 360px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  }
  .drawer-sub {
    margin: 0;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .market-locked-box {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    padding: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.72rem;
    color: #94a3b8;
  }
  .market-active-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.35);
    padding: 0.32rem 0.5rem;
    border-radius: 4px;
  }
  .market-status-tag {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: #6ee7b7;
    font-weight: 700;
  }
  .market-batch-selector {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .batch-label {
    font-size: 0.64rem;
    color: #94a3b8;
  }
  .batch-buttons {
    display: flex;
    gap: 0.15rem;
  }
  .batch-btn {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    padding: 0.12rem 0.35rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .batch-btn.active {
    background: #eab308;
    color: #090d16;
    font-weight: 700;
  }
  .market-commodities-grid {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .commodity-card {
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 5px;
    padding: 0.45rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
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
    font-size: 0.76rem;
    color: #f8fafc;
  }
  .res-stock-count {
    font-size: 0.66rem;
    color: #94a3b8;
  }
  .commodity-prices {
    display: flex;
    gap: 0.4rem;
  }
  .price-pill {
    flex: 1;
    background: rgba(5, 9, 18, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    display: flex;
    justify-content: space-between;
    font-size: 0.66rem;
  }
  .price-pill.buy .pill-val {
    color: #f87171;
    font-weight: 700;
  }
  .price-pill.sell .pill-val {
    color: #34d399;
    font-weight: 700;
  }
  .commodity-actions {
    display: flex;
    gap: 0.35rem;
  }
  .btn-trade {
    flex: 1;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.28rem 0.45rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-trade.buy {
    background: rgba(220, 38, 38, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
  }
  .btn-trade.buy:hover:not(:disabled) {
    background: #dc2626;
    color: #ffffff;
  }
  .btn-trade.sell {
    background: rgba(16, 185, 129, 0.2);
    border: 1px solid #10b981;
    color: #6ee7b7;
  }
  .btn-trade.sell:hover:not(:disabled) {
    background: #10b981;
    color: #ffffff;
  }
  .btn-trade:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .drawer-section-divider {
    height: 1px;
    background: rgba(148, 163, 184, 0.15);
    margin: 0.2rem 0;
  }
  .routes-section, .border-trade-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .routes-header h5 {
    margin: 0;
    font-size: 0.74rem;
    color: #fef08a;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .routes-hint {
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .routes-list, .pending-proposals-list, .eligible-partners-list {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }
  .route-item {
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    padding: 0.3rem 0.45rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .route-info {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.68rem;
    color: #e2e8f0;
  }
  .route-badge {
    font-size: 0.6rem;
    background: rgba(52, 211, 153, 0.2);
    color: #6ee7b7;
    padding: 0.08rem 0.3rem;
    border-radius: 3px;
    margin-left: 0.3rem;
  }
  .route-actions {
    display: flex;
    gap: 0.25rem;
  }
  .btn-route {
    font-size: 0.62rem;
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .btn-route.accept {
    background: #16a34a;
    border: none;
    color: #ffffff;
  }
  .btn-route.reject {
    background: #dc2626;
    border: none;
    color: #ffffff;
  }
  .partner-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 3px;
    padding: 0.25rem 0.4rem;
  }
  .partner-name {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.68rem;
    color: #e2e8f0;
  }
  .btn-propose-route {
    background: rgba(234, 179, 8, 0.18);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #fef08a;
    font-size: 0.62rem;
    font-weight: 700;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    cursor: pointer;
  }
  .btn-propose-route:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .empty-routes-hint {
    margin: 0.2rem 0;
    font-size: 0.64rem;
    color: #64748b;
  }

  /* Utility Buttons */
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
    cursor: pointer;
  }
  .btn.primary-gold {
    background: linear-gradient(135deg, #eab308, #a16207);
    border: 1px solid #fef08a;
    color: #050911;
  }
  .btn.primary-gold:hover:not(:disabled) {
    background: linear-gradient(135deg, #fde047, #ca8a04);
    border-color: #ffffff;
    color: #050911;
    box-shadow: 0 6px 18px rgba(234, 179, 8, 0.4);
  }
  .btn.secondary {
    background: #1e293b;
    border: 1px solid #475569;
    color: #f8fafc;
  }
  .full-width {
    width: 100%;
  }

  .combat-anim-settings {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    padding-top: 0.45rem;
    margin-top: 0.25rem;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
  }
  .combat-anim-label {
    display: flex;
    align-items: center;
    gap: 0.32rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .combat-anim-btn-group {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }
  .combat-anim-opt {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.26);
    color: #cbd5e1;
    border-radius: 4px;
    padding: 0.28rem 0.3rem;
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.14s ease;
    text-align: center;
  }
  .combat-anim-opt:hover {
    border-color: rgba(250, 204, 21, 0.55);
    color: #f8fafc;
  }
  .combat-anim-opt.selected {
    background: rgba(234, 179, 8, 0.22);
    border-color: #eab308;
    color: #fef08a;
  }
  .combat-anim-hint {
    font-size: 0.6rem;
    color: #94a3b8;
    line-height: 1.3;
  }

  /* Responsive Adjustments */
  @media (max-height: 800px) {
    .continents-dropdown {
      max-height: 120px;
    }
    .floating-drawer {
      max-height: 185px;
    }
  }

  @media (max-width: 1180px) {
    .top-center-banner {
      max-width: 440px;
    }
  }

  @media (max-width: 1024px) {
    .top-left-panel {
      max-height: calc(100vh - 175px);
    }
    .top-center-banner {
      max-width: 380px;
      padding: 0.4rem 0.7rem;
    }
    .tc-directive {
      font-size: 0.72rem;
    }
    .tool-btn {
      min-width: 30px;
      height: 24px;
    }
  }

  @media (max-width: 820px) {
    .top-center-banner {
      max-width: 300px;
      padding: 0.35rem 0.55rem;
    }
    .tc-kicker {
      font-size: 0.58rem;
    }
    .tc-directive {
      font-size: 0.66rem;
    }
  }
</style>
