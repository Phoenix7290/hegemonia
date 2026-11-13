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
    PlayerColor,
    PlayerState,
    TerritoryDef,
    TerritoryState,
    UnitType,
  } from "@hegemonia/shared";
  import type { IconName } from "../lib/icons";

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
    handleDemolishStructure: (territoryId: string, type: BuildingType) => void;
    handleExpandInfrastructure?: (territoryId: string) => void;
    handleRecruitUnit: (territoryId: string, unitType: UnitType) => void;
    canRecruitUnit: (territoryId: string, unitType: UnitType) => boolean;
    getRecruitRequirement: (unitType: UnitType) => string;
    getTerritoryName: (territoryId: string) => string;
    onClose?: () => void;
    onSelectCapital?: (territoryId: string) => void;
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
    handleDemolishStructure,
    handleExpandInfrastructure,
    handleRecruitUnit,
    canRecruitUnit,
    getRecruitRequirement,
    getTerritoryName,
    onClose,
    onSelectCapital,
  }: Props = $props();

  const COLOR_HEX: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    dark_green: "#15803d",
    yellow: "#facc15",
    orange: "#f97316",
    pink: "#ec4899",
    purple: "#a855f7",
    black: "#94a3b8",
    white: "#f8fafc",
  };

  const UNIT_ROLE_SUMMARY: Record<UnitType, string> = {
    infantry: "Guarnição & Assalto de Linha",
    tank: "Blitzkrieg & Re-rolagem de 1s",
    artillery: "Barragem de Saturação",
    aircraft: "Apoio CAS, Bombardeio & Recon",
    navy: "Supremacia Naval & Costeira",
  };

  function getBuildingIcon(type: BuildingType, level?: number): IconName {
    if (type === "fortification") {
      return level === 2 ? "fortification-l2" : "fortification";
    }
    return type as IconName;
  }

  function getBuildingEffectShort(type: BuildingType, level?: number): string {
    if (type === "market") return "+$2/turno • Libera Mercado";
    if (type === "civilian_factory") return "+$3/turno • +1 Slot de Obra";
    if (type === "industry") {
      return level === 2
        ? "4x Extração • +$4 Dividendos"
        : "2x Extração • Produz Blindados/Art.";
    }
    if (type === "military_factory") return "Produz Blindados & Artilharia";
    if (type === "steel_mine") return "+2 Aço/turno na jazida";
    if (type === "oil_well") return "+2 Petróleo/turno na bacia";
    if (type === "refinery") return "+1 Petróleo sintético/turno";
    if (type === "fortification") {
      return level === 2
        ? "+1 Defesa & -1 Ataque Inimigo"
        : "+1 no Maior Dado de Defesa";
    }
    if (type === "airfield") return "Opera Aeronaves & Ponte Aérea";
    if (type === "port") return "Opera Marinha & +$1 Polo Naval";
    return "";
  }
</script>

{#if !isImmersiveMode && hudVisible}
  {#if inspectedTerritory}
    {@const bldgs = inspectedTerritory.state.buildings ?? []}
    {@const maxSlots = getTerritoryMaxBuildingSlots(game, inspectedTerritory.def.id)}
    {@const isOwnedByMe = inspectedTerritory.state.ownerId === myPlayerId}
    {@const inspectedFortLevel = getTerritoryBuildingLevel(inspectedTerritory.state, "fortification")}
    {@const hasIndustry = hasTerritoryBuilding(inspectedTerritory.state, "industry")}
    {@const hasArmory =
      hasTerritoryBuilding(inspectedTerritory.state, "industry") ||
      hasTerritoryBuilding(inspectedTerritory.state, "military_factory")}
    {@const myRes = myPlayerState?.resources ?? { money: 0, steel: 0, oil: 0, gold: 0 }}
    {@const ownerAccent = inspectedTerritory.owner
      ? COLOR_HEX[inspectedTerritory.owner.color]
      : "#64748b"}
    {@const territoryUnits = getTerritoryUnits(inspectedTerritory.state)}

    <aside
      class="recon-slide-drawer"
      style="--owner-accent: {ownerAccent};"
    >
      <div class="recon-inspector-card" data-testid="territory-command-panel">
        <div class="card-corner tl"></div>
        <div class="card-corner tr"></div>
        <div class="card-corner bl"></div>
        <div class="card-corner br"></div>

        <!-- 1. TOP COMMAND BAR -->
        <header class="recon-panel-superhead">
          <div class="superhead-title">
            <span class="superhead-badge">
              <Icon name="compass" size={14} color="#facc15" />
            </span>
            <span>{t("recon_title")}</span>
          </div>
          {#if onClose}
            <button
              type="button"
              class="btn-recon-close"
              onclick={onClose}
              title="Fechar Dossiê Territorial e voltar ao Quadro de Generais (ESC)"
              aria-label="Fechar Dossiê Territorial"
            >
              <Icon name="back" size={13} />
              <span>Generais</span>
              <kbd class="esc-tag">ESC</kbd>
            </button>
          {/if}
        </header>

        <!-- SCROLLABLE WAR ROOM DOSSIER BODY -->
        <div class="recon-scroll-body">
          <!-- 2. HERO TERRITORY IDENTITY BANNER -->
          <section class="recon-hero-card">
            <div class="recon-head">
              <div class="flag-frame">
                {#if inspectedTerritory.owner}
                  <FactionFlag color={inspectedTerritory.owner.color} width={34} height={22} />
                {:else}
                  <Icon name="flag" size={18} color="#94a3b8" />
                {/if}
              </div>

              <div class="hero-title-block">
                <div class="hero-name-row">
                  <strong>{getTerritoryName(inspectedTerritory.def.id)}</strong>
                  {#if isOwnedByMe}
                    <span class="allegiance-tag own">SOB SEU COMANDO</span>
                  {:else if inspectedTerritory.owner}
                    <span class="allegiance-tag enemy">TERRITÓRIO RIVAL</span>
                  {/if}
                </div>
                <span class="hero-occupant">
                  {t("recon_occupant", {
                    name: inspectedTerritory.owner?.name ?? t("recon_neutral"),
                  })}
                </span>
              </div>

              <div class="recon-garrison-box" title={t("recon_garrison")}>
                <span class="garrison-num">{inspectedTerritory.state.armies}</span>
                <span class="garrison-lbl recon-garrison">
                  {t("division_short", { count: inspectedTerritory.state.armies })}
                </span>
              </div>
            </div>

            <!-- Capital & Tactical Logistics Alerts -->
            {#if inspectedTerritory.owner?.capitalTerritoryId === inspectedTerritory.def.id}
              <div class="recon-capital-tag gold">
                <Icon name="capital" size={14} />
                <span>{t("capital_national")}</span>
              </div>
            {:else if game.players.some((p) => p.capitalTerritoryId === inspectedTerritory.def.id)}
              {@const origOwner = game.players.find(
                (p) => p.capitalTerritoryId === inspectedTerritory.def.id
              )}
              <div class="recon-capital-tag red">
                <Icon name="capital-fallen" size={14} />
                <span>{t("capital_captured", { name: origOwner?.name ?? "" })}</span>
              </div>
            {:else if isOwnedByMe && isMyTurn && game.phase === "deploy" && !myPlayerState?.capitalTerritoryId && onSelectCapital}
              <button
                type="button"
                class="btn-set-capital"
                onclick={() => onSelectCapital(inspectedTerritory!.def.id)}
                title={t("capital_select_hint")}
              >
                <Icon name="capital" size={15} />
                <span>{t("capital_select_btn")} (+1 Div/Turno • 3 Slots)</span>
              </button>
            {/if}

            {#if inspectedTerritory.state.isEncircled}
              <div class="recon-status-alert danger">
                <Icon name="supply-cut" size={14} />
                <span>Linha de Suprimento Cortada (Território sob Cerco)</span>
              </div>
            {/if}
            {#if inspectedTerritory.state.outOfFuel}
              <div class="recon-status-alert warning">
                <Icon name="fuel-empty" size={14} />
                <span>Falta de Combustível (Blindados sem re-rolagem)</span>
              </div>
            {/if}
            {#if inspectedTerritory.state.blitzkriegAvailable}
              <div class="recon-status-alert gold">
                <Icon name="blitzkrieg" size={14} />
                <span>Impulso Blitzkrieg Disponível para Avanço Blindado</span>
              </div>
            {/if}

            <!-- Theater, Frontiers & Geography Pills -->
            <div class="recon-meta">
              <span class="meta-chip theater">
                <Icon name="globe" size={12} />
                <span>{inspectedTerritory.regionName}</span>
              </span>
              <span class="meta-chip">
                <Icon name="compass" size={12} />
                <span>{t("recon_borders", { count: inspectedTerritory.def.neighbors.length })}</span>
              </span>
              <span class="meta-chip">
                {#if inspectedTerritory.def.isCoastal !== false}
                  <Icon name="anchor" size={12} />
                  <span>{t("res_coastal")}</span>
                {:else}
                  <Icon name="shield" size={12} />
                  <span>{t("res_landlocked")}</span>
                {/if}
              </span>
            </div>

            <!-- Strategic Resource & Trade Hub Extraction -->
            <div class="recon-economy-row">
              {#if inspectedTerritory.def.resource === "steel"}
                <div class="recon-res-badge steel">
                  <div class="res-badge-icon">
                    <Icon name="steel" size={16} />
                  </div>
                  <div class="res-badge-copy">
                    <strong>{t("res_steel")} (+{hasIndustry ? 2 : 1}/turno)</strong>
                    <small>{hasIndustry ? "Extração Industrial Dobrada" : "Jazida Siderúrgica"}</small>
                  </div>
                </div>
              {:else if inspectedTerritory.def.resource === "oil"}
                <div class="recon-res-badge oil">
                  <div class="res-badge-icon">
                    <Icon name="oil" size={16} />
                  </div>
                  <div class="res-badge-copy">
                    <strong>{t("res_oil")} (+{hasIndustry ? 2 : 1}/turno)</strong>
                    <small>{hasIndustry ? "Refinaria Industrial Ativa" : "Bacia Petrolífera"}</small>
                  </div>
                </div>
              {:else if inspectedTerritory.def.resource === "gold"}
                <div class="recon-res-badge gold">
                  <div class="res-badge-icon">
                    <Icon name="gold" size={16} />
                  </div>
                  <div class="res-badge-copy">
                    <strong>{t("res_gold")} (+{hasIndustry ? 2 : 1} / +$2)</strong>
                    <small>Reserva Estratégica & Tesouraria</small>
                  </div>
                </div>
              {/if}

              {#if inspectedTerritory.def.tradeBonus && inspectedTerritory.def.tradeBonus > 0}
                <div class="recon-res-badge money">
                  <div class="res-badge-icon">
                    <Icon name="coins" size={16} />
                  </div>
                  <div class="res-badge-copy">
                    <strong>{t("res_trade_hub", { bonus: inspectedTerritory.def.tradeBonus })}</strong>
                    <small>Rota Comercial Marítima/Continental</small>
                  </div>
                </div>
              {/if}
            </div>
          </section>

          <!-- 3. COMMANDER TREASURY & STOCKPILE QUICK READOUT -->
          {#if myPlayerState}
            <div class="recon-treasury-bar" title="Recursos disponíveis no seu Tesouro Nacional">
              <span class="treasury-kicker">SEU ESTOQUE</span>
              <div class="treasury-pills">
                <span class="t-pill money">
                  <Icon name="coins" size={13} />
                  <strong>${myRes.money}</strong>
                </span>
                <span class="t-pill steel">
                  <Icon name="steel" size={13} />
                  <strong>{myRes.steel}</strong>
                </span>
                <span class="t-pill oil">
                  <Icon name="oil" size={13} />
                  <strong>{myRes.oil}</strong>
                </span>
                <span class="t-pill gold">
                  <Icon name="gold" size={13} />
                  <strong>{myRes.gold}</strong>
                </span>
              </div>
            </div>
          {/if}

          <!-- 4. GARRISON ORDER OF BATTLE (UNIT COMPOSITION) -->
          <section class="recon-section recon-unit-composition">
            <div class="section-header-bar">
              <span class="infra-title">
                <Icon name="shield" size={14} />
                <span>{t("unit_composition_title")}</span>
              </span>
              <span class="section-counter-pill">
                {inspectedTerritory.state.armies} {t("division_short", { count: inspectedTerritory.state.armies })}
              </span>
            </div>

            <div class="recon-unit-chips">
              {#each UNIT_TYPES as unitType}
                {@const quantity = territoryUnits[unitType]}
                <div
                  class="recon-unit-chip {unitType}"
                  class:has-units={quantity > 0}
                  title="{t(`unit_${unitType}`)}: {quantity}"
                >
                  <div class="unit-chip-icon">
                    <Icon name={unitType} size={18} />
                  </div>
                  <span class="unit-chip-name">{t(`unit_${unitType}`)}</span>
                  <strong class="unit-chip-count">{quantity}</strong>
                </div>
              {/each}
            </div>
          </section>

          <!-- 5. TERRITORIAL INFRASTRUCTURE & MILITARY ENGINEERING (HEGEM-32 & HEGEM-107) -->
          <section class="recon-section">
            <div class="section-header-bar recon-infra-header">
              <span class="infra-title">
                <Icon name="industry" size={14} />
                <span>{t("building_section_title")}</span>
              </span>
              <span class="infra-slots">
                {t("building_slots_count", { used: bldgs.length, max: maxSlots })}
              </span>
            </div>

            <!-- Visual Slot Matrix (Shows Built Structures & Empty Slots in 2 columns) -->
            <div class="recon-active-bldgs">
              {#each Array(maxSlots) as _, slotIdx}
                {@const b = bldgs[slotIdx]}
                {#if b}
                  <div class="recon-bldg-chip {b.type}">
                    <div class="bldg-slot-icon">
                      <Icon name={getBuildingIcon(b.type, b.level)} size={18} />
                    </div>
                    <div class="bldg-slot-info">
                      <strong>
                        {#if b.type === "fortification"}
                          {b.level === 2 ? t("building_fortification_l2") : t("building_fortification_l1")}
                        {:else if b.type === "market"}
                          {t("building_market")}
                        {:else if b.type === "civilian_factory"}
                          {t("building_civilian_factory")}
                        {:else if b.type === "industry"}
                          {b.level === 2 ? t("building_industry_l2") : t("building_industry_l1")}
                        {:else if b.type === "military_factory"}
                          {t("building_military_factory")}
                        {:else if b.type === "steel_mine"}
                          {t("building_steel_mine")}
                        {:else if b.type === "oil_well"}
                          {t("building_oil_well")}
                        {:else if b.type === "refinery"}
                          {t("building_refinery")}
                        {:else if b.type === "airfield"}
                          {t("building_airfield")}
                        {:else if b.type === "port"}
                          {t("building_port")}
                        {/if}
                      </strong>
                      <small>{getBuildingEffectShort(b.type, b.level)}</small>
                    </div>
                    {#if isOwnedByMe && isMyTurn && game.phase === "deploy" && !game.pendingConquest && !game.winnerId}
                      <button
                        type="button"
                        class="btn-chip-demolish"
                        onclick={() => handleDemolishStructure(inspectedTerritory!.def.id, b.type)}
                        title="Demolir estrutura (+50% reembolso de Aço/Dinheiro)"
                        aria-label="Demolir estrutura"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    {:else}
                      <span class="bldg-active-pill">{t("building_built_tag")}</span>
                    {/if}
                  </div>
                {:else}
                  <div class="recon-empty-slot">
                    <div class="empty-slot-icon">
                      <Icon name="plus" size={14} />
                    </div>
                    <span>Slot Livre (#{slotIdx + 1})</span>
                  </div>
                {/if}
              {/each}
            </div>

            <!-- Construction Blueprint Buttons (2-Column Grid) -->
            {#if isOwnedByMe && isMyTurn && !game.pendingConquest && !game.winnerId}
              {#if myPlayerState?.doctrineId === "extermination"}
                <div class="extermination-no-build-box" style="margin-top: 1rem; padding: 12px; background: rgba(136, 19, 55, 0.15); border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 6px; text-align: center;">
                  <strong style="color: #fb7185; font-size: 0.8rem; display: block; margin-bottom: 4px;">DOUTRINA DE EXTERMÍNIO: CONSTRUÇÃO PROIBIDA</strong>
                  <span style="color: #cbd5e1; font-size: 0.74rem;">Esta nação opera com economia nula (0 0 0 0) focada em aniquilação e não desenvolve infraestrutura civil.</span>
                </div>
              {:else}
              <div class="recon-build-grid">
                <!-- +1 Slot Extra (Permanent Infrastructure Expansion) -->
                {#if handleExpandInfrastructure && !inspectedTerritory.state.infrastructureExpanded && game.phase === "deploy"}
                  <button
                    type="button"
                    class="btn-build-option btn-build-expand"
                    disabled={myRes.money < 4 || myRes.steel < 1}
                    onclick={() => handleExpandInfrastructure!(inspectedTerritory!.def.id)}
                    title="Expandir a Infraestrutura territorial permanentemente adicionando +1 Slot de Construção ($4 + 1 Aço)"
                  >
                    <div class="build-opt-icon expand">
                      <Icon name="plus" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">+1 Slot de Engenharia</span>
                      <small class="build-opt-sub">Expansão de Obra Permanente</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 4}>
                        <Icon name="coins" size={11} /> $4
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Market ($5) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "market")}
                  {@const isMarketBanned = myPlayerState?.doctrineId === "extermination"}
                  <button
                    type="button"
                    class="btn-build-option market-opt"
                    class:doctrine-banned={isMarketBanned}
                    disabled={isMarketBanned || bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "market")}
                    title={isMarketBanned ? "Proibido pela Doutrina de Extermínio" : t("building_market_desc")}
                  >
                    <div class="build-opt-icon market">
                      <Icon name="market" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_market")}</span>
                      <small class="build-opt-sub" class:locked-req={isMarketBanned}>
                        {isMarketBanned ? "BLOQUEADO PELA DOUTRINA" : "+$2/turno • Mercado Global"}
                      </small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 5}>
                        <Icon name="coins" size={11} /> $5
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Civilian Factory ($6, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "civilian_factory")}
                  {@const isCivBanned = myPlayerState?.doctrineId === "extermination"}
                  <button
                    type="button"
                    class="btn-build-option civilian-factory-opt"
                    class:doctrine-banned={isCivBanned}
                    disabled={isCivBanned || bldgs.length >= maxSlots || myRes.money < 6 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "civilian_factory")}
                    title={isCivBanned ? "Proibido pela Doutrina de Extermínio" : t("building_civilian_factory_desc")}
                  >
                    <div class="build-opt-icon civilian_factory">
                      <Icon name="civilian_factory" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_civilian_factory")}</span>
                      <small class="build-opt-sub" class:locked-req={isCivBanned}>
                        {isCivBanned ? "BLOQUEADO PELA DOUTRINA" : "+$3/turno • +1 Slot de Obra"}
                      </small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 6}>
                        <Icon name="coins" size={11} /> $6
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Industry ($6, 1 Steel) or Upgrade to Lv2 for Tall Sovereign ($8, 2 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "industry")}
                  <button
                    type="button"
                    class="btn-build-option industry-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 6 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "industry")}
                    title={t("building_industry_desc")}
                  >
                    <div class="build-opt-icon industry">
                      <Icon name="industry" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_industry")}</span>
                      <small class="build-opt-sub">2x Extração • Tanques & Art.</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 6}>
                        <Icon name="coins" size={11} /> $6
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {:else if (myPlayerState?.doctrineId === "tall_sovereign" || myPlayerState?.doctrineId === "defense_in_depth") && getTerritoryBuildingLevel(inspectedTerritory.state, "industry") === 1}
                  <button
                    type="button"
                    class="btn-build-option upgrade industry-opt"
                    disabled={myRes.money < 6 || myRes.steel < 2}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "industry")}
                    title={t("building_industry_l2_desc")}
                  >
                    <div class="build-opt-icon industry">
                      <Icon name="industry" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_industry_l2")}</span>
                      <small class="build-opt-sub">+100% Produção & Dividendos</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 6}>
                        <Icon name="coins" size={11} /> $6
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 2}>
                        <Icon name="steel" size={11} /> 2
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Military Factory ($7, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "military_factory")}
                  <button
                    type="button"
                    class="btn-build-option military-factory-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 7 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "military_factory")}
                    title={t("building_military_factory_desc")}
                  >
                    <div class="build-opt-icon military_factory">
                      <Icon name="military_factory" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_military_factory")}</span>
                      <small class="build-opt-sub">Produz Blindados & Artilharia</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 7}>
                        <Icon name="coins" size={11} /> $7
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Steel Mine ($5, only on steel deposits) -->
                {#if inspectedTerritory.def.resource === "steel" && !hasTerritoryBuilding(inspectedTerritory.state, "steel_mine")}
                  <button
                    type="button"
                    class="btn-build-option steel-mine-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "steel_mine")}
                    title={t("building_steel_mine_desc")}
                  >
                    <div class="build-opt-icon steel_mine">
                      <Icon name="steel_mine" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_steel_mine")}</span>
                      <small class="build-opt-sub">+2 Aço/turno na jazida</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 5}>
                        <Icon name="coins" size={11} /> $5
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Oil Well ($5, only on oil basins) -->
                {#if inspectedTerritory.def.resource === "oil" && !hasTerritoryBuilding(inspectedTerritory.state, "oil_well")}
                  <button
                    type="button"
                    class="btn-build-option oil-well-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "oil_well")}
                    title={t("building_oil_well_desc")}
                  >
                    <div class="build-opt-icon oil_well">
                      <Icon name="oil_well" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_oil_well")}</span>
                      <small class="build-opt-sub">+2 Petróleo/turno na bacia</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 5}>
                        <Icon name="coins" size={11} /> $5
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Refinery ($7, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "refinery")}
                  <button
                    type="button"
                    class="btn-build-option refinery-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 7 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "refinery")}
                    title={t("building_refinery_desc")}
                  >
                    <div class="build-opt-icon refinery">
                      <Icon name="refinery" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_refinery")}</span>
                      <small class="build-opt-sub">+1 Petróleo sintético/turno</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 7}>
                        <Icon name="coins" size={11} /> $7
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Fortification (Casamata $6 / Fortaleza $6+2A) -->
                {#if inspectedFortLevel === 0}
                  <button
                    type="button"
                    class="btn-build-option fort-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 6}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                    title={t("building_fortification_l1_desc")}
                  >
                    <div class="build-opt-icon fortification">
                      <Icon name="fortification" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_fortification_l1")}</span>
                      <small class="build-opt-sub">+1 no Maior Dado de Defesa</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 6}>
                        <Icon name="coins" size={11} /> $6
                      </strong>
                    </div>
                  </button>
                {:else if inspectedFortLevel === 1}
                  <button
                    type="button"
                    class="btn-build-option upgrade fort-opt"
                    disabled={myRes.money < 6 || myRes.steel < 2}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "fortification")}
                    title={t("building_fortification_l2_desc")}
                  >
                    <div class="build-opt-icon fortification-l2">
                      <Icon name="fortification-l2" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_btn_upgrade_l2")}</span>
                      <small class="build-opt-sub">+1 Defesa & -1 Ataque Inimigo</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 6}>
                        <Icon name="coins" size={11} /> $6
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 2}>
                        <Icon name="steel" size={11} /> 2
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Airfield ($5, 1 Steel) -->
                {#if !hasTerritoryBuilding(inspectedTerritory.state, "airfield")}
                  <button
                    type="button"
                    class="btn-build-option airfield-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5 || myRes.steel < 1}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "airfield")}
                    title={t("building_airfield_desc")}
                  >
                    <div class="build-opt-icon airfield">
                      <Icon name="airfield" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_airfield")}</span>
                      <small class="build-opt-sub">Força Aérea & Ponte Aérea</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 5}>
                        <Icon name="coins" size={11} /> $5
                      </strong>
                      <strong class="cost-tag steel" class:missing={myRes.steel < 1}>
                        <Icon name="steel" size={11} /> 1
                      </strong>
                    </div>
                  </button>
                {/if}

                <!-- Port ($5, coastal only) -->
                {#if inspectedTerritory.def.isCoastal !== false && !hasTerritoryBuilding(inspectedTerritory.state, "port")}
                  <button
                    type="button"
                    class="btn-build-option port-opt"
                    disabled={bldgs.length >= maxSlots || myRes.money < 5}
                    onclick={() => handleBuildStructure(inspectedTerritory!.def.id, "port")}
                    title={t("building_port_desc")}
                  >
                    <div class="build-opt-icon port">
                      <Icon name="port" size={18} />
                    </div>
                    <div class="build-opt-copy">
                      <span class="build-opt-title">{t("building_port")}</span>
                      <small class="build-opt-sub">Ancora Marinha & +$1 Polo</small>
                    </div>
                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < 5}>
                        <Icon name="coins" size={11} /> $5
                      </strong>
                    </div>
                  </button>
                {/if}
              </div>
              {/if}
            {/if}
          </section>

          <!-- 6. DIVISIONAL RECRUITMENT & MOBILIZATION -->
          {#if isOwnedByMe && isMyTurn && game.phase === "deploy" && !game.pendingConquest && !game.winnerId}
            <section class="recon-section">
              <div class="section-header-bar recon-infra-header recon-recruit-header">
                <span class="infra-title">
                  <Icon name="infantry" size={14} />
                  <span>{t("unit_recruit_title")}</span>
                </span>
                <span class="section-counter-pill gold">FASE 1 • MOBILIZAÇÃO</span>
              </div>

              <div class="recon-build-grid recruit-list">
                {#each UNIT_TYPES as unitType}
                  {@const cost = UNIT_COSTS[unitType]}
                  {@const isUnitBannedByDoctrine =
                    myPlayerState?.doctrineId === "mass_assault" &&
                    (unitType === "tank" || unitType === "artillery" || unitType === "aircraft")}
                  {@const canRecruit = !isUnitBannedByDoctrine && canRecruitUnit(inspectedTerritory.def.id, unitType)}
                  {@const reqText = isUnitBannedByDoctrine
                    ? "Bloqueado pela Doutrina de Assalto em Massa"
                    : getRecruitRequirement(unitType)}
                  {@const currentUnitCount = territoryUnits[unitType]}
                  {@const missingBldg =
                    (unitType === "tank" && !hasArmory) ||
                    (unitType === "artillery" && !hasArmory) ||
                    (unitType === "aircraft" && !hasTerritoryBuilding(inspectedTerritory.state, "airfield")) ||
                    (unitType === "navy" &&
                      ((myPlayerState?.doctrineId !== "extermination" &&
                        !hasTerritoryBuilding(inspectedTerritory.state, "port")) ||
                        inspectedTerritory.def.isCoastal === false))}

                  <button
                    type="button"
                    class="btn-build-option recruit-option {unitType}"
                    class:doctrine-banned={isUnitBannedByDoctrine}
                    disabled={!canRecruit}
                    onclick={() => handleRecruitUnit(inspectedTerritory!.def.id, unitType)}
                    title={reqText}
                  >
                    <div class="build-opt-icon unit-icon {unitType}">
                      <Icon name={unitType} size={19} />
                    </div>

                    <div class="build-opt-copy">
                      <div class="recruit-title-row">
                        <span class="build-opt-title">{t(`unit_${unitType}`)}</span>
                        {#if currentUnitCount > 0}
                          <span class="in-field-badge">{currentUnitCount} em campo</span>
                        {/if}
                      </div>
                      {#if isUnitBannedByDoctrine}
                        <small class="build-opt-sub locked-req">
                          <Icon name="lock" size={10} />
                          <span>BLOQUEADO PELA DOUTRINA</span>
                        </small>
                      {:else if missingBldg}
                        <small class="build-opt-sub locked-req">
                          <Icon name="lock" size={10} />
                          <span>{reqText}</span>
                        </small>
                      {:else}
                        <small class="build-opt-sub">{UNIT_ROLE_SUMMARY[unitType]}</small>
                      {/if}
                    </div>

                    <div class="build-opt-costs">
                      <strong class="cost-tag money" class:missing={myRes.money < cost.money}>
                        <Icon name="coins" size={11} /> ${cost.money}
                      </strong>
                      {#if cost.steel > 0}
                        <strong class="cost-tag steel" class:missing={myRes.steel < cost.steel}>
                          <Icon name="steel" size={11} /> {cost.steel}
                        </strong>
                      {/if}
                      {#if cost.oil > 0}
                        <strong class="cost-tag oil" class:missing={myRes.oil < cost.oil}>
                          <Icon name="oil" size={11} /> {cost.oil}
                        </strong>
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        </div>
      </div>
    </aside>
  {:else}
    <div class="bottom-left-stack">
      <div class="bottom-left-hint">
        <span>{t("hints_nav")}</span>
      </div>
    </div>
  {/if}
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

  /* Left Slide-Over Command Drawer overlaying Top-Left Players Panel */
  .recon-slide-drawer {
    grid-column: 1;
    grid-row: 1 / span 3;
    align-self: start;
    z-index: 35;
    width: min(368px, calc(100vw - 1.5rem));
    max-height: calc(100vh - 1.5rem);
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    animation: reconSlideInLeft 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes reconSlideInLeft {
    from {
      opacity: 0;
      transform: translateX(-28px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .recon-inspector-card {
    position: relative;
    pointer-events: auto;
    backdrop-filter: blur(18px);
    background: linear-gradient(
      165deg,
      rgba(12, 20, 38, 0.98) 0%,
      rgba(6, 11, 22, 0.99) 100%
    );
    border: 1px solid rgba(212, 175, 55, 0.55);
    border-radius: 8px;
    box-shadow:
      0 22px 55px rgba(0, 0, 0, 0.92),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 1.5rem);
    overflow: hidden;
  }

  /* Decorative Military Brass Corner Brackets */
  .card-corner {
    position: absolute;
    width: 8px;
    height: 8px;
    border-color: #eab308;
    border-style: solid;
    pointer-events: none;
    z-index: 3;
    opacity: 0.8;
  }
  .card-corner.tl {
    top: 4px;
    left: 4px;
    border-width: 1.5px 0 0 1.5px;
  }
  .card-corner.tr {
    top: 4px;
    right: 4px;
    border-width: 1.5px 1.5px 0 0;
  }
  .card-corner.bl {
    bottom: 4px;
    left: 4px;
    border-width: 0 0 1.5px 1.5px;
  }
  .card-corner.br {
    bottom: 4px;
    right: 4px;
    border-width: 0 1.5px 1.5px 0;
  }

  /* Top Command Header Bar */
  .recon-panel-superhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.62rem 0.8rem;
    background: linear-gradient(
      90deg,
      rgba(234, 179, 8, 0.14) 0%,
      rgba(15, 23, 42, 0.85) 100%
    );
    border-bottom: 1px solid rgba(212, 175, 55, 0.32);
    flex-shrink: 0;
  }
  .superhead-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    text-transform: uppercase;
    font-weight: 800;
    letter-spacing: 0.07em;
    color: #fef08a;
    min-width: 0;
  }
  .superhead-title span:last-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .superhead-badge {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: rgba(234, 179, 8, 0.16);
    border: 1px solid rgba(234, 179, 8, 0.45);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .btn-recon-close {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.28rem 0.55rem;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.35);
    color: #e2e8f0;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .btn-recon-close:hover {
    background: rgba(234, 179, 8, 0.2);
    border-color: #facc15;
    color: #fef08a;
  }
  .esc-tag {
    font-family: var(--font-mono);
    font-size: 0.56rem;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(2, 6, 23, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #94a3b8;
  }

  /* Scrollable Dossier Body */
  .recon-scroll-body {
    padding: 0.72rem 0.8rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .recon-scroll-body::-webkit-scrollbar {
    width: 5px;
  }
  .recon-scroll-body::-webkit-scrollbar-track {
    background: rgba(5, 9, 18, 0.5);
  }
  .recon-scroll-body::-webkit-scrollbar-thumb {
    background: rgba(212, 175, 55, 0.35);
    border-radius: 999px;
  }

  /* 2. Hero Identity Card */
  .recon-hero-card {
    background: linear-gradient(
      145deg,
      rgba(15, 23, 42, 0.92) 0%,
      rgba(7, 12, 24, 0.95) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-left: 3.5px solid var(--owner-accent, #eab308);
    border-radius: 6px;
    padding: 0.65rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.48rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }
  .recon-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .flag-frame {
    width: 42px;
    height: 30px;
    border-radius: 5px;
    background: rgba(4, 8, 16, 0.9);
    border: 1px solid rgba(212, 175, 55, 0.38);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.65);
  }
  .hero-title-block {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
    flex: 1;
  }
  .hero-name-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .recon-head strong {
    font-family: var(--font-display);
    font-size: 1.02rem;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: 0.02em;
    line-height: 1.15;
  }
  .allegiance-tag {
    font-family: var(--font-tactical);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    padding: 0.08rem 0.36rem;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .allegiance-tag.own {
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.42);
    color: #6ee7b7;
  }
  .allegiance-tag.enemy {
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }
  .hero-occupant {
    font-size: 0.72rem;
    color: #94a3b8;
    font-weight: 500;
  }

  .recon-garrison-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 56px;
    padding: 0.25rem 0.5rem;
    border-radius: 5px;
    background: linear-gradient(180deg, rgba(202, 138, 4, 0.22), rgba(113, 63, 18, 0.28));
    border: 1px solid rgba(234, 179, 8, 0.5);
    flex-shrink: 0;
  }
  .garrison-num {
    font-family: var(--font-mono);
    font-size: 1.02rem;
    font-weight: 900;
    color: #fef08a;
    line-height: 1.05;
  }
  .garrison-lbl {
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #fde047;
  }

  /* Capital & Tactical Status Banners */
  .recon-capital-tag {
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.24rem 0.6rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .recon-capital-tag.gold {
    background: linear-gradient(90deg, rgba(234, 179, 8, 0.22), rgba(161, 98, 7, 0.25));
    border: 1px solid #facc15;
    color: #fef08a;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.25);
  }
  .recon-capital-tag.red {
    background: linear-gradient(90deg, rgba(239, 68, 68, 0.22), rgba(153, 27, 27, 0.25));
    border: 1px solid #f87171;
    color: #fca5a5;
  }
  .btn-set-capital {
    width: 100%;
    padding: 0.38rem 0.6rem;
    border-radius: 5px;
    background: linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(161, 98, 7, 0.35));
    border: 1px solid #facc15;
    color: #fef08a;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    transition: all 0.16s ease;
  }
  .btn-set-capital:hover {
    background: linear-gradient(135deg, rgba(250, 204, 21, 0.4), rgba(202, 138, 4, 0.5));
    box-shadow: 0 0 14px rgba(234, 179, 8, 0.35);
  }

  .recon-status-alert {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.03em;
  }
  .recon-status-alert.danger {
    background: rgba(239, 68, 68, 0.16);
    border: 1px solid rgba(239, 68, 68, 0.45);
    color: #fca5a5;
  }
  .recon-status-alert.warning {
    background: rgba(245, 158, 11, 0.16);
    border: 1px solid rgba(245, 158, 11, 0.45);
    color: #fde047;
  }
  .recon-status-alert.gold {
    background: rgba(234, 179, 8, 0.16);
    border: 1px solid rgba(234, 179, 8, 0.45);
    color: #fef08a;
  }

  /* Geography Meta Pills */
  .recon-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
  }
  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.18rem 0.45rem;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    font-size: 0.66rem;
    font-weight: 600;
    color: #cbd5e1;
  }
  .meta-chip.theater {
    color: #93c5fd;
    border-color: rgba(59, 130, 246, 0.35);
    background: rgba(30, 58, 138, 0.25);
  }

  /* Economy & Trade Resources */
  .recon-economy-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
  }
  .recon-res-badge {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    padding: 0.25rem 0.52rem;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    flex: 1 1 calc(50% - 0.2rem);
    min-width: 140px;
  }
  .res-badge-icon {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .res-badge-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .res-badge-copy strong {
    font-size: 0.7rem;
    line-height: 1.15;
  }
  .res-badge-copy small {
    font-size: 0.58rem;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recon-res-badge.steel {
    border-color: rgba(148, 163, 184, 0.4);
    color: #e2e8f0;
  }
  .recon-res-badge.steel .res-badge-icon {
    background: rgba(100, 116, 139, 0.22);
    color: #cbd5e1;
  }
  .recon-res-badge.oil {
    border-color: rgba(249, 115, 22, 0.45);
    color: #fdba74;
  }
  .recon-res-badge.oil .res-badge-icon {
    background: rgba(234, 88, 12, 0.22);
    color: #fb923c;
  }
  .recon-res-badge.gold {
    border-color: rgba(234, 179, 8, 0.45);
    color: #fef08a;
  }
  .recon-res-badge.gold .res-badge-icon {
    background: rgba(202, 138, 4, 0.22);
    color: #facc15;
  }
  .recon-res-badge.money {
    border-color: rgba(16, 185, 129, 0.45);
    color: #6ee7b7;
  }
  .recon-res-badge.money .res-badge-icon {
    background: rgba(5, 150, 105, 0.22);
    color: #34d399;
  }

  /* 3. Commander Treasury Bar */
  .recon-treasury-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    padding: 0.38rem 0.6rem;
    border-radius: 6px;
    background: linear-gradient(
      90deg,
      rgba(234, 179, 8, 0.12) 0%,
      rgba(15, 23, 42, 0.88) 100%
    );
    border: 1px solid rgba(212, 175, 55, 0.35);
  }
  .treasury-kicker {
    font-family: var(--font-tactical);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #facc15;
    text-transform: uppercase;
  }
  .treasury-pills {
    display: flex;
    align-items: center;
    gap: 0.42rem;
  }
  .t-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 800;
  }
  .t-pill.money {
    color: #6ee7b7;
  }
  .t-pill.steel {
    color: #cbd5e1;
  }
  .t-pill.oil {
    color: #fdba74;
  }
  .t-pill.gold {
    color: #fef08a;
  }

  /* Section Containers */
  .recon-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .section-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.24rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  }
  .infra-title {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #e2e8f0;
  }
  .section-counter-pill {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 800;
    padding: 0.06rem 0.36rem;
    border-radius: 999px;
    background: rgba(30, 41, 59, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #94a3b8;
  }
  .section-counter-pill.gold {
    background: rgba(234, 179, 8, 0.16);
    border-color: rgba(234, 179, 8, 0.4);
    color: #fef08a;
    font-family: var(--font-tactical);
    letter-spacing: 0.05em;
  }
  .infra-slots {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 800;
    color: #facc15;
  }

  /* 4. Garrison Unit Chips */
  .recon-unit-chips {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.28rem;
  }
  .recon-unit-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.32rem 0.2rem;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.18);
    opacity: 0.45;
    transition: all 0.15s ease;
  }
  .recon-unit-chip.has-units {
    opacity: 1;
    background: linear-gradient(
      180deg,
      rgba(22, 33, 52, 0.85) 0%,
      rgba(10, 16, 30, 0.95) 100%
    );
    border-color: rgba(212, 175, 55, 0.4);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }
  .unit-chip-icon {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
  }
  .unit-chip-name {
    font-family: var(--font-tactical);
    font-size: 0.52rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #94a3b8;
    margin-top: 0.1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unit-chip-count {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 900;
    color: #f8fafc;
    line-height: 1.1;
  }
  .recon-unit-chip.has-units .unit-chip-count {
    color: #fef08a;
  }

  /* 5. Building Slot Chips (2-Column Grid) */
  .recon-active-bldgs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem;
    margin-top: 0.25rem;
  }
  .recon-bldg-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    background: linear-gradient(
      135deg,
      rgba(22, 33, 52, 0.92) 0%,
      rgba(12, 19, 34, 0.96) 100%
    );
    border: 1px solid rgba(212, 175, 55, 0.38);
    min-width: 0;
  }
  .bldg-slot-icon {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.35);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: #fef08a;
  }
  .bldg-slot-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .bldg-slot-info strong {
    font-size: 0.68rem;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bldg-slot-info small {
    font-size: 0.58rem;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .btn-chip-demolish {
    width: 22px;
    height: 22px;
    padding: 0;
    margin: 0;
    line-height: 0;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.18);
    border: 1px solid rgba(239, 68, 68, 0.45);
    color: #fca5a5;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.14s ease;
  }
  .btn-chip-demolish:hover {
    background: #dc2626;
    color: #ffffff;
  }
  .bldg-active-pill {
    font-family: var(--font-tactical);
    font-size: 0.52rem;
    font-weight: 800;
    padding: 0.08rem 0.3rem;
    border-radius: 3px;
    background: rgba(16, 185, 129, 0.2);
    border: 1px solid rgba(16, 185, 129, 0.4);
    color: #6ee7b7;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .recon-empty-slot {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    border: 1px dashed rgba(148, 163, 184, 0.25);
    background: rgba(5, 9, 18, 0.45);
    color: #64748b;
    font-size: 0.65rem;
    font-weight: 600;
    min-width: 0;
  }
  .recon-empty-slot span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-slot-icon {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px dashed rgba(148, 163, 184, 0.25);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  /* Construction & Recruitment Action Cards */
  .recon-build-grid:not(.recruit-list) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.38rem;
    margin-top: 0.25rem;
  }
  .recon-build-grid.recruit-list {
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
    margin-top: 0.25rem;
  }

  .btn-build-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    width: 100%;
    padding: 0.42rem 0.5rem;
    border-radius: 6px;
    text-align: left;
    color: #f1f5f9;
    background: linear-gradient(
      135deg,
      rgba(22, 33, 52, 0.92) 0%,
      rgba(12, 19, 34, 0.96) 100%
    );
    border: 1px solid rgba(148, 163, 184, 0.28);
    cursor: pointer;
    transition: all 0.16s ease;
    box-sizing: border-box;
    min-height: 48px;
  }
  .btn-build-option:hover:not(:disabled) {
    background: linear-gradient(
      135deg,
      rgba(30, 45, 70, 0.96) 0%,
      rgba(18, 28, 48, 0.99) 100%
    );
    border-color: rgba(234, 179, 8, 0.55);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
    transform: translateY(-1px);
  }
  .btn-build-option:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    border-color: rgba(148, 163, 184, 0.16);
    background: rgba(15, 23, 42, 0.55);
  }
  .btn-build-option.doctrine-banned,
  .btn-build-option.doctrine-banned:disabled {
    opacity: 0.26;
    background: #02040a !important;
    border-color: rgba(30, 41, 59, 0.42) !important;
    filter: grayscale(1) brightness(0.45);
    cursor: not-allowed;
  }

  .btn-build-expand {
    grid-column: 1 / -1;
    border-color: rgba(234, 179, 8, 0.45);
    background: linear-gradient(
      135deg,
      rgba(30, 45, 68, 0.95) 0%,
      rgba(15, 23, 42, 0.98) 100%
    );
  }
  .btn-build-expand:hover:not(:disabled) {
    border-color: #facc15;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.25);
  }

  .build-opt-icon {
    width: 26px;
    height: 26px;
    border-radius: 5px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #e2e8f0;
  }
  .build-opt-icon.market {
    color: #6ee7b7;
    border-color: rgba(16, 185, 129, 0.4);
  }
  .build-opt-icon.civilian_factory {
    color: #67e8f9;
    border-color: rgba(6, 182, 212, 0.4);
  }
  .build-opt-icon.industry {
    color: #fde047;
    border-color: rgba(234, 179, 8, 0.4);
  }
  .build-opt-icon.military_factory {
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.4);
  }
  .build-opt-icon.steel_mine {
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.4);
  }
  .build-opt-icon.oil_well {
    color: #fdba74;
    border-color: rgba(251, 146, 60, 0.4);
  }
  .build-opt-icon.refinery {
    color: #fb923c;
    border-color: rgba(234, 88, 12, 0.4);
  }
  .build-opt-icon.fortification,
  .build-opt-icon.fortification-l2 {
    color: #93c5fd;
    border-color: rgba(59, 130, 246, 0.4);
  }
  .build-opt-icon.airfield {
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.4);
  }
  .build-opt-icon.port {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
  }
  .build-opt-icon.expand {
    color: #fef08a;
    border-color: #eab308;
    background: rgba(234, 179, 8, 0.2);
  }

  .build-opt-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .build-opt-title {
    font-family: var(--font-tactical);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .build-opt-sub {
    font-size: 0.58rem;
    color: #94a3b8;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .build-opt-costs {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    flex-shrink: 0;
  }
  .cost-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-family: var(--font-mono);
    font-size: 0.64rem;
    font-weight: 800;
    padding: 0.08rem 0.32rem;
    border-radius: 3px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.25);
  }
  .cost-tag.money {
    color: #6ee7b7;
  }
  .cost-tag.steel {
    color: #cbd5e1;
  }
  .cost-tag.oil {
    color: #fdba74;
  }
  .cost-tag.missing {
    color: #f87171 !important;
    border-color: rgba(239, 68, 68, 0.4) !important;
    background: rgba(127, 29, 29, 0.3) !important;
  }

  /* Recruitment List in 1 column */
  .recruit-option {
    min-height: 52px;
  }
  .recruit-title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .in-field-badge {
    font-family: var(--font-tactical);
    font-size: 0.52rem;
    font-weight: 800;
    padding: 0.05rem 0.28rem;
    border-radius: 3px;
    background: rgba(234, 179, 8, 0.18);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #fef08a;
    text-transform: uppercase;
  }
  .locked-req {
    color: #fca5a5;
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
  }

  .bottom-left-hint {
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 5px;
    padding: 0.3rem 0.55rem;
    color: #94a3b8;
    font-size: 0.65rem;
    pointer-events: auto;
  }
</style>
