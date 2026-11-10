import { t, i18n } from "./index.svelte";
import { ALL_OBJECTIVES } from "@hegemonia/maps";
import type { ObjectiveCard } from "@hegemonia/shared";

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

export function getObjectiveTitle(idOrObj: string | ObjectiveCard | undefined | null): string {
  if (!idOrObj) return t("objective");
  if (typeof idOrObj === "object") {
    const desc = i18n.locale === "en" ? (idOrObj.descriptionEn ?? idOrObj.descriptionPt) : idOrObj.descriptionPt;
    if (desc && desc.includes(":")) {
      return desc.split(":")[0].trim();
    }
    return getObjectiveTitle(idOrObj.id);
  }
  const id = idOrObj;
  const normalized = id.startsWith("obj_") ? id : `obj_${id}`;
  const bare = id.startsWith("obj_") ? id.slice(4) : id;

  const directTitle = t(`${normalized}_title`);
  if (directTitle !== `${normalized}_title`) return directTitle;

  const bareTitle = t(`${bare}_title`);
  if (bareTitle !== `${bare}_title`) return bareTitle;

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

export function getObjectiveDescription(idOrObj: string | ObjectiveCard | undefined | null): string {
  if (!idOrObj) return "";
  if (typeof idOrObj === "object") {
    if (i18n.locale === "en" && idOrObj.descriptionEn) return idOrObj.descriptionEn;
    if (idOrObj.descriptionPt) return idOrObj.descriptionPt;
    return getObjectiveDescription(idOrObj.id);
  }
  const id = idOrObj;
  // If the string itself is already a description (e.g. long sentence with spaces), return it
  if (id.includes(" ") && id.length > 30) return id;

  const normalized = id.startsWith("obj_") ? id : `obj_${id}`;
  const bare = id.startsWith("obj_") ? id.slice(4) : id;

  const directTranslated = t(normalized);
  if (directTranslated !== normalized) return directTranslated;

  const directBare = t(bare);
  if (directBare !== bare) return directBare;

  const key = `objective_${bare}_desc`;
  const translated = t(key);
  if (translated !== key) return translated;

  const keyNorm = `objective_${normalized}_desc`;
  const translatedNorm = t(keyNorm);
  if (translatedNorm !== keyNorm) return translatedNorm;

  const found = ALL_OBJECTIVES.find((o) => o.id === id || o.id === normalized || o.id === bare);
  if (found) {
    return i18n.locale === "en" ? (found.descriptionEn ?? found.descriptionPt) : found.descriptionPt;
  }
  return id;
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
