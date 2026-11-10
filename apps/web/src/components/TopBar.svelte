<script lang="ts">
  import FactionFlag from "./FactionFlag.svelte";
  import DoctrineCrest from "./DoctrineCrest.svelte";
  import Icon from "./Icon.svelte";
  import TacticalAlerts from "./TacticalAlerts.svelte";
  import { t } from "../i18n/index.svelte";
  import {
    getTerritoryName,
    getContinentName,
    getSubregionName,
    getObjectiveDescription,
    getFactionDoctrine,
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
  import {
    getMilitaryRank,
    type GameState,
    type PlayerColor,
    type PlayerState,
    type ResourceType,
  } from "@hegemonia/shared";
  import { auth } from "../lib/auth.svelte";
  import { tooltip } from "../lib/tooltip";
  import type { BaseMapMode, MapOverlays } from "../lib/map-preferences";

  const COLOR_HEX: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    dark_green: "#15803d",
    yellow: "#facc15",
    orange: "#f97316",
    pink: "#ec4899",
    purple: "#a855f7",
    black: "#21262B",
    white: "#F0F0F5",
  };

  const SOUNDTRACKS = [
    {
      id: "ambient_procedural",
      label: "Marcha Tática (Sintetizador Web Audio)",
    },
    {
      id: "track1.mp3",
      label: "Trilha Customizada Local (track1.mp3)",
    },
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
    onFocusTerritory?: (territoryId: string) => void;
    autoCameraFocus?: boolean;
    onToggleAutoCameraFocus?: (val: boolean) => void;
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
    onFocusTerritory,
    autoCameraFocus = true,
    onToggleAutoCameraFocus,
  }: Props = $props();

  let activeDiplomacyTargetId = $state<string | null>(null);
  let showContinents = $state(false);
  let showMobilizationPopup = $state(false);
  let marketBatchQty = $state(1);
  let showExitConfirmModal = $state(false);
  let botTakeoverMode = $state<"after_2_turns" | "immediate">("after_2_turns");

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
    game?.players.find((p) => p.id === activeDiplomacyTargetId) ?? null,
  );

  let incomingTreatyProposals = $derived(
    game?.treaties?.filter(
      (t) => t.status === "pending" && t.toPlayerId === myPlayerId,
    ) ?? [],
  );

  let targetTreatyWithMe = $derived.by(() => {
    if (!game || !activeDiplomacyTargetId || !myPlayerId) return null;
    return (
      game.treaties?.find(
        (t) =>
          t.status !== "broken" &&
          ((t.fromPlayerId === myPlayerId &&
            t.toPlayerId === activeDiplomacyTargetId) ||
            (t.fromPlayerId === activeDiplomacyTargetId &&
              t.toPlayerId === myPlayerId)),
      ) ?? null
    );
  });

  let activeCoalitionAgainstTarget = $derived(
    game?.coalitions?.find(
      (c) => c.targetPlayerId === activeDiplomacyTargetId,
    ) ?? null,
  );

  let inSameCoalitionWithTarget = $derived(
    Boolean(
      game &&
        myPlayerId &&
        activeDiplomacyTargetId &&
        (game.coalitions ?? []).some(
          (c) =>
            c.memberPlayerIds.includes(myPlayerId) &&
            c.memberPlayerIds.includes(activeDiplomacyTargetId!),
        ),
    ),
  );

  let myAlliesAndCoalitionPartners = $derived.by(() => {
    if (!game || !myPlayerId) return [];
    return game.players.filter((p) => {
      if (p.id === myPlayerId || p.eliminated) return false;
      const hasAlliedTreaty = (game.treaties ?? []).some(
        (tr) =>
          tr.status === "active" &&
          tr.type === "alliance" &&
          ((tr.fromPlayerId === myPlayerId && tr.toPlayerId === p.id) ||
            (tr.fromPlayerId === p.id && tr.toPlayerId === myPlayerId)),
      );
      const inCoalition = (game.coalitions ?? []).some(
        (c) =>
          c.memberPlayerIds.includes(myPlayerId) &&
          c.memberPlayerIds.includes(p.id),
      );
      return hasAlliedTreaty || inCoalition;
    });
  });

  let myHasCoalitionPartner = $derived(
    Boolean(
      game &&
        myPlayerId &&
        (game.coalitions ?? []).some(
          (c) =>
            c.memberPlayerIds.includes(myPlayerId) &&
            c.memberPlayerIds.length >= 2,
        ),
    ),
  );

  let myAircraftTerritoryId = $derived.by(() => {
    if (!game || !myPlayerId) return null;
    const found = Object.values(game.territories).find(
      (t) =>
        t.ownerId === myPlayerId &&
        (t.units?.aircraft ?? 0) >= 1 &&
        t.armies >= 2,
    );
    return found?.id ?? null;
  });

  let myEconomyIncome = $derived.by(() => {
    if (!game || !myPlayerId) return null;
    return calculateTurnEconomy(game, myPlayerId);
  });

  let validTradeTriplet = $derived(
    myPlayerState ? findValidTradeTriplet(myPlayerState.cards) : null,
  );

  let nextTradeBonus = $derived(
    game ? getTradeBonusArmies(game.tradeCount) : 4,
  );

  let myHasMarket = $derived(
    Boolean(game && myPlayerId && playerHasMarket(game, myPlayerId)),
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
              (tr.fromPlayerId === p.id && tr.toPlayerId === myPlayerId)),
        ) &&
        !(game.investmentRoutes ?? []).some(
          (ir) =>
            (ir.playerAId === myPlayerId && ir.playerBId === p.id) ||
            (ir.playerAId === p.id && ir.playerBId === myPlayerId),
        ),
    );
  });

  function toggleRightDrawer(
    drawer: "cards" | "objective" | "audio" | "market",
  ) {
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

  function handleMarketTrade(
    resource: ResourceType,
    operation: "buy" | "sell",
  ) {
    if (operation === "buy") {
      sound.playMarketBuy();
    } else {
      sound.playMarketSell();
    }
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

  function handleProposeTreaty(
    targetPlayerId: string,
    type: "alliance" | "nap",
  ) {
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

  function handleSendAllianceAid(
    targetPlayerId: string,
    payload: { money?: number; steel?: number; oil?: number; gold?: number },
  ) {
    sendAction({
      type: "send_alliance_aid",
      targetPlayerId,
      ...payload,
    });
  }

  function handleSendCoalitionAircraft(targetPlayerId: string) {
    if (!myAircraftTerritoryId) return;
    sendAction({
      type: "send_coalition_aircraft",
      targetPlayerId,
      fromTerritoryId: myAircraftTerritoryId,
      quantity: 1,
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
            {sender?.name ?? "General"} propôs um
            <strong
              >{prop.type === "alliance"
                ? "Tratado de Aliança Militar"
                : "Pacto de Não-Agressão (NAP)"}</strong
            >
          </span>
        </div>
        <div class="toast-actions">
          <button
            class="btn-toast-accept"
            onclick={() => handleAcceptTreaty(prop.id)}
          >
            <Icon name="check" size={12} /> Aceitar
          </button>
          <button
            class="btn-toast-reject"
            onclick={() => handleRejectTreaty(prop.id)}
          >
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
    <span class="card-corner tl"></span>
    <span class="card-corner tr"></span>
    <span class="card-corner bl"></span>
    <span class="card-corner br"></span>

    <div class="panel-header">
      <div class="brand-row">
        <div class="brand-identity">
          <div class="brand-emblem-frame">
            <img src="/hegemonia-logo.webp" alt="Hegemonia" class="hud-mini-logo" />
          </div>
          <div class="brand-lockup">
            <strong>HEGEMONIA</strong>
            <small><Icon name="compass" size={10} /> OPERAÇÃO {roomCode}</small>
          </div>
        </div>
        <span class="round-tag" title={t("round", { round: game.round })}>
          <Icon name="clock" size={11} />
          <span>{t("round", { round: game.round }).toUpperCase()}</span>
        </span>
      </div>
    </div>

    {#if game.round === 1}
      <div class="round1-treaty-banner">
        <div class="treaty-banner-icon">
          <Icon name="shield" size={14} />
        </div>
        <span>{t("banner_round1_treaty")}</span>
      </div>
    {/if}

    <!-- Global World Tension Gauge (One-way Escalation) -->
    <div
      class="world-tension-wrap"
      data-testid="world-tension-badge"
      title="Tensão Mundial: {game.worldTension ??
        0}% (Alianças Militares em 50%)"
    >
      <div class="tension-top-row">
        <span class="tension-title">
          <span class="tension-icon-box"><Icon name="globe" size={12} /></span>
          <span>TENSÃO MUNDIAL</span>
        </span>
        <strong
          class="tension-value"
          class:high-tension={(game.worldTension ?? 0) >= 50}
          >{game.worldTension ?? 0}%</strong
        >
      </div>
      <div class="tension-gauge-bar">
        <div
          class="tension-gauge-fill"
          class:critical={(game.worldTension ?? 0) >= 66}
          class:elevated={(game.worldTension ?? 0) >= 34}
          style="width: {game.worldTension ?? 0}%;"
        ></div>
        <div
          class="tension-threshold-marker"
          style="left: 50%;"
          title="Desbloqueio de Alianças Militares (50%)"
        ></div>
      </div>
      <div class="tension-subtext">
        {#if (game.worldTension ?? 0) < 50}
          <span><Icon name="lock" size={10} /> Alianças Militares bloqueadas (&ge; 50%)</span>
        {:else}
          <span class="unlocked-text"><Icon name="swords" size={10} /> Alianças Militares Desbloqueadas</span>
        {/if}
      </div>
    </div>

    {#if activeDiplomacyTarget}
      <!-- DOSSIÊ DIPLOMÁTICO VIEW -->
      <div class="diplomacy-dossier">
        <div class="dossier-header">
          <button
            class="btn-dossier-back"
            onclick={() => (activeDiplomacyTargetId = null)}
          >
            <Icon name="back" size={13} />
            <span>Voltar ao Quadro Geral</span>
          </button>
        </div>

        <div
          class="dossier-target-card"
          style="border-left-color: {activeDiplomacyTarget.color === 'black' ? '#cbd5e1' : COLOR_HEX[activeDiplomacyTarget.color]};"
        >
          <div class="target-card-top">
            <div class="g-flag-frame">
              <FactionFlag
                color={activeDiplomacyTarget.color}
                width={26}
                height={17}
              />
            </div>
            <div class="target-card-info">
              <strong>{activeDiplomacyTarget.name}</strong>
              <small>DOSSIÊ DIPLOMÁTICO DO GENERAL</small>
            </div>
          </div>

          <!-- Infamy Gauge -->
          <div class="infamy-wrap">
            <div class="infamy-row">
              <span><Icon name="infamy" size={11} /> INFÂMIA DO GENERAL</span>
              <strong
                class="infamy-value"
                class:high-infamy={(activeDiplomacyTarget.infamy ?? 0) >= 50}
              >
                {activeDiplomacyTarget.infamy ?? 0}%
              </strong>
            </div>
            <div class="infamy-bar">
              <div
                class="infamy-fill"
                class:grand-threat={(activeDiplomacyTarget.infamy ?? 0) >= 100}
                class:bilateral-threat={(activeDiplomacyTarget.infamy ?? 0) >=
                  50}
                style="width: {activeDiplomacyTarget.infamy ?? 0}%;"
              ></div>
              <div
                class="infamy-marker"
                style="left: 50%;"
                title="Coalizão Bilateral (50%)"
              ></div>
              <div
                class="infamy-marker"
                style="left: 100%;"
                title="Grande Coalizão (100%)"
              ></div>
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
                  <span
                    >{targetTreatyWithMe.type === "alliance"
                      ? "Aliança Militar Ativa"
                      : "Pacto de Não-Agressão (NAP) Ativo"}</span
                  >
                </div>
                <p class="treaty-rule-desc">
                  Ataques mútuos estão suspensos pelas leis de guerra.
                </p>
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
                  <span
                    >Proposta de {targetTreatyWithMe.type === "alliance"
                      ? "Aliança"
                      : "NAP"} enviada.</span
                  >
                  <button
                    class="btn-ghost-sm"
                    onclick={() => handleRejectTreaty(targetTreatyWithMe.id)}
                  >
                    Cancelar Proposta
                  </button>
                </div>
              {:else}
                <div class="treaty-incoming-box">
                  <strong
                    >Proposta de {targetTreatyWithMe.type === "alliance"
                      ? "Aliança Militar"
                      : "Pacto de Não-Agressão"}</strong
                  >
                  <div class="treaty-incoming-actions">
                    <button
                      class="btn-tactical-success"
                      onclick={() => handleAcceptTreaty(targetTreatyWithMe.id)}
                    >
                      <Icon name="check" size={13} /> Aceitar
                    </button>
                    <button
                      class="btn-tactical-danger"
                      onclick={() => handleRejectTreaty(targetTreatyWithMe.id)}
                    >
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
                onclick={() =>
                  handleProposeTreaty(activeDiplomacyTarget.id, "nap")}
              >
                <Icon name="handshake" size={14} />
                <span>Propor Pacto de Não-Agressão (NAP)</span>
              </button>
              <button
                class="btn-treaty-propose"
                class:btn-disabled={(game.worldTension ?? 0) < 50}
                disabled={(game.worldTension ?? 0) < 50}
                onclick={() =>
                  handleProposeTreaty(activeDiplomacyTarget.id, "alliance")}
                title={(game.worldTension ?? 0) < 50
                  ? "Requer Tensão Mundial de pelo menos 50%"
                  : "Propor aliança militar mútua"}
              >
                <Icon name="crown" size={14} />
                <span
                  >Propor Aliança Militar {(game.worldTension ?? 0) < 50
                    ? "(Requer 50% Tensão)"
                    : ""}</span
                >
              </button>
            </div>
          {/if}
        </div>

        <!-- Coalitions Section -->
        <div class="dossier-section">
          <div class="dossier-section-title">
            Coalizões Militares de Contenção
          </div>
          {#if activeCoalitionAgainstTarget}
            <div class="coalition-active-box">
              <div class="coalition-header">
                <Icon name="swords" size={14} />
                <span
                  >COALIZÃO ATIVA ({activeCoalitionAgainstTarget.memberPlayerIds
                    .length}/{(activeDiplomacyTarget.infamy ?? 0) >= 100
                    ? 3
                    : 2} Membros)</span
                >
              </div>
              <div class="coalition-members">
                {#each activeCoalitionAgainstTarget.memberPlayerIds as mid}
                  {@const mem = game.players.find((p) => p.id === mid)}
                  {#if mem}
                    <span
                      class="coalition-member-tag"
                      style="border-color: {mem.color === 'black' ? '#cbd5e1' : COLOR_HEX[mem.color]};"
                    >
                      <FactionFlag color={mem.color} width={14} height={9} />
                      {mem.name}
                      {mid === myPlayerId ? "(Você)" : ""}
                    </span>
                  {/if}
                {/each}
              </div>

              {#if !activeCoalitionAgainstTarget.memberPlayerIds.includes(myPlayerId)}
                {@const maxMembers =
                  (activeDiplomacyTarget.infamy ?? 0) >= 100 ? 3 : 2}
                {#if activeCoalitionAgainstTarget.memberPlayerIds.length < maxMembers}
                  <button
                    class="btn-coalition-join"
                    onclick={() =>
                      handleJoinCoalition(activeCoalitionAgainstTarget.id)}
                  >
                    <Icon name="swords" size={13} />
                    <span
                      >Unir-se à Coalizão contra {activeDiplomacyTarget.name}</span
                    >
                  </button>
                {:else}
                  <p class="coalition-full-note">
                    Capacidade máxima da coalizão atingida.
                  </p>
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
                A Infâmia de {activeDiplomacyTarget.name} ({activeDiplomacyTarget.infamy}%)
                ultrapassou o limiar de alarme global.
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
              <span
                >Coalizões bloqueadas. Alvo possui apenas {activeDiplomacyTarget.infamy ??
                  0}% de Infâmia (requer ≥ 50%).</span
              >
            </div>
          {/if}

          {#if (targetTreatyWithMe?.status === "active" && targetTreatyWithMe.type === "alliance") || inSameCoalitionWithTarget}
            {@const myRes = myPlayerState?.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
            <div class="dossier-section lend-lease-section">
              <div class="dossier-section-title">
                <Icon name={inSameCoalitionWithTarget ? "swords" : "handshake"} size={12} />
                <span>
                  {inSameCoalitionWithTarget
                    ? "Logística de Coalizão (Lend-Lease & Aeronaves)"
                    : "Ajuda Militar de Aliança (Lend-Lease)"}
                </span>
              </div>
              <div class="lend-lease-grid">
                <button
                  type="button"
                  class="btn-lend-lease"
                  disabled={myRes.money < 3}
                  onclick={() => handleSendAllianceAid(activeDiplomacyTarget.id, { money: 3 })}
                  title="Enviar $3 do Tesouro Nacional para este aliado"
                >
                  <Icon name="coins" size={12} />
                  <span>Enviar $3</span>
                </button>
                <button
                  type="button"
                  class="btn-lend-lease"
                  disabled={myRes.steel < 1}
                  onclick={() => handleSendAllianceAid(activeDiplomacyTarget.id, { steel: 1 })}
                  title="Enviar 1 Aço para este aliado"
                >
                  <Icon name="steel" size={12} />
                  <span>+1 Aço</span>
                </button>
                <button
                  type="button"
                  class="btn-lend-lease"
                  disabled={myRes.oil < 1}
                  onclick={() => handleSendAllianceAid(activeDiplomacyTarget.id, { oil: 1 })}
                  title="Enviar 1 Petróleo para este aliado"
                >
                  <Icon name="oil" size={12} />
                  <span>+1 Petróleo</span>
                </button>
                <button
                  type="button"
                  class="btn-lend-lease"
                  disabled={myRes.gold < 1}
                  onclick={() => handleSendAllianceAid(activeDiplomacyTarget.id, { gold: 1 })}
                  title="Enviar 1 Ouro para este aliado"
                >
                  <Icon name="gold" size={12} />
                  <span>+1 Ouro</span>
                </button>
              </div>
              {#if inSameCoalitionWithTarget}
                <button
                  type="button"
                  class="btn-coalition-aircraft"
                  disabled={!myAircraftTerritoryId}
                  onclick={() => handleSendCoalitionAircraft(activeDiplomacyTarget.id)}
                  title={myAircraftTerritoryId
                    ? "Transferir 1 Aeronave de combate diretamente para a base do seu parceiro de Coalizão"
                    : "Você precisa ter ao menos 1 Aeronave em um território com mais de 1 divisão para transferir"}
                >
                  <Icon name="aircraft" size={13} />
                  <span>Transferir +1 Aeronave de Coalizão</span>
                </button>
              {/if}
            </div>
          {/if}

          <!-- Hegemon Last Stand Alert -->
          {#if activeCoalitionAgainstTarget && activeCoalitionAgainstTarget.memberPlayerIds.length >= 2}
            {@const bonus =
              (activeDiplomacyTarget.infamy ?? 0) >= 100 &&
              activeCoalitionAgainstTarget.memberPlayerIds.length >= 3
                ? 2
                : 1}
            <div class="hegemon-bonus-banner">
              <Icon name="star" size={13} />
              <span
                >Mobilização Total Hegemon: +{bonus} nos dados contra membros
                da coalizão</span
              >
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Hegemony Power Bar (Segmented World Dominance %) -->
      <div class="hegemony-bar-wrap">
        <div class="hegemony-bar-label">
          <span class="hegemony-label-left">
            <Icon name="flag" size={11} />
            <span>{t("hegemony_bar")}</span>
          </span>
          <span class="hegemony-terr-pill">{t("territories_count", { count: 44 }).toUpperCase()}</span>
        </div>
        <div class="hegemony-bar" title={t("hegemony_bar")}>
          {#each playerMetrics as m}
            <div
              class="hegemony-segment"
              style="width: {m.sharePct}%; background: {m.player.color === 'black' ? '#21262B' : COLOR_HEX[
                m.player.color
              ]}; {m.player.color === 'black' ? 'box-shadow: inset 0 0 0 1px #cbd5e1;' : ''}"
              title="{m.player.name}: {m.sharePct}% ({m.terrCount} {t(
                'territories_count',
                { count: m.terrCount },
              )}, {m.totalArmies} {t('divisions', { count: m.totalArmies })})"
            ></div>
          {/each}
        </div>
      </div>

      <!-- Generals Roster with Heraldic Flags & Icon-Backed Telemetry -->
      <div class="generals-roster-box">
        <div class="roster-header-bar">
          <span class="roster-header-title">
            <Icon name="crown" size={11} />
            <span>COMANDANTES EM OPERAÇÃO</span>
          </span>
          {#if myAlliesAndCoalitionPartners.length > 0}
            <button
              type="button"
              class="btn-top-left-alliance"
              class:coalition={myHasCoalitionPartner}
              onclick={() => {
                sound.playClick();
                activeDiplomacyTargetId = myAlliesAndCoalitionPartners[0].id;
              }}
              use:tooltip={{
                title: myHasCoalitionPartner ? "Comando de Coalizão Ativo" : "Comando de Aliança Ativo",
                content: myHasCoalitionPartner
                  ? "Clique para enviar Dinheiro, Recursos ou Aeronaves de combate aos membros da sua Coalizão."
                  : "Clique para enviar Dinheiro ou Recursos (Lend-Lease) aos seus aliados militares."
              }}
            >
              <Icon name={myHasCoalitionPartner ? "swords" : "handshake"} size={11} />
              <span>{myHasCoalitionPartner ? "COALIZÃO" : "ALIANÇA"} ({myAlliesAndCoalitionPartners.length})</span>
            </button>
          {/if}
          <span class="roster-legend-hint" title="Territórios / Divisões / Cartas">
            <span><Icon name="globe" size={10} /> TERR</span>
            <span><Icon name="infantry" size={10} /> DIV</span>
            <span><Icon name="cards" size={10} /> CART</span>
          </span>
        </div>

        <div class="generals-table">
          {#each playerMetrics as m, idx}
            {@const isTurn = idx === game.turnIndex}
            {@const activeTreaty = game.treaties?.find(
              (tr) =>
                tr.status === "active" &&
                ((tr.fromPlayerId === myPlayerId && tr.toPlayerId === m.player.id) ||
                  (tr.fromPlayerId === m.player.id && tr.toPlayerId === myPlayerId))
            )}
            <div
              class="general-row"
              class:active-turn={isTurn}
              class:is-me={m.player.id === myPlayerId}
              class:eliminated={m.player.eliminated}
              style="border-left-color: {m.player.color === 'black' ? '#cbd5e1' : COLOR_HEX[m.player.color]};"
            >
              <div class="g-info">
                <div class="g-flag-frame">
                  <FactionFlag color={m.player.color} width={24} height={16} />
                </div>
                <div class="g-name-stack">
                  <span class="g-name">
                    <span class="g-name-text">{m.player.name}</span>
                    {#if m.player.doctrineId}
                      <span
                        class="g-doctrine-crest"
                        use:tooltip={{
                          title: `Doutrina: ${getFactionDoctrine(m.player.doctrineId)}`,
                          content: "Doutrina Militar Nacional ativa para este comandante."
                        }}
                      >
                        <DoctrineCrest doctrineId={m.player.doctrineId} size={14} />
                      </span>
                    {/if}
                    {#if m.player.id === myPlayerId}
                      <small class="you-badge">{t("you")}</small>
                    {/if}
                    {#if isTurn}
                      <span class="turn-indicator" title={t("turn")}>
                        <Icon name="crown" size={12} />
                      </span>
                    {/if}
                  </span>
                  {#if activeTreaty}
                    <span class="g-treaty-tag" class:alliance={activeTreaty.type === "alliance"}>
                      <Icon name="shield" size={9} />
                      {activeTreaty.type === "alliance" ? "ALIANÇA" : "PACTO NAP"}
                    </span>
                  {/if}
                </div>
              </div>

              <div class="g-stats">
                <span
                  title={t("territories_count", { count: m.terrCount })}
                  class="stat-pill stat-terr"
                >
                  <Icon name="globe" size={11} />
                  <strong>{m.terrCount}</strong>
                </span>
                <span
                  title={t("divisions", { count: m.totalArmies })}
                  class="stat-pill stat-div"
                >
                  <Icon name="infantry" size={11} />
                  <strong>{m.totalArmies}</strong>
                </span>
                <span
                  title={t("cards_title")}
                  class="stat-pill stat-cards"
                >
                  <Icon name="cards" size={11} />
                  <strong>{m.player.cards.length}</strong>
                </span>
                {#if (m.player.infamy ?? 0) > 0}
                  <span title="Infâmia do General" class="stat-pill infamy-pill">
                    <Icon name="infamy" size={11} />
                    <strong>{m.player.infamy}%</strong>
                  </span>
                {/if}
                {#if m.player.id !== myPlayerId && !m.player.eliminated}
                  <button
                    class="btn-diplomacy-icon"
                    class:active={activeDiplomacyTargetId === m.player.id}
                    class:has-treaty={Boolean(activeTreaty)}
                    title="Dossiê Diplomático com {m.player.name}"
                    onclick={() =>
                      (activeDiplomacyTargetId =
                        activeDiplomacyTargetId === m.player.id
                          ? null
                          : m.player.id)}
                  >
                    <Icon name="handshake" size={13} />
                  </button>
                {:else if m.player.id === myPlayerId}
                  <span class="btn-diplomacy-spacer" title="Seu Comando">
                    <Icon name="star" size={11} />
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Continents & Asian Sub-Regions Toggle -->
    <div class="continents-toggle-row">
      <button
        class="btn-ghost"
        class:open={showContinents}
        onclick={() => (showContinents = !showContinents)}
      >
        <span class="theatres-btn-left">
          <span class="theatres-icon-badge"><Icon name="globe" size={13} /></span>
          <span>{t("theatres_and_bonuses")}</span>
        </span>
        <span class="theatres-chevron-box">
          <Icon name={showContinents ? "chevron-up" : "chevron-down"} size={13} />
        </span>
      </button>
    </div>

    {#if showContinents}
      <div class="continents-dropdown">
        <div class="dropdown-section-title">
          <Icon name="compass" size={11} />
          <span>{t("classic_continents_section")}</span>
        </div>
        {#each CLASSIC_MAP.continents.filter((c) => c.id !== "asia") as c}
          {@const terrs = CLASSIC_MAP.territories.filter(
            (t) => t.continent === c.id,
          )}
          {@const ownerId = game.territories[terrs[0].id]?.ownerId}
          {@const isMonopoly = terrs.every(
            (t) => game!.territories[t.id].ownerId === ownerId,
          )}
          <div class="cont-pill" class:monopoly={isMonopoly}>
            <span class="cont-name">{getContinentName(c.id)}</span>
            <div class="cont-right">
              {#if isMonopoly}
                {@const p = game.players.find((plr) => plr.id === ownerId)}
                {#if p}<FactionFlag
                    color={p.color}
                    width={16}
                    height={10}
                  />{/if}
              {/if}
              <span class="bonus-tag">+{c.bonus}</span>
            </div>
          </div>
        {/each}

        <div class="dropdown-section-title">
          <Icon name="star" size={11} />
          <span>{t("asia_subregions_section")}</span>
        </div>
        {#each ASIA_SUBREGIONS as sub}
          {@const ownerId = game.territories[sub.territoryIds[0]]?.ownerId}
          {@const isMonopoly = sub.territoryIds.every(
            (tid) => game!.territories[tid]?.ownerId === ownerId,
          )}
          <div class="cont-pill asia-sub-pill" class:monopoly={isMonopoly}>
            <span class="cont-name">{getSubregionName(sub.id)}</span>
            <div class="cont-right">
              {#if isMonopoly}
                {@const p = game.players.find((plr) => plr.id === ownerId)}
                {#if p}<FactionFlag
                    color={p.color}
                    width={16}
                    height={10}
                  />{/if}
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
            {isMyTurn
              ? t("banner_your_turn")
              : t("banner_waiting", {
                  name: currentTurnPlayer.name.toUpperCase(),
                })}
          </span>
          <strong class="tc-directive">
            {#if game.pendingConquest}
              {t("phase_pending_conquest")}
            {:else if game.phase === "deploy"}
              {isMyTurn
                ? ((myPlayerState?.unplacedArmies ?? 0) > 0
                    ? t("phase_deploy_my_turn", {
                        count: myPlayerState?.unplacedArmies ?? 0,
                      })
                    : t("phase_deploy_ready"))
                : t("phase_deploy_waiting")}
            {:else if game.phase === "attack"}
              {isMyTurn ? t("phase_attack_my_turn") : t("phase_attack_waiting")}
            {:else if game.phase === "maneuver"}
              {isMyTurn
                ? t("phase_maneuver_my_turn")
                : t("phase_maneuver_waiting")}
            {:else}
              {t("phase_campaign_ended")}
            {/if}
          </strong>
        </div>
        <div
          class="tc-timer"
          class:timer-warning={remainingSeconds <= 20 && remainingSeconds > 10}
          class:timer-danger={remainingSeconds <= 20 && remainingSeconds > 10}
          class:timer-critical={remainingSeconds <= 10}
          class:timer-my-turn={isMyTurn}
          role="timer"
          aria-live={remainingSeconds <= 10 ? "assertive" : "off"}
          aria-label={`Tempo restante de turno: ${remainingSeconds} segundos`}
        >
          <Icon name="clock" size={14} />
          <span>{remainingSeconds}s</span>
        </div>
      </div>
    {/if}

    <TacticalAlerts
      {game}
      {myPlayerId}
      {myPlayerState}
      {isMyTurn}
      onFocusTerritory={(terrId) => onFocusTerritory?.(terrId)}
    />
  </div>
{/if}

<!-- ↗ TOP-RIGHT: PLAYER HEADQUARTERS, MAP MODE SWITCHER, CARDS, OBJECTIVE & EQUALIZER -->
{#if !isImmersiveMode}
  <aside class="hud-panel top-right-panel">
    <span class="card-corner tl"></span>
    <span class="card-corner tr"></span>
    <span class="card-corner bl"></span>
    <span class="card-corner br"></span>

    <div class="hq-header-bar">
      {#if myPlayerState}
        {@const userLevel = auth.user?.level ?? 1}
        {@const rank = getMilitaryRank(userLevel)}
        <div
          class="hq-general"
          use:tooltip={{
            title: `${rank.titlePt} • Nível ${userLevel}`,
            content: auth.user
              ? `Comandante Supremo (${myPlayerState.name}) • ${auth.user.xp ?? 0} XP acumulado.`
              : `Comandante da facção em campo tático.`
          }}
        >
          <div class="hq-flag-frame">
            <FactionFlag color={myPlayerState.color} width={28} height={19} />
          </div>
          <div class="hq-identity-stack">
            <div class="hq-kicker-row">
              <span class="hq-kicker">QUARTEL-GENERAL</span>
              <span class="hq-rank-badge">{rank.titlePt}</span>
            </div>
            <span class="hq-name">{myPlayerState.name}</span>
          </div>
        </div>
      {/if}

      <div class="hq-header-right">
        {#if myPlayerState && isMyTurn && myPlayerState.unplacedArmies > 0}
          <div
            class="reserve-badge"
            use:tooltip={{
              title: "Reservas Prontas para Posicionar",
              content: `Você possui +${myPlayerState.unplacedArmies} divisão(ões) de reserva para posicionar em seus territórios neste turno.`
            }}
          >
            <Icon name="shield" size={12} />
            <span>+{myPlayerState.unplacedArmies}</span>
          </div>
        {/if}

        <button
          class="hud-btn btn-exit-room"
          onclick={() => {
            sound.playClick();
            if (game?.phase === "game_over") {
              leaveCurrentRoom();
            } else {
              showExitConfirmModal = true;
            }
          }}
          title={t("exit_button_tooltip")}
        >
          <Icon name="logout" size={14} />
        </button>
      </div>
    </div>

    <!-- Structured 2-Row Command Deck -->
    <div class="hq-command-grid">
      <div class="hq-primary-row">
        <button
          class="hud-btn hq-deck-btn"
          data-testid="btn-open-cards"
          class:highlight={Boolean(validTradeTriplet)}
          class:mandatory={Boolean(
            myPlayerState && myPlayerState.cards.length >= 5,
          )}
          class:active={activeRightDrawer === "cards"}
          onclick={() => toggleRightDrawer("cards")}
          title={t("cards_title")}
        >
          <span class="hq-btn-icon"><Icon name="cards" size={14} /></span>
          <span class="hq-btn-label">Cartas</span>
          <span class="hq-btn-pill">{myPlayerState?.cards.length ?? 0}/5</span>
        </button>

        <button
          class="hud-btn hq-deck-btn"
          data-testid="btn-open-objective"
          class:active={activeRightDrawer === "objective"}
          onclick={() => toggleRightDrawer("objective")}
          title={t("secret_objective_label")}
        >
          <span class="hq-btn-icon"><Icon name="target" size={14} /></span>
          <span class="hq-btn-label">Diretriz</span>
          {#if objectiveProgress}
            <span class="hq-btn-pill">{objectiveProgress.pct}%</span>
          {/if}
        </button>

        <button
          class="hud-btn hq-deck-btn"
          data-testid="btn-open-market"
          class:highlight={Boolean(myHasMarket)}
          class:active={activeRightDrawer === "market"}
          onclick={() => toggleRightDrawer("market")}
          title={t("market_btn_open")}
        >
          <span class="hq-btn-icon"><Icon name="market" size={14} /></span>
          <span class="hq-btn-label">{t("market_btn_open")}</span>
        </button>
      </div>

      <div class="hq-secondary-row">
        <button
          class="hud-btn hq-sub-btn"
          data-testid="btn-open-audio"
          class:active={activeRightDrawer === "audio" ||
            (ui.isMusicPlaying && !ui.isMuted)}
          onclick={() => toggleRightDrawer("audio")}
          title={t("audio_radio_eq")}
        >
          <Icon name={ui.isMuted ? "mute" : "radio"} size={13} />
          <span>
            {ui.isMuted
              ? t("audio_muted")
              : ui.isMusicPlaying
                ? t("audio_radio_on")
                : t("audio_status")}
          </span>
        </button>

        <button
          class="hud-btn hq-sub-btn"
          class:active={showHudManager}
          onclick={() => {
            sound.playClick();
            showHudManager = !showHudManager;
            if (showHudManager) activeRightDrawer = null;
          }}
          title={t("hud_vision_title")}
        >
          <Icon name="eye" size={13} />
          <span>Painéis HUD</span>
        </button>
      </div>
    </div>

    {#if myPlayerState}
      {@const res = myPlayerState.resources ?? {
        money: 0,
        steel: 0,
        oil: 0,
        gold: 0,
      }}
      <div class="hq-economy-bar">
        <div
          class="econ-pill money"
          data-testid="res-money"
          use:tooltip={{
            title: "Tesouro & Fundos Operacionais ($)",
            content: "Utilizado para aquisição de recursos no Mercado Global, edificação de defesas territoriais e custeio de manobras táticas."
          }}
        >
          <span class="econ-icon-box"><Icon name="coins" size={14} /></span>
          <div class="econ-data">
            <span class="econ-val">${res.money}</span>
            {#if myEconomyIncome && myEconomyIncome.netMoney > 0}
              <span class="econ-delta">+{myEconomyIncome.netMoney}</span>
            {/if}
          </div>
        </div>
        <div
          class="econ-pill steel"
          data-testid="res-steel"
          use:tooltip={{
            title: "Aço Estratégico",
            content: "Matéria-prima pesada para produção de tanques blindados, peças de artilharia pesada e modernização de fortalezas nível 2."
          }}
        >
          <span class="econ-icon-box"><Icon name="steel" size={13} /></span>
          <div class="econ-data">
            <span class="econ-val">{res.steel}</span>
            {#if myEconomyIncome && myEconomyIncome.steel > 0}
              <span class="econ-delta">+{myEconomyIncome.steel}</span>
            {/if}
          </div>
        </div>
        <div
          class="econ-pill oil"
          data-testid="res-oil"
          use:tooltip={{
            title: "Petróleo & Combustível",
            content: "Recurso tático consumido no abastecimento de divisões blindadas e manobras territoriais de alcance estratégico."
          }}
        >
          <span class="econ-icon-box"><Icon name="oil" size={13} /></span>
          <div class="econ-data">
            <span class="econ-val">{res.oil}</span>
            {#if myEconomyIncome && myEconomyIncome.oil > 0}
              <span class="econ-delta">+{myEconomyIncome.oil}</span>
            {/if}
          </div>
        </div>
        <div
          class="econ-pill gold"
          data-testid="res-gold"
          use:tooltip={{
            title: "Ouro Monetário de Reserva",
            content: "Ativo de reserva internacional de alta liquidez. Pode ser liquidado a taxas premium de conversão cambial."
          }}
        >
          <span class="econ-icon-box"><Icon name="gold" size={13} /></span>
          <div class="econ-data">
            <span class="econ-val">{res.gold}</span>
            {#if myEconomyIncome && myEconomyIncome.gold > 0}
              <span class="econ-delta">+{myEconomyIncome.gold}</span>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Map Mode Switcher & Overlays (HEGEM-62) + Camera Controls -->
    {#if hudVisibility.mapControls}
      <div class="map-mode-bar">
        <!-- Row 1: Base Map Mode (Segmented Switch) -->
        <div class="mode-row" title={t("map_base_label")}>
          <span class="group-label">
            <Icon name="compass" size={11} />
            <span>{t("map_base_label")}</span>
          </span>
          <div class="segmented-control">
            <button
              class="mode-btn base-btn"
              class:active={baseMapMode === "cartographic"}
              onclick={() => (baseMapMode = "cartographic")}
              title={t("map_mode_cartographic_title")}
            >
              <Icon name="compass" size={11} />
              <span>{t("map_mode_cartographic")}</span>
            </button>
            <button
              class="mode-btn base-btn"
              class:active={baseMapMode === "geopolitical"}
              onclick={() => (baseMapMode = "geopolitical")}
              title={t("map_mode_geopolitical_title")}
            >
              <Icon name="flag" size={11} />
              <span>{t("map_mode_geopolitical")}</span>
            </button>
          </div>
        </div>

        <!-- Row 2: Tactical Overlays (Toggles + Clear) -->
        <div class="mode-row" title={t("map_overlays_label")}>
          <span class="group-label">
            <Icon name="globe" size={11} />
            <span>{t("map_overlays_label")}</span>
          </span>
          <div class="toggle-buttons">
            <button
              class="mode-btn overlay-btn"
              class:active={overlays.regional}
              onclick={() => (overlays.regional = !overlays.regional)}
              title={t("map_mode_regional_title")}
            >
              <Icon name="globe" size={12} />
              <span>{t("map_mode_regional")}</span>
            </button>
            <button
              class="mode-btn overlay-btn"
              class:active={overlays.economic}
              onclick={() => (overlays.economic = !overlays.economic)}
              title={t("map_mode_economic_title")}
            >
              <Icon name="coins" size={12} />
              <span>{t("map_mode_economic")}</span>
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
                <Icon name="close" size={10} />
                <span>{t("map_clear_overlays")}</span>
              </button>
            {/if}
          </div>
        </div>

        <!-- Row 3: Clean Vision & Camera Zoom Cluster -->
        <div class="mode-row camera-row">
          <button
            class="mode-btn clean-mode-tab"
            class:active={cleanMapMode}
            onclick={() => (cleanMapMode = !cleanMapMode)}
            title={t("map_mode_clean_title")}
          >
            <Icon name={cleanMapMode ? "eye-off" : "eye"} size={12} />
            <span>{cleanMapMode ? t("mode_clean_active") : t("mode_clean_label")}</span>
          </button>

          <div class="zoom-cluster">
            <button class="tool-btn" onclick={zoomIn} title="Aproximar (+)">
              <Icon name="plus" size={13} />
            </button>
            <button class="tool-btn" onclick={zoomOut} title="Afastar (-)">
              <Icon name="minus" size={13} />
            </button>
            <button
              class="tool-btn reset-btn"
              onclick={resetZoom}
              title="Centralizar Mapa"
            >
              <Icon name="reset" size={12} />
              <span>RST</span>
            </button>
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
          <button
            class="btn-close"
            onclick={() => (activeRightDrawer = null)}
            aria-label={t("close")}><Icon name="close" size={14} /></button
          >
        </div>
        <div class="radio-controls">
          <div class="radio-top-btns">
            <button
              class="btn primary-gold"
              style="flex: 1;"
              onclick={() => ui.toggleMusic()}
            >
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
              oninput={(e) =>
                ui.setMusicVolume(
                  parseFloat((e.currentTarget as HTMLInputElement).value),
                )}
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
              oninput={(e) =>
                ui.setSfxVolume(
                  parseFloat((e.currentTarget as HTMLInputElement).value),
                )}
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
            <span class="combat-anim-label"
              ><Icon name="swords" size={12} />
              {t("settings_combat_anim_label")}:</span
            >
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
            <small class="combat-anim-hint"
              >{t("settings_combat_anim_hint")}</small
            >
          </div>

          <div class="combat-anim-settings" style="margin-top: 0.8rem;">
            <span class="combat-anim-label"
              ><Icon name="shield" size={12} />
              {t("settings_tooltips_label")}:</span
            >
            <div class="combat-anim-btn-group">
              <button
                class="combat-anim-opt"
                class:selected={ui.tooltipsEnabled}
                onclick={() => { if (!ui.tooltipsEnabled) ui.toggleTooltips(); }}
              >
                {t("settings_tooltips_on")}
              </button>
              <button
                class="combat-anim-opt"
                class:selected={!ui.tooltipsEnabled}
                onclick={() => { if (ui.tooltipsEnabled) ui.toggleTooltips(); }}
              >
                {t("settings_tooltips_off")}
              </button>
            </div>
            <small class="combat-anim-hint"
              >{t("settings_tooltips_hint")}</small
            >
          </div>

          <div class="combat-anim-settings" style="margin-top: 0.8rem;">
            <span class="combat-anim-label"
              ><Icon name="compass" size={12} />
              {t("settings_auto_camera_label")}:</span
            >
            <div class="combat-anim-btn-group">
              <button
                class="combat-anim-opt"
                class:selected={autoCameraFocus}
                onclick={() => onToggleAutoCameraFocus?.(true)}
              >
                {t("settings_auto_camera_on")}
              </button>
              <button
                class="combat-anim-opt"
                class:selected={!autoCameraFocus}
                onclick={() => onToggleAutoCameraFocus?.(false)}
              >
                {t("settings_auto_camera_off")}
              </button>
            </div>
            <small class="combat-anim-hint"
              >{t("settings_auto_camera_hint")}</small
            >
          </div>

          <div class="combat-anim-settings" style="margin-top: 0.8rem;">
            <span class="combat-anim-label">
              <Icon name="clock" size={12} />
              Alertas de Fim de Turno:
            </span>
            <div class="combat-anim-btn-group">
              <button
                class="combat-anim-opt"
                class:selected={ui.turnTimerAlertsEnabled}
                onclick={() => { if (!ui.turnTimerAlertsEnabled) ui.toggleTurnTimerAlerts(); }}
              >
                Ligado
              </button>
              <button
                class="combat-anim-opt"
                class:selected={!ui.turnTimerAlertsEnabled}
                onclick={() => { if (ui.turnTimerAlertsEnabled) ui.toggleTurnTimerAlerts(); }}
              >
                Desligado
              </button>
            </div>
            <small class="combat-anim-hint">
              Sons táticos e avisos nos 10s finais do seu turno
            </small>
          </div>
        </div>
      </div>
    {/if}

    <!-- Secret Objective Drawer -->
    {#if activeRightDrawer === "objective" && myPlayerState}
      <div class="floating-drawer objective-drawer">
        <div class="drawer-header">
          <h4>
            <Icon name="target" size={15} /> Diretriz Secreta de Alto Comando
          </h4>
          <button
            class="btn-close"
            onclick={() => (activeRightDrawer = null)}
            aria-label={t("close")}><Icon name="close" size={14} /></button
          >
        </div>
        <p class="objective-body">
          {getObjectiveDescription(myPlayerState.objective.id)}
        </p>
        {#if objectiveProgress}
          <div class="objective-progress-box">
            <div class="progress-bar-header">
              <span>Progresso da Operação:</span>
              <strong
                >{objectiveProgress.pct}% ({objectiveProgress.owned}/{objectiveProgress.total})</strong
              >
            </div>
            <div class="progress-track">
              <div
                class="progress-fill"
                style="width: {objectiveProgress.pct}%;"
              ></div>
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
            <Icon
              name={highlightObjectiveTerritories ? "eye" : "eye-off"}
              size={13}
            />
            {highlightObjectiveTerritories
              ? "Ocultar Alvos no Mapa"
              : "Destacar Alvos no Mapa (Verde / Vermelho)"}
          </button>
        </div>

        <small class="objective-note">
          Documento confidencial mascarado no servidor. O cumprimento garante
          vitória imediata.
        </small>
      </div>
    {/if}

    <!-- Modular HUD Visibility & Customizer Drawer -->
    {#if showHudManager}
      <div class="floating-drawer hud-drawer">
        <div class="drawer-header">
          <h4>
            <Icon name="eye" size={15} /> Personalização da Interface (HUD)
          </h4>
          <button
            class="btn-close"
            onclick={() => (showHudManager = false)}
            aria-label={t("close")}><Icon name="close" size={14} /></button
          >
        </div>

        <div class="hud-immersive-box">
          <button
            class="btn full-width"
            class:primary-gold={isImmersiveMode}
            class:secondary={!isImmersiveMode}
            onclick={toggleImmersiveMode}
          >
            <Icon name={isImmersiveMode ? "eye" : "eye-off"} size={14} />
            {isImmersiveMode
              ? "Desativar Modo Imersivo"
              : "Modo Imersivo (Ocultar Tudo - Tecla H)"}
          </button>
          <small
            >Dica: Pressione <strong>H</strong> a qualquer momento para alternar
            o modo 100% mapa limpo.</small
          >
        </div>

        <div class="hud-toggle-list">
          <span class="hud-section-label">Painéis e Docks Visíveis:</span>

          <label class="hud-toggle-row">
            <span
              ><Icon name="clock" size={13} /> Barra de Comando & Timer (Topo)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.topBanner}
              onchange={() => toggleHudElement("topBanner")}
            />
          </label>

          <label class="hud-toggle-row">
            <span
              ><Icon name="crown" size={13} /> Generais & Teatros (Esquerda)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.continents}
              onchange={() => toggleHudElement("continents")}
            />
          </label>

          <label class="hud-toggle-row">
            <span
              ><Icon name="shield" size={13} /> Console de Ordens & Fases (Inferior)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.bottomDock}
              onchange={() => toggleHudElement("bottomDock")}
            />
          </label>

          <label class="hud-toggle-row">
            <span
              ><Icon name="radio" size={13} /> Diário de Guerra & Chat (Direita)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.warJournal}
              onchange={() => toggleHudElement("warJournal")}
            />
          </label>

          <label class="hud-toggle-row">
            <span
              ><Icon name="globe" size={13} /> Modos de Mapa & Zoom (Superior)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.mapControls}
              onchange={() => toggleHudElement("mapControls")}
            />
          </label>

          <label class="hud-toggle-row">
            <span
              ><Icon name="target" size={13} /> Reconhecimento & Dicas (Inferior)</span
            >
            <input
              type="checkbox"
              checked={hudVisibility.recon}
              onchange={() => toggleHudElement("recon")}
            />
          </label>
        </div>

        <div class="combat-anim-settings">
          <span class="combat-anim-label"
            ><Icon name="swords" size={12} />
            {t("settings_combat_anim_label")}:</span
          >
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
          <small class="combat-anim-hint"
            >{t("settings_combat_anim_hint")}</small
          >
        </div>
      </div>
    {/if}

    <!-- Supply Cards & Escalation Drawer -->
    {#if activeRightDrawer === "cards" && myPlayerState}
      <div class="floating-drawer cards-drawer">
        <div class="drawer-header">
          <h4>
            <Icon name="cards" size={15} />
            {t("cards_count", { count: myPlayerState.cards.length })}
          </h4>
          <button
            class="btn-close"
            onclick={() => (activeRightDrawer = null)}
            aria-label={t("close")}><Icon name="close" size={14} /></button
          >
        </div>

        <div class="escalation-banner">
          <span
            >{t("cards_exchange_next", {
              count: (game.tradeCount ?? 0) + 1,
            })}</span
          >
          <strong>+{t("divisions", { count: nextTradeBonus })}</strong>
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
                {c.territoryId
                  ? getTerritoryName(c.territoryId)
                  : t("card_wildcard")}
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
            onclick={() =>
              sendAction({ type: "trade_cards", cardIds: validTradeTriplet })}
          >
            <Icon name="shield" size={15} />
            {t("cards_exchange_btn", { armies: nextTradeBonus })}
          </button>
        {/if}

        {#if isMyTurn && game.phase === "deploy" && myPlayerState.cards.length < 5}
          {@const res = myPlayerState.resources ?? {
            money: 0,
            steel: 0,
            oil: 0,
            gold: 0,
          }}
          {@const canBuyWithGold =
            !myPlayerState.boughtCardWithGoldThisTurn && res.gold >= 4}
          <div class="gold-card-purchase-box">
            <div class="gold-card-purchase-head">
              <Icon name="gold" size={13} />
              <span>{t("cards_buy_gold_title")}</span>
            </div>
            <p class="gold-card-purchase-sub">{t("cards_buy_gold_sub")}</p>
            {#if myPlayerState.boughtCardWithGoldThisTurn}
              <div class="gold-card-bought-tag">
                <Icon name="check" size={12} />
                {t("cards_buy_gold_done")}
              </div>
            {:else}
              <div class="gold-card-btn-row">
                <button
                  class="hud-btn gold-buy-btn"
                  disabled={!canBuyWithGold}
                  onclick={() =>
                    sendAction({
                      type: "buy_card_with_gold",
                    })}
                >
                  <Icon name="gold" size={12} />
                  {t("cards_buy_gold_btn")}
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Global Dynamic Market & Allied Trade Drawer (HEGEM-22 & HEGEM-82) -->
    {#if activeRightDrawer === "market" && myPlayerState && game}
      {@const treasuryMoney = myPlayerState.resources?.money ?? 0}
      <div class="floating-drawer market-drawer" data-testid="market-modal">
        <div class="drawer-header">
          <h4><Icon name="market" size={15} /> {t("market_modal_title")}</h4>
          <div class="market-header-right">
            <span
              class="market-treasury-badge"
              data-testid="market-treasury-balance"
              title={t("res_money")}
            >
              <Icon name="coins" size={13} />
              <strong
                >{t("market_treasury_balance", {
                  amount: treasuryMoney,
                })}</strong
              >
            </span>
            <button
              class="btn-close"
              onclick={() => (activeRightDrawer = null)}
              aria-label={t("close")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
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
              <Icon name="industry" size={13} />
              {t("market_has_access")}
            </div>
            <div class="market-batch-selector">
              <span class="batch-label"
                >{t("market_batch_qty", { qty: "" })}</span
              >
              <div class="batch-buttons">
                {#each [1, 5, 10] as qty}
                  <button
                    class="batch-btn"
                    class:active={marketBatchQty === qty}
                    data-testid="market-batch-{qty}"
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
            {#each ["steel", "oil", "gold"] as const as res}
              {@const stock = myPlayerState.resources[res] ?? 0}
              {@const buyCost = getEstBuyCost(res, marketBatchQty)}
              {@const sellRev = getEstSellRevenue(res, marketBatchQty)}
              {@const currentPrice = game.marketPrices[res]}
              {@const lacksFunds = treasuryMoney < buyCost}
              {@const lacksStock = stock < marketBatchQty}
              {@const canAffordBuy = !lacksFunds}
              {@const canSell = !lacksStock}
              <div
                class="commodity-card"
                class:cannot-afford-buy={lacksFunds}
                class:cannot-afford-sell={lacksStock}
                data-testid="market-card-{res}"
              >
                <div class="commodity-head">
                  <div class="res-badge">
                    <Icon name={res} size={15} />
                    <strong>{t(`res_${res}`)}</strong>
                  </div>
                  <span
                    class="res-stock-pill"
                    class:stock-empty={stock === 0}
                    class:stock-low={stock > 0 && lacksStock}
                    data-testid="market-stock-{res}"
                  >
                    {t("market_your_stock", { count: stock })}
                  </span>
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
                    class:insufficient={lacksFunds}
                    data-testid="market-buy-{res}"
                    disabled={!canAffordBuy}
                    onclick={() => handleMarketTrade(res, "buy")}
                    title={lacksFunds ? t("market_insufficient_funds") : ""}
                  >
                    {t("market_btn_buy")}
                    {marketBatchQty}x (-${buyCost})
                  </button>
                  <button
                    class="btn-trade sell"
                    class:insufficient={lacksStock}
                    data-testid="market-sell-{res}"
                    disabled={!canSell}
                    onclick={() => handleMarketTrade(res, "sell")}
                    title={lacksStock ? t("market_insufficient_stock") : ""}
                  >
                    {t("market_btn_sell")}
                    {marketBatchQty}x (+${sellRev})
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
            <h5>
              <Icon name="handshake" size={14} />
              {t("investment_routes_title")}
            </h5>
            <span class="routes-hint">{t("investment_routes_sub")}</span>
          </div>

          <!-- Active Routes -->
          {#if game.investmentRoutes && game.investmentRoutes.filter((r) => r.status === "active" && (r.playerAId === myPlayerId || r.playerBId === myPlayerId)).length > 0}
            <div class="routes-list">
              {#each game.investmentRoutes.filter((r) => r.status === "active" && (r.playerAId === myPlayerId || r.playerBId === myPlayerId)) as r}
                {@const partnerId =
                  r.playerAId === myPlayerId ? r.playerBId : r.playerAId}
                {@const partner = game.players.find((p) => p.id === partnerId)}
                <div class="route-item active">
                  <div class="route-info">
                    <FactionFlag
                      color={partner?.color ?? "blue"}
                      width={16}
                      height={10}
                    />
                    <strong>{partner?.name ?? "Aliado"}</strong>
                    <span class="route-badge">
                      {t("investment_status_active", {
                        income: r.roundsActive >= 3 ? 3 : 2,
                        rounds: r.roundsActive,
                      })}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Pending Proposals to Me -->
          {#if game.investmentRoutes && game.investmentRoutes.some((r) => r.status === "pending" && r.playerBId === myPlayerId)}
            <div class="pending-proposals-list">
              {#each game.investmentRoutes.filter((r) => r.status === "pending" && r.playerBId === myPlayerId) as r}
                {@const proposer = game.players.find(
                  (p) => p.id === r.playerAId,
                )}
                <div class="route-item pending">
                  <div class="route-info">
                    <FactionFlag
                      color={proposer?.color ?? "blue"}
                      width={16}
                      height={10}
                    />
                    <span
                      >{proposer?.name}: {t("investment_status_pending")}</span
                    >
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
          {:else if !game.investmentRoutes || !game.investmentRoutes.some((r) => r.playerAId === myPlayerId || r.playerBId === myPlayerId)}
            <p class="empty-routes-hint">{t("investment_no_allies")}</p>
          {/if}
        </div>

        <!-- Border Trade Pending Deals -->
        {#if game.borderTrades && game.borderTrades.some((d) => d.status === "pending" && d.toPlayerId === myPlayerId)}
          <div class="drawer-section-divider"></div>
          <div class="border-trade-section">
            <div class="routes-header">
              <h5>
                <Icon name="handshake" size={14} />
                {t("border_trade_title")}
              </h5>
              <span class="routes-hint">{t("border_trade_sub")}</span>
            </div>
            <div class="pending-proposals-list">
              {#each game.borderTrades.filter((d) => d.status === "pending" && d.toPlayerId === myPlayerId) as d}
                {@const seller = game.players.find(
                  (p) => p.id === d.fromPlayerId,
                )}
                <div class="route-item pending">
                  <div class="route-info">
                    <FactionFlag
                      color={seller?.color ?? "blue"}
                      width={16}
                      height={10}
                    />
                    <span
                      >{t("border_trade_pending_desc", {
                        from: getTerritoryName(d.fromTerritoryId),
                        to: getTerritoryName(d.toTerritoryId),
                        resource: t(`res_${d.resource}`),
                        price: d.price,
                      })}</span
                    >
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

{#if showExitConfirmModal}
  <div
    class="exit-modal-backdrop"
    onclick={() => (showExitConfirmModal = false)}
    onkeydown={(e) => {
      if (e.key === "Escape") showExitConfirmModal = false;
    }}
    role="presentation"
  >
    <div
      class="exit-modal-box"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <div class="exit-modal-header">
        <div class="exit-modal-icon-badge">
          <Icon name="logout" size={20} />
        </div>
        <div class="exit-modal-titles">
          <h4>{t("exit_confirm_title")}</h4>
          <span class="exit-modal-sub">{t("exit_confirm_subtitle")}</span>
        </div>
      </div>
      <p class="exit-modal-desc">
        {t("exit_confirm_desc")}
      </p>
      <div class="exit-bot-takeover-options">
        <label class="bot-takeover-radio" class:selected={botTakeoverMode === "after_2_turns"}>
          <input
            type="radio"
            name="botTakeoverMode"
            value="after_2_turns"
            bind:group={botTakeoverMode}
          />
          <div class="radio-copy">
            <strong>IA assume após 2 turnos (Padrão)</strong>
            <small>Permite reconexão caso você retorne em até 2 rodadas.</small>
          </div>
        </label>
        <label class="bot-takeover-radio" class:selected={botTakeoverMode === "immediate"}>
          <input
            type="radio"
            name="botTakeoverMode"
            value="immediate"
            bind:group={botTakeoverMode}
          />
          <div class="radio-copy">
            <strong>General IA assume imediatamente</strong>
            <small>Transfere o comando das suas forças para um Bot agora mesmo.</small>
          </div>
        </label>
      </div>
      <div class="exit-modal-actions">
        <button
          type="button"
          class="btn-cancel"
          onclick={() => (showExitConfirmModal = false)}
        >
          {t("exit_confirm_cancel")}
        </button>
        <button
          type="button"
          class="btn-confirm-leave"
          onclick={() => {
            showExitConfirmModal = false;
            try {
              (window as any).__hegemoniaRoom?.send("leave_match", {
                botTakeoverMode,
              });
            } catch {
              // ignore
            }
            leaveCurrentRoom();
          }}
        >
          <Icon name="logout" size={14} />
          {t("exit_confirm_leave")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .hud-panel {
    pointer-events: auto;
    position: relative;
    backdrop-filter: blur(18px);
    background: linear-gradient(
      180deg,
      rgba(9, 15, 29, 0.97) 0%,
      rgba(5, 9, 18, 0.99) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.38);
    border-radius: 10px;
    box-shadow:
      0 20px 44px rgba(0, 0, 0, 0.88),
      0 0 24px rgba(234, 179, 8, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    padding: 0.78rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  /* Brass Corner Brackets (Wargame Dossier Frame) */
  .card-corner {
    position: absolute;
    width: 10px;
    height: 10px;
    pointer-events: none;
    z-index: 5;
  }
  .card-corner.tl {
    top: 4px;
    left: 4px;
    border-top: 2px solid #eab308;
    border-left: 2px solid #eab308;
    border-top-left-radius: 4px;
  }
  .card-corner.tr {
    top: 4px;
    right: 4px;
    border-top: 2px solid #eab308;
    border-right: 2px solid #eab308;
    border-top-right-radius: 4px;
  }
  .card-corner.bl {
    bottom: 4px;
    left: 4px;
    border-bottom: 2px solid #eab308;
    border-left: 2px solid #eab308;
    border-bottom-left-radius: 4px;
  }
  .card-corner.br {
    bottom: 4px;
    right: 4px;
    border-bottom: 2px solid #eab308;
    border-right: 2px solid #eab308;
    border-bottom-right-radius: 4px;
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
    background: linear-gradient(
      135deg,
      rgba(15, 23, 42, 0.96),
      rgba(30, 41, 59, 0.96)
    );
    border: 1px solid rgba(234, 179, 8, 0.7);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.75);
    padding: 0.55rem 0.85rem;
    border-radius: 7px;
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

  /* ↖ Top-Left Panel (Supreme Command & Generals Dossier) */
  .top-left-panel {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: start;
    max-height: calc(100vh - 108px);
    overflow: hidden;
  }
  .panel-header {
    padding-bottom: 0.48rem;
    border-bottom: 1px solid rgba(234, 179, 8, 0.22);
  }
  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .brand-identity {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  .brand-emblem-frame {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    background: radial-gradient(
      circle at 50% 35%,
      rgba(234, 179, 8, 0.2),
      rgba(15, 23, 42, 0.92)
    );
    border: 1px solid rgba(234, 179, 8, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }
  .hud-mini-logo {
    width: 26px;
    height: 26px;
    object-fit: contain;
    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.75));
  }
  .brand-lockup {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    line-height: 1.05;
  }
  .brand-lockup strong {
    font-family: var(--font-tactical);
    font-size: 0.92rem;
    font-weight: 900;
    letter-spacing: 0.14em;
    color: #fef08a;
    text-shadow: 0 1px 6px rgba(234, 179, 8, 0.25);
  }
  .brand-lockup small {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: 0.06em;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .round-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    background: linear-gradient(
      180deg,
      rgba(234, 179, 8, 0.2) 0%,
      rgba(161, 98, 7, 0.18) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.48);
    color: #fef08a;
    padding: 0.24rem 0.55rem;
    border-radius: 6px;
    font-weight: 800;
    letter-spacing: 0.05em;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  .round1-treaty-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: linear-gradient(
      90deg,
      rgba(30, 58, 138, 0.38) 0%,
      rgba(15, 23, 42, 0.85) 100%
    );
    border: 1px solid rgba(96, 165, 250, 0.4);
    color: #bfdbfe;
    padding: 0.4rem 0.55rem;
    border-radius: 7px;
    font-size: 0.69rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .treaty-banner-icon {
    width: 26px;
    height: 26px;
    border-radius: 5px;
    background: rgba(59, 130, 246, 0.22);
    border: 1px solid rgba(96, 165, 250, 0.45);
    color: #60a5fa;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* World Tension Telemetry Box */
  .world-tension-wrap {
    background: linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.82) 0%,
      rgba(8, 13, 25, 0.92) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 7px;
    padding: 0.45rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .tension-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.68rem;
    font-weight: 800;
  }
  .tension-title {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    color: #cbd5e1;
    font-family: var(--font-tactical);
    letter-spacing: 0.06em;
  }
  .tension-icon-box {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: rgba(56, 189, 248, 0.14);
    border: 1px solid rgba(56, 189, 248, 0.32);
    color: #38bdf8;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tension-value {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.14);
    border: 1px solid rgba(234, 179, 8, 0.32);
    padding: 0.08rem 0.4rem;
    border-radius: 4px;
  }
  .tension-value.high-tension {
    color: #fecaca;
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.45);
    text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  }
  .tension-gauge-bar {
    position: relative;
    height: 7px;
    background: rgba(4, 8, 16, 0.92);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.25);
  }
  .tension-gauge-fill {
    height: 100%;
    background: linear-gradient(90deg, #ca8a04, #facc15);
    transition: width 0.4s ease;
  }
  .tension-gauge-fill.elevated {
    background: linear-gradient(90deg, #ea580c, #fb923c);
  }
  .tension-gauge-fill.critical {
    background: linear-gradient(90deg, #dc2626, #f87171);
  }
  .tension-threshold-marker {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #38bdf8;
    box-shadow: 0 0 6px #38bdf8;
    z-index: 2;
  }
  .tension-subtext {
    font-size: 0.62rem;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .tension-subtext span {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
  }
  .tension-subtext .unlocked-text {
    color: #38bdf8;
    font-weight: 700;
  }

  /* Hegemony Balance of Power Card */
  .hegemony-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    background: rgba(8, 13, 25, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 7px;
    padding: 0.42rem 0.58rem;
  }
  .hegemony-bar-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.63rem;
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-weight: 800;
    letter-spacing: 0.05em;
  }
  .hegemony-label-left {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: #eab308;
  }
  .hegemony-terr-pill {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    color: #94a3b8;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 0.06rem 0.35rem;
    border-radius: 4px;
  }
  .hegemony-bar {
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    display: flex;
    background: rgba(4, 8, 16, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.24);
  }
  .hegemony-segment {
    height: 100%;
    transition: width 0.3s ease;
  }

  /* Generals Roster Box & Table */
  .generals-roster-box {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
  }
  .roster-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.15rem;
  }
  .roster-header-title {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-tactical);
    font-size: 0.63rem;
    font-weight: 800;
    letter-spacing: 0.07em;
    color: #eab308;
  }
  .roster-legend-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    color: #64748b;
  }
  .roster-legend-hint span {
    display: inline-flex;
    align-items: center;
    gap: 0.16rem;
  }
  .generals-table {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    max-height: calc(100vh - 380px);
    overflow-y: auto;
    padding-right: 0.15rem;
  }
  .general-row {
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.88) 0%,
      rgba(8, 13, 25, 0.92) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-left: 4px solid #64748b;
    border-radius: 6px;
    padding: 0.38rem 0.48rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.15s ease;
  }
  .general-row:hover {
    border-color: rgba(148, 163, 184, 0.38);
    background: linear-gradient(
      90deg,
      rgba(22, 33, 58, 0.92) 0%,
      rgba(11, 18, 34, 0.95) 100%
    );
  }
  .general-row.active-turn {
    background: linear-gradient(
      90deg,
      rgba(234, 179, 8, 0.18) 0%,
      rgba(15, 23, 42, 0.92) 100%
    );
    border-color: rgba(234, 179, 8, 0.5);
    box-shadow: 0 0 14px rgba(234, 179, 8, 0.16);
  }
  .general-row.eliminated {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .g-info {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    flex: 1;
  }
  .g-flag-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border-radius: 4px;
    background: rgba(4, 8, 16, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.28);
    flex-shrink: 0;
  }
  .g-name-stack {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .g-name {
    font-size: 0.75rem;
    font-weight: 700;
    color: #f8fafc;
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    min-width: 0;
  }
  .g-name-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .you-badge {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border: 1px solid rgba(147, 197, 253, 0.45);
    color: #eff6ff;
    padding: 0.04rem 0.3rem;
    border-radius: 3px;
    font-family: var(--font-tactical);
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .turn-indicator {
    color: #facc15;
    display: inline-flex;
    filter: drop-shadow(0 0 4px rgba(250, 204, 21, 0.5));
    flex-shrink: 0;
  }
  .g-treaty-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    width: fit-content;
    font-family: var(--font-tactical);
    font-size: 0.54rem;
    font-weight: 800;
    padding: 0.04rem 0.32rem;
    border-radius: 3px;
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.38);
    color: #7dd3fc;
  }
  .g-treaty-tag.alliance {
    background: rgba(16, 185, 129, 0.16);
    border-color: rgba(52, 211, 153, 0.42);
    color: #6ee7b7;
  }
  .g-stats {
    display: flex;
    align-items: center;
    gap: 0.24rem;
    flex-shrink: 0;
  }
  .stat-pill {
    background: rgba(6, 11, 22, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.24);
    color: #94a3b8;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 0.16rem 0.36rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    min-width: 34px;
    justify-content: center;
  }
  .stat-pill strong {
    color: #f8fafc;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .stat-pill.stat-terr {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.24);
  }
  .stat-pill.stat-div {
    color: #eab308;
    border-color: rgba(234, 179, 8, 0.24);
  }
  .stat-pill.stat-cards {
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.24);
  }
  .stat-pill.infamy-pill {
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.38);
    background: rgba(127, 29, 29, 0.25);
  }
  .stat-pill.infamy-pill strong {
    color: #fca5a5;
  }
  .btn-diplomacy-icon {
    width: 26px;
    height: 24px;
    background: linear-gradient(
      180deg,
      rgba(30, 41, 59, 0.92) 0%,
      rgba(15, 23, 42, 0.96) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.35);
    color: #cbd5e1;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .btn-diplomacy-icon:hover {
    border-color: #eab308;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.18);
  }
  .btn-diplomacy-icon.has-treaty {
    border-color: rgba(52, 211, 153, 0.5);
    color: #6ee7b7;
    background: rgba(16, 185, 129, 0.16);
  }
  .btn-diplomacy-icon.active {
    background: rgba(234, 179, 8, 0.28);
    border-color: #fde047;
    color: #fef08a;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.3);
  }
  .btn-diplomacy-spacer {
    width: 26px;
    height: 24px;
    border-radius: 5px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.25);
    color: #eab308;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Continents & Asian Sub-Regions Toggle */
  .continents-toggle-row {
    margin-top: 0.08rem;
  }
  .btn-ghost {
    background: linear-gradient(
      180deg,
      rgba(22, 33, 58, 0.78) 0%,
      rgba(11, 18, 34, 0.9) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.32);
    color: #e2e8f0;
    width: 100%;
    padding: 0.38rem 0.55rem;
    border-radius: 7px;
    font-family: var(--font-tactical);
    font-size: 0.73rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-ghost:hover,
  .btn-ghost.open {
    border-color: rgba(234, 179, 8, 0.65);
    color: #fef08a;
    background: linear-gradient(
      180deg,
      rgba(30, 45, 78, 0.88) 0%,
      rgba(15, 23, 42, 0.95) 100%
    );
  }
  .theatres-btn-left {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .theatres-icon-badge {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.35);
    color: #facc15;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .theatres-chevron-box {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .continents-dropdown {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 175px;
    overflow-y: auto;
    padding: 0.25rem 0.1rem 0.1rem;
  }
  .dropdown-section-title {
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #eab308;
    margin-top: 0.2rem;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .cont-pill {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.72rem;
    padding: 0.28rem 0.5rem;
    background: rgba(8, 13, 25, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 5px;
    color: #e2e8f0;
  }
  .cont-pill.monopoly {
    border-color: rgba(234, 179, 8, 0.4);
    background: rgba(234, 179, 8, 0.08);
  }
  .asia-sub-pill {
    border-left: 3px solid #eab308;
  }
  .cont-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .bonus-tag {
    font-family: var(--font-mono);
    font-size: 0.66rem;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.16);
    border: 1px solid rgba(234, 179, 8, 0.35);
    padding: 0.06rem 0.35rem;
    border-radius: 4px;
    font-weight: 800;
  }

  /* Diplomatic Dossier */
  .diplomacy-dossier {
    display: flex;
    flex-direction: column;
    gap: 0.48rem;
    background: rgba(6, 11, 22, 0.9);
    border: 1px solid rgba(234, 179, 8, 0.38);
    border-radius: 7px;
    padding: 0.55rem;
  }
  .btn-dossier-back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-dossier-back:hover {
    color: #fef08a;
    border-color: rgba(234, 179, 8, 0.5);
  }
  .dossier-target-card {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-left: 4px solid #64748b;
    border-radius: 6px;
    padding: 0.45rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
  }
  .target-card-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .target-card-info strong {
    font-size: 0.82rem;
    color: #f8fafc;
  }
  .target-card-info small {
    display: block;
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    color: #eab308;
    letter-spacing: 0.06em;
  }
  .infamy-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
  }
  .infamy-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.62rem;
    color: #94a3b8;
    font-weight: 700;
  }
  .infamy-row span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .infamy-value.high-infamy {
    color: #ef4444;
  }
  .infamy-bar {
    position: relative;
    height: 6px;
    background: rgba(5, 9, 18, 0.92);
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
    gap: 0.32rem;
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
    border-radius: 5px;
    padding: 0.38rem 0.55rem;
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
    padding: 0.3rem 0.55rem;
    border-radius: 5px;
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
    border-radius: 5px;
    padding: 0.38rem 0.55rem;
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
    padding: 0.18rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .treaty-incoming-box {
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 5px;
    padding: 0.38rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
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
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
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
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .treaty-propose-box {
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
  }
  .btn-treaty-propose {
    background: rgba(15, 23, 42, 0.88);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #e2e8f0;
    padding: 0.36rem 0.55rem;
    border-radius: 5px;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.15s ease;
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
    border-radius: 5px;
    padding: 0.42rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
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
    border-radius: 4px;
    padding: 0.14rem 0.38rem;
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
    padding: 0.32rem 0.55rem;
    border-radius: 5px;
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
    border-radius: 5px;
    padding: 0.42rem 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
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
    padding: 0.32rem 0.55rem;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .coalition-locked-box {
    background: rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 5px;
    padding: 0.38rem 0.55rem;
    font-size: 0.62rem;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .hegemon-bonus-banner {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 5px;
    padding: 0.34rem 0.55rem;
    font-size: 0.66rem;
    color: #fef08a;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  /* ⬆ Top-Center Operational Banner */
  .top-center-banner {
    pointer-events: auto;
    grid-column: 2;
    grid-row: 1;
    justify-self: center;
    align-self: start;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    background: linear-gradient(
      180deg,
      rgba(11, 18, 33, 0.95) 0%,
      rgba(6, 11, 21, 0.98) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.38);
    border-radius: 8px;
    padding: 0.5rem 1rem;
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(16px);
    max-width: 620px;
    width: fit-content;
  }
  .top-center-banner.my-turn-banner {
    border-color: rgba(234, 179, 8, 0.78);
    box-shadow:
      0 14px 32px rgba(0, 0, 0, 0.82),
      0 0 22px rgba(234, 179, 8, 0.2);
  }
  .tc-main-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
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
    font-size: 0.79rem;
    color: #f8fafc;
    font-weight: 600;
  }
  .tc-timer {
    margin-left: 0.4rem;
    font-family: var(--font-mono);
    font-size: 0.86rem;
    font-weight: 800;
    padding: 0.26rem 0.58rem;
    border-radius: 5px;
    background: rgba(5, 9, 18, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.32);
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
  .tc-timer.timer-critical {
    color: #ffffff;
    border-color: #ef4444;
    background: rgba(185, 28, 28, 0.88);
    box-shadow: 0 0 14px rgba(239, 68, 68, 0.85), inset 0 0 8px rgba(239, 68, 68, 0.45);
    animation: timer-pulse-glow 1s ease-in-out infinite alternate;
  }
  @keyframes timer-pulse-glow {
    0% {
      transform: scale(1);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.6), inset 0 0 6px rgba(239, 68, 68, 0.3);
      border-color: #dc2626;
    }
    100% {
      transform: scale(1.06);
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.95), 0 0 32px rgba(220, 38, 38, 0.45), inset 0 0 12px rgba(239, 68, 68, 0.65);
      border-color: #fca5a5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tc-timer.timer-critical {
      animation: none;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.8);
    }
  }

  .g-doctrine-crest {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 0.25rem;
    cursor: help;
  }

  .tc-sub-bar {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: 0.15rem;
  }
  .btn-tc-mobilization {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #e2e8f0;
    font-family: var(--font-tactical);
    font-size: 0.64rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-tc-mobilization:hover,
  .btn-tc-mobilization.active {
    background: rgba(234, 179, 8, 0.2);
    border-color: #facc15;
    color: #fef08a;
    box-shadow: 0 0 10px rgba(234, 179, 8, 0.25);
  }
  .tc-mob-armies {
    background: #eab308;
    color: #050911;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 900;
    padding: 0.02rem 0.3rem;
    border-radius: 3px;
  }

  .tc-mobilization-popover {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    width: min(340px, 92vw);
    background: linear-gradient(
      165deg,
      rgba(15, 23, 42, 0.98) 0%,
      rgba(8, 13, 26, 0.99) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.55);
    border-radius: 8px;
    box-shadow:
      0 20px 45px rgba(0, 0, 0, 0.92),
      0 0 20px rgba(234, 179, 8, 0.15);
    padding: 0.65rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    z-index: 60;
  }
  .mob-pop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(234, 179, 8, 0.25);
    padding-bottom: 0.35rem;
  }
  .mob-pop-title {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #fef08a;
  }
  .mob-pop-close {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0.15rem;
    border-radius: 3px;
  }
  .mob-pop-close:hover {
    color: #f8fafc;
    background: rgba(239, 68, 68, 0.25);
  }
  .mob-pop-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .mob-pop-armies {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.5rem;
    border-radius: 5px;
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.3);
  }
  .mob-armies-lbl {
    font-family: var(--font-tactical);
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    color: #cbd5e1;
  }
  .mob-armies-val {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 900;
    color: #fef08a;
  }
  .mob-pop-commodities {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.3rem;
  }
  .mob-comm-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.26rem 0.45rem;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
  }
  .mob-comm-label {
    font-size: 0.64rem;
    color: #94a3b8;
    flex: 1;
  }
  .mob-comm-val {
    font-family: var(--font-mono);
    font-size: 0.74rem;
    font-weight: 800;
  }
  .mob-comm-item.money {
    border-color: rgba(16, 185, 129, 0.35);
  }
  .mob-comm-item.money .mob-comm-val {
    color: #6ee7b7;
  }
  .mob-comm-item.steel {
    border-color: rgba(148, 163, 184, 0.35);
  }
  .mob-comm-item.steel .mob-comm-val {
    color: #cbd5e1;
  }
  .mob-comm-item.oil {
    border-color: rgba(249, 115, 22, 0.35);
  }
  .mob-comm-item.oil .mob-comm-val {
    color: #fdba74;
  }
  .mob-comm-item.gold {
    border-color: rgba(234, 179, 8, 0.35);
  }
  .mob-comm-item.gold .mob-comm-val {
    color: #fef08a;
  }
  .mob-pop-note {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.22rem 0.45rem;
    border-radius: 4px;
    font-size: 0.6rem;
    line-height: 1.25;
  }
  .mob-pop-note.warning {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.35);
    color: #fde047;
  }
  .mob-pop-note.danger {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }

  /* ↗ Top-Right Panel (Commander HQ, Treasury & Map Control Deck) */
  .top-right-panel {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: start;
    position: relative;
  }
  .hq-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.48rem;
    border-bottom: 1px solid rgba(234, 179, 8, 0.22);
  }
  .hq-general {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  .hq-flag-frame {
    padding: 3px;
    border-radius: 5px;
    background: rgba(4, 8, 16, 0.9);
    border: 1px solid rgba(234, 179, 8, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .hq-identity-stack {
    display: flex;
    flex-direction: column;
    gap: 0.08rem;
    min-width: 0;
  }
  .hq-kicker-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .hq-kicker {
    font-family: var(--font-tactical);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: #eab308;
    text-transform: uppercase;
  }
  .hq-rank-badge {
    font-family: var(--font-tactical);
    font-size: 0.56rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: rgba(212, 160, 23, 0.16);
    color: #fbbf24;
    border: 1px solid rgba(212, 160, 23, 0.38);
    padding: 0.06rem 0.32rem;
    border-radius: 3px;
  }
  .hq-name {
    font-family: var(--font-tactical);
    font-weight: 900;
    font-size: 0.92rem;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hq-header-right {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    flex-shrink: 0;
  }
  .reserve-badge {
    background: linear-gradient(
      135deg,
      rgba(234, 179, 8, 0.24),
      rgba(161, 98, 7, 0.2)
    );
    border: 1px solid rgba(250, 204, 21, 0.55);
    color: #fef08a;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    padding: 0.2rem 0.42rem;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.18);
    flex-shrink: 0;
  }

  /* Structured 2-Row HQ Command Grid */
  .hq-command-grid {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    width: 100%;
  }
  .hq-primary-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.3rem;
    min-width: 0;
    width: 100%;
  }
  .hq-secondary-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3rem;
    min-width: 0;
    width: 100%;
  }
  .hud-btn {
    background: linear-gradient(
      180deg,
      rgba(20, 30, 52, 0.92) 0%,
      rgba(10, 16, 30, 0.96) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #e2e8f0;
    font-family: var(--font-tactical);
    font-size: 0.7rem;
    font-weight: 800;
    padding: 0.34rem 0.4rem;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
    transition: all 0.15s ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .hq-deck-btn {
    justify-content: space-between;
    padding: 0.34rem 0.42rem;
  }
  .hq-btn-icon {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: rgba(234, 179, 8, 0.14);
    border: 1px solid rgba(234, 179, 8, 0.3);
    color: #facc15;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .hq-btn-label {
    font-size: 0.71rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hq-btn-pill {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 800;
    padding: 0.06rem 0.32rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #fef08a;
  }
  .hq-sub-btn {
    padding: 0.32rem 0.5rem;
    font-size: 0.69rem;
    color: #cbd5e1;
  }
  .hud-btn:hover {
    background: linear-gradient(
      180deg,
      rgba(30, 44, 74, 0.96) 0%,
      rgba(15, 23, 42, 0.98) 100%
    );
    border-color: rgba(234, 179, 8, 0.58);
    color: #fef08a;
  }
  .hud-btn.active {
    background: linear-gradient(
      180deg,
      rgba(234, 179, 8, 0.26) 0%,
      rgba(161, 98, 7, 0.22) 100%
    );
    border-color: #fde047;
    color: #fef08a;
    box-shadow: 0 0 14px rgba(234, 179, 8, 0.25);
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
    0%,
    100% {
      box-shadow: 0 0 4px rgba(234, 179, 8, 0.3);
    }
    50% {
      box-shadow: 0 0 14px rgba(234, 179, 8, 0.75);
    }
  }
  @keyframes pulseAlert {
    0%,
    100% {
      box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
    }
    50% {
      box-shadow: 0 0 14px rgba(239, 68, 68, 0.85);
    }
  }
  .btn-exit-room {
    width: 30px;
    height: 30px;
    padding: 0;
    color: #f87171;
    background: rgba(127, 29, 29, 0.28);
    border-color: rgba(239, 68, 68, 0.42);
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  .btn-exit-room:hover {
    color: #ffffff;
    background: #dc2626;
    border-color: #f87171;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.45);
  }

  /* Exit Campaign Modal (HEGEM-106) */
  .exit-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 7, 18, 0.78);
    backdrop-filter: blur(8px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    pointer-events: auto;
  }
  .exit-modal-box {
    background: #0f172a;
    border: 1px solid rgba(239, 68, 68, 0.45);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75), 0 0 28px rgba(239, 68, 68, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 440px;
    width: 100%;
    color: #f8fafc;
  }
  .exit-modal-header {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    margin-bottom: 1rem;
  }
  .exit-modal-icon-badge {
    width: 42px;
    height: 42px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .exit-modal-titles h4 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    color: #f8fafc;
  }
  .exit-modal-sub {
    font-size: 0.72rem;
    color: #ef4444;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .exit-modal-desc {
    margin: 0 0 1.25rem 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: #94a3b8;
  }
  .exit-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.65rem;
  }
  .exit-modal-actions .btn-cancel {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(148, 163, 184, 0.1);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .exit-modal-actions .btn-cancel:hover {
    background: rgba(148, 163, 184, 0.2);
    color: #fff;
  }
  .exit-modal-actions .btn-confirm-leave {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    font-weight: 600;
    background: #dc2626;
    border: 1px solid #ef4444;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.15s ease;
  }
  .exit-modal-actions .btn-confirm-leave:hover {
    background: #b91c1c;
    box-shadow: 0 0 14px rgba(239, 68, 68, 0.5);
  }

  /* 4-Column Economy & Stockpile Bar */
  .hq-economy-bar {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.28rem;
    padding: 0.4rem 0;
    min-width: 0;
    width: 100%;
    border-top: 1px solid rgba(148, 163, 184, 0.16);
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  }
  .econ-pill {
    display: flex;
    align-items: center;
    gap: 0.26rem;
    padding: 0.28rem 0.32rem;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: 6px;
    background: rgba(6, 11, 22, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    color: #e2e8f0;
  }
  .econ-icon-box {
    width: 19px;
    height: 19px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .econ-data {
    display: flex;
    align-items: baseline;
    gap: 0.16rem;
    min-width: 0;
    overflow: hidden;
  }

  .btn-top-left-alliance {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.16rem 0.42rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    background: rgba(16, 185, 129, 0.18);
    border: 1px solid rgba(52, 211, 153, 0.55);
    color: #6ee7b7;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .btn-top-left-alliance.coalition {
    background: rgba(234, 179, 8, 0.22);
    border-color: rgba(250, 204, 21, 0.65);
    color: #fef08a;
  }
  .lend-lease-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem;
    margin-bottom: 0.4rem;
  }
  .btn-lend-lease,
  .btn-coalition-aircraft {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.38rem 0.5rem;
    border-radius: 6px;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 800;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #a7f3d0;
    cursor: pointer;
  }
  .btn-coalition-aircraft {
    width: 100%;
    border-color: rgba(56, 189, 248, 0.6);
    background: rgba(14, 116, 144, 0.25);
    color: #7dd3fc;
  }
  .btn-lend-lease:disabled,
  .btn-coalition-aircraft:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .exit-bot-takeover-options {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 1rem;
  }
  .bot-takeover-radio {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.25);
    cursor: pointer;
  }
  .bot-takeover-radio.selected {
    border-color: rgba(250, 204, 21, 0.65);
    background: rgba(202, 138, 4, 0.14);
  }
  .bot-takeover-radio .radio-copy {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .bot-takeover-radio strong {
    font-size: 0.78rem;
    color: #f8fafc;
  }
  .bot-takeover-radio small {
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .econ-pill.money {
    border-color: rgba(52, 211, 153, 0.32);
  }
  .econ-pill.money .econ-icon-box {
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(52, 211, 153, 0.35);
    color: #34d399;
  }
  .econ-pill.money .econ-delta {
    color: #34d399;
  }
  .econ-pill.steel {
    border-color: rgba(148, 163, 184, 0.32);
  }
  .econ-pill.steel .econ-icon-box {
    background: rgba(148, 163, 184, 0.16);
    border: 1px solid rgba(148, 163, 184, 0.35);
    color: #cbd5e1;
  }
  .econ-pill.steel .econ-delta {
    color: #94a3b8;
  }
  .econ-pill.oil {
    border-color: rgba(251, 146, 60, 0.32);
  }
  .econ-pill.oil .econ-icon-box {
    background: rgba(249, 115, 22, 0.16);
    border: 1px solid rgba(251, 146, 60, 0.35);
    color: #fb923c;
  }
  .econ-pill.oil .econ-delta {
    color: #fb923c;
  }
  .econ-pill.gold {
    border-color: rgba(251, 191, 36, 0.35);
  }
  .econ-pill.gold .econ-icon-box {
    background: rgba(234, 179, 8, 0.16);
    border: 1px solid rgba(251, 191, 36, 0.38);
    color: #fbbf24;
  }
  .econ-pill.gold .econ-delta {
    color: #fbbf24;
  }
  .econ-val {
    color: #f8fafc;
    font-size: 0.76rem;
    font-variant-numeric: tabular-nums;
  }
  .econ-delta {
    font-size: 0.62rem;
    font-weight: 700;
  }

  /* Structured Map Mode & Camera Control Deck (HEGEM-62) */
  .map-mode-bar {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: rgba(6, 11, 22, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 7px;
    padding: 0.45rem 0.52rem;
  }
  .mode-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
  }
  .mode-row.camera-row {
    padding-top: 0.32rem;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
  }
  .group-label {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94a3b8;
    font-weight: 800;
    font-family: var(--font-tactical);
    user-select: none;
    flex-shrink: 0;
  }
  .segmented-control,
  .toggle-buttons {
    display: inline-flex;
    gap: 0.25rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .mode-btn {
    background: linear-gradient(
      180deg,
      rgba(20, 30, 52, 0.88) 0%,
      rgba(10, 16, 30, 0.94) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.26);
    color: #cbd5e1;
    font-family: var(--font-tactical);
    font-size: 0.67rem;
    font-weight: 700;
    padding: 0.26rem 0.5rem;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    transition: all 0.15s ease;
  }
  .mode-btn:hover {
    color: #f8fafc;
    border-color: rgba(234, 179, 8, 0.48);
  }
  .mode-btn.active {
    background: linear-gradient(
      180deg,
      rgba(234, 179, 8, 0.24) 0%,
      rgba(161, 98, 7, 0.2) 100%
    );
    border-color: #fde047;
    color: #fef08a;
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.2);
  }
  .mode-btn.overlay-btn.active {
    background: rgba(56, 189, 248, 0.2);
    border-color: #38bdf8;
    color: #e0f2fe;
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
  }
  .mode-btn.clear-layers-btn {
    font-size: 0.62rem;
    padding: 0.24rem 0.42rem;
    border: 1px dashed rgba(248, 113, 113, 0.45);
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.2);
  }
  .mode-btn.clear-layers-btn:hover {
    border-color: #ef4444;
    color: #fee2e2;
    background: rgba(239, 68, 68, 0.28);
  }
  .mode-btn.clean-mode-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .zoom-cluster {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .tool-btn {
    background: linear-gradient(
      180deg,
      rgba(20, 30, 52, 0.9) 0%,
      rgba(10, 16, 30, 0.96) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #e2e8f0;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 800;
    min-width: 28px;
    height: 26px;
    padding: 0 0.4rem;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.22rem;
    transition: all 0.15s ease;
  }
  .tool-btn:hover {
    border-color: #fde047;
    color: #fef08a;
    background: rgba(234, 179, 8, 0.16);
  }
  .contextual-map-legend {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.22rem 0.55rem;
    background: rgba(8, 13, 25, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 5px;
    font-size: 0.63rem;
    font-family: var(--font-tactical);
    color: #cbd5e1;
    animation: fadeIn 0.15s ease;
  }
  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-weight: 700;
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

  /* Floating Drawers */
  .floating-drawer {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background: linear-gradient(
      180deg,
      rgba(9, 15, 29, 0.98) 0%,
      rgba(5, 9, 18, 0.99) 100%
    );
    border: 1px solid rgba(234, 179, 8, 0.45);
    border-radius: 9px;
    box-shadow:
      0 20px 44px rgba(0, 0, 0, 0.92),
      0 0 24px rgba(234, 179, 8, 0.1);
    backdrop-filter: blur(18px);
    padding: 0.72rem 0.85rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.48rem;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid rgba(234, 179, 8, 0.2);
    padding-bottom: 0.38rem;
  }
  .drawer-header h4 {
    margin: 0;
    font-family: var(--font-tactical);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #fef08a;
    display: flex;
    align-items: center;
    gap: 0.38rem;
  }
  .btn-close {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .btn-close:hover {
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.5);
    background: rgba(127, 29, 29, 0.3);
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
    display: flex;
    gap: 0.35rem;
  }
  .gold-buy-btn {
    width: 100%;
    justify-content: center;
    font-size: 0.72rem;
    padding: 0.4rem 0.6rem;
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

  /* Market Drawer (HEGEM-22 & HEGEM-82) */
  .market-drawer {
    width: 375px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  }
  .market-header-right {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .market-treasury-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.18rem 0.5rem;
    border-radius: 4px;
    background: linear-gradient(
      135deg,
      rgba(16, 185, 129, 0.2),
      rgba(234, 179, 8, 0.16)
    );
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #6ee7b7;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    white-space: nowrap;
  }
  .market-treasury-badge strong {
    color: #ecfdf5;
    font-weight: 800;
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
    gap: 0.45rem;
  }
  .res-badge {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.76rem;
    color: #f8fafc;
  }
  .res-stock-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.14rem 0.48rem;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #a7f3d0;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .res-stock-pill.stock-low {
    background: rgba(245, 158, 11, 0.16);
    border-color: rgba(251, 191, 36, 0.45);
    color: #fde68a;
  }
  .res-stock-pill.stock-empty {
    background: rgba(127, 29, 29, 0.25);
    border-color: rgba(248, 113, 113, 0.45);
    color: #fca5a5;
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
    transition: all 0.15s ease;
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
  .btn-trade.insufficient {
    border-style: dashed;
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
  .routes-section,
  .border-trade-section {
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
  .routes-list,
  .pending-proposals-list,
  .eligible-partners-list {
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
