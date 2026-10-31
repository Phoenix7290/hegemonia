export type BaseMapMode = "cartographic" | "geopolitical";

export interface MapOverlays {
  regional: boolean;
  economic: boolean;
}

export interface MapPreferences {
  base: BaseMapMode;
  overlays: MapOverlays;
}

export const MAP_PREFERENCES_STORAGE_KEY = "hegemonia_map_preferences";
export const LEGACY_MAP_MODE_STORAGE_KEY = "hegemonia_map_mode";

export const DEFAULT_MAP_PREFERENCES: MapPreferences = {
  base: "cartographic",
  overlays: {
    regional: false,
    economic: false,
  },
};

export function parseMapPreferences(raw: string | null): MapPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const base: BaseMapMode =
      parsed.base === "geopolitical" ? "geopolitical" : "cartographic";

    const overlays: MapOverlays = {
      regional: Boolean(parsed.overlays?.regional),
      economic: Boolean(parsed.overlays?.economic),
    };

    return { base, overlays };
  } catch {
    return null;
  }
}

export function migrateLegacyMapMode(legacyValue: string | null): MapPreferences | null {
  if (!legacyValue) return null;
  switch (legacyValue) {
    case "geopolitical":
      return { base: "geopolitical", overlays: { regional: false, economic: false } };
    case "regional":
      return { base: "cartographic", overlays: { regional: true, economic: false } };
    case "economic":
      return { base: "cartographic", overlays: { regional: false, economic: true } };
    case "cartographic":
      return { base: "cartographic", overlays: { regional: false, economic: false } };
    default:
      return null;
  }
}

export function loadMapPreferences(): MapPreferences {
  if (typeof localStorage === "undefined") {
    return {
      base: DEFAULT_MAP_PREFERENCES.base,
      overlays: { ...DEFAULT_MAP_PREFERENCES.overlays },
    };
  }

  // 1. Tentar ler preferências modernas
  const modern = parseMapPreferences(localStorage.getItem(MAP_PREFERENCES_STORAGE_KEY));
  if (modern) return modern;

  // 2. Tentar migrar preferência legada
  const migrated = migrateLegacyMapMode(localStorage.getItem(LEGACY_MAP_MODE_STORAGE_KEY));
  if (migrated) {
    saveMapPreferences(migrated);
    return migrated;
  }

  return {
    base: DEFAULT_MAP_PREFERENCES.base,
    overlays: { ...DEFAULT_MAP_PREFERENCES.overlays },
  };
}

export function saveMapPreferences(preferences: MapPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MAP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Modo anônimo / quota excedida
  }
}
