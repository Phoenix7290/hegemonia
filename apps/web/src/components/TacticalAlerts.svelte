<script lang="ts">
  import Icon from "./Icon.svelte";
  import { tooltip } from "../lib/tooltip";
  import { t } from "../i18n/index.svelte";
  import { CLASSIC_MAP } from "@hegemonia/maps";
  import type { GameState, PlayerState } from "@hegemonia/shared";

  interface Props {
    game: GameState;
    myPlayerId: string | null;
    myPlayerState: PlayerState | undefined;
    isMyTurn: boolean;
    onFocusTerritory: (territoryId: string) => void;
  }

  let {
    game,
    myPlayerId,
    myPlayerState,
    isMyTurn,
    onFocusTerritory,
  }: Props = $props();

  let artilleryIndex = $state(0);
  let aircraftIndex = $state(0);
  let encircledIndex = $state(0);
  let enemyEncircledIndex = $state(0);

  // 1. Territories with ready Artillery during attack phase
  const readyArtilleryTerritories = $derived.by(() => {
    if (!myPlayerId || !isMyTurn || game.phase !== "attack") return [];
    return CLASSIC_MAP.territories
      .filter((t) => {
        const terrState = game.territories[t.id];
        if (!terrState || terrState.occupierId !== myPlayerId) return false;
        const artCount = terrState.units.artillery ?? 0;
        if (artCount <= 0) return false;
        // Check for adjacent enemy territories
        return t.neighbors.some((nId) => {
          const neighbor = game.territories[nId];
          return neighbor && neighbor.occupierId !== myPlayerId;
        });
      })
      .map((t) => t.id);
  });

  // 2. Territories with ready Aircraft during attack phase
  const readyAircraftTerritories = $derived.by(() => {
    if (!myPlayerId || !isMyTurn || game.phase !== "attack") return [];
    return CLASSIC_MAP.territories
      .filter((t) => {
        const terrState = game.territories[t.id];
        if (!terrState || terrState.occupierId !== myPlayerId) return false;
        return (terrState.units.fighter ?? 0) > 0;
      })
      .map((t) => t.id);
  });

  // 3. My territories suffering Encirclement (supply cut)
  const myEncircledTerritories = $derived.by(() => {
    if (!myPlayerId) return [];
    return CLASSIC_MAP.territories
      .filter((t) => {
        const terrState = game.territories[t.id];
        return terrState?.occupierId === myPlayerId && Boolean(terrState.isEncircled);
      })
      .map((t) => t.id);
  });

  // 4. Enemy territories that are Encircled and border my frontlines
  const enemyEncircledTerritories = $derived.by(() => {
    if (!myPlayerId) return [];
    const myTerrIds = new Set(
      Object.entries(game.territories)
        .filter(([_, st]) => st.occupierId === myPlayerId)
        .map(([id]) => id)
    );
    return CLASSIC_MAP.territories
      .filter((t) => {
        const terrState = game.territories[t.id];
        if (!terrState || terrState.occupierId === myPlayerId || !terrState.isEncircled) {
          return false;
        }
        return t.neighbors.some((nId) => myTerrIds.has(nId));
      })
      .map((t) => t.id);
  });

  // 5. Critical Fuel Starvation (outOfFuel)
  const isOutOfFuelWithMechanized = $derived.by(() => {
    if (!myPlayerId || !myPlayerState) return false;
    const oil = myPlayerState.resources?.oil ?? 0;
    if (oil > 0) return false;
    return Object.values(game.territories).some((t) => {
      if (t.occupierId !== myPlayerId) return false;
      return (t.units.tank ?? 0) > 0 || (t.units.fighter ?? 0) > 0;
    });
  });

  function focusNextArtillery() {
    if (readyArtilleryTerritories.length === 0) return;
    const target = readyArtilleryTerritories[artilleryIndex % readyArtilleryTerritories.length];
    artilleryIndex += 1;
    onFocusTerritory(target);
  }

  function focusNextAircraft() {
    if (readyAircraftTerritories.length === 0) return;
    const target = readyAircraftTerritories[aircraftIndex % readyAircraftTerritories.length];
    aircraftIndex += 1;
    onFocusTerritory(target);
  }

  function focusNextEncircled() {
    if (myEncircledTerritories.length === 0) return;
    const target = myEncircledTerritories[encircledIndex % myEncircledTerritories.length];
    encircledIndex += 1;
    onFocusTerritory(target);
  }

  function focusNextEnemyEncircled() {
    if (enemyEncircledTerritories.length === 0) return;
    const target = enemyEncircledTerritories[enemyEncircledIndex % enemyEncircledTerritories.length];
    enemyEncircledIndex += 1;
    onFocusTerritory(target);
  }
</script>

<div class="tactical-alerts-bar" aria-label="Alertas Táticos da Campanha">
  {#if readyArtilleryTerritories.length > 0}
    <button
      class="alert-pill alert-action artillery"
      onclick={focusNextArtillery}
      use:tooltip={{
        title: `${t("tactical_alerts_artillery_ready")} (${readyArtilleryTerritories.length})`,
        content: "Divisões de artilharia com linha de visão e alvos adjacentes prontos para assalto ou saturação. Clique para mirar no setor."
      }}
    >
      <Icon name="bombardment" size={13} />
      <span>{t("tactical_alerts_artillery_ready")}</span>
      <span class="count-badge">{readyArtilleryTerritories.length}</span>
    </button>
  {/if}

  {#if readyAircraftTerritories.length > 0}
    <button
      class="alert-pill alert-action aircraft"
      onclick={focusNextAircraft}
      use:tooltip={{
        title: `${t("tactical_alerts_aircraft_ready")} (${readyAircraftTerritories.length})`,
        content: "Esquadrilhas aéreas disponíveis para bombardeio estratégico e superioridade. Clique para focar a base operacional."
      }}
    >
      <Icon name="aircraft" size={13} />
      <span>{t("tactical_alerts_aircraft_ready")}</span>
      <span class="count-badge">{readyAircraftTerritories.length}</span>
    </button>
  {/if}

  {#if myEncircledTerritories.length > 0}
    <button
      class="alert-pill alert-danger encircled"
      onclick={focusNextEncircled}
      use:tooltip={{
        title: `${t("tactical_alerts_encircled_warning")} (${myEncircledTerritories.length})`,
        content: "Alerta Crítico: Território isolado sem rota de suprimentos até a Capital. Penalidade defensiva de -1 ou -2 aplicada. Clique para inspecionar a guarnição cercada."
      }}
    >
      <Icon name="supply-cut" size={13} />
      <span>{t("tactical_alerts_encircled_warning")}</span>
      <span class="count-badge">{myEncircledTerritories.length}</span>
    </button>
  {/if}

  {#if enemyEncircledTerritories.length > 0}
    <button
      class="alert-pill alert-opportunity enemy-encircled"
      onclick={focusNextEnemyEncircled}
      use:tooltip={{
        title: `${t("tactical_alerts_encircled_opportunity")} (${enemyEncircledTerritories.length})`,
        content: "Oportunidade Tática: Forças inimigas fronteiriças estão sitiadas e sem suprimentos (-1 ou -2 DEF). Setor vulnerável para avanço rápido. Clique para centrar."
      }}
    >
      <Icon name="target" size={13} />
      <span>{t("tactical_alerts_encircled_opportunity")}</span>
      <span class="count-badge">{enemyEncircledTerritories.length}</span>
    </button>
  {/if}

  {#if isOutOfFuelWithMechanized}
    <div
      class="alert-pill alert-warning fuel"
      use:tooltip={{
        title: t("tactical_alerts_out_of_fuel"),
        content: "Seus tanques blindados e caças estão sem combustível suficiente. Bônus de superioridade mecanizada estão comprometidos. Compre petróleo no Mercado Global."
      }}
    >
      <Icon name="fuel-empty" size={13} />
      <span>{t("tactical_alerts_out_of_fuel")}</span>
    </div>
  {/if}
</div>

<style>
  .tactical-alerts-bar {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    pointer-events: auto;
  }

  .alert-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.22rem 0.55rem;
    border-radius: 4px;
    font-family: var(--font-tactical);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    white-space: nowrap;
    border: 1px solid transparent;
  }

  .alert-pill:hover {
    transform: translateY(-1px);
    filter: brightness(1.15);
  }

  .alert-action.artillery {
    background: rgba(180, 83, 9, 0.25);
    border-color: rgba(245, 158, 11, 0.6);
    color: #fbbf24;
  }
  .alert-action.artillery:hover {
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.45);
  }

  .alert-action.aircraft {
    background: rgba(14, 116, 144, 0.25);
    border-color: rgba(6, 182, 212, 0.6);
    color: #67e8f9;
  }
  .alert-action.aircraft:hover {
    box-shadow: 0 0 10px rgba(6, 182, 212, 0.45);
  }

  .alert-danger.encircled {
    background: rgba(185, 28, 28, 0.3);
    border-color: #ef4444;
    color: #fca5a5;
    animation: alert-pulse-danger 2s infinite ease-in-out;
  }

  .alert-opportunity.enemy-encircled {
    background: rgba(16, 185, 129, 0.22);
    border-color: rgba(52, 211, 153, 0.65);
    color: #a7f3d0;
  }
  .alert-opportunity.enemy-encircled:hover {
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.45);
  }

  .alert-warning.fuel {
    background: rgba(217, 119, 6, 0.25);
    border-color: #f59e0b;
    color: #fde68a;
  }

  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.05rem 0.3rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.45);
    font-size: 0.65rem;
    font-weight: 800;
  }

  @keyframes alert-pulse-danger {
    0%, 100% {
      box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
    }
    50% {
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.85);
      border-color: #f87171;
    }
  }
</style>
