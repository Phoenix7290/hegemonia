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
  import { getTerritoryName } from "../i18n/content.svelte";
  import type { BaseMapMode, MapOverlays } from "../lib/map-preferences.js";

  let {
    game,
    myPlayerId,
    baseMapMode = "cartographic",
    overlays = { regional: false, economic: false },
    mapMode,
    cleanMapMode = false,
    highlightObjectiveTerritories = false,
    objectiveTargetTerritoryIds = new Set<string>(),
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

  const REGION_BANNERS: { label: string; bonus: string; x: number; y: number; color: string }[] = [
    { label: "AMÉRICA DO NORTE", bonus: "+5", x: 265, y: 125, color: "#f59e0b" },
    { label: "AMÉRICA DO SUL", bonus: "+2", x: 392, y: 382, color: "#10b981" },
    { label: "EUROPA", bonus: "+5", x: 645, y: 132, color: "#3b82f6" },
    { label: "ÁFRICA", bonus: "+3", x: 655, y: 295, color: "#eab308" },
    { label: "ÁSIA: INDO-ARÁBIA", bonus: "+2", x: 835, y: 228, color: "#f97316" },
    { label: "ÁSIA: ESTEPES & SIBÉRIA", bonus: "+2", x: 935, y: 108, color: "#06b6d4" },
    { label: "ÁSIA: LESTE ASIÁTICO", bonus: "+3", x: 995, y: 185, color: "#ec4899" },
    { label: "OCEANIA", bonus: "+2", x: 1015, y: 375, color: "#a855f7" },
  ];

  function getTerritoryRegionColor(t: { continent: string; subRegion?: string }): string {
    if (t.subRegion && REGION_COLOR_HEX[t.subRegion]) {
      return REGION_COLOR_HEX[t.subRegion];
    }
    return REGION_COLOR_HEX[t.continent] ?? "#64748b";
  }

  const COMPACT_BADGE_IDS = new Set([
    "islandia",
    "inglaterra",
    "alemanha",
    "polonia",
    "balcas",
    "franca",
    "egito",
    "tchita",
    "mongolia",
    "vietna",
    "borneu",
    "sumatra",
    "nova_guine",
    "madagascar",
    "havai",
  ]);

  const territoryById = new Map(CLASSIC_MAP.territories.map((t) => [t.id, t]));

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
      <span>Visão Limpa Ativa — Pressione <strong>F4</strong> para restaurar marcadores</span>
    </div>
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

      <!-- 3 HORIZONTAL WORLD COPIES (-1200, 0, +1200) FOR CONTINUOUS EU4/HOI4 GLOBE WRAPPING -->
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

      <!-- TERRITORY PASS: after all world-copy backgrounds -->
      {#each [-MAP_WIDTH, 0, MAP_WIDTH] as offsetX (offsetX)}
        <g class="world-copy" transform="translate({offsetX}, 0)">
          <!-- 44 Natural Earth Admin-1 & Admin-0 Geopolitical Territories -->
          {#each CLASSIC_MAP.territories as t (t.id)}
            {@const tState = game.territories[t.id]}
            {@const owner = game.players.find((p) => p.id === tState.ownerId)}
            {@const ownerColor = owner ? COLOR_HEX[owner.color] : "#334155"}
            {@const regionColor = getTerritoryRegionColor(t as any)}
            {@const economicProfileColor =
              t.resource === "gold"
                ? "#854d0e"
                : t.resource === "oil"
                  ? "#451a03"
                  : t.resource === "steel"
                    ? "#1e293b"
                    : (t.tradeBonus && t.tradeBonus > 0)
                      ? "#064e3b"
                      : "#18181b"}
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
            {@const isCapital = owner?.capitalTerritoryId === t.id}
            {@const originalCapitalOwner = game.players.find((p) => p.capitalTerritoryId === t.id)}
            {@const isFallenCapital = originalCapitalOwner && originalCapitalOwner.id !== tState.ownerId}
            {@const fortLevel = getTerritoryBuildingLevel(tState, "fortification")}

            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g
              class="territory-group"
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

              <!-- OVERLAY: Regional Continental Tint -->
              {#if effectiveOverlays.regional}
                <path
                  d={t.svgPath}
                  fill={regionColor}
                  fill-opacity={effectiveBaseMode === "cartographic" ? "0.32" : "0.26"}
                  stroke="none"
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

              {#if !cleanMapMode}
                {@const compactTroops = formatCompactTroops(tState.armies)}
                {@const troopFontSize = compactTroops.length <= 2 ? 8.2 : compactTroops.length === 3 ? 7.5 : 6.5}
                <!-- HOI4-STYLE MILITARY DIVISION COUNTER WITH OPTIONAL ECONOMIC SUB-BADGE -->
                <g
                  transform="translate({t.center[0]}, {t.center[1]}) scale({COMPACT_BADGE_IDS.has(t.id) ? 0.82 : 0.94})"
                  class="division-counter"
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

                  <!-- Attached Economic Sub-Badge (Overlay: Economic) -->
                  {#if effectiveOverlays.economic}
                    {@const maxSlots = isCapital ? 3 : 2}
                    {@const bldgs = tState.buildings ?? []}
                    <g transform="translate(0, 11.5)" class="economic-sub-badge" pointer-events="none">
                      <rect
                        x="-20"
                        y="-4.6"
                        width="40"
                        height="9.4"
                        rx="2"
                        fill="#090e1a"
                        stroke="rgba(148, 163, 184, 0.45)"
                        stroke-width="0.75"
                        filter="drop-shadow(0 1px 2px rgba(0,0,0,0.85))"
                      />
                      <!-- Resource Icon on Left -->
                      {#if t.resource === "gold"}
                        <g transform="translate(-13.5, 0)">
                          <circle cx="0" cy="0" r="3.2" fill="#2e1b05" stroke="#facc15" stroke-width="0.6" />
                          <Icon name="gold" size={5} x={-2.5} y={-2.5} color="#fde047" strokeWidth={2} />
                        </g>
                      {:else if t.resource === "steel"}
                        <g transform="translate(-13.5, 0)">
                          <circle cx="0" cy="0" r="3.2" fill="#0f172a" stroke="#94a3b8" stroke-width="0.6" />
                          <Icon name="steel" size={5} x={-2.5} y={-2.5} color="#e2e8f0" strokeWidth={2} />
                        </g>
                      {:else if t.resource === "oil"}
                        <g transform="translate(-13.5, 0)">
                          <circle cx="0" cy="0" r="3.2" fill="#321202" stroke="#f97316" stroke-width="0.6" />
                          <Icon name="oil" size={5} x={-2.5} y={-2.5} color="#fdba74" strokeWidth={2} />
                        </g>
                      {:else if t.tradeBonus && t.tradeBonus > 0}
                        <g transform="translate(-13.5, 0)">
                          <circle cx="0" cy="0" r="3.2" fill="#042f2e" stroke="#10b981" stroke-width="0.6" />
                          <Icon name="coins" size={5} x={-2.5} y={-2.5} color="#6ee7b7" strokeWidth={2} />
                        </g>
                      {:else}
                        <g transform="translate(-13.5, 0)">
                          <circle cx="0" cy="0" r="1.8" fill="#0f172a" stroke="rgba(148, 163, 184, 0.35)" stroke-width="0.5" />
                        </g>
                      {/if}

                      <!-- Divider Line -->
                      <line x1="-8" y1="-3.8" x2="-8" y2="3.8" stroke="rgba(148, 163, 184, 0.25)" stroke-width="0.6" />

                      <!-- Building Slots on Right -->
                      <g transform="translate(4.5, 0)">
                        {#each Array(maxSlots) as _, slotIdx}
                          {@const b = bldgs[slotIdx]}
                          {@const slotX = (slotIdx - (maxSlots - 1) / 2) * 7.2}
                          <g transform="translate({slotX}, 0)">
                            {#if b}
                              <rect
                                x="-2.8"
                                y="-3.4"
                                width="5.6"
                                height="6.8"
                                rx="1"
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
                                stroke-width="0.6"
                              />
                              <Icon
                                name={b.type === "fortification"
                                  ? (b.level === 2 ? "fortification-l2" : "fortification")
                                  : b.type}
                                size={4.6}
                                x={-2.3}
                                y={-2.3}
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
                                x="-2.6"
                                y="-3.2"
                                width="5.2"
                                height="6.4"
                                rx="0.9"
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
                    y={effectiveOverlays.economic ? 20.8 : 11.2}
                    text-anchor="middle"
                    fill={isCapital ? "#fde047" : "#e2e8f0"}
                    font-size="6.2"
                    font-weight="700"
                    letter-spacing="0.01em"
                    pointer-events="none"
                    style="paint-order: stroke; stroke: #050912; stroke-width: 2.4px; stroke-linejoin: round;"
                  >
                    {getTerritoryName(t.id)}
                  </text>

                  <!-- Structural Indicators (Dots for constructed infrastructure, only shown if economic overlay is off) -->
                  {#if !effectiveOverlays.economic && tState.buildings && tState.buildings.length > 0}
                    <g transform="translate(0, 16.5)" pointer-events="none">
                      {#each tState.buildings as b, bIdx}
                        {@const xOffset = (bIdx - (tState.buildings.length - 1) / 2) * 5.2}
                        <circle
                          cx={xOffset}
                          cy="0"
                          r="1.7"
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
              {/if}
            </g>
          {/each}

          <!-- Floating Regional & Sub-Regional Theatre Banners in "regional" Overlay -->
          {#if effectiveOverlays.regional && !cleanMapMode}
            {#each REGION_BANNERS as rb}
              <g transform="translate({rb.x}, {rb.y})" pointer-events="none">
                <rect
                  x="-68"
                  y="-11"
                  width="136"
                  height="20"
                  rx="4"
                  fill="rgba(6, 10, 18, 0.88)"
                  stroke={rb.color}
                  stroke-width="1.5"
                />
                <text
                  x="0"
                  y="-1"
                  text-anchor="middle"
                  dominant-baseline="central"
                  fill="#f8fafc"
                  font-size="7.8"
                  font-weight="900"
                  letter-spacing="0.06em"
                >
                  {rb.label} ({rb.bonus})
                </text>
              </g>
            {/each}
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

  .territory-group {
    cursor: pointer;
  }
  .territory-group:hover path:first-child {
    filter: brightness(1.25);
  }
  .division-counter {
    pointer-events: none;
  }
</style>
