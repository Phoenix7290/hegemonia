import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { totalUnits } from "@hegemonia/engine";
import type { UnitCounts, UnitType } from "@hegemonia/shared";
import { catalogs } from "../i18n/registry";

function getMaxAllowed(
  unitType: UnitType,
  available: UnitCounts,
  selection: UnitCounts,
  maxTotal: number
): number {
  const selectedTotal = totalUnits(selection);
  const current = selection[unitType] ?? 0;
  const otherTotal = selectedTotal - current;
  const remainingBudget = Math.max(0, maxTotal - otherTotal);
  return Math.min(available[unitType] ?? 0, remainingBudget);
}

function getTargetHalf(
  unitType: UnitType,
  available: UnitCounts,
  selection: UnitCounts,
  maxTotal: number
): number {
  const maxAllowed = getMaxAllowed(unitType, available, selection, maxTotal);
  const half = Math.round((available[unitType] ?? 0) * 0.5);
  return Math.min(half, maxAllowed);
}

function applyCategoryPreset(
  unitType: UnitType,
  mode: "zero" | "half" | "max",
  available: UnitCounts,
  selection: UnitCounts,
  maxTotal: number
): UnitCounts {
  if (mode === "zero") {
    return { ...selection, [unitType]: 0 };
  }
  if (mode === "half") {
    return { ...selection, [unitType]: getTargetHalf(unitType, available, selection, maxTotal) };
  }
  return { ...selection, [unitType]: getMaxAllowed(unitType, available, selection, maxTotal) };
}

function fillMaxAll(
  available: UnitCounts,
  selection: UnitCounts,
  maxTotal: number
): UnitCounts {
  const selectedTotal = totalUnits(selection);
  let remaining = Math.max(0, maxTotal - selectedTotal);
  if (remaining <= 0) return { ...selection };
  const next = { ...selection };
  const priorityOrder: UnitType[] = ["tank", "artillery", "infantry", "aircraft", "navy"];
  for (const ut of priorityOrder) {
    if (remaining <= 0) break;
    const canTake = Math.max(0, (available[ut] ?? 0) - (next[ut] ?? 0));
    const take = Math.min(canTake, remaining);
    next[ut] = (next[ut] ?? 0) + take;
    remaining -= take;
  }
  return next;
}

describe("HEGEM-83: Tactical Unit Selector Presets & Constraints", () => {
  const defaultAvailable: UnitCounts = {
    infantry: 10,
    tank: 4,
    artillery: 2,
    aircraft: 1,
    navy: 0,
  };

  it("calculates max allowed per category respecting global budget maxTotal", () => {
    const selection: UnitCounts = { infantry: 3, tank: 0, artillery: 0, aircraft: 0, navy: 0 };
    const maxTotal = 5; // e.g. 6 armies on territory, 1 must remain as garrison

    // Tanks can take at most 5 - 3 = 2, even though 4 are available
    expect(getMaxAllowed("tank", defaultAvailable, selection, maxTotal)).toBe(2);

    // Infantry can expand from 3 up to 5
    expect(getMaxAllowed("infantry", defaultAvailable, selection, maxTotal)).toBe(5);

    // Navy has 0 available, so max allowed is 0
    expect(getMaxAllowed("navy", defaultAvailable, selection, maxTotal)).toBe(0);
  });

  it("calculates 50% target clamped to remaining budget", () => {
    const maxTotal = 3;
    const selection: UnitCounts = { infantry: 1, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    // Infantry available = 10, half = 5. But remaining budget is 3 - 0 = 3, so target half is clamped to 3
    expect(getTargetHalf("infantry", defaultAvailable, selection, maxTotal)).toBe(3);

    // Tank available = 4, half = 2. Remaining budget is 3 - 1 = 2, so target half is 2
    expect(getTargetHalf("tank", defaultAvailable, selection, maxTotal)).toBe(2);

    // Artillery available = 2, half = 1. Remaining budget = 2, so target half is 1
    expect(getTargetHalf("artillery", defaultAvailable, selection, maxTotal)).toBe(1);
  });

  it("applies category presets (zero, half, max) without violating garrison rules", () => {
    const originArmies = 8;
    const maxTotal = originArmies - 1; // Strict engine rule: at least 1 army remains as garrison
    let selection: UnitCounts = { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    // Max tanks
    selection = applyCategoryPreset("tank", "max", defaultAvailable, selection, maxTotal);
    expect(selection.tank).toBe(4);
    expect(totalUnits(selection)).toBeLessThanOrEqual(maxTotal);

    // 50% artillery: available 2, half is 1. Remaining budget is 7 - 4 = 3 >= 1
    selection = applyCategoryPreset("artillery", "half", defaultAvailable, selection, maxTotal);
    expect(selection.artillery).toBe(1);
    expect(totalUnits(selection)).toBe(5);

    // Max infantry: available 10, but remaining budget is 7 - 5 = 2. Must clamp to 2
    selection = applyCategoryPreset("infantry", "max", defaultAvailable, selection, maxTotal);
    expect(selection.infantry).toBe(2);
    expect(totalUnits(selection)).toBe(7);
    expect(totalUnits(selection)).toBe(maxTotal);

    // Zero tanks
    selection = applyCategoryPreset("tank", "zero", defaultAvailable, selection, maxTotal);
    expect(selection.tank).toBe(0);
    expect(totalUnits(selection)).toBe(3);
  });

  it("fills max force according to strategic tactical priority", () => {
    const maxTotal = 6;
    const initial: UnitCounts = { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    const filled = fillMaxAll(defaultAvailable, initial, maxTotal);
    // Priority: tank (takes 4), then artillery (takes 2), remaining is 0
    expect(filled.tank).toBe(4);
    expect(filled.artillery).toBe(2);
    expect(filled.infantry).toBe(0);
    expect(totalUnits(filled)).toBe(6);
  });

  it("respects existing selection and tops up to maxTotal", () => {
    const maxTotal = 7;
    // User already manually picked 2 infantry
    const initial: UnitCounts = { infantry: 2, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    const filled = fillMaxAll(defaultAvailable, initial, maxTotal);
    // Preserves 2 infantry, fills 4 tanks, 1 artillery = 7
    expect(filled.infantry).toBe(2);
    expect(filled.tank).toBe(4);
    expect(filled.artillery).toBe(1);
    expect(totalUnits(filled)).toBe(7);
  });

  it("has complete i18n preset translations with key parity and zero emojis", () => {
    const pt = catalogs["pt-BR"].game;
    const en = catalogs["en"].game;

    const presetKeys = [
      "unit_preset_zero",
      "unit_preset_half",
      "unit_preset_max",
      "unit_preset_clear_all_tip",
      "unit_preset_fill_max_tip",
      "unit_preset_zero_category",
      "unit_preset_half_category",
      "unit_preset_max_category",
    ];

    for (const key of presetKeys) {
      expect((pt as any)[key], `Key ${key} in pt-BR`).toBeDefined();
      expect((en as any)[key], `Key ${key} in en`).toBeDefined();

      // Zero emojis rule
      const emojiRegex = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}]/u;
      expect((pt as any)[key]).not.toMatch(emojiRegex);
      expect((en as any)[key]).not.toMatch(emojiRegex);
    }
  });
});

describe("HEGEM-84: Tactical Confrontation Header with Faction Flags", () => {
  it("verifies ActionConsole embeds FactionFlag in .attack-matchup with 18x12 dimension", () => {
    const actionConsolePath = resolve(__dirname, "../components/ActionConsole.svelte");
    const code = readFileSync(actionConsolePath, "utf-8");

    // Must import FactionFlag
    expect(code).toContain('import FactionFlag from "./FactionFlag.svelte"');

    // Must look up both attacker and defender player instances
    expect(code).toMatch(/fromPlayer\s*=\s*game\.players\.find/);
    expect(code).toMatch(/toPlayer\s*=\s*game\.players\.find/);

    // Must render FactionFlag with width 18 and height 12 for both sides
    expect(code).toContain("<FactionFlag color={fromPlayer.color} width={18} height={12} />");
    expect(code).toContain("<FactionFlag color={toPlayer.color} width={18} height={12} />");

    // Matchup sides must exist for layout
    expect(code).toContain('class="matchup-side origin"');
    expect(code).toContain('class="matchup-side target"');
  });

  it("verifies UnitSelector implements press-and-hold pointer handlers and cleanup", () => {
    const unitSelectorPath = resolve(__dirname, "../components/UnitSelector.svelte");
    const code = readFileSync(unitSelectorPath, "utf-8");

    // Pointer events for mobile & desktop
    expect(code).toContain("onpointerdown=");
    expect(code).toContain("onpointerup=");
    expect(code).toContain("onpointercancel=");
    expect(code).toContain("oncontextmenu=");

    // Acceleration delay scaling
    expect(code).toMatch(/accelerationFactor|Math\.floor\(currentDelay/);

    // Cleanup on destroy
    expect(code).toContain("onDestroy");
    expect(code).toContain("stopHold");

    // Presets chips in row
    expect(code).toContain('class="category-presets"');
    expect(code).toContain('class="preset-chip"');
  });
});

describe("HEGEM-97: Maneuver Redesign with Visual Route & Agile Fast Actions", () => {
  it("verifies ActionConsole implements dual contrasting cards and quick division selectors", () => {
    const actionConsolePath = resolve(__dirname, "../components/ActionConsole.svelte");
    const code = readFileSync(actionConsolePath, "utf-8");

    // Must have dual contrasting cards for origin and destination
    expect(code).toContain('class="maneuver-dual-cards"');
    expect(code).toContain('class="maneuver-card from-card"');
    expect(code).toContain('class="maneuver-card to-card"');
    expect(code).toContain('class="card-tag from">ORIGEM</div>');
    expect(code).toContain('class="card-tag to">DESTINO</div>');

    // Must retain minimum garrison of 1
    expect(code).toContain("1 retida");

    // Must implement quick selection bar (+1, 50%, MÁXIMO, LIMPAR)
    expect(code).toContain('class="maneuver-quick-bar"');
    expect(code).toContain("+1");
    expect(code).toContain("50%");
    expect(code).toContain("MÁXIMO");
    expect(code).toContain("LIMPAR");

    // Must have action buttons
    expect(code).toContain("CONFIRMAR REAGRUPAMENTO");
    expect(code).toContain("ENCERRAR TURNO SEM MANOBRA");
  });

  it("verifies TacticalMap contains directional maneuver vector marker and destination pulse", () => {
    const mapPath = resolve(__dirname, "../components/TacticalMap.svelte");
    const code = readFileSync(mapPath, "utf-8");

    // Directional Arrowhead marker in SVG defs
    expect(code).toContain('id="maneuver-arrow"');

    // Directional Maneuver Vector layer
    expect(code).toContain('class="layer-maneuver-route"');
    expect(code).toContain('marker-end="url(#maneuver-arrow)"');
    expect(code).toContain('class="fx-maneuver-vector"');

    // Maneuver valid destination pulse class
    expect(code).toContain("class:maneuver-dest-pulse={isManeuverDest}");
    expect(code).toContain(".maneuver-dest-pulse");
  });
});

describe("Left Slide-Over Territory Command & Military Engineering Dossier", () => {
  it("verifies ReconInspector slides in from the left overlaying the top-left panel with structured wargame cards", () => {
    const reconPath = resolve(__dirname, "../components/ReconInspector.svelte");
    const code = readFileSync(reconPath, "utf-8");

    expect(code).toContain('class="recon-slide-drawer"');
    expect(code).toContain('data-testid="territory-command-panel"');
    expect(code).toContain("grid-row: 1 / span 3;");
    expect(code).toContain("reconSlideInLeft");
    expect(code).toContain('class="btn-recon-close"');
    expect(code).toContain('class="recon-treasury-bar"');
    expect(code).toContain('class="recon-empty-slot"');
  });

  it("verifies TopBar and WarJournal use structured wargame cards, icon-backed telemetry, and brass corner brackets", () => {
    const topBarPath = resolve(__dirname, "../components/TopBar.svelte");
    const topBarCode = readFileSync(topBarPath, "utf-8");

    // Top-left structured header, icon-backed commander stats, and brass brackets
    expect(topBarCode).toContain('class="brand-emblem-frame"');
    expect(topBarCode).toContain('class="generals-roster-box"');
    expect(topBarCode).toContain('class="stat-pill stat-terr"');
    expect(topBarCode).toContain('class="stat-pill stat-div"');
    expect(topBarCode).toContain('class="stat-pill stat-cards"');

    // Top-right structured HQ header, 2-row command deck, and 3-row map mode bar without dangling dividers
    expect(topBarCode).toContain('class="hq-header-bar"');
    expect(topBarCode).toContain('class="hq-command-grid"');
    expect(topBarCode).toContain('class="hq-primary-row"');
    expect(topBarCode).toContain('class="hq-secondary-row"');
    expect(topBarCode).toContain('class="econ-icon-box"');
    expect(topBarCode).toContain('class="mode-row camera-row"');
    expect(topBarCode).not.toContain('class="mode-divider"');

    // WarJournal structured dispatch entries and brass corner brackets
    const journalPath = resolve(__dirname, "../components/WarJournal.svelte");
    const journalCode = readFileSync(journalPath, "utf-8");
    expect(journalCode).toContain('class="card-corner tl"');
    expect(journalCode).toContain('class="j-tab-icon"');
    expect(journalCode).toContain("scrollerEl.scrollTop = scrollerEl.scrollHeight");

    // TopBar doctrine crest in generals table and TacticalAlerts action popups in top-center (HEGEM-130)
    expect(topBarCode).toContain("<DoctrineCrest");
    expect(topBarCode).toContain('class="top-center-banner"');
    expect(topBarCode).toContain("<TacticalAlerts");
    expect(topBarCode).not.toContain('class="btn-tc-mobilization"');
  });

  it("verifies ObjectiveSelectionModal renders as a floating, collapsible, non-blocking tactical HUD toast", () => {
    const objModalPath = resolve(__dirname, "../components/ObjectiveSelectionModal.svelte");
    const objCode = readFileSync(objModalPath, "utf-8");

    // Floating non-blocking toast architecture (no screen-dimming fixed backdrop)
    expect(objCode).toContain('class="objective-toast-wrapper"');
    expect(objCode).toContain('class="objective-toast-card"');
    expect(objCode).toContain('class="objective-toast-pill-bar"');
    expect(objCode).toContain("pointer-events: none;");
    expect(objCode).toContain("pointer-events: auto;");
    expect(objCode).not.toContain("objective-modal-backdrop");

    // Collapsible inspection and expansion controls
    expect(objCode).toContain('class="btn-minimize-toast"');
    expect(objCode).toContain('class="pill-expand-btn"');
    expect(objCode).toContain('class="confirm-objective-btn"');
    expect(objCode).toContain('class="card-corner tl"');
    expect(objCode).toContain("Compatibilidade Tática Aprovada");
  });
});
