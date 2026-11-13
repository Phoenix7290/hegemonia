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

  const id = typeof idOrObj === "object" ? idOrObj.id : idOrObj;
  const normalized = id ? (id.startsWith("obj_") ? id : `obj_${id}`) : "";
  const bare = id ? (id.startsWith("obj_") ? id.slice(4) : id) : "";

  // 1. Direct title in active locale catalog
  if (normalized) {
    const directTitle = t(`${normalized}_title`);
    if (directTitle !== `${normalized}_title`) return directTitle;
  }
  if (bare) {
    const bareTitle = t(`${bare}_title`);
    if (bareTitle !== `${bare}_title`) return bareTitle;

    const legacyKey = `objective_${bare}_title`;
    const translatedLegacy = t(legacyKey);
    if (translatedLegacy !== legacyKey) return translatedLegacy;
  }
  if (id) {
    const idKey = `objective_${id}_title`;
    const translatedId = t(idKey);
    if (translatedId !== idKey) return translatedId;
  }

  // 2. If an object is provided, check if its own localized description has a colon prefix (e.g. "Title: Description")
  if (typeof idOrObj === "object") {
    const rawDesc = i18n.locale === "en" ? (idOrObj.descriptionEn ?? idOrObj.descriptionPt) : idOrObj.descriptionPt;
    if (rawDesc && rawDesc.includes(":") && !rawDesc.startsWith("obj_")) {
      const candidate = rawDesc.split(":")[0].trim();
      if (candidate && !candidate.startsWith("obj_") && candidate.length < 80) {
        return candidate;
      }
    }
  }

  // 3. Fallback to extracting title from resolved objective description
  const desc = getObjectiveDescription(idOrObj);
  if (desc && desc.includes(":") && !desc.startsWith("obj_")) {
    const candidate = desc.split(":")[0].trim();
    if (candidate && !candidate.startsWith("obj_") && candidate.length < 80) {
      return candidate;
    }
  }

  // 4. Fallback: check ALL_OBJECTIVES static registry
  if (id) {
    const found = ALL_OBJECTIVES.find((o) => o.id === id || o.id === normalized || o.id === bare);
    if (found) {
      const foundDesc = i18n.locale === "en" ? (found.descriptionEn ?? found.descriptionPt) : found.descriptionPt;
      if (foundDesc && foundDesc.includes(":") && !foundDesc.startsWith("obj_")) {
        const candidate = foundDesc.split(":")[0].trim();
        if (candidate && !candidate.startsWith("obj_") && candidate.length < 80) {
          return candidate;
        }
      }
    }
  }

  return t("objective");
}

export function getObjectiveDescription(idOrObj: string | ObjectiveCard | undefined | null): string {
  if (!idOrObj) return "";

  // If a raw string is passed that is already an actual sentence (not a key like obj_...)
  if (typeof idOrObj === "string") {
    if (idOrObj.includes(" ") && idOrObj.length > 25 && !idOrObj.startsWith("obj_")) {
      return idOrObj;
    }
  }

  const id = typeof idOrObj === "object" ? idOrObj.id : idOrObj;
  const normalized = id ? (id.startsWith("obj_") ? id : `obj_${id}`) : "";
  const bare = id ? (id.startsWith("obj_") ? id.slice(4) : id) : "";

  // 1. Direct translation from active locale catalog (ensures locale switching works reactively!)
  if (normalized) {
    const directTranslated = t(normalized);
    if (directTranslated !== normalized) return directTranslated;
  }
  if (bare) {
    const directBare = t(bare);
    if (directBare !== bare) return directBare;

    const legacyKey = `objective_${bare}_desc`;
    const translated = t(legacyKey);
    if (translated !== legacyKey) return translated;
  }
  if (id) {
    const keyNorm = `objective_${normalized}_desc`;
    const translatedNorm = t(keyNorm);
    if (translatedNorm !== keyNorm) return translatedNorm;
  }

  // 2. If an object is passed and has non-raw localized text
  if (typeof idOrObj === "object") {
    if (i18n.locale === "en") {
      if (idOrObj.descriptionEn && idOrObj.descriptionEn.includes(" ") && !idOrObj.descriptionEn.startsWith("obj_")) {
        return idOrObj.descriptionEn;
      }
    } else {
      if (idOrObj.descriptionPt && idOrObj.descriptionPt.includes(" ") && !idOrObj.descriptionPt.startsWith("obj_")) {
        return idOrObj.descriptionPt;
      }
    }
  }

  // 3. Fallback to static registry ALL_OBJECTIVES
  if (id) {
    const found = ALL_OBJECTIVES.find((o) => o.id === id || o.id === normalized || o.id === bare);
    if (found) {
      return i18n.locale === "en" ? (found.descriptionEn ?? found.descriptionPt) : found.descriptionPt;
    }
  }

  // 4. Object fallback (even if missing spaces or other locale)
  if (typeof idOrObj === "object") {
    if (i18n.locale === "en" && idOrObj.descriptionEn && !idOrObj.descriptionEn.startsWith("obj_")) {
      return idOrObj.descriptionEn;
    }
    if (idOrObj.descriptionPt && !idOrObj.descriptionPt.startsWith("obj_")) {
      return idOrObj.descriptionPt;
    }
  }

  return id || "";
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
