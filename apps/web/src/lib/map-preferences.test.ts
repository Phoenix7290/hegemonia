import { beforeEach, describe, expect, it } from "vitest";
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
});
