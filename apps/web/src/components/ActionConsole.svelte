<script lang="ts">
  import FactionFlag from "./FactionFlag.svelte";
  import Icon from "./Icon.svelte";
  import UnitSelector from "./UnitSelector.svelte";
  import { i18n, t } from "../i18n/index.svelte";
  import { isSeaLink } from "@hegemonia/maps";
  import {
    checkNavalBlockade,
    getMovedInUnits,
    getTerritoryUnits,
    hasTerritoryBuilding,
    isConnectedByFriendlyPath,
    subtractUnits,
    totalUnits,
  } from "@hegemonia/engine";
  import type {
    AirMissionType,
    GameState,
    PlayerState,
    TerritoryDef,
    UnitCounts,
    UnitType,
  } from "@hegemonia/shared";

  interface Props {
    game: GameState;
    myPlayerId: string | null;
    myPlayerState: PlayerState | undefined;
    isMyTurn: boolean;
    selectedFromId: string | null;
    selectedToId: string | null;
    sliderArmies: number;
    selectedUnits: UnitCounts;
    selectedAttackDice: number | null;
    maxAttackerDice: number;
    currentAttackOdds: number | null;
    selectedUnitTotal: number;
    territoryById: Map<string, TerritoryDef>;
    isImmersiveMode?: boolean;
    hudVisible?: boolean;
    confirmDeploy: () => void;
    confirmOccupy: () => void;
    confirmAttack: () => void;
    confirmManeuver: () => void;
    confirmArtilleryBarrage: () => void;
    confirmAirMission: (type: AirMissionType) => void;
    sendAction: (action: any) => void;
    getTerritoryName: (id: string) => string;
    getOccupationAvailable: () => UnitCounts;
    clearSelection: () => void;
  }

  let {
    game,
    myPlayerId,
    myPlayerState,
    isMyTurn,
    selectedFromId = $bindable(),
    selectedToId = $bindable(),
    sliderArmies = $bindable(),
    selectedUnits = $bindable(),
    selectedAttackDice = $bindable(),
    maxAttackerDice,
    currentAttackOdds,
    selectedUnitTotal,
    territoryById,
    isImmersiveMode = false,
    hudVisible = true,
    confirmDeploy,
    confirmOccupy,
    confirmAttack,
    confirmManeuver,
    confirmArtilleryBarrage,
    confirmAirMission,
    sendAction,
    getTerritoryName,
    getOccupationAvailable,
    clearSelection,
  }: Props = $props();

  function quickSetManeuver(
    mode: "plus1" | "half" | "max" | "clear",
    maxM: number,
    availableUnits: UnitCounts
  ) {
    if (mode === "clear") {
      selectedUnits = { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };
      return;
    }
    if (mode === "plus1") {
      if (selectedUnitTotal >= maxM) return;
      const order: UnitType[] = ["infantry", "tank", "artillery", "aircraft", "navy"];
      for (const ut of order) {
        const avail = availableUnits[ut] ?? 0;
        const cur = selectedUnits[ut] ?? 0;
        if (cur < avail) {
          selectedUnits = { ...selectedUnits, [ut]: cur + 1 };
          return;
        }
      }
      return;
    }
    if (mode === "half") {
      fillManeuverToTarget(Math.max(1, Math.floor(maxM / 2)), availableUnits);
      return;
    }
    if (mode === "max") {
      fillManeuverToTarget(maxM, availableUnits);
      return;
    }
  }

  function fillManeuverToTarget(target: number, availableUnits: UnitCounts) {
    let remaining = target;
    const next: UnitCounts = { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };
    const order: UnitType[] = ["tank", "artillery", "infantry", "aircraft", "navy"];
    for (const ut of order) {
      if (remaining <= 0) break;
      const canTake = Math.min(availableUnits[ut] ?? 0, remaining);
      next[ut] = canTake;
      remaining -= canTake;
    }
    selectedUnits = next;
  }

  let isOccupyLocked = $state(false);
  let lockoutRemaining = $state(0);
  let lockoutTimer: ReturnType<typeof setTimeout> | null = null;
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if (game.pendingConquest) {
      isOccupyLocked = true;
      lockoutRemaining = 2;
      if (lockoutTimer) clearTimeout(lockoutTimer);
      if (countdownInterval) clearInterval(countdownInterval);

      countdownInterval = setInterval(() => {
        lockoutRemaining = Math.max(0, lockoutRemaining - 1);
      }, 1000);

      lockoutTimer = setTimeout(() => {
        isOccupyLocked = false;
        lockoutRemaining = 0;
        if (countdownInterval) clearInterval(countdownInterval);
      }, 2000);
    } else {
      isOccupyLocked = false;
      lockoutRemaining = 0;
      if (lockoutTimer) clearTimeout(lockoutTimer);
      if (countdownInterval) clearInterval(countdownInterval);
    }
    return () => {
      if (lockoutTimer) clearTimeout(lockoutTimer);
      if (countdownInterval) clearInterval(countdownInterval);
    };
  });

  let canSwapManeuverRoute = $derived.by(() => {
    if (!selectedFromId || !selectedToId || !game || !myPlayerId) return false;
    const toTerr = game.territories[selectedToId];
    if (!toTerr || toTerr.ownerId !== myPlayerId) return false;
    const avail = subtractUnits(getTerritoryUnits(toTerr), getMovedInUnits(toTerr));
    return totalUnits(avail) > 1;
  });

  function swapManeuverRoute() {
    if (!canSwapManeuverRoute || !selectedFromId || !selectedToId) return;
    const oldFrom = selectedFromId;
    const oldTo = selectedToId;
    selectedFromId = oldTo;
    selectedToId = oldFrom;
    const fromT = game.territories[oldTo];
    if (fromT) {
      const avail = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT));
      const maxM = Math.max(0, totalUnits(avail) - 1);
      quickSetManeuver("max", maxM, avail);
    }
  }

  function useDestinationAsOrigin() {
    if (!selectedToId || !game) return;
    const newFrom = selectedToId;
    selectedFromId = newFrom;
    selectedToId = null;
    const fromT = game.territories[newFrom];
    if (fromT) {
      const avail = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT));
      const maxM = Math.max(0, totalUnits(avail) - 1);
      quickSetManeuver("max", maxM, avail);
    }
  }
</script>

{#if !isImmersiveMode && hudVisible}
  <footer class="hud-panel bottom-center-dock">

    {#if isMyTurn && !game.winnerId}
      {#if game.pendingConquest}
        <div class="action-popup">
          <div class="popup-head">
            <h4>
              <Icon name="flag" size={14} /> {t("conquest_title")} — {t("conquest_prompt")}
            </h4>
          </div>
          <UnitSelector
            available={getOccupationAvailable()}
            bind:selection={selectedUnits}
            maxTotal={game.pendingConquest.maxMove}
          />
          <button
            class="btn primary-gold conquest-btn"
            class:locked={isOccupyLocked}
            disabled={isOccupyLocked || selectedUnitTotal < game.pendingConquest.minMove}
            onclick={confirmOccupy}
            title={isOccupyLocked ? "Trava de segurança antidisparo ativa (2s)" : ""}
          >
            {#if isOccupyLocked}
              <Icon name="clock" size={14} /> Aguarde ({lockoutRemaining > 0 ? `${lockoutRemaining}s` : "..."})
            {:else}
              {t("conquest_advance", { count: selectedUnitTotal })}
            {/if}
          </button>
        </div>

      {:else if game.phase === "deploy"}
        {#if selectedFromId && (myPlayerState?.unplacedArmies ?? 0) > 0}
          {@const fromTerr = game.territories[selectedFromId]}
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
                <button class="preset-btn" onclick={clearSelection} aria-label={t("close")}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            </div>
            {#if fromTerr?.isEncircled}
              <div class="tactical-intel-alert danger">
                <Icon name="supply-cut" size={14} />
                <span><strong>Território sob Cerco Militar:</strong> Sem conexão com a Capital. Reforços bloqueados!</span>
              </div>
            {/if}
            <div class="slider-row">
              <input type="range" min="1" max={maxD} disabled={fromTerr?.isEncircled} bind:value={sliderArmies} />
              {#if !myPlayerState?.capitalTerritoryId}
                <button
                  class="btn secondary-btn select-cap-btn"
                  title={t("capital_select_hint")}
                  onclick={() => sendAction({ type: "select_capital", territoryId: selectedFromId })}
                >
                  <Icon name="capital" size={13} /> {t("capital_select_btn")}
                </button>
              {/if}
              <button class="btn primary-gold" disabled={fromTerr?.isEncircled} onclick={confirmDeploy}>
                <Icon name="phase-deploy" size={14} /> {t("deploy_confirm", { count: sliderArmies })}
              </button>
            </div>
          </div>
        {/if}

      {:else if game.phase === "attack"}
        {#if selectedFromId && selectedToId}
          {@const fromTerr = game.territories[selectedFromId]}
          {@const toTerr = game.territories[selectedToId]}
          {@const fromUnits = getTerritoryUnits(fromTerr)}
          {@const isSea = isSeaLink(selectedFromId, selectedToId)}
          {@const navalCheck = isSea && myPlayerId ? checkNavalBlockade(game, selectedFromId, selectedToId, myPlayerId) : null}
          {@const canArtillery = fromUnits.artillery > 0 && !fromTerr.artilleryBarrageFiredThisTurn}
          {@const canAir = hasTerritoryBuilding(fromTerr, "airfield") && fromUnits.aircraft > 0 && !fromTerr.airMissionFlownThisTurn && (myPlayerState?.resources?.oil ?? 0) > 0}
          {@const fromPlayer = game.players.find((p) => p.id === fromTerr?.ownerId)}
          {@const toPlayer = game.players.find((p) => p.id === toTerr?.ownerId)}
          <div class="action-popup attack-popup">
            <div class="attack-matchup">
              <span class="matchup-side origin">
                {#if fromPlayer}
                  <FactionFlag color={fromPlayer.color} width={18} height={12} />
                {/if}
                <span class="matchup-text">
                  {t("combat_origin", { territory: getTerritoryName(selectedFromId) })}
                  <strong class="matchup-armies">({fromTerr.armies})</strong>
                </span>
              </span>
              <span class="vs">{t("vs")}</span>
              <span class="matchup-side target">
                <span class="matchup-text">
                  {t("combat_target", { territory: getTerritoryName(selectedToId) })}
                  <strong class="matchup-armies">({toTerr.armies})</strong>
                </span>
                {#if toPlayer}
                  <FactionFlag color={toPlayer.color} width={18} height={12} />
                {/if}
              </span>
            </div>

            {#if toTerr.isEncircled}
              <div class="tactical-intel-alert danger">
                <Icon name="supply-cut" size={14} />
                <span><strong>Defensor Sob Cerco:</strong> Penalidade de -{(toTerr.encircledRounds ?? 1) >= 2 ? 2 : 1} no dado de defesa.</span>
              </div>
            {/if}
            {#if fromTerr.outOfFuel}
              <div class="tactical-intel-alert warning">
                <Icon name="fuel-empty" size={14} />
                <span><strong>Sem Petróleo:</strong> Blindados imobilizados e sem re-rolagem de 1s.</span>
              </div>
            {/if}
            {#if fromTerr.blitzkriegAvailable}
              <div class="tactical-intel-alert gold">
                <Icon name="blitzkrieg" size={14} />
                <span><strong>Blitzkrieg Ativo:</strong> Blindados sobreviventes podem liderar este segundo ataque imediato!</span>
              </div>
            {/if}
            {#if navalCheck?.isBlockaded}
              <div class="tactical-intel-alert danger">
                <Icon name="blockade" size={14} />
                <span><strong>Bloqueio Naval:</strong> Frota inimiga ({navalCheck.defenderNavy} vs {navalCheck.attackerNavy}) impede o desembarque anfíbio.</span>
              </div>
            {:else if navalCheck && navalCheck.attackerNavy > 0}
              <div class="tactical-intel-alert info">
                <Icon name="anchor" size={14} />
                <span><strong>Bombardeio Costeiro:</strong> Frotas aliadas no Porto concedem +1 ao dado mais alto!</span>
              </div>
            {/if}

            <UnitSelector
              available={getTerritoryUnits(game.territories[selectedFromId])}
              bind:selection={selectedUnits}
              maxTotal={game.territories[selectedFromId].armies - 1}
            />

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

            {#if canArtillery || canAir}
              <div class="support-missions-row">
                {#if canArtillery}
                  <button
                    class="btn secondary-btn support-mission-btn"
                    title="Disparo de saturação sem contra-ataque: 4+ degrada fortaleza ou destrói unidades"
                    onclick={confirmArtilleryBarrage}
                  >
                    <Icon name="artillery" size={13} />
                    <span>Barragem de Artilharia ({fromUnits.artillery})</span>
                  </button>
                {/if}
                {#if canAir}
                  <button
                    class="btn secondary-btn support-mission-btn"
                    title="Apoio Aéreo Aproximado: +1 dado no próximo ataque a este território"
                    onclick={() => confirmAirMission("cas")}
                  >
                    <Icon name="aircraft" size={13} />
                    <span>Apoio Aéreo (CAS)</span>
                  </button>
                  <button
                    class="btn secondary-btn support-mission-btn"
                    title="Bombardeio Estratégico: 5+ degrada construções inimigas"
                    onclick={() => confirmAirMission("bombardment")}
                  >
                    <Icon name="bombardment" size={13} />
                    <span>Bombardeio Estratégico</span>
                  </button>
                  <button
                    class="btn secondary-btn support-mission-btn"
                    title="Reconhecimento Aéreo: revela dados secretos e espionagem"
                    onclick={() => confirmAirMission("recon")}
                  >
                    <Icon name="recon-plane" size={13} />
                    <span>Reconhecimento</span>
                  </button>
                {/if}
              </div>
            {/if}

            <div class="attack-cta-row">
              <button class="btn secondary" onclick={clearSelection}>
                {t("cancel")}
              </button>
              <button
                class="btn btn-attack"
                style="flex: 1;"
                disabled={selectedUnitTotal < 1 || (navalCheck?.isBlockaded ?? false)}
                onclick={confirmAttack}
              >
                <Icon name="phase-attack" size={15} /> {t("combat_execute")}
              </button>
            </div>
          </div>
        {/if}

      {:else if game.phase === "maneuver"}
        {#if selectedFromId && !selectedToId}
          {@const fromT = game.territories[selectedFromId]}
          {@const availableUnits = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT))}
          {@const maxM = Math.max(0, totalUnits(availableUnits) - 1)}
          <div class="action-popup maneuver-popup">
            <div class="popup-head">
              <h4>
                <Icon name="phase-maneuver" size={14} />
                <span>{getTerritoryName(selectedFromId)}: Escolha o Destino</span>
              </h4>
              <button class="preset-btn" onclick={clearSelection} aria-label={t("close")}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div class="maneuver-prompt-box">
              <p class="maneuver-hint-text">
                {#if maxM < 1}
                  Esta província possui apenas 1 divisão (guarnição mínima) ou tropas já movimentadas. Selecione outra província aliada com mais tropas.
                {:else}
                  Clique em um território aliado conectado (por terra, mar ou aeródromo) no mapa para traçar a rota de reagrupamento ({maxM} div disponíveis).
                {/if}
              </p>
              <div class="maneuver-prompt-actions">
                <button class="btn secondary" onclick={clearSelection} title="Desmarcar esta província e escolher outra origem">
                  Trocar Origem
                </button>
                <button class="btn outline-button" onclick={() => sendAction({ type: "end_turn" })}>
                  {t("end_turn")}
                </button>
              </div>
            </div>
          </div>
        {:else if selectedFromId && selectedToId}
          {@const fromT = game.territories[selectedFromId]}
          {@const toT = game.territories[selectedToId]}
          {@const availableUnits = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT))}
          {@const isNeighbor = Boolean(territoryById.get(selectedFromId)?.neighbors.includes(selectedToId))}
          {@const isConnected = isNeighbor || isConnectedByFriendlyPath(game, selectedFromId, selectedToId, myPlayerId ?? "")}
          {@const isAirlift =
            !isConnected &&
            hasTerritoryBuilding(fromT, "airfield") &&
            hasTerritoryBuilding(toT, "airfield")}
          {@const maxM = isAirlift
            ? Math.min(availableUnits.infantry, Math.max(0, totalUnits(availableUnits) - 1))
            : Math.max(0, totalUnits(availableUnits) - 1)}
          {@const currentTransfer = isAirlift ? sliderArmies : selectedUnitTotal}
          {@const fromTotal = totalUnits(getTerritoryUnits(fromT))}
          {@const toTotal = totalUnits(getTerritoryUnits(toT))}
          {@const fromRemaining = Math.max(1, fromTotal - currentTransfer)}
          {@const toProjected = toTotal + currentTransfer}

          <div class="action-popup maneuver-popup">
            <div class="popup-head">
              <h4>
                {#if isAirlift}
                  <Icon name="airfield" size={14} />
                  <span>Ponte Aérea Estratégica</span>
                {:else}
                  <Icon name="phase-maneuver" size={14} />
                  <span>Remanejamento Tático</span>
                {/if}
              </h4>
              <button class="preset-btn" onclick={clearSelection} aria-label={t("close")}>
                <Icon name="close" size={12} />
              </button>
            </div>

            <!-- Dual Contrasting Cards: Origem vs Destino (HEGEM-97) -->
            <div class="maneuver-dual-cards">
              <div class="maneuver-card from-card">
                <div class="card-tag from">ORIGEM</div>
                <strong class="card-territory-name">{getTerritoryName(selectedFromId)}</strong>
                <div class="card-metrics-grid">
                  <div class="metric-item">
                    <span class="metric-lbl">Atual</span>
                    <strong class="metric-val">{fromTotal} div</strong>
                  </div>
                  <div class="metric-item">
                    <span class="metric-lbl">Guarnição</span>
                    <span class="metric-pill locked">1 retida</span>
                  </div>
                  <div class="metric-item highlight">
                    <span class="metric-lbl">Restante</span>
                    <strong class="metric-val rem">{fromRemaining} div</strong>
                  </div>
                </div>
              </div>

              <div class="maneuver-transfer-divider">
                <Icon name="arrow-right" size={16} />
                <span class="transfer-badge">+{currentTransfer}</span>
              </div>

              <div class="maneuver-card to-card">
                <div class="card-tag to">DESTINO</div>
                <strong class="card-territory-name">{getTerritoryName(selectedToId)}</strong>
                <div class="card-metrics-grid">
                  <div class="metric-item">
                    <span class="metric-lbl">Atual</span>
                    <strong class="metric-val">{toTotal} div</strong>
                  </div>
                  <div class="metric-item">
                    <span class="metric-lbl">Reforço</span>
                    <span class="metric-pill receiving">+{currentTransfer}</span>
                  </div>
                  <div class="metric-item highlight">
                    <span class="metric-lbl">Projetado</span>
                    <strong class="metric-val proj">{toProjected} div</strong>
                  </div>
                </div>
              </div>
            </div>

            <!-- Quick Action Preset Buttons (HEGEM-97) -->
            <div class="maneuver-quick-bar">
              <span class="quick-title">Seleção Rápida:</span>
              <button
                type="button"
                class="quick-preset-btn"
                disabled={maxM < 1 || (isAirlift ? sliderArmies >= maxM : selectedUnitTotal >= maxM)}
                onclick={() => {
                  if (isAirlift) sliderArmies = Math.min(maxM, sliderArmies + 1);
                  else quickSetManeuver("plus1", maxM, availableUnits);
                }}
              >
                +1
              </button>
              <button
                type="button"
                class="quick-preset-btn"
                disabled={maxM < 1}
                onclick={() => {
                  if (isAirlift) sliderArmies = Math.max(1, Math.floor(maxM / 2));
                  else quickSetManeuver("half", maxM, availableUnits);
                }}
              >
                50% ({Math.max(1, Math.floor(maxM / 2))})
              </button>
              <button
                type="button"
                class="quick-preset-btn"
                disabled={maxM < 1}
                onclick={() => {
                  if (isAirlift) sliderArmies = maxM;
                  else quickSetManeuver("max", maxM, availableUnits);
                }}
              >
                MÁXIMO ({maxM})
              </button>
              <button
                type="button"
                class="quick-preset-btn"
                disabled={currentTransfer === 0}
                onclick={() => {
                  if (isAirlift) sliderArmies = 1;
                  else quickSetManeuver("clear", maxM, availableUnits);
                }}
              >
                LIMPAR
              </button>
            </div>

            {#if isAirlift}
              <div class="slider-row">
                <input type="range" min="1" max={maxM} disabled={maxM < 1} bind:value={sliderArmies} />
              </div>
            {:else}
              <UnitSelector
                available={availableUnits}
                bind:selection={selectedUnits}
                maxTotal={maxM}
              />
            {/if}

            <div class="maneuver-actions-row">
              <button
                class="btn primary-gold btn-confirm-maneuver"
                disabled={currentTransfer < 1}
                onclick={confirmManeuver}
              >
                <Icon name="check" size={14} />
                CONFIRMAR REAGRUPAMENTO ({currentTransfer})
              </button>

              {#if canSwapManeuverRoute}
                <button
                  type="button"
                  class="btn secondary btn-swap-route"
                  onclick={swapManeuverRoute}
                  title="Inverter origem e destino: enviar de {getTerritoryName(selectedToId)} para {getTerritoryName(selectedFromId)}"
                >
                  <Icon name="reset" size={13} />
                  INVERTER ROTA (⇄)
                </button>
              {/if}

              <button
                type="button"
                class="btn outline-button btn-change-origin"
                onclick={useDestinationAsOrigin}
                title="Tornar este destino a nova província de origem"
              >
                USAR COMO ORIGEM
              </button>

              <button
                type="button"
                class="btn outline-button btn-change-target"
                onclick={() => { selectedToId = null; }}
                title="Escolher outro território de destino"
              >
                TROCAR DESTINO
              </button>

              <button
                class="btn outline-button btn-skip-maneuver"
                onclick={() => sendAction({ type: "end_turn" })}
              >
                ENCERRAR TURNO SEM MANOBRA
              </button>
            </div>
          </div>
        {/if}
      {/if}
    {/if}

    <!-- 1 - 2 - 3 Step Phase Navigator -->
    <div class="phase-stepper-row">
      <div class="phase-steps-group" role="group" aria-label="Turn Phases">
        <div class="phase-step" class:active-phase={game.phase === "deploy"} title={t("phase_deploy_desc")}>
          <span class="num">1</span>
          <span class="step-icon"><Icon name="phase-deploy" size={12} /></span>
          <span class="label">{t("phase_deploy")}</span>
        </div>
        <div class="phase-step" class:active-phase={game.phase === "attack"} title={t("phase_attack_desc")}>
          <span class="num">2</span>
          <span class="step-icon"><Icon name="phase-attack" size={12} /></span>
          <span class="label">{t("phase_attack")}</span>
        </div>
        <div class="phase-step" class:active-phase={game.phase === "maneuver"} title={t("phase_maneuver_desc")}>
          <span class="num">3</span>
          <span class="step-icon"><Icon name="phase-maneuver" size={12} /></span>
          <span class="label">{t("phase_maneuver")}</span>
        </div>
      </div>

      <div class="phase-action-slot">
        {#if isMyTurn && !game.winnerId}
          {#if game.phase === "deploy" && game.round > 1}
            <button
              class="btn secondary phase-cta-btn"
              disabled={(myPlayerState?.unplacedArmies ?? 0) > 0}
              title={(myPlayerState?.unplacedArmies ?? 0) > 0
                ? "Posicione todas as tropas de reforço antes de avançar para o ataque"
                : "Avançar para a fase de ataque"}
              onclick={() => sendAction({ type: "end_deploy" })}
            >
              {t("advance_to_attack")}
            </button>
          {:else if game.phase === "attack" && !game.pendingConquest}
            <button class="btn secondary phase-cta-btn" onclick={() => sendAction({ type: "end_attack" })}>
              {t("advance_to_maneuver")}
            </button>
          {:else if game.phase === "maneuver"}
            <button class="btn primary-gold phase-cta-btn" onclick={() => sendAction({ type: "end_turn" })}>
              <Icon name="check" size={14} /> {t("end_turn")}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </footer>
{/if}

<style>
  .bottom-center-dock {
    position: fixed;
    left: 50%;
    bottom: 0.75rem;
    transform: translateX(-50%);
    z-index: 25;
    width: auto;
    min-width: min(calc(100vw - 2rem), 320px);
    max-width: min(calc(100vw - 1.5rem), 560px);
    margin: 0;
    pointer-events: auto;
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 6px;
    padding: 0.45rem 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    box-sizing: border-box;
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
  .conquest-btn.locked {
    opacity: 0.65;
    cursor: not-allowed;
    filter: grayscale(0.5);
    pointer-events: none;
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
    cursor: pointer;
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

  .attack-matchup {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    padding: 0.15rem 0.1rem;
  }
  .matchup-side {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    flex: 1;
  }
  .matchup-side.origin {
    justify-content: flex-start;
  }
  .matchup-side.target {
    justify-content: flex-end;
    text-align: right;
  }
  .matchup-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #cbd5e1;
  }
  .matchup-armies {
    color: #fde68a;
    font-weight: 700;
    margin-left: 0.2rem;
  }
  .vs {
    background: #991b1b;
    color: #fecaca;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    flex-shrink: 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
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
  .tactical-intel-alert {
    margin: 3px 0;
    font-size: 0.76rem;
    padding: 5px 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 0.42rem;
    line-height: 1.3;
  }
  .tactical-intel-alert.danger {
    color: #fca5a5;
    background: rgba(185, 28, 28, 0.24);
    border: 1px solid rgba(239, 68, 68, 0.4);
  }
  .tactical-intel-alert.warning {
    color: #fdba74;
    background: rgba(194, 65, 12, 0.24);
    border: 1px solid rgba(249, 115, 22, 0.4);
  }
  .tactical-intel-alert.gold {
    color: #fde047;
    background: rgba(202, 138, 4, 0.24);
    border: 1px solid rgba(234, 179, 8, 0.4);
  }
  .tactical-intel-alert.info {
    color: #38bdf8;
    background: rgba(2, 132, 199, 0.24);
    border: 1px solid rgba(56, 189, 248, 0.4);
  }

  .support-missions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .support-mission-btn {
    font-size: 0.74rem;
    padding: 4px 8px;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .attack-cta-row {
    display: flex;
    gap: 0.45rem;
  }
  .btn {
    border-radius: 5px;
    padding: 0.42rem 0.75rem;
    font-family: var(--font-tactical);
    font-weight: 800;
    font-size: 0.76rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .phase-cta-btn {
    padding: 0.32rem 0.65rem;
    font-size: 0.71rem;
    height: 30px;
    white-space: nowrap;
    flex-shrink: 0;
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
  .btn.btn-attack {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border: 1px solid rgba(252, 165, 165, 0.5);
    color: white;
  }
  .phase-stepper-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    width: 100%;
    min-height: 34px;
  }
  .phase-steps-group {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .phase-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.32rem;
    padding: 0.32rem 0.58rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.82);
    color: #64748b;
    font-family: var(--font-tactical);
    font-size: 0.73rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid rgba(148, 163, 184, 0.14);
    white-space: nowrap;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .phase-step .num {
    width: 17px;
    height: 17px;
    border-radius: 3px;
    background: #1e293b;
    font-family: var(--font-mono);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    color: #94a3b8;
    line-height: 1;
    flex-shrink: 0;
  }
  .phase-step .step-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    flex-shrink: 0;
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
  .phase-step.active-phase .step-icon {
    opacity: 1;
    color: #fef08a;
  }
  .phase-action-slot {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    min-width: 24px;
  }

  /* --- HEGEM-97: Maneuver Redesign Styles --- */
  .maneuver-popup {
    min-width: 360px;
    max-width: 440px;
  }
  .maneuver-prompt-box {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.35rem 0.2rem;
  }
  .maneuver-hint-text {
    font-size: 0.76rem;
    color: #94a3b8;
    line-height: 1.35;
    margin: 0;
  }
  .maneuver-prompt-actions {
    display: flex;
    justify-content: flex-end;
  }
  .maneuver-dual-cards {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0;
  }
  .maneuver-card {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.55rem;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.18);
  }
  .maneuver-card.from-card {
    border-left: 3px solid #38bdf8;
  }
  .maneuver-card.to-card {
    border-right: 3px solid #facc15;
  }
  .card-tag {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
  }
  .card-tag.from {
    color: #38bdf8;
  }
  .card-tag.to {
    color: #facc15;
  }
  .card-territory-name {
    display: block;
    font-size: 0.82rem;
    font-weight: 700;
    color: #f8fafc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0.15rem 0 0.35rem 0;
  }
  .card-metrics-grid {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.72rem;
  }
  .metric-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .metric-lbl {
    color: #94a3b8;
  }
  .metric-val {
    color: #e2e8f0;
    font-family: var(--font-mono);
  }
  .metric-val.rem {
    color: #38bdf8;
    font-weight: 700;
  }
  .metric-val.proj {
    color: #fde047;
    font-weight: 700;
  }
  .metric-pill {
    font-size: 0.64rem;
    padding: 0.08rem 0.32rem;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .metric-pill.locked {
    background: rgba(56, 189, 248, 0.15);
    color: #7dd3fc;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }
  .metric-pill.receiving {
    background: rgba(234, 179, 8, 0.18);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.35);
  }
  .maneuver-transfer-divider {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    color: #38bdf8;
  }
  .transfer-badge {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 800;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }
  .maneuver-quick-bar {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0;
  }
  .quick-title {
    font-size: 0.7rem;
    color: #94a3b8;
    font-family: var(--font-tactical);
    margin-right: 0.15rem;
  }
  .quick-preset-btn {
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
    font-size: 0.68rem;
    font-family: var(--font-mono);
    font-weight: 700;
    padding: 0.2rem 0.45rem;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .quick-preset-btn:hover:not(:disabled) {
    background: rgba(56, 189, 248, 0.25);
    border-color: #38bdf8;
    color: #f8fafc;
  }
  .quick-preset-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .maneuver-actions-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.35rem;
    margin-top: 0.4rem;
    width: 100%;
    box-sizing: border-box;
  }
  .btn-confirm-maneuver {
    grid-column: 1 / -1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.45rem 0.75rem;
  }
  .btn-swap-route,
  .btn-change-origin,
  .btn-change-target {
    font-size: 0.68rem;
    padding: 0.32rem 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .btn-skip-maneuver {
    grid-column: 1 / -1;
    font-size: 0.72rem;
    white-space: normal;
    text-align: center;
    padding: 0.35rem 0.5rem;
    opacity: 0.85;
  }

  @media (max-width: 1200px) {
    .bottom-center-dock {
      max-width: min(calc(100vw - 2rem), 480px);
      padding: 0.4rem 0.65rem;
    }
  }

  @media (max-width: 820px) {
    .bottom-center-dock {
      width: calc(100vw - 1rem);
      max-width: calc(100vw - 1rem);
      min-width: 0;
      bottom: 0.4rem;
      padding: 0.35rem 0.5rem;
    }
    .phase-stepper-row {
      display: grid;
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 0.3rem;
    }
    .phase-steps-group {
      display: flex;
      width: 100%;
      justify-content: space-between;
    }
    .phase-step {
      flex: 1;
      justify-content: center;
      padding: 0.22rem 0.32rem;
      font-size: 0.65rem;
    }
    .phase-action-slot {
      width: 100%;
    }
    .phase-action-slot button {
      width: 100%;
    }
  }
</style>