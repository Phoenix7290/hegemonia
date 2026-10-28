import type { Locale, Namespace, TranslationParams } from "./types";
import { DEFAULT_LOCALE, catalogs, isSupportedLocale, SUPPORTED_LOCALES } from "./registry";
import {
  formatDateShort,
  formatTimeShort,
  getNumberFormat,
  getDateTimeFormat,
  getRelativeTimeFormat,
} from "./format";

const STORAGE_KEY = "hegemonia_locale";

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isSupportedLocale(saved)) return saved;
  } catch {
    // Ignore localStorage access failures
  }

  if (typeof navigator !== "undefined" && navigator.languages) {
    for (const lang of navigator.languages) {
      if (lang.toLowerCase().startsWith("pt")) return "pt-BR";
      if (lang.toLowerCase().startsWith("en")) return "en";
    }
  }

  return DEFAULT_LOCALE;
}

export class I18nManager {
  locale = $state<Locale>(detectInitialLocale());

  constructor() {
    if (typeof document !== "undefined") {
      document.documentElement.lang = this.locale;
    }
  }

  setLocale(newLocale: Locale): void {
    if (!isSupportedLocale(newLocale)) return;
    this.locale = newLocale;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, newLocale);
      } catch {
        // Ignore storage errors
      }
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = newLocale;
    }
  }

  t(key: string, params?: TranslationParams): string {
    const currentCatalog = catalogs[this.locale] ?? catalogs[DEFAULT_LOCALE];
    const fallbackCatalog = catalogs[DEFAULT_LOCALE];

    let template: string | undefined;

    // Check for dot-separated keys, e.g. "game.phase_reinforce"
    if (key.includes(".")) {
      const dotIndex = key.indexOf(".");
      const ns = key.slice(0, dotIndex) as Namespace;
      const subKey = key.slice(dotIndex + 1);

      if (currentCatalog[ns] && subKey in currentCatalog[ns]) {
        template = currentCatalog[ns][subKey];
      } else if (fallbackCatalog[ns] && subKey in fallbackCatalog[ns]) {
        template = fallbackCatalog[ns][subKey];
      }
    }

    // If not found or not dot-separated, search all namespaces
    if (template === undefined) {
      const namespaces: Namespace[] = ["common", "game", "map", "social", "comms", "errors"];
      for (const ns of namespaces) {
        if (currentCatalog[ns] && key in currentCatalog[ns]) {
          template = currentCatalog[ns][key];
          break;
        }
      }
      if (template === undefined) {
        for (const ns of namespaces) {
          if (fallbackCatalog[ns] && key in fallbackCatalog[ns]) {
            template = fallbackCatalog[ns][key];
            break;
          }
        }
      }
    }

    if (template === undefined) {
      return key;
    }

    if (!params) {
      return template;
    }

    return template.replace(/\{(\w+)\}/g, (match, paramKey) => {
      if (paramKey in params) {
        return String(params[paramKey]);
      }
      return match;
    });
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return getNumberFormat(this.locale, options).format(value);
  }

  formatDate(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    return getDateTimeFormat(this.locale, options).format(d);
  }

  formatTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
    const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    return getDateTimeFormat(this.locale, options ?? { hour: "2-digit", minute: "2-digit" }).format(d);
  }

  formatDateShort(date: Date | string | number): string {
    return formatDateShort(date, this.locale);
  }

  formatTimeShort(date: Date | string | number): string {
    return formatTimeShort(date, this.locale);
  }

  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return getRelativeTimeFormat(this.locale).format(value, unit);
  }

  get supportedLocales() {
    return SUPPORTED_LOCALES;
  }
}

export const i18n = new I18nManager();

export function t(key: string, params?: TranslationParams): string {
  return i18n.t(key, params);
}
