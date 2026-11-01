import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  DEFAULT_MAP_PREFERENCES,
  LEGACY_MAP_MODE_STORAGE_KEY,
  MAP_PREFERENCES_STORAGE_KEY,
  loadMapPreferences,
  migrateLegacyMapMode,
  parseMapPreferences,
  saveMapPreferences,
} from "./map-preferences.js";

describe("Map Preferences & Overlays (HEGEM-62)", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    // Mock standard localStorage
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  });

  it("returns default preferences when storage is empty", () => {
    const prefs = loadMapPreferences();
    expect(prefs).toEqual(DEFAULT_MAP_PREFERENCES);
    expect(prefs.base).toBe("cartographic");
    expect(prefs.overlays.regional).toBe(false);
    expect(prefs.overlays.economic).toBe(false);
  });

  it("parses modern map preferences correctly", () => {
    const json = JSON.stringify({
      base: "geopolitical",
      overlays: { regional: true, economic: false },
    });
    const parsed = parseMapPreferences(json);
    expect(parsed).toEqual({
      base: "geopolitical",
      overlays: { regional: true, economic: false },
    });
  });

  it("handles corrupted or invalid JSON by returning null", () => {
    expect(parseMapPreferences("not-json")).toBeNull();
    expect(parseMapPreferences("")).toBeNull();
    expect(parseMapPreferences("null")).toBeNull();
    expect(parseMapPreferences("123")).toBeNull();
  });

  it("migrates legacy map modes to base mode + overlays without losing user intent", () => {
    expect(migrateLegacyMapMode("geopolitical")).toEqual({
      base: "geopolitical",
      overlays: { regional: false, economic: false },
    });

    expect(migrateLegacyMapMode("regional")).toEqual({
      base: "cartographic",
      overlays: { regional: true, economic: false },
    });

    expect(migrateLegacyMapMode("economic")).toEqual({
      base: "cartographic",
      overlays: { regional: false, economic: true },
    });

    expect(migrateLegacyMapMode("cartographic")).toEqual({
      base: "cartographic",
      overlays: { regional: false, economic: false },
    });

    expect(migrateLegacyMapMode("unknown_mode")).toBeNull();
  });

  it("transparently loads and upgrades legacy localStorage value", () => {
    localStorage.setItem(LEGACY_MAP_MODE_STORAGE_KEY, "economic");
    const prefs = loadMapPreferences();

    expect(prefs).toEqual({
      base: "cartographic",
      overlays: { regional: false, economic: true },
    });

    // Verify it saved modern preferences to storage
    const modernRaw = localStorage.getItem(MAP_PREFERENCES_STORAGE_KEY);
    expect(modernRaw).not.toBeNull();
    expect(JSON.parse(modernRaw!)).toEqual({
      base: "cartographic",
      overlays: { regional: false, economic: true },
    });
  });

  it("persists combined overlays (both regional and economic active simultaneously)", () => {
    saveMapPreferences({
      base: "geopolitical",
      overlays: { regional: true, economic: true },
    });

    const loaded = loadMapPreferences();
    expect(loaded.base).toBe("geopolitical");
    expect(loaded.overlays.regional).toBe(true);
    expect(loaded.overlays.economic).toBe(true);
  });

  it("enforces strict SVG z-index layer hierarchy and non-colliding theater insignias (HEGEM-77 & HEGEM-81)", () => {
    const tacticalMapPath = path.resolve(
      import.meta.dirname,
      "../components/TacticalMap.svelte"
    );
    const source = fs.readFileSync(tacticalMapPath, "utf8");

    const polygonsIdx = source.indexOf('class="layer-territory-polygons"');
    const theatersIdx = source.indexOf('class="layer-theater-insignias"');
    const badgesIdx = source.indexOf('class="layer-territory-badges"');

    expect(polygonsIdx).toBeGreaterThan(-1);
    expect(theatersIdx).toBeGreaterThan(polygonsIdx);
    expect(badgesIdx).toBeGreaterThan(theatersIdx);

    // Rich Tactical Theater Tooltip (HEGEM-81) must be present
    expect(source).toContain('data-testid="theater-tactical-tooltip"');
    expect(source).toContain("theater_progress_summary");

    // Verify theater banner coordinates do not collide with any of the 53 territory centers
    const bannerCoords = [
      [145, 222],
      [292, 405],
      [500, 152],
      [534, 350],
      [808, 312],
      [880, 42],
      [1134, 222],
      [936, 416],
    ];
    for (const [bx, by] of bannerCoords) {
      for (const terr of CLASSIC_MAP.territories) {
        const dist = Math.hypot(bx - terr.center[0], by - terr.center[1]);
        expect(dist, `Theater banner (${bx},${by}) too close to ${terr.id}`).toBeGreaterThan(40);
      }
    }
  });

  it("removes Global Theater Directives card and harmonizes CommandCenter layout (HEGEM-78)", () => {
    const cmdCenterPath = path.resolve(
      import.meta.dirname,
      "../components/CommandCenter.svelte"
    );
    const source = fs.readFileSync(cmdCenterPath, "utf8");

    expect(source).not.toContain("intel-card");
    expect(source).not.toContain("deck_params_title");
    expect(source).not.toContain("deck_spec_");
    expect(source).toContain("rank-card-footer");
    expect(source).toContain("/api/leaderboard?limit=6");
  });
});
