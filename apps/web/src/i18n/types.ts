export type Locale = "pt-BR" | "en";

export interface LocaleMeta {
  code: Locale;
  name: string;
  nativeName: string;
  flag: string; // ISO country code or short tactical prefix
}

export type Namespace =
  | "common"
  | "game"
  | "map"
  | "social"
  | "comms"
  | "errors";

export type TranslationCatalog = Record<string, string>;

export type LocaleCatalog = {
  common: TranslationCatalog;
  game: TranslationCatalog;
  map: TranslationCatalog;
  social: TranslationCatalog;
  comms: TranslationCatalog;
  errors: TranslationCatalog;
};

export type TranslationParams = Record<string, string | number>;
