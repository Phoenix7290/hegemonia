<script lang="ts">
  import Icon from "./Icon.svelte";
  import FactionFlag from "./FactionFlag.svelte";
  import { t } from "../i18n/index.svelte";
  import {
    UNIT_TYPES,
    UNIT_COSTS,
    getTerritoryUnits,
    getTerritoryBuildingLevel,
    getTerritoryMaxBuildingSlots,
    hasTerritoryBuilding,
  } from "@hegemonia/engine";
  import type {
    BuildingType,
    GameState,
    PlayerState,
    TerritoryDef,
    TerritoryState,
    UnitType,
  } from "@hegemonia/shared";

  interface Props {
    game: GameState;
    myPlayerId: string | null;
    myPlayerState: PlayerState | undefined;
    isMyTurn: boolean;
    inspectedTerritory: {
      def: TerritoryDef;
      state: TerritoryState;
      owner: PlayerState | null;
      regionName: string;
    } | null;
    isImmersiveMode?: boolean;
    hudVisible?: boolean;
    handleBuildStructure: (territoryId: string, type: BuildingType) => void;
    handleRecruitUnit: (territoryId: string, unitType: UnitType) => void;
    canRecruitUnit: (territoryId: string, unitType: UnitType) => boolean;
    getRecruitRequirement: (unitType: UnitType) => string;
    getTerritoryName: (territoryId: string) => string;
  }

  let {
    game,
    myPlayerId,
    myPlayerState,
    isMyTurn,
    inspectedTerritory,
    isImmersiveMode = false,
    hudVisible = true,
    handleBuildStructure,
    handleRecruitUnit,
    canRecruitUnit,
    getRecruitRequirement,
    getTerritoryName,
  }: Props = $props();
</script>

{#if !isImmersiveMode && hudVisible}
  <div class="bottom-left-stack">
    {#if inspectedTerritory}
      {@const bldgs = inspectedTerritory.state.buildings ?? []}
      {@const maxSlots = getTerritoryMaxBuildingSlots(game, inspectedTerritory.def.id)}
      {@const isOwnedByMe = inspectedTerritory.state.ownerId === myPlayerId}
      {@const inspectedFortLevel = getTerritoryBuildingLevel(inspectedTerritory.state, "fortification")}
      {@const myRes = myPlayerState?.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
      <div class="recon-inspector-card" data-testid="territory-command-panel">
        <div class="recon-panel-superhead">
          <Icon name="industry" size={11} color="#d4af37" />
          <span>{t("recon_title")}</span>
        </div>
        <div class="recon-head">
          {#if inspectedTerritory.owner}
            <FactionFlag color={inspectedTerritory.owner.color} width={20} height={13} />
          {/if}
          <strong>{getTerritoryName(inspectedTerritory.def.id)}</strong>
          <span class="recon-garrison">{inspectedTerritory.state.armies} {t("division_short", { count: inspectedTerritory.state.armies })}</span>
        </div>
        {#if inspectedTerritory.owner?.capitalTerritoryId === inspectedTerritory.def.id}
          <div class="recon-capital-tag gold">
            {t("capital_national")}
          </div>
        {:else if game.players.some((p) => p.capitalTerritoryId === inspectedTerritory.def.id)}
          {@const origOwner = game.players.find((p) => p.capitalTerritoryId === inspectedTerritory.def.id)}
          <div class="recon-capital-tag red">
            {t("capital_captured", { name: origOwner?.name ?? "" })}
          </div>
        {/if}
        <div class="recon-meta">
          <span>{inspectedTerritory.regionName}</span>
          <span>•</span>
          <span>{t("recon_occupant", { name: inspectedTerritory.owner?.name ?? t("recon_neutral") })}</span>
          <span>•</span>
          <span>{t("recon_borders", { count: inspectedTerritory.def.neighbors.length })}</span>
        </div>
        <div class="recon-economy-row">
          {#if inspectedTerritory.def.resource === "steel"}
            <span class="recon-res-badge steel">
              <Icon name="steel" size={11} /> {t("res_steel")} (+1)
            </span>
          {:else if inspectedTerritory.def.resource === "oil"}
            <span class="recon-res-badge oil">
              <Icon name="oil" size={11} /> {t("res_oil")} (+1)
            </span>
          {:else if inspectedTerritory.def.resource === "gold"}
            <span class="recon-res-badge gold">
              <Icon name="gold" size={11} /> {t("res_gold")} (+1 / +$2)
            </span>
          {/if}
          {#if inspectedTerritory.def.tradeBonus && inspectedTerritory.def.tradeBonus > 0}
            <span class="recon-res-badge money">
              <Icon name="coins" size={11} /> {t("res_trade_hub", { bonus: inspectedTerritory.def.tradeBonus })}
            </span>
          {/if}
          <span class="recon-res-badge geo">
            {#if inspectedTerritory.def.isCoastal !== false}
              <Icon name="anchor" size={11} /> {t("res_coastal")}
            {:else}
              <Icon name="shield" size={11} /> {t("res_landlocked")}
            {/if}
          </span>
        </div>

        <div class="recon-unit-composition">
          <span class="infra-title"><Icon name="infantry" size={11} /> {t("unit_composition_title")}</span>
          <div class="recon-unit-chips">
            {#each UNIT_TYPES as unitType}
              {@const quantity = getTerritoryUnits(inspectedTerritory.state)[unitType]}
              {#if quantity > 0}
                <span class="recon-unit-chip" title={t(`unit_${unitType}`)}>
                  <Icon name={unitType} size={11} /> {quantity}
                </span>
              {/if}
            {/each}
          </div>
        </div>

        <!-- Territorial Infrastructure Section (HEGEM-32) -->
        <div class="recon-infra-header">
          <span class="infra-title"><Icon name="industry" size={11} /> {t("building_section_title")}</span>
          <span class="infra-slots">{t("building_slots_count", { used: bldgs.length, max: maxSlots })}</span>
        </div>

        {#if bldgs.length > 0}
          <div class="recon-active-bldgs">
            {#each bldgs as b}
              <span class="recon-bldg-chip {b.type}">
                <Icon name={b.type === "fortification" ? "fortification" : b.type} size={11} />
                {#if b.type === "fortification"}
                  {b.level === 2 ? t("building_fortification_l2") : t("building_fortification_l1")}
                {:else if b.type === "market"}
                  {t("building_market")}
                {:else if b.type === "industry"}
                  {t("building_industry")}
                {:else if b.type === "airfield"}
                  {t("building_airfield")}
                {:else if b.type === "port"}
                  {t("building_port")}
                {/if}
              </span>
            {/each}
          </div>
        {/if}

        {#if isOwnedByMe && isMyTurn && !game.pendingConquest && !game.winnerId}
          <div class="recon-build-grid">
            <!-- Market ($5) -->
            {#if !hasTerritoryBuilding(inspectedTerritory.state, "market")}
              <button
                class="btn-build-option"
                disabled={bldgs.length >= maxSlots || myRes.money < 5}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "market")}
                title={t("building_market_desc")}
              >
                <Icon name="market" size={11} />
                <span>{t("building_market")}</span>
                <strong class="cost-tag">$5</strong>
              </button>
            {/if}

            <!-- Industry ($6, 1 Steel) -->
            {#if !hasTerritoryBuilding(inspectedTerritory.state, "industry")}
              <button
                class="btn-build-option"
                disabled={bldgs.length >= maxSlots || myRes.money < 6 || myRes.steel < 1}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "industry")}
                title={t("building_industry_desc")}
              >
                <Icon name="industry" size={11} />
                <span>{t("building_industry")}</span>
                <strong class="cost-tag">$6+1A</strong>
              </button>
            {/if}

            <!-- Fortification (Casamata $4 / Fortaleza $4+1A) -->
            {#if inspectedFortLevel === 0}
              <button
                class="btn-build-option"
                disabled={bldgs.length >= maxSlots || myRes.money < 4}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                title={t("building_fortification_l1_desc")}
              >
                <Icon name="fortification" size={11} />
                <span>{t("building_fortification_l1")}</span>
                <strong class="cost-tag">$4</strong>
              </button>
            {:else if inspectedFortLevel === 1}
              <button
                class="btn-build-option upgrade"
                disabled={myRes.money < 4 || myRes.steel < 1}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                title={t("building_fortification_l2_desc")}
              >
                <Icon name="fortification" size={11} />
                <span>{t("building_btn_upgrade_l2")}</span>
                <strong class="cost-tag">$4+1A</strong>
              </button>
            {/if}

            <!-- Airfield ($5, 1 Steel) -->
            {#if !hasTerritoryBuilding(inspectedTerritory.state, "airfield")}
              <button
                class="btn-build-option"
                disabled={bldgs.length >= maxSlots || myRes.money < 5 || myRes.steel < 1}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "airfield")}
                title={t("building_airfield_desc")}
              >
                <Icon name="airfield" size={11} />
                <span>{t("building_airfield")}</span>
                <strong class="cost-tag">$5+1A</strong>
              </button>
            {/if}

            <!-- Port ($5, coastal only) -->
            {#if inspectedTerritory.def.isCoastal !== false && !hasTerritoryBuilding(inspectedTerritory.state, "port")}
              <button
                class="btn-build-option"
                disabled={bldgs.length >= maxSlots || myRes.money < 5}
                onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "port")}
                title={t("building_port_desc")}
              >
                <Icon name="anchor" size={11} />
                <span>{t("building_port")}</span>
                <strong class="cost-tag">$5</strong>
              </button>
            {/if}
          </div>
        {/if}

        {#if isOwnedByMe && isMyTurn && game.phase === "deploy" && !game.pendingConquest && !game.winnerId}
          <div class="recon-infra-header recon-recruit-header">
            <span class="infra-title"><Icon name="plus" size={11} /> {t("unit_recruit_title")}</span>
          </div>
          <div class="recon-build-grid">
            {#each UNIT_TYPES as unitType}
              {@const cost = UNIT_COSTS[unitType]}
              <button
                class="btn-build-option recruit-option"
                disabled={!canRecruitUnit(inspectedTerritory.def.id, unitType)}
                onclick={() => handleRecruitUnit(inspectedTerritory!.def.id, unitType)}
                title={getRecruitRequirement(unitType)}
              >
                <Icon name={unitType} size={11} />
                <span>{t(`unit_${unitType}`)}</span>
                <strong class="cost-tag">
                  {t("unit_cost_summary", { money: cost.money, steel: cost.steel, oil: cost.oil })}
                </strong>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="bottom-left-hint">
      <span>{t("hints_nav")}</span>
    </div>
  </div>
{/if}

<style>
  .bottom-left-stack {
    grid-column: 1;
    grid-row: 3;
    align-self: end;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .recon-inspector-card {
    pointer-events: auto;
    background: linear-gradient(160deg, rgba(11, 18, 33, 0.94), rgba(6, 11, 21, 0.96));
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 6px;
    padding: 0.5rem 0.65rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.75);
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
  }
  .recon-panel-superhead {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #d4af37;
    border-bottom: 1px solid rgba(212, 175, 55, 0.2);
    padding-bottom: 0.25rem;
    margin-bottom: 0.15rem;
  }
  .recon-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .recon-head strong {
    font-family: var(--font-display);
    font-size: 0.86rem;
    color: #f8fafc;
  }
  .recon-garrison {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 800;
    color: #fef08a;
    background: rgba(202, 138, 4, 0.18);
    border: 1px solid rgba(234, 179, 8, 0.4);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .recon-capital-tag {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    width: fit-content;
  }
  .recon-capital-tag.gold {
    background: rgba(234, 179, 8, 0.15);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.45);
  }
  .recon-capital-tag.red {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.45);
  }
  .recon-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.68rem;
    color: #94a3b8;
  }
  .recon-economy-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.28rem;
  }
  .recon-res-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    padding: 0.14rem 0.42rem;
    border-radius: 4px;
    font-size: 0.67rem;
    font-weight: 600;
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
  }
  .recon-res-badge.steel {
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.35);
  }
  .recon-res-badge.oil {
    color: #fdba74;
    border-color: rgba(251, 146, 60, 0.35);
  }
  .recon-res-badge.gold {
    color: #fde047;
    border-color: rgba(250, 204, 21, 0.4);
  }
  .recon-res-badge.money {
    color: #6ee7b7;
    border-color: rgba(52, 211, 153, 0.35);
  }
  .recon-unit-composition {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.3rem 0;
  }
  .recon-unit-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .recon-unit-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.35rem;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 3px;
    background: rgba(15, 23, 42, 0.72);
    color: #cbd5e1;
    font-family: var(--font-mono);
    font-size: 0.62rem;
  }
  .recon-infra-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.35rem;
    padding-top: 0.3rem;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
  }
  .infra-title {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .infra-slots {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: #cbd5e1;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .recon-active-bldgs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  .recon-bldg-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.12rem 0.38rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }
  .recon-bldg-chip.market {
    color: #fde047;
    border-color: rgba(234, 179, 8, 0.4);
    background: rgba(234, 179, 8, 0.1);
  }
  .recon-bldg-chip.industry {
    color: #fb923c;
    border-color: rgba(251, 146, 60, 0.4);
    background: rgba(251, 146, 60, 0.1);
  }
  .recon-bldg-chip.fortification {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.1);
  }
  .recon-bldg-chip.airfield {
    color: #93c5fd;
    border-color: rgba(96, 165, 250, 0.4);
    background: rgba(96, 165, 250, 0.1);
  }
  .recon-bldg-chip.port {
    color: #5eead4;
    border-color: rgba(45, 212, 191, 0.4);
    background: rgba(45, 212, 191, 0.1);
  }
  .recon-build-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem;
    margin-top: 0.3rem;
  }
  .btn-build-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.2rem;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    font-size: 0.64rem;
    font-weight: 600;
    color: #e2e8f0;
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.25);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-build-option:hover:not(:disabled) {
    background: rgba(51, 65, 85, 0.85);
    border-color: #facc15;
    color: #ffffff;
  }
  .btn-build-option.upgrade {
    border-color: rgba(56, 189, 248, 0.45);
    color: #bae6fd;
  }
  .btn-build-option.upgrade:hover:not(:disabled) {
    border-color: #38bdf8;
    background: rgba(14, 116, 144, 0.35);
  }
  .btn-build-option:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: grayscale(0.6);
  }
  .btn-build-option .cost-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: #facc15;
    background: rgba(0, 0, 0, 0.35);
    padding: 1px 3px;
    border-radius: 2px;
  }
  .recon-recruit-header {
    margin-top: 0.25rem;
  }
  .recruit-option {
    grid-column: span 1;
  }
  .bottom-left-hint {
    background: rgba(9, 14, 26, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    font-size: 0.68rem;
    color: #94a3b8;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    width: fit-content;
  }
  @media (max-width: 1024px) {
    .bottom-left-hint {
      display: none;
    }
    .bottom-left-stack {
      margin-bottom: 3.6rem;
    }
  }
</style>
