import type { Locale, LocaleCatalog, LocaleMeta } from "./types";
import { ptBR } from "./locales/pt-BR";
import { en } from "./locales/en";

export const DEFAULT_LOCALE: Locale = "pt-BR";

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  {
    code: "pt-BR",
    name: "Português (Brasil)",
    nativeName: "Português",
    flag: "BR",
  },
  {
    code: "en",
    name: "English (US)",
    nativeName: "English",
    flag: "US",
  },
];

export const catalogs: Record<Locale, LocaleCatalog> = {
  "pt-BR": ptBR,
  en,
};

export function isSupportedLocale(code: string): code is Locale {
  return code in catalogs;
}
