<script lang="ts">
  import Icon from "./Icon.svelte";
  import UnitSelector from "./UnitSelector.svelte";
  import { t } from "../i18n/index.svelte";
  import { isSeaLink } from "@hegemonia/maps";
  import {
    checkNavalBlockade,
    getMovedInUnits,
    getTerritoryUnits,
    hasTerritoryBuilding,
    subtractUnits,
    totalUnits,
  } from "@hegemonia/engine";
  import type {
    AirMissionType,
    GameState,
    PlayerState,
    TerritoryDef,
    UnitCounts,
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
            class="btn primary-gold"
            disabled={selectedUnitTotal < game.pendingConquest.minMove}
            onclick={confirmOccupy}
          >
            {t("conquest_advance", { count: selectedUnitTotal })}
          </button>
        </div>

      {:else if game.phase === "deploy"}
        {#if selectedFromId}
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
              <button class="btn primary-gold" data-testid="btn-confirm-deploy" disabled={fromTerr?.isEncircled} onclick={confirmDeploy}>
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
          {@const canArtillery = fromUnits.artillery > 0 && !fromTerr.artilleryBarrageFiredThisTurn && (!navalCheck || !navalCheck.isBlockaded)}
          {@const canAir = hasTerritoryBuilding(fromTerr, "airfield") && fromUnits.aircraft > 0 && !fromTerr.airMissionFlownThisTurn && (myPlayerState?.resources?.oil ?? 0) > 0}
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

            <!-- Tactical Logistics & Support Intel -->
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
                data-testid="btn-confirm-attack"
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
        {#if selectedFromId && selectedToId}
          {@const fromT = game.territories[selectedFromId]}
          {@const toT = game.territories[selectedToId]}
          {@const availableUnits = subtractUnits(getTerritoryUnits(fromT), getMovedInUnits(fromT))}
          {@const isAirlift =
            !territoryById.get(selectedFromId)?.neighbors.includes(selectedToId) &&
            hasTerritoryBuilding(fromT, "airfield") &&
            hasTerritoryBuilding(toT, "airfield")}
          {@const maxM = Math.min(availableUnits.infantry, Math.max(0, totalUnits(availableUnits) - 1))}
          <div class="action-popup">
            <div class="popup-head">
              <h4>
                {#if isAirlift}
                  <Icon name="airfield" size={14} />
                  <span>{t("airlift_btn_label")} ({getTerritoryName(selectedFromId)}</span>
                  <Icon name="arrow-right" size={12} />
                  <span>{getTerritoryName(selectedToId)})</span>
                {:else}
                  {t("maneuver_prompt", { from: getTerritoryName(selectedFromId), to: getTerritoryName(selectedToId) })}
                {/if}
              </h4>
              <div class="quick-presets">
                {#if isAirlift}
                  <button class="preset-btn" disabled={maxM < 1} onclick={() => (sliderArmies = 1)}>Min (1)</button>
                  <button class="preset-btn" disabled={maxM < 1} onclick={() => (sliderArmies = maxM)}>Max ({maxM})</button>
                {/if}
                <button class="preset-btn" onclick={clearSelection} aria-label={t("close")}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            </div>
            {#if isAirlift}
              <div class="slider-row">
                <input type="range" min="1" max={maxM} disabled={maxM < 1} bind:value={sliderArmies} />
                <button class="btn primary-gold" disabled={maxM < 1} onclick={confirmManeuver}>
                  <Icon name="airfield" size={14} /> {t("airlift_btn_label")} ({sliderArmies})
                </button>
              </div>
            {:else}
              <UnitSelector
                available={availableUnits}
                bind:selection={selectedUnits}
                maxTotal={Math.max(0, totalUnits(availableUnits) - 1)}
              />
              <button
                class="btn primary-gold"
                data-testid="btn-confirm-maneuver"
                disabled={selectedUnitTotal < 1}
                onclick={confirmManeuver}
              >
                {t("maneuver_transfer", { count: selectedUnitTotal })}
              </button>
            {/if}
          </div>
        {/if}
      {/if}
    {/if}

    <!-- 1 - 2 - 3 Step Phase Navigator (HEGEM-63: Stabilized 3-Column Grid) -->
    <div class="phase-stepper-row">
      <div class="phase-balance-slot" aria-hidden="true"></div>
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
          {#if game.phase === "attack" && !game.pendingConquest}
            <button class="btn secondary" data-testid="btn-end-attack" onclick={() => sendAction({ type: "end_attack" })}>
              {t("advance_to_maneuver")}
            </button>
          {:else if game.phase === "maneuver"}
            <button class="btn primary-gold" data-testid="btn-end-turn" onclick={() => sendAction({ type: "end_turn" })}>
              <Icon name="check" size={15} /> {t("end_turn")}
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
    width: min(calc(100vw - 2rem), 620px);
    margin: 0;
    pointer-events: auto;
    background: rgba(8, 14, 26, 0.94);
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 6px;
    padding: 0.55rem 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
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
  .btn.btn-attack {
    background: linear-gradient(135deg, #dc2626, #991b1b);
    border: 1px solid rgba(252, 165, 165, 0.5);
    color: white;
  }
  .phase-stepper-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 34px;
  }
  .phase-balance-slot {
    min-width: 0;
  }
  .phase-steps-group {
    display: inline-grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    justify-items: stretch;
    gap: 0.32rem;
  }
  .phase-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.32rem;
    padding: 0.32rem 0.55rem;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.82);
    color: #64748b;
    font-family: var(--font-tactical);
    font-size: 0.74rem;
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
    justify-self: end;
    display: inline-flex;
    align-items: center;
  }
  @media (max-width: 1180px) {
    .bottom-center-dock {
      width: min(calc(100vw - 2rem), 520px);
    }
  }
  @media (max-width: 1024px) {
    .bottom-center-dock {
      width: min(calc(100vw - 1.5rem), 490px);
      bottom: 0.5rem;
    }
  }
  @media (max-width: 820px) {
    .bottom-center-dock {
      width: min(calc(100vw - 1rem), 440px);
    }
    .phase-stepper-row {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 0.35rem;
    }
    .phase-balance-slot {
      display: none;
    }
    .phase-action-slot {
      justify-self: center;
    }
    .phase-step {
      padding: 0.25rem 0.45rem;
      font-size: 0.68rem;
    }
  }
</style>
