import { t } from "./index.svelte";

const TERRITORY_ALIASES: Record<string, string> = {
  brazil: "brasil",
  vietnam: "vietna",
  japan: "japao",
  germany: "alemanha",
  france: "franca",
  poland: "polonia",
  balkans: "balcas",
  moscow: "moscou",
  egypt: "egito",
  sudan: "sudao",
  south_africa: "africa_do_sul",
  middle_east: "oriente_medio",
  alaska: "alasca",
  greenland: "groenlandia",
  hawaii: "havai",
  iceland: "islandia",
  great_britain: "inglaterra",
  england: "inglaterra",
  sweden: "suecia",
  new_york: "nova_york",
  borneo: "borneu",
  new_guinea: "nova_guine",
  siberia: "siberia",
  kazakhstan: "aral",
};

const SUBREGION_ALIASES: Record<string, string> = {
  east_asia: "subregion_asia_leste",
  asia_east: "subregion_asia_leste",
  steppes: "subregion_asia_estepes",
  asia_steppes: "subregion_asia_estepes",
  indo_arabia: "subregion_asia_indo_arabia",
  asia_indo_arabia: "subregion_asia_indo_arabia",
};

export function getTerritoryName(id: string): string {
  // Check exact terr_${id}
  const directKey = id.startsWith("terr_") ? id : `terr_${id}`;
  const translatedDirect = t(directKey);
  if (translatedDirect !== directKey) return translatedDirect;

  // Check alias
  const aliasTarget = TERRITORY_ALIASES[id.toLowerCase()];
  if (aliasTarget) {
    const aliasKey = `terr_${aliasTarget}`;
    const translatedAlias = t(aliasKey);
    if (translatedAlias !== aliasKey) return translatedAlias;
  }

  // Check territory_${id} legacy format
  const legacyKey = `territory_${id}`;
  const legacyTranslated = t(legacyKey);
  if (legacyTranslated !== legacyKey) return legacyTranslated;

  return id;
}

export function getContinentName(id: string): string {
  const directKey = id.startsWith("continent_") ? id : `continent_${id}`;
  const translated = t(directKey);
  return translated !== directKey ? translated : id;
}

export function getSubregionName(id: string): string {
  const directKey = id.startsWith("subregion_") ? id : `subregion_${id}`;
  const translated = t(directKey);
  if (translated !== directKey) return translated;

  const aliasKey = SUBREGION_ALIASES[id.toLowerCase()];
  if (aliasKey) {
    const aliasTranslated = t(aliasKey);
    if (aliasTranslated !== aliasKey) return aliasTranslated;
  }

  return id;
}

export function getObjectiveTitle(id: string): string {
  const key = `objective_${id}_title`;
  const translated = t(key);
  if (translated !== key) return translated;

  // Extract from description if it contains a title prefix (e.g. "Japão Imperial (Sol Nascente): ...")
  const desc = getObjectiveDescription(id);
  if (desc && desc.includes(":")) {
    return desc.split(":")[0].trim();
  }

  return t("objective");
}

export function getObjectiveDescription(id: string): string {
  const normalized = id.startsWith("obj_") ? id : `obj_${id}`;
  const directTranslated = t(normalized);
  if (directTranslated !== normalized) return directTranslated;

  const key = `objective_${id}_desc`;
  const translated = t(key);
  return translated !== key ? translated : id;
}

export function getFactionName(color: string): string {
  const key = `faction_${color}_name`;
  const translated = t(key);
  return translated !== key ? translated : color;
}

export function getFactionDoctrine(color: string): string {
  const key = `faction_${color}_doctrine`;
  const translated = t(key);
  return translated !== key ? translated : "";
}

export function getBadgeName(slug: string, fallback?: string): string {
  const normalized = slug.replace(/-/g, "_");
  const key = `badge_${normalized}_name`;
  const translated = t(key);
  return translated !== key ? translated : (fallback ?? slug);
}

export function getBadgeDescription(slug: string, fallback?: string): string {
  const normalized = slug.replace(/-/g, "_");
  const key = `badge_${normalized}_desc`;
  const translated = t(key);
  return translated !== key ? translated : (fallback ?? "");
}
