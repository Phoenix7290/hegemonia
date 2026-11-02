<script module lang="ts">
  import { MAP_WIDTH, MAP_HEIGHT } from "@hegemonia/maps";

  export function wrapCamX(x: number): number {
    const half = MAP_WIDTH / 2;
    let res = (((x + half) % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH - half;
    return res;
  }

  export function clampCamY(y: number): number {
    const maxPanY = 260;
    return Math.max(-maxPanY, Math.min(maxPanY, y));
  }
</script>

<script lang="ts">
  import { formatCompactTroops, type GameState, type PlayerColor } from "@hegemonia/shared";
  import {
    CLASSIC_MAP,
    DIRECT_SEA_LINKS,
    PACIFIC_WRAP_LINKS,
    GRATICULE_SVG_PATH,
  } from "@hegemonia/maps";
  import {
    hasTerritoryBuilding,
    getTerritoryBuildingLevel,
  } from "@hegemonia/engine";
  import Icon from "./Icon.svelte";
  import { t } from "../i18n/index.svelte";
  import {
    getTerritoryName,
    getContinentName,
    getSubregionName,
  } from "../i18n/content.svelte";
  import type { BaseMapMode, MapOverlays } from "../lib/map-preferences.js";
  import type { IconName } from "../lib/icons.js";
  import {
    resolveShortestMapVector,
    type ActiveCombatAnimation,
  } from "../lib/combat-animations.js";

  let {
    game,
    myPlayerId,
    baseMapMode = "cartographic",
    overlays = { regional: false, economic: false },
    mapMode,
    cleanMapMode = false,
    highlightObjectiveTerritories = false,
    objectiveTargetTerritoryIds = new Set<string>(),
    combatAnimations = [],
    selectedFromId = $bindable(null),
    selectedToId = $bindable(null),
    hoveredTerritoryId = $bindable(null),
    zoom = $bindable(1.05),
    camX = $bindable(0),
    camY = $bindable(0),
    onTerritoryClick,
  }: {
    game: GameState;
    myPlayerId: string | null;
    baseMapMode?: BaseMapMode;
    overlays?: MapOverlays;
    mapMode?: "cartographic" | "geopolitical" | "regional" | "economic";
    cleanMapMode?: boolean;
    highlightObjectiveTerritories?: boolean;
    objectiveTargetTerritoryIds?: Set<string>;
    combatAnimations?: ActiveCombatAnimation[];
    selectedFromId?: string | null;
    selectedToId?: string | null;
    hoveredTerritoryId?: string | null;
    zoom?: number;
    camX?: number;
    camY?: number;
    onTerritoryClick: (terrId: string) => void;
  } = $props();

  const effectiveBaseMode = $derived<BaseMapMode>(
    baseMapMode ?? (mapMode === "geopolitical" ? "geopolitical" : "cartographic")
  );

  const effectiveOverlays = $derived<MapOverlays>({
    regional: overlays?.regional ?? (mapMode === "regional"),
    economic: overlays?.economic ?? (mapMode === "economic"),
  });

  const COLOR_HEX: Record<PlayerColor, string> = {
    blue: "#3b82f6",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#f59e0b",
    black: "#475569",
    white: "#94a3b8",
  };

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

  interface TheaterBanner {
    id: string;
    continent: string;
    subRegion?: string;
    shortKey: string;
    doctrineKey: string;
    bonusArmies: number;
    extraBonus?: { icon: IconName; text: string; color: string; labelKey: string };
    x: number;
    y: number;
    color: string;
  }

  // Ocean & Coastal Void Anchors (HEGEM-77 & HEGEM-81): Zero collision with land territory badges
  const REGION_BANNERS: TheaterBanner[] = [
    {
      id: "north-america",
      continent: "north_america",
      shortKey: "theater_short_north_america",
      doctrineKey: "theater_doctrine_north_america",
      bonusArmies: 6,
      x: 145,
      y: 222,
      color: "#f59e0b",
    },
    {
      id: "south-america",
      continent: "south_america",
      shortKey: "theater_short_south_america",
      doctrineKey: "theater_doctrine_south_america",
      bonusArmies: 3,
      x: 292,
      y: 405,
      color: "#10b981",
    },
    {
      id: "europe",
      continent: "europe",
      shortKey: "theater_short_europe",
      doctrineKey: "theater_doctrine_europe",
      bonusArmies: 6,
      extraBonus: {
        icon: "coins",
        text: "+$3",
        color: "#6ee7b7",
        labelKey: "theater_bonus_economy_label",
      },
      x: 500,
      y: 152,
      color: "#3b82f6",
    },
    {
      id: "africa",
      continent: "africa",
      shortKey: "theater_short_africa",
      doctrineKey: "theater_doctrine_africa",
      bonusArmies: 4,
      x: 534,
      y: 350,
      color: "#eab308",
    },
    {
      id: "asia-indo-arabia",
      continent: "asia",
      subRegion: "asia_indo_arabia",
      shortKey: "theater_short_asia_indo_arabia",
      doctrineKey: "theater_doctrine_asia_indo_arabia",
      bonusArmies: 2,
      extraBonus: {
        icon: "oil",
        text: "+2",
        color: "#fdba74",
        labelKey: "theater_bonus_resources_label",
      },
      x: 808,
      y: 312,
      color: "#f97316",
    },
    {
      id: "asia-steppes",
      continent: "asia",
      subRegion: "asia_steppes",
      shortKey: "theater_short_asia_steppes",
      doctrineKey: "theater_doctrine_asia_steppes",
      bonusArmies: 2,
      extraBonus: {
        icon: "steel",
        text: "+1",
        color: "#cbd5e1",
        labelKey: "theater_bonus_resources_label",
      },
      x: 880,
      y: 42,
      color: "#06b6d4",
    },
    {
      id: "asia-east",
      continent: "asia",
      subRegion: "asia_east",
      shortKey: "theater_short_asia_east",
      doctrineKey: "theater_doctrine_asia_east",
      bonusArmies: 4,
      x: 1134,
      y: 222,
      color: "#ec4899",
    },
    {
      id: "oceania",
      continent: "oceania",
      shortKey: "theater_short_oceania",
      doctrineKey: "theater_doctrine_oceania",
      bonusArmies: 2,
      x: 936,
      y: 416,
      color: "#a855f7",
    },
  ];

  let hoveredTheaterId = $state<string | null>(null);

  function getTheaterTitle(rb: TheaterBanner): string {
    if (rb.subRegion) {
      return `${getContinentName(rb.continent)}: ${getSubregionName(rb.subRegion)}`;
    }
    return getContinentName(rb.continent);
  }

  function getTheaterStats(rb: TheaterBanner) {
    const terrs = CLASSIC_MAP.territories.filter((t) =>
      rb.subRegion ? t.subRegion === rb.subRegion : t.continent === rb.continent
    );
    const total = terrs.length;
    const countsByOwner = new Map<string, number>();
    let myCount = 0;

    for (const terr of terrs) {
      const ownerId = game.territories[terr.id]?.ownerId;
      if (ownerId) {
        countsByOwner.set(ownerId, (countsByOwner.get(ownerId) ?? 0) + 1);
        if (ownerId === myPlayerId) myCount++;
      }
    }

    let leaderId: string | null = null;
    let leaderCount = 0;
    for (const [ownerId, count] of countsByOwner.entries()) {
      if (count > leaderCount) {
        leaderCount = count;
        leaderId = ownerId;
      }
    }

    const leaderPlayer = leaderId ? game.players.find((p) => p.id === leaderId) ?? null : null;
    const isHegemonyActive = total > 0 && leaderCount === total;
    const statusLabel = isHegemonyActive ? t("theater_status_active") : t("theater_status_contested");
    const summaryText = t("theater_progress_summary", {
      controlled: leaderCount,
      total,
      status: statusLabel,
    });

    return {
      total,
      myCount,
      leaderCount,
      leaderPlayer,
      isHegemonyActive,
      statusLabel,
      summaryText,
    };
  }

  let activeTheaterBanner = $derived(
    hoveredTheaterId ? REGION_BANNERS.find((b) => b.id === hoveredTheaterId) ?? null : null
  );
  let activeTheaterStats = $derived(
    activeTheaterBanner ? getTheaterStats(activeTheaterBanner) : null
  );

  function getTerritoryRegionColor(t: { continent: string; subRegion?: string }): string {
    if (t.subRegion && REGION_COLOR_HEX[t.subRegion]) {
      return REGION_COLOR_HEX[t.subRegion];
    }
    return REGION_COLOR_HEX[t.continent] ?? "#64748b";
  }

  const COMPACT_BADGE_IDS = new Set([
    "islandia",
    "inglaterra",
    "suecia",
    "alemanha",
    "polonia",
    "balcas",
    "franca",
    "espanha",
    "italia",
    "argelia",
    "egito",
    "nigeria",
    "sudao",
    "congo",
    "mocambique",
    "sao_paulo",
    "california",
    "texas",
    "nova_york",
    "ottawa",
    "tchita",
    "mongolia",
    "pequim",
    "vietna",
    "borneu",
    "sumatra",
    "nova_guine",
    "madagascar",
    "havai",
  ]);

  // Optical badge anchor offsets in dense continental clusters (HEGEM-77)
  const BADGE_ANCHOR_OFFSETS: Record<string, [number, number]> = {
    inglaterra: [-6, -5],
    franca: [-2, -1],
    espanha: [-8, 5],
    alemanha: [0, -4],
    italia: [-1, 5],
    polonia: [3, -4],
    balcas: [5, 3],
    congo: [-5, -4],
    mocambique: [4, 4],
    tchita: [3, -4],
    mongolia: [-5, -1],
    pequim: [6, 3],
  };

  const territoryById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

  function getTerritoryBadgeCoords(terrId: string): [number, number] {
    const def = territoryById.get(terrId);
    if (!def) return [0, 0];
    const offset = BADGE_ANCHOR_OFFSETS[terrId] ?? [0, 0];
    return [def.center[0] + offset[0], def.center[1] + offset[1]];
  }

  const armorShockTerritoryIds = $derived(
    new Set(
      combatAnimations
        .filter(
          (a) => a.categories.includes("tank") || a.categories.includes("artillery")
        )
        .map((a) => a.toTerritoryId)
    )
  );

  const underFireTerritoryIds = $derived(
    new Set(combatAnimations.map((a) => a.toTerritoryId))
  );

  // --- Mouse Drag, Touch Pan (Tablet) & Wheel Camera Controls ---
  let isDragging = $state(false);
  let lastMouseX = $state(0);
  let lastMouseY = $state(0);

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    if (target.closest(".hud-panel") || target.closest(".war-journal-panel")) return;
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

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const target = e.target as Element;
    if (target.closest(".hud-panel") || target.closest(".war-journal-panel")) return;
    isDragging = true;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    const dxPx = e.touches[0].clientX - lastMouseX;
    const dyPx = e.touches[0].clientY - lastMouseY;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;

    const svgScale = MAP_WIDTH / Math.max(window.innerWidth, 320);
    camX = wrapCamX(camX + (dxPx * svgScale) / zoom);
    camY = clampCamY(camY + (dyPx * svgScale) / zoom);
  }

  function onTouchEnd() {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.14 : 0.88;
    zoom = Math.max(0.75, Math.min(4.5, zoom * zoomFactor));
  }
</script>

<svelte:window
  onmousemove={onMouseMove}
  onmouseup={onMouseUp}
  ontouchend={onTouchEnd}
/>

<!-- FULLSCREEN CONTINUOUS WRAPAROUND GEOPOLITICAL & CARTOGRAPHIC MAP -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="map-viewport"
  onwheel={onWheel}
  onmousedown={onMouseDown}
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
>
  {#if cleanMapMode}
    <div class="clean-map-indicator">
      <Icon name="eye" size={13} />
      <span>{t("clean_map_indicator_text")}</span>
    </div>
  {/if}

  {#if effectiveOverlays.regional && !cleanMapMode && activeTheaterBanner && activeTheaterStats}
    <aside
      class="theater-tactical-tooltip"
      style="--theater-accent: {activeTheaterBanner.color};"
      data-testid="theater-tactical-tooltip"
    >
      <div class="ttt-header">
        <div class="ttt-title-group">
          <span class="ttt-eyebrow">{t("theater_tooltip_eyebrow")}</span>
          <h4>{getTheaterTitle(activeTheaterBanner)}</h4>
        </div>
        <span
          class="ttt-status-pill"
          class:active={activeTheaterStats.isHegemonyActive}
        >
          <Icon name={activeTheaterStats.isHegemonyActive ? "crown" : "swords"} size={11} />
          {activeTheaterStats.statusLabel}
        </span>
      </div>

      <div class="ttt-progress-block">
        <div class="ttt-progress-meta">
          <strong>{activeTheaterStats.summaryText}</strong>
          <div class="ttt-control-sub">
            <span>{t("theater_your_control", { count: activeTheaterStats.myCount, total: activeTheaterStats.total })}</span>
            {#if activeTheaterStats.leaderPlayer}
              <span>• {t("theater_leader_control", { name: activeTheaterStats.leaderPlayer.name, count: activeTheaterStats.leaderCount, total: activeTheaterStats.total })}</span>
            {/if}
          </div>
        </div>
        <div class="ttt-progress-track">
          <div
            class="ttt-progress-fill"
            style="width: {Math.round((activeTheaterStats.leaderCount / Math.max(1, activeTheaterStats.total)) * 100)}%; background: {activeTheaterBanner.color};"
          ></div>
        </div>
      </div>

      <div class="ttt-bonuses-grid">
        <div class="ttt-bonus-item">
          <span class="ttt-bonus-icon" style="color: {activeTheaterBanner.color};">
            <Icon name="infantry" size={14} />
          </span>
          <div class="ttt-bonus-copy">
            <small>{t("theater_bonus_divisions_label")}</small>
            <strong>{t("theater_bonus_divisions_val", { count: activeTheaterBanner.bonusArmies })}</strong>
          </div>
        </div>

        {#if activeTheaterBanner.extraBonus}
          <div class="ttt-bonus-item">
            <span class="ttt-bonus-icon" style="color: {activeTheaterBanner.extraBonus.color};">
              <Icon name={activeTheaterBanner.extraBonus.icon} size={14} />
            </span>
            <div class="ttt-bonus-copy">
              <small>{t(activeTheaterBanner.extraBonus.labelKey)}</small>
              <strong style="color: {activeTheaterBanner.extraBonus.color};">{activeTheaterBanner.extraBonus.text}</strong>
            </div>
          </div>
        {/if}
      </div>

      <p class="ttt-doctrine-note">
        <Icon name="shield" size={12} color={activeTheaterBanner.color} />
        <span>{t(activeTheaterBanner.doctrineKey)}</span>
      </p>
    </aside>
  {/if}

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

      <!-- Secret Objective Highlights -->
      <filter id="glow-green" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="0" stdDeviation="4.0" flood-color="#10b981" flood-opacity="1" />
      </filter>
      <filter id="glow-red" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="#ef4444" flood-opacity="1" />
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
        fill={effectiveBaseMode === "cartographic" ? "#061121" : "#08172e"}
      />
      <rect
        x={-MAP_WIDTH * 2}
        y={-MAP_HEIGHT}
        width={MAP_WIDTH * 5}
        height={MAP_HEIGHT * 3}
        fill="url(#tactical-grid)"
      />

      <!-- LAYER 1: 3 HORIZONTAL WORLD COPIES (-1200, 0, +1200) BASE RELIEF & SEA ROUTES -->
      {#each [-MAP_WIDTH, 0, MAP_WIDTH] as offsetX (offsetX)}
        <g class="world-copy" transform="translate({offsetX}, 0)">
          {#if effectiveBaseMode === "cartographic"}
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
              stroke={effectiveBaseMode === "cartographic" ? "rgba(224, 242, 254, 0.65)" : "#64748b"}
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
              stroke={effectiveBaseMode === "cartographic" ? "rgba(224, 242, 254, 0.72)" : "#94a3b8"}
              stroke-dasharray="4,4"
              stroke-width="1.5"
              pointer-events="none"
            />
          {/each}

        </g>
      {/each}

      <!-- LAYER 2..5: STRICT Z-INDEX HIERARCHY PER WORLD COPY (HEGEM-77 & HEGEM-81) -->
      {#each [-MAP_WIDTH, 0, MAP_WIDTH] as offsetX (offsetX)}
        <g class="world-copy" transform="translate({offsetX}, 0)">
          <!-- PASS A (Layers 2 & 3): Political Polygons, Regional Illuminated Borders & Economic Ambient Glow -->
          <g class="layer-territory-polygons">
            {#each CLASSIC_MAP.territories as t (t.id)}
              {@const tState = game.territories[t.id]}
              {@const owner = game.players.find((p) => p.id === tState.ownerId)}
              {@const ownerColor = owner ? COLOR_HEX[owner.color] : "#334155"}
              {@const regionColor = getTerritoryRegionColor(t as any)}
              {@const activeFill = ownerColor}
              {@const isSelected = selectedFromId === t.id || selectedToId === t.id}
              {@const fromTerrState = selectedFromId ? game.territories[selectedFromId] : null}
              {@const isAirliftDest =
                Boolean(selectedFromId) &&
                t.id !== selectedFromId &&
                game.phase === "maneuver" &&
                tState.ownerId === myPlayerId &&
                Boolean(fromTerrState && hasTerritoryBuilding(fromTerrState, "airfield")) &&
                hasTerritoryBuilding(tState, "airfield") &&
                !fromTerrState?.airliftedThisTurn}
              {@const isValidTarget =
                selectedFromId &&
                ((game.phase === "attack" &&
                  tState.ownerId !== myPlayerId &&
                  (fromTerrState?.armies ?? 0) >= 2 &&
                  territoryById.get(selectedFromId)?.neighbors.includes(t.id)) ||
                 (game.phase === "maneuver" &&
                  tState.ownerId === myPlayerId &&
                  (territoryById.get(selectedFromId)?.neighbors.includes(t.id) || isAirliftDest)))}
              {@const isObjTarget = highlightObjectiveTerritories && objectiveTargetTerritoryIds.has(t.id)}
              {@const isObjOwned = isObjTarget && tState.ownerId === myPlayerId}
              {@const isObjPending = isObjTarget && tState.ownerId !== myPlayerId}
              {@const isObjDimmed = highlightObjectiveTerritories && objectiveTargetTerritoryIds.size > 0 && !isObjTarget}

              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <g
                class="territory-group"
                data-testid={offsetX === 0 ? `territory-${t.id}` : `territory-${t.id}-clone`}
                data-territory-id={t.id}
                data-primary-globe={offsetX === 0 ? "true" : undefined}
                onclick={() => onTerritoryClick(t.id)}
                onmouseenter={() => (hoveredTerritoryId = t.id)}
                onmouseleave={() => {
                  if (hoveredTerritoryId === t.id) hoveredTerritoryId = null;
                }}
              >
                <title>{getTerritoryName(t.id)}: {tState.armies} divisões</title>
                <!-- Base Political Fill + Frontier Border -->
                <path
                  d={t.svgPath}
                  fill={isObjOwned ? "#059669" : isObjPending ? "#dc2626" : activeFill}
                  fill-opacity={isObjTarget
                    ? "0.85"
                    : isSelected
                      ? "0.88"
                      : effectiveBaseMode === "cartographic"
                        ? "0.42"
                        : "0.84"}
                  stroke={isSelected
                    ? "#ffffff"
                    : isValidTarget
                      ? "#facc15"
                      : isObjPending
                        ? "#ef4444"
                        : isObjOwned
                          ? "#10b981"
                          : effectiveBaseMode === "cartographic"
                            ? ownerColor
                            : "rgba(9, 13, 22, 0.9)"}
                  stroke-width={isSelected
                    ? "2.6"
                    : isValidTarget || isObjPending
                      ? "2.4"
                      : isObjOwned
                        ? "2.0"
                        : effectiveBaseMode === "cartographic"
                          ? "1.6"
                          : "1.0"}
                  stroke-linejoin="round"
                  filter={isSelected || isValidTarget
                    ? "url(#glow-gold)"
                    : isObjPending
                      ? "url(#glow-red)"
                      : isObjOwned
                        ? "url(#glow-green)"
                        : undefined}
                  style={isObjDimmed ? "opacity: 0.28; transition: opacity 0.25s ease;" : "transition: opacity 0.25s ease;"}
                />

                {#if effectiveBaseMode === "cartographic"}
                  <!-- Crisp Dark Inner Frontier Line so Neighboring Same-Color Provinces Remain Distinct Over Satellite Terrain -->
                  <path
                    d={t.svgPath}
                    fill="none"
                    stroke="rgba(6, 10, 18, 0.78)"
                    stroke-width="0.7"
                    pointer-events="none"
                  />
                {/if}

                <!-- OVERLAY: Regional Continental Tint + Illuminated Theater Border (HEGEM-77) -->
                {#if effectiveOverlays.regional}
                  <path
                    d={t.svgPath}
                    fill={regionColor}
                    fill-opacity={effectiveBaseMode === "cartographic" ? "0.28" : "0.24"}
                    stroke={regionColor}
                    stroke-opacity="0.72"
                    stroke-width="1.35"
                    stroke-linejoin="round"
                    pointer-events="none"
                  />
                {/if}

                <!-- OVERLAY: Economic Resource Ambient Glow -->
                {#if effectiveOverlays.economic && t.resource}
                  <path
                    d={t.svgPath}
                    fill={t.resource === "gold" ? "#eab308" : t.resource === "oil" ? "#f97316" : "#94a3b8"}
                    fill-opacity="0.16"
                    stroke="none"
                    pointer-events="none"
                  />
                {/if}
              </g>
            {/each}
          </g>

          <!-- PASS B (Layer 4): Compact Ocean/Coastal Theater Insignias (HEGEM-81 & HEGEM-77) -->
          {#if effectiveOverlays.regional && !cleanMapMode}
            <g class="layer-theater-insignias">
              {#each REGION_BANNERS as rb (rb.id)}
                {@const shortLabel = t(rb.shortKey)}
                {@const stats = getTheaterStats(rb)}
                {@const isHovered = hoveredTheaterId === rb.id}
                {@const leftZoneW = 23.5}
                {@const labelWidth = Math.max(28, Math.ceil(shortLabel.length * 3.65) + 7)}
                {@const rightZoneW = rb.extraBonus ? (rb.extraBonus.text.length >= 3 ? 25.5 : 21.5) : 0}
                {@const w = leftZoneW + labelWidth + rightZoneW + (rb.extraBonus ? 0 : 2.5)}
                {@const leftEdge = -w / 2}
                {@const divLeftX = leftEdge + leftZoneW}
                {@const labelCenterX = divLeftX + labelWidth / 2}
                {@const divRightX = divLeftX + labelWidth}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g
                  transform="translate({rb.x}, {rb.y})"
                  class="tactical-theater-badge"
                  class:is-hovered={isHovered}
                  pointer-events="auto"
                  data-testid={offsetX === 0 ? `badge-theater-${rb.id}` : undefined}
                  onmouseenter={() => (hoveredTheaterId = rb.id)}
                  onmouseleave={() => {
                    if (hoveredTheaterId === rb.id) hoveredTheaterId = null;
                  }}
                  onclick={(e) => {
                    e.stopPropagation();
                    hoveredTheaterId = hoveredTheaterId === rb.id ? null : rb.id;
                  }}
                >
                  <title>{getTheaterTitle(rb)} ({stats.summaryText}) — +{rb.bonusArmies}{rb.extraBonus ? ` ${rb.extraBonus.text}` : ""}</title>
                  <!-- Compact gunmetal ribbon base with regional border accent -->
                  <rect
                    x={leftEdge}
                    y="-7"
                    width={w}
                    height="14"
                    rx="2.8"
                    fill="rgba(6, 10, 18, 0.94)"
                    stroke={rb.color}
                    stroke-width={isHovered || stats.isHegemonyActive ? "1.5" : "1.1"}
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,0.85))"
                  />
                  <!-- Left Regional Color Accent Bar -->
                  <rect
                    x={leftEdge + 1.4}
                    y="-5.2"
                    width="2.0"
                    height="10.4"
                    rx="1"
                    fill={rb.color}
                  />
                  <!-- Left Zone: Infantry division icon & bonus troops -->
                  <Icon name="infantry" size={6.8} x={leftEdge + 4.8} y={-3.4} color={rb.color} strokeWidth={1.9} />
                  <text
                    x={leftEdge + 12.8}
                    y="0.3"
                    text-anchor="start"
                    dominant-baseline="central"
                    fill={rb.color}
                    font-size="6.0"
                    font-weight="900"
                    font-family="system-ui, -apple-system, sans-serif"
                  >
                    +{rb.bonusArmies}
                  </text>
                  <!-- Divider between Left Bonus & Theater Code -->
                  <line
                    x1={divLeftX}
                    y1="-4.6"
                    x2={divLeftX}
                    y2="4.6"
                    stroke="rgba(148, 163, 184, 0.28)"
                    stroke-width="0.75"
                  />
                  <!-- Center Zone: Theater short code centered in its dynamic cell -->
                  <text
                    x={labelCenterX}
                    y="0.3"
                    text-anchor="middle"
                    dominant-baseline="central"
                    fill="#f8fafc"
                    font-size="5.0"
                    font-weight="800"
                    letter-spacing="0.03em"
                    font-family="system-ui, -apple-system, sans-serif"
                  >
                    {shortLabel}
                  </text>
                  {#if rb.extraBonus}
                    <!-- Divider between Theater Code & Extra Geoeconomic Bonus -->
                    <line
                      x1={divRightX}
                      y1="-4.6"
                      x2={divRightX}
                      y2="4.6"
                      stroke="rgba(148, 163, 184, 0.28)"
                      stroke-width="0.75"
                    />
                    <Icon
                      name={rb.extraBonus.icon}
                      size={6.8}
                      x={divRightX + 2.4}
                      y={-3.4}
                      color={rb.extraBonus.color}
                      strokeWidth={1.9}
                    />
                    <text
                      x={divRightX + 10.4}
                      y="0.3"
                      text-anchor="start"
                      dominant-baseline="central"
                      fill={rb.extraBonus.color}
                      font-size="6.0"
                      font-weight="900"
                      font-family="system-ui, -apple-system, sans-serif"
                    >
                      {rb.extraBonus.text}
                    </text>
                  {/if}
                </g>
              {/each}
            </g>
          {/if}

          <!-- PASS C (Layer 5 - Top of Stack): Military Division Badges, Compact Economic Slots & Territory Labels (HEGEM-77) -->
          {#if !cleanMapMode}
            <g class="layer-territory-badges">
              {#each CLASSIC_MAP.territories as t (t.id)}
                {@const tState = game.territories[t.id]}
                {@const owner = game.players.find((p) => p.id === tState.ownerId)}
                {@const ownerColor = owner ? COLOR_HEX[owner.color] : "#334155"}
                {@const isSelected = selectedFromId === t.id || selectedToId === t.id}
                {@const fromTerrState = selectedFromId ? game.territories[selectedFromId] : null}
                {@const isAirliftDest =
                  Boolean(selectedFromId) &&
                  t.id !== selectedFromId &&
                  game.phase === "maneuver" &&
                  tState.ownerId === myPlayerId &&
                  Boolean(fromTerrState && hasTerritoryBuilding(fromTerrState, "airfield")) &&
                  hasTerritoryBuilding(tState, "airfield") &&
                  !fromTerrState?.airliftedThisTurn}
                {@const isValidTarget =
                  selectedFromId &&
                  ((game.phase === "attack" &&
                    tState.ownerId !== myPlayerId &&
                    (fromTerrState?.armies ?? 0) >= 2 &&
                    territoryById.get(selectedFromId)?.neighbors.includes(t.id)) ||
                   (game.phase === "maneuver" &&
                    tState.ownerId === myPlayerId &&
                    (territoryById.get(selectedFromId)?.neighbors.includes(t.id) || isAirliftDest)))}
                {@const isObjTarget = highlightObjectiveTerritories && objectiveTargetTerritoryIds.has(t.id)}
                {@const isObjOwned = isObjTarget && tState.ownerId === myPlayerId}
                {@const isObjPending = isObjTarget && tState.ownerId !== myPlayerId}
                {@const isCapital = owner?.capitalTerritoryId === t.id}
                {@const originalCapitalOwner = game.players.find((p) => p.capitalTerritoryId === t.id)}
                {@const isFallenCapital = originalCapitalOwner && originalCapitalOwner.id !== tState.ownerId}
                {@const fortLevel = getTerritoryBuildingLevel(tState, "fortification")}
                {@const compactTroops = formatCompactTroops(tState.armies)}
                {@const troopFontSize = compactTroops.length <= 2 ? 8.2 : compactTroops.length === 3 ? 7.5 : 6.5}
                {@const isCompact = COMPACT_BADGE_IDS.has(t.id)}
                {@const anchorOffset = BADGE_ANCHOR_OFFSETS[t.id] ?? [0, 0]}
                {@const badgeX = t.center[0] + anchorOffset[0]}
                {@const badgeY = t.center[1] + anchorOffset[1]}
                {@const isUnderArmorShock = armorShockTerritoryIds.has(t.id)}
                {@const isUnderFire = underFireTerritoryIds.has(t.id)}

                <!-- HOI4-STYLE MILITARY DIVISION COUNTER WITH OPTIONAL COMPACT ECONOMIC SUB-BADGE -->
                <g
                  transform="translate({badgeX}, {badgeY}) scale({isCompact ? 0.80 : 0.92})"
                  class="division-counter"
                  data-testid={offsetX === 0 ? `badge-troop-${t.id}` : undefined}
                >
                  <g
                    class="division-counter-body"
                    class:under-armor-shock={isUnderArmorShock}
                    class:under-fire={isUnderFire && !isUnderArmorShock}
                  >
                  <!-- Capital Crown / Vector Seal (HEGEM-63) -->
                  {#if isCapital}
                    <g transform="translate(0, -10.2)">
                      <circle cx="0" cy="0" r="4.4" fill="#090e1a" stroke="#f59e0b" stroke-width="1.3" />
                      <Icon name="capital" size={6.4} x={-3.2} y={-3.2} color="#facc15" strokeWidth={2.1} />
                    </g>
                  {:else if isFallenCapital}
                    <g transform="translate(0, -10.2)">
                      <circle cx="0" cy="0" r="4.4" fill="#090e1a" stroke="#ef4444" stroke-width="1.3" />
                      <Icon name="capital-fallen" size={6.4} x={-3.2} y={-3.2} color="#fca5a5" strokeWidth={2.1} />
                    </g>
                  {/if}

                  <rect
                    x="-13"
                    y="-6.5"
                    width="26"
                    height="13"
                    rx="2.2"
                    fill="#090e1a"
                    stroke={isCapital
                      ? "#f59e0b"
                      : isFallenCapital
                        ? "#ef4444"
                        : isSelected
                           ? "#ffffff"
                           : isValidTarget
                             ? "#facc15"
                             : isObjPending
                               ? "#ef4444"
                               : isObjOwned
                                 ? "#10b981"
                                 : ownerColor}
                    stroke-width={isCapital || isFallenCapital || isSelected || isValidTarget || isObjTarget ? "1.6" : "1.1"}
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
                    font-size={troopFontSize}
                    font-weight="800"
                    font-family="system-ui, -apple-system, sans-serif"
                    pointer-events="none"
                  >
                    {compactTroops}
                  </text>

                  <!-- Fortification Crest (HEGEM-63) -->
                  {#if fortLevel > 0}
                    <g transform="translate(13.5, -4.5)">
                      <circle cx="0" cy="0" r="3.8" fill="#090e1a" stroke={fortLevel === 2 ? "#38bdf8" : "#94a3b8"} stroke-width="1.1" />
                      <Icon
                        name={fortLevel === 2 ? "fortification-l2" : "fortification"}
                        size={5.2}
                        x={-2.6}
                        y={-2.6}
                        color={fortLevel === 2 ? "#38bdf8" : "#cbd5e1"}
                        strokeWidth={2.2}
                      />
                    </g>
                  {/if}

                  <!-- Encirclement / Out of Supply Badge (HEGEM-35, HEGEM-63) -->
                  {#if tState.isEncircled}
                    <g transform="translate(-13.5, -4.5)" pointer-events="none">
                      <circle cx="0" cy="0" r="3.8" fill="#450a0a" stroke="#ef4444" stroke-width="1.1" />
                      <Icon name="supply-cut" size={5.2} x={-2.6} y={-2.6} color="#fca5a5" strokeWidth={2.2} />
                    </g>
                  {/if}

                  <!-- Fuel Starvation Badge (HEGEM-35, HEGEM-63) -->
                  {#if tState.outOfFuel}
                    <g transform="translate(-13.5, 4.5)" pointer-events="none">
                      <circle cx="0" cy="0" r="3.8" fill="#451a03" stroke="#f97316" stroke-width="1.1" />
                      <Icon name="fuel-empty" size={5.2} x={-2.6} y={-2.6} color="#fdba74" strokeWidth={2.2} />
                    </g>
                  {/if}

                  <!-- Blitzkrieg Spearhead Indicator (HEGEM-25, HEGEM-63) -->
                  {#if tState.blitzkriegAvailable}
                    <g transform="translate(13.5, 4.5)" pointer-events="none">
                      <circle cx="0" cy="0" r="3.8" fill="#422006" stroke="#eab308" stroke-width="1.1" />
                      <Icon name="blitzkrieg" size={5.2} x={-2.6} y={-2.6} color="#fef08a" strokeWidth={2.2} />
                    </g>
                  {/if}

                  <!-- Attached Compact Economic Sub-Badge (Overlay: Economic — HEGEM-77) -->
                  {#if effectiveOverlays.economic}
                    {@const maxSlots = isCapital ? 3 : 2}
                    {@const bldgs = tState.buildings ?? []}
                    <g transform="translate(0, 9.8)" class="economic-sub-badge" pointer-events="none">
                      <rect
                        x="-16"
                        y="-4.0"
                        width="32"
                        height="8.0"
                        rx="1.8"
                        fill="#090e1a"
                        stroke="rgba(148, 163, 184, 0.45)"
                        stroke-width="0.7"
                        filter="drop-shadow(0 1px 2px rgba(0,0,0,0.85))"
                      />
                      <!-- Resource Icon on Left -->
                      {#if t.resource === "gold"}
                        <g transform="translate(-10.8, 0)">
                          <circle cx="0" cy="0" r="2.7" fill="#2e1b05" stroke="#facc15" stroke-width="0.55" />
                          <Icon name="gold" size={4.2} x={-2.1} y={-2.1} color="#fde047" strokeWidth={2} />
                        </g>
                      {:else if t.resource === "steel"}
                        <g transform="translate(-10.8, 0)">
                          <circle cx="0" cy="0" r="2.7" fill="#0f172a" stroke="#94a3b8" stroke-width="0.55" />
                          <Icon name="steel" size={4.2} x={-2.1} y={-2.1} color="#e2e8f0" strokeWidth={2} />
                        </g>
                      {:else if t.resource === "oil"}
                        <g transform="translate(-10.8, 0)">
                          <circle cx="0" cy="0" r="2.7" fill="#321202" stroke="#f97316" stroke-width="0.55" />
                          <Icon name="oil" size={4.2} x={-2.1} y={-2.1} color="#fdba74" strokeWidth={2} />
                        </g>
                      {:else if t.tradeBonus && t.tradeBonus > 0}
                        <g transform="translate(-10.8, 0)">
                          <circle cx="0" cy="0" r="2.7" fill="#042f2e" stroke="#10b981" stroke-width="0.55" />
                          <Icon name="coins" size={4.2} x={-2.1} y={-2.1} color="#6ee7b7" strokeWidth={2} />
                        </g>
                      {:else}
                        <g transform="translate(-10.8, 0)">
                          <circle cx="0" cy="0" r="1.5" fill="#0f172a" stroke="rgba(148, 163, 184, 0.35)" stroke-width="0.5" />
                        </g>
                      {/if}

                      <!-- Divider Line -->
                      <line x1="-6.4" y1="-3.2" x2="-6.4" y2="3.2" stroke="rgba(148, 163, 184, 0.25)" stroke-width="0.55" />

                      <!-- Building Slots on Right -->
                      <g transform="translate(3.6, 0)">
                        {#each Array(maxSlots) as _, slotIdx}
                          {@const b = bldgs[slotIdx]}
                          {@const slotX = (slotIdx - (maxSlots - 1) / 2) * 5.6}
                          <g transform="translate({slotX}, 0)">
                            {#if b}
                              <rect
                                x="-2.3"
                                y="-2.8"
                                width="4.6"
                                height="5.6"
                                rx="0.9"
                                fill={b.type === "market"
                                  ? "#451a03"
                                  : b.type === "industry"
                                    ? "#1e293b"
                                    : b.type === "fortification"
                                      ? (b.level === 2 ? "#082f49" : "#1e293b")
                                      : b.type === "airfield"
                                        ? "#172554"
                                        : "#042f2e"}
                                stroke={b.type === "market"
                                  ? "#f59e0b"
                                  : b.type === "industry"
                                    ? "#fb923c"
                                    : b.type === "fortification"
                                      ? (b.level === 2 ? "#38bdf8" : "#94a3b8")
                                      : b.type === "airfield"
                                        ? "#60a5fa"
                                        : "#2dd4bf"}
                                stroke-width="0.55"
                              />
                              <Icon
                                name={b.type === "fortification"
                                  ? (b.level === 2 ? "fortification-l2" : "fortification")
                                  : b.type}
                                size={3.8}
                                x={-1.9}
                                y={-1.9}
                                color={b.type === "market"
                                  ? "#fde047"
                                  : b.type === "industry"
                                    ? "#fdba74"
                                    : b.type === "fortification"
                                      ? (b.level === 2 ? "#7dd3fc" : "#e2e8f0")
                                      : b.type === "airfield"
                                        ? "#93c5fd"
                                        : "#5eead4"}
                                strokeWidth={2}
                              />
                            {:else}
                              <rect
                                x="-2.1"
                                y="-2.6"
                                width="4.2"
                                height="5.2"
                                rx="0.8"
                                fill="rgba(15, 23, 42, 0.4)"
                                stroke="rgba(148, 163, 184, 0.3)"
                                stroke-dasharray="1, 0.8"
                                stroke-width="0.5"
                              />
                            {/if}
                          </g>
                        {/each}
                      </g>
                    </g>
                  {/if}

                  <!-- Territory Label Underneath Counter -->
                  <text
                    x="0"
                    y={effectiveOverlays.economic ? 17.6 : 10.6}
                    text-anchor="middle"
                    fill={isCapital ? "#fde047" : "#e2e8f0"}
                    font-size={isCompact ? "5.7" : "6.1"}
                    font-weight="700"
                    letter-spacing="0.01em"
                    pointer-events="none"
                    style="paint-order: stroke; stroke: #050912; stroke-width: 2.3px; stroke-linejoin: round;"
                  >
                    {getTerritoryName(t.id)}
                  </text>

                  <!-- Structural Indicators (Dots for constructed infrastructure, only shown if economic overlay is off) -->
                  {#if !effectiveOverlays.economic && tState.buildings && tState.buildings.length > 0}
                    <g transform="translate(0, 15.2)" pointer-events="none">
                      {#each tState.buildings as b, bIdx}
                        {@const xOffset = (bIdx - (tState.buildings.length - 1) / 2) * 5.0}
                        <circle
                          cx={xOffset}
                          cy="0"
                          r="1.6"
                          fill={b.type === "fortification"
                            ? (b.level === 2 ? "#38bdf8" : "#94a3b8")
                            : b.type === "market"
                              ? "#f59e0b"
                              : b.type === "industry"
                                ? "#fb923c"
                                : b.type === "airfield"
                                  ? "#60a5fa"
                                  : "#2dd4bf"}
                          stroke="#090e1a"
                          stroke-width="0.6"
                        />
                      {/each}
                    </g>
                  {/if}
                  </g>
                </g>
              {/each}
            </g>
          {/if}

          <!-- PASS D (Layer 6 - Non-Blocking Combined-Arms Vector Combat FX — HEGEM-80) -->
          {#if combatAnimations.length > 0}
            <g class="layer-combat-animations" pointer-events="none">
              {#each combatAnimations as anim (anim.id)}
                {@const fromCoords = getTerritoryBadgeCoords(anim.fromTerritoryId)}
                {@const toCoords = getTerritoryBadgeCoords(anim.toTerritoryId)}
                {@const vec = resolveShortestMapVector(fromCoords, toCoords, MAP_WIDTH)}
                <g
                  class="combat-fx-instance"
                  data-testid={offsetX === 0 ? `combat-fx-${anim.fromTerritoryId}-${anim.toTerritoryId}` : undefined}
                  style="--anim-dur: {anim.durationMs}ms; --travel-dist: {vec.dist.toFixed(1)}px;"
                >
                  <!-- 1. INFANTRY: Frontline Tracer Fire & Border Muzzle Flashes -->
                  {#if anim.categories.includes("infantry")}
                    <g
                      class="combat-fx-infantry"
                      transform="translate({vec.x1.toFixed(1)}, {vec.y1.toFixed(1)}) rotate({vec.angleDeg.toFixed(1)})"
                    >
                      <!-- Muzzle flashes near border contact zone -->
                      <polygon
                        class="fx-muzzle-flash"
                        points="{(vec.dist * 0.22).toFixed(1)},0 {(vec.dist * 0.22 + 5).toFixed(1)},-3.2 {(vec.dist * 0.22 + 3.2).toFixed(1)},0 {(vec.dist * 0.22 + 5).toFixed(1)},3.2"
                        fill="#fef08a"
                        stroke="#f97316"
                        stroke-width="0.6"
                      />
                      <polygon
                        class="fx-muzzle-flash delay-1"
                        points="{(vec.dist * 0.34).toFixed(1)},-2.5 {(vec.dist * 0.34 + 4.5).toFixed(1)},-5.2 {(vec.dist * 0.34 + 3).toFixed(1)},-2.5 {(vec.dist * 0.34 + 4.5).toFixed(1)},0.2"
                        fill="#fde047"
                      />
                      <!-- Staggered tracer fire bursts crossing the frontier -->
                      <line
                        class="fx-tracer-beam"
                        x1={(vec.dist * 0.16).toFixed(1)}
                        y1="-2.2"
                        x2={(vec.dist * 0.92).toFixed(1)}
                        y2="-1.2"
                        pathLength="100"
                        stroke="#fef08a"
                        stroke-width="1.35"
                        stroke-linecap="round"
                      />
                      <line
                        class="fx-tracer-beam delay-1"
                        x1={(vec.dist * 0.18).toFixed(1)}
                        y1="2.2"
                        x2={(vec.dist * 0.94).toFixed(1)}
                        y2="1.2"
                        pathLength="100"
                        stroke="#fb923c"
                        stroke-width="1.25"
                        stroke-linecap="round"
                      />
                      <line
                        class="fx-tracer-beam delay-2"
                        x1={(vec.dist * 0.24).toFixed(1)}
                        y1="0"
                        x2={(vec.dist * 0.96).toFixed(1)}
                        y2="0"
                        pathLength="100"
                        stroke="#fde047"
                        stroke-width="1.4"
                        stroke-linecap="round"
                      />
                      <!-- Impact sparks on defender perimeter -->
                      <circle
                        class="fx-infantry-spark"
                        cx={(vec.dist * 0.95).toFixed(1)}
                        cy="0"
                        r="3.2"
                        fill="none"
                        stroke="#fde047"
                        stroke-width="1.1"
                      />
                    </g>
                  {/if}

                  <!-- 2. TANKS (ARMOR): High-Velocity Sabot Streak & Explosive Armor Shockwave -->
                  {#if anim.categories.includes("tank")}
                    <g
                      class="combat-fx-tank"
                      transform="translate({vec.x1.toFixed(1)}, {vec.y1.toFixed(1)}) rotate({vec.angleDeg.toFixed(1)})"
                    >
                      <!-- High-velocity ballistic sabot trail -->
                      <line
                        class="fx-tank-sabot-trail"
                        x1={(vec.dist * 0.12).toFixed(1)}
                        y1="0"
                        x2={vec.dist.toFixed(1)}
                        y2="0"
                        pathLength="100"
                        stroke="#f97316"
                        stroke-width="2.6"
                        stroke-linecap="round"
                        filter="url(#glow-gold)"
                      />
                      <line
                        class="fx-tank-sabot-core"
                        x1={(vec.dist * 0.15).toFixed(1)}
                        y1="0"
                        x2={vec.dist.toFixed(1)}
                        y2="0"
                        pathLength="100"
                        stroke="#fef08a"
                        stroke-width="1.3"
                        stroke-linecap="round"
                      />
                      <!-- Armored spearhead dart -->
                      <g class="fx-tank-projectile">
                        <polygon
                          points="4,0 -3,-2.5 -1.5,0 -3,2.5"
                          fill="#fef08a"
                          stroke="#ea580c"
                          stroke-width="0.7"
                        />
                      </g>
                      <!-- Explosive ballistic shockwave rings at defender -->
                      <g transform="translate({vec.dist.toFixed(1)}, 0)">
                        <circle
                          class="fx-tank-shockwave"
                          cx="0"
                          cy="0"
                          r="3"
                          fill="rgba(251, 146, 60, 0.35)"
                          stroke="#f97316"
                          stroke-width="1.8"
                        />
                        <circle
                          class="fx-tank-shockwave secondary"
                          cx="0"
                          cy="0"
                          r="2"
                          fill="none"
                          stroke="#fef08a"
                          stroke-width="1.2"
                        />
                      </g>
                    </g>
                  {/if}

                  <!-- 3. ARTILLERY: High Parabolic Ballistic Arc, Smoke Puffs & Temporary Crater -->
                  {#if anim.categories.includes("artillery")}
                    <g class="combat-fx-artillery">
                      <!-- Dashed ballistic arc guide -->
                      <path
                        d={vec.parabolicPathD}
                        fill="none"
                        stroke="rgba(251, 146, 60, 0.42)"
                        stroke-width="1.1"
                        stroke-dasharray="2.5 3.5"
                      />
                      <!-- Animated glowing artillery shell streak along the parabolic curve -->
                      <path
                        class="fx-artillery-shell-arc"
                        d={vec.parabolicPathD}
                        pathLength="100"
                        fill="none"
                        stroke="#fb923c"
                        stroke-width="2.8"
                        stroke-linecap="round"
                        filter="url(#glow-red)"
                      />
                      <path
                        class="fx-artillery-shell-arc core"
                        d={vec.parabolicPathD}
                        pathLength="100"
                        fill="none"
                        stroke="#fef08a"
                        stroke-width="1.4"
                        stroke-linecap="round"
                      />
                      <!-- Impact Crater & Smoke Plume at Target -->
                      <g transform="translate({vec.x2.toFixed(1)}, {vec.y2.toFixed(1)})">
                        <ellipse
                          class="fx-artillery-crater"
                          cx="0"
                          cy="1.5"
                          rx="7.5"
                          ry="4.2"
                          fill="rgba(15, 23, 42, 0.88)"
                          stroke="#f97316"
                          stroke-width="1.1"
                        />
                        <circle
                          class="fx-artillery-blast"
                          cx="0"
                          cy="0"
                          r="4.5"
                          fill="rgba(239, 68, 68, 0.55)"
                          stroke="#fde047"
                          stroke-width="1.4"
                        />
                        <circle class="fx-smoke-puff p1" cx="-4" cy="-2" r="3.4" fill="rgba(148, 163, 184, 0.65)" />
                        <circle class="fx-smoke-puff p2" cx="4.2" cy="-3" r="3.0" fill="rgba(100, 116, 139, 0.65)" />
                        <circle class="fx-smoke-puff p3" cx="0" cy="-5" r="3.8" fill="rgba(203, 213, 225, 0.55)" />
                      </g>
                    </g>
                  {/if}

                  <!-- 4. AIR FORCE: Fighter/Bomber Sortie Across Airspace & Area Bomb Dispersal -->
                  {#if anim.categories.includes("aircraft")}
                    <g
                      class="combat-fx-aircraft"
                      transform="translate({vec.x1.toFixed(1)}, {vec.y1.toFixed(1)}) rotate({vec.angleDeg.toFixed(1)})"
                    >
                      <!-- Twin high-altitude contrails -->
                      <line
                        class="fx-air-contrail"
                        x1="0"
                        y1="-2.6"
                        x2={vec.dist.toFixed(1)}
                        y2="-2.6"
                        pathLength="100"
                        stroke="rgba(186, 230, 253, 0.65)"
                        stroke-width="0.95"
                        stroke-linecap="round"
                      />
                      <line
                        class="fx-air-contrail"
                        x1="0"
                        y1="2.6"
                        x2={vec.dist.toFixed(1)}
                        y2="2.6"
                        pathLength="100"
                        stroke="rgba(186, 230, 253, 0.65)"
                        stroke-width="0.95"
                        stroke-linecap="round"
                      />
                      <!-- Area bomb dispersal / recon radar rings around target -->
                      <g transform="translate({vec.dist.toFixed(1)}, 0)">
                        {#if anim.missionType === "recon"}
                          <circle
                            class="fx-air-dispersal recon"
                            cx="0"
                            cy="0"
                            r="4"
                            fill="none"
                            stroke="#38bdf8"
                            stroke-width="1.3"
                          />
                        {:else}
                          <circle
                            class="fx-air-dispersal b1"
                            cx="-5"
                            cy="-2.5"
                            r="3"
                            fill="rgba(251, 191, 36, 0.35)"
                            stroke="#facc15"
                            stroke-width="1.2"
                          />
                          <circle
                            class="fx-air-dispersal b2"
                            cx="0"
                            cy="0"
                            r="3.8"
                            fill="rgba(239, 68, 68, 0.4)"
                            stroke="#f97316"
                            stroke-width="1.4"
                          />
                          <circle
                            class="fx-air-dispersal b3"
                            cx="4.8"
                            cy="2.2"
                            r="3"
                            fill="rgba(251, 191, 36, 0.35)"
                            stroke="#facc15"
                            stroke-width="1.2"
                          />
                        {/if}
                      </g>
                      <!-- Swept-wing tactical jet silhouette flying across the vector -->
                      <g class="fx-aircraft-silhouette">
                        <path
                          d="M 7 0 L 1.5 -1.6 L -2.5 -7.2 L -4.5 -7.2 L -2.2 -1.6 L -6.5 -1.2 L -8.2 -3.6 L -9.2 -3.6 L -8.0 0 L -9.2 3.6 L -8.2 3.6 L -6.5 1.2 L -2.2 1.6 L -4.5 7.2 L -2.5 7.2 L 1.5 1.6 Z"
                          fill="#e0f2fe"
                          stroke="#0284c7"
                          stroke-width="0.65"
                          filter="drop-shadow(0 2px 3px rgba(0,0,0,0.85))"
                        />
                      </g>
                    </g>
                  {/if}

                  <!-- 5. NAVY: Coastal Battery Salvo, Water Splashes & Beachhead Detonation -->
                  {#if anim.categories.includes("navy")}
                    <g
                      class="combat-fx-navy"
                      transform="translate({vec.x1.toFixed(1)}, {vec.y1.toFixed(1)}) rotate({vec.angleDeg.toFixed(1)})"
                    >
                      <!-- Twin naval cannon salvo streaks -->
                      <line
                        class="fx-navy-salvo"
                        x1={(vec.dist * 0.1).toFixed(1)}
                        y1="-2.4"
                        x2={(vec.dist * 0.96).toFixed(1)}
                        y2="-1.2"
                        pathLength="100"
                        stroke="#38bdf8"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                      <line
                        class="fx-navy-salvo delay-1"
                        x1={(vec.dist * 0.1).toFixed(1)}
                        y1="2.4"
                        x2={(vec.dist * 0.96).toFixed(1)}
                        y2="1.2"
                        pathLength="100"
                        stroke="#bae6fd"
                        stroke-width="1.6"
                        stroke-linecap="round"
                      />
                      <!-- Maritime water splash rings along sea crossing -->
                      <circle
                        class="fx-navy-splash s1"
                        cx={(vec.dist * 0.42).toFixed(1)}
                        cy="-1.8"
                        r="2.4"
                        fill="none"
                        stroke="#e0f2fe"
                        stroke-width="1.1"
                      />
                      <circle
                        class="fx-navy-splash s2"
                        cx={(vec.dist * 0.68).toFixed(1)}
                        cy="1.8"
                        r="2.8"
                        fill="none"
                        stroke="#7dd3fc"
                        stroke-width="1.1"
                      />
                      <!-- Amphibious beachhead detonation at coastal target -->
                      <g transform="translate({(vec.dist * 0.96).toFixed(1)}, 0)">
                        <circle
                          class="fx-navy-beach-blast"
                          cx="0"
                          cy="0"
                          r="3.6"
                          fill="rgba(56, 189, 248, 0.35)"
                          stroke="#fde047"
                          stroke-width="1.5"
                        />
                      </g>
                    </g>
                  {/if}
                </g>
              {/each}
            </g>
          {/if}
        </g>
      {/each}
    </g>
  </svg>
</div>

<style>
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

  .clean-map-indicator {
    position: absolute;
    top: 4.8rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(6, 11, 21, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.5);
    color: #e0f2fe;
    padding: 0.35rem 0.9rem;
    border-radius: 20px;
    font-size: 0.72rem;
    font-weight: 600;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65);
    letter-spacing: 0.02em;
    backdrop-filter: blur(4px);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  /* Rich Tactical Theater Tooltip (HEGEM-81) */
  .theater-tactical-tooltip {
    position: absolute;
    top: 4.8rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(390px, calc(100vw - 32px));
    background: linear-gradient(165deg, rgba(9, 15, 28, 0.96) 0%, rgba(5, 9, 18, 0.98) 100%);
    border: 1px solid var(--theater-accent, #eab308);
    border-left: 3px solid var(--theater-accent, #eab308);
    border-radius: 7px;
    padding: 12px 14px;
    color: #f8fafc;
    z-index: 25;
    pointer-events: none;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.85), 0 0 16px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .ttt-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }
  .ttt-title-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ttt-eyebrow {
    font-family: var(--font-tactical);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: var(--theater-accent, #eab308);
  }
  .ttt-title-group h4 {
    font-family: var(--font-display);
    font-size: 0.94rem;
    font-weight: 800;
    color: #f8fafc;
    margin: 0;
  }
  .ttt-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 3px;
    font-family: var(--font-tactical);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(30, 41, 59, 0.85);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.35);
    white-space: nowrap;
  }
  .ttt-status-pill.active {
    background: rgba(16, 185, 129, 0.2);
    color: #6ee7b7;
    border-color: rgba(16, 185, 129, 0.5);
  }
  .ttt-progress-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: rgba(5, 9, 18, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 5px;
    padding: 7px 9px;
  }
  .ttt-progress-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ttt-progress-meta strong {
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    color: #f1f5f9;
  }
  .ttt-control-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 0.66rem;
    color: #94a3b8;
  }
  .ttt-progress-track {
    width: 100%;
    height: 4px;
    background: rgba(30, 41, 59, 0.85);
    border-radius: 2px;
    overflow: hidden;
  }
  .ttt-progress-fill {
    height: 100%;
    transition: width 0.25s ease;
  }
  .ttt-bonuses-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  .ttt-bonus-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 5px;
  }
  .ttt-bonus-icon {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: rgba(5, 9, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.22);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .ttt-bonus-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ttt-bonus-copy small {
    font-size: 0.62rem;
    color: #94a3b8;
  }
  .ttt-bonus-copy strong {
    font-family: var(--font-tactical);
    font-size: 0.76rem;
    color: #f8fafc;
  }
  .ttt-doctrine-note {
    margin: 0;
    padding-top: 6px;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.68rem;
    color: #cbd5e1;
    line-height: 1.35;
  }

  .tactical-theater-badge {
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .tactical-theater-badge:hover,
  .tactical-theater-badge.is-hovered {
    filter: brightness(1.25);
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

  /* --- HEGEM-80: GPU-Accelerated Vector Combat Animations per Troop Category --- */
  .division-counter-body.under-armor-shock {
    animation: badgeArmorShock 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }
  .division-counter-body.under-fire {
    animation: badgeUnderFire 380ms ease-out both;
  }

  @keyframes badgeArmorShock {
    0%, 100% { transform: translate(0, 0); }
    18% { transform: translate(-2.2px, 1.4px); }
    36% { transform: translate(2.4px, -1.6px); }
    54% { transform: translate(-1.8px, -1.1px); }
    72% { transform: translate(1.5px, 1.2px); }
  }

  @keyframes badgeUnderFire {
    0%, 100% { transform: translate(0, 0); }
    25% { transform: translate(-1.2px, 0.8px); }
    55% { transform: translate(1.2px, -0.8px); }
  }

  /* 1. Infantry: Muzzle Flashes & Tracer Fire */
  .fx-muzzle-flash {
    animation: combatMuzzleFlash var(--anim-dur, 620ms) ease-out both;
  }
  .fx-muzzle-flash.delay-1 {
    animation-delay: 70ms;
  }
  .fx-tracer-beam {
    stroke-dasharray: 18 100;
    animation: combatTracerDash var(--anim-dur, 620ms) linear both;
  }
  .fx-tracer-beam.delay-1 {
    animation-delay: 55ms;
  }
  .fx-tracer-beam.delay-2 {
    animation-delay: 110ms;
  }
  .fx-infantry-spark {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatImpactRing var(--anim-dur, 620ms) ease-out both;
  }

  @keyframes combatMuzzleFlash {
    0% { opacity: 0; }
    12% { opacity: 1; }
    28% { opacity: 0.25; }
    44% { opacity: 0.95; }
    70%, 100% { opacity: 0; }
  }

  @keyframes combatTracerDash {
    0% {
      stroke-dashoffset: 24;
      opacity: 0.95;
    }
    80% {
      opacity: 1;
    }
    100% {
      stroke-dashoffset: -95;
      opacity: 0;
    }
  }

  /* 2. Tank (Armor): High-Velocity Sabot & Shockwave */
  .fx-tank-sabot-trail,
  .fx-tank-sabot-core {
    stroke-dasharray: 28 110;
    animation: combatSabotStreak var(--anim-dur, 620ms) cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .fx-tank-projectile {
    animation: combatLinearTravel var(--anim-dur, 620ms) cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .fx-tank-shockwave {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatShockwaveExpand var(--anim-dur, 620ms) cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .fx-tank-shockwave.secondary {
    animation-delay: 65ms;
  }

  @keyframes combatSabotStreak {
    0% {
      stroke-dashoffset: 30;
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    100% {
      stroke-dashoffset: -100;
      opacity: 0;
    }
  }

  @keyframes combatLinearTravel {
    0% {
      transform: translate3d(0, 0, 0) scale(0.85);
      opacity: 0.95;
    }
    75% {
      transform: translate3d(var(--travel-dist, 80px), 0, 0) scale(1.05);
      opacity: 1;
    }
    100% {
      transform: translate3d(var(--travel-dist, 80px), 0, 0) scale(0.4);
      opacity: 0;
    }
  }

  @keyframes combatShockwaveExpand {
    0%, 28% {
      transform: scale(0.2);
      opacity: 0;
    }
    45% {
      opacity: 1;
    }
    100% {
      transform: scale(4.2);
      opacity: 0;
    }
  }

  /* 3. Artillery: High-Arc Parabolic Shell, Crater & Smoke Plume */
  .fx-artillery-shell-arc {
    stroke-dasharray: 16 110;
    animation: combatParabolicArc var(--anim-dur, 620ms) cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  .fx-artillery-crater {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatCraterFade var(--anim-dur, 620ms) ease-out both;
  }
  .fx-artillery-blast {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatShockwaveExpand var(--anim-dur, 620ms) ease-out both;
  }
  .fx-smoke-puff {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatSmokePlume var(--anim-dur, 620ms) ease-out both;
  }
  .fx-smoke-puff.p2 {
    animation-delay: 45ms;
  }
  .fx-smoke-puff.p3 {
    animation-delay: 85ms;
  }

  @keyframes combatParabolicArc {
    0% {
      stroke-dashoffset: 18;
      opacity: 1;
    }
    82% {
      opacity: 1;
    }
    100% {
      stroke-dashoffset: -102;
      opacity: 0;
    }
  }

  @keyframes combatCraterFade {
    0%, 42% {
      transform: scale(0.2);
      opacity: 0;
    }
    58% {
      transform: scale(1.05);
      opacity: 0.95;
    }
    85% {
      transform: scale(1);
      opacity: 0.85;
    }
    100% {
      transform: scale(0.95);
      opacity: 0;
    }
  }

  @keyframes combatSmokePlume {
    0%, 44% {
      transform: translate3d(0, 2px, 0) scale(0.3);
      opacity: 0;
    }
    65% {
      opacity: 0.85;
    }
    100% {
      transform: translate3d(0, -10px, 0) scale(2.1);
      opacity: 0;
    }
  }

  /* 4. Air Force: Jet Flyover, Contrails & Area Bomb Dispersal */
  .fx-air-contrail {
    stroke-dasharray: 100 100;
    animation: combatContrailDraw var(--anim-dur, 620ms) ease-out both;
  }
  .fx-aircraft-silhouette {
    animation: combatAirSortie var(--anim-dur, 620ms) cubic-bezier(0.22, 0.61, 0.36, 1) both;
  }
  .fx-air-dispersal {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatShockwaveExpand var(--anim-dur, 620ms) ease-out both;
  }
  .fx-air-dispersal.b2 {
    animation-delay: 45ms;
  }
  .fx-air-dispersal.b3 {
    animation-delay: 90ms;
  }

  @keyframes combatContrailDraw {
    0% {
      stroke-dashoffset: 100;
      opacity: 0.85;
    }
    70% {
      stroke-dashoffset: 0;
      opacity: 0.7;
    }
    100% {
      stroke-dashoffset: 0;
      opacity: 0;
    }
  }

  @keyframes combatAirSortie {
    0% {
      transform: translate3d(-6px, 0, 0) scale(0.75);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      transform: translate3d(calc(var(--travel-dist, 80px) + 12px), 0, 0) scale(0.95);
      opacity: 0;
    }
  }

  /* 5. Navy: Coastal Battery Salvo, Water Splashes & Beach Detonation */
  .fx-navy-salvo {
    stroke-dasharray: 22 105;
    animation: combatSabotStreak var(--anim-dur, 620ms) ease-out both;
  }
  .fx-navy-salvo.delay-1 {
    animation-delay: 60ms;
  }
  .fx-navy-splash {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatImpactRing var(--anim-dur, 620ms) ease-out both;
  }
  .fx-navy-splash.s2 {
    animation-delay: 75ms;
  }
  .fx-navy-beach-blast {
    transform-box: fill-box;
    transform-origin: center;
    animation: combatShockwaveExpand var(--anim-dur, 620ms) ease-out both;
  }

  @keyframes combatImpactRing {
    0%, 20% {
      transform: scale(0.25);
      opacity: 0;
    }
    50% {
      opacity: 0.95;
    }
    100% {
      transform: scale(3.2);
      opacity: 0;
    }
  }
</style>
