import { describe, it, expect, beforeEach } from "vitest";
import { catalogs, SUPPORTED_LOCALES } from "./registry";
import { i18n, t } from "./index.svelte";
import {
  getTerritoryName,
  getContinentName,
  getSubregionName,
  getObjectiveTitle,
  getObjectiveDescription,
  getFactionName,
  getFactionDoctrine,
  getBadgeName,
  getBadgeDescription,
} from "./content.svelte";
import type { Namespace } from "./types";

describe("i18n Catalog Parity", () => {
  const ptBR = catalogs["pt-BR"];
  const en = catalogs["en"];
  const namespaces: Namespace[] = ["common", "game", "map", "social", "comms", "errors"];

  it("should have all namespaces in both pt-BR and en", () => {
    for (const ns of namespaces) {
      expect(ptBR[ns]).toBeDefined();
      expect(en[ns]).toBeDefined();
    }
  });

  for (const ns of namespaces) {
    it(`should have 100% key parity for namespace '${ns}'`, () => {
      const ptKeys = Object.keys(ptBR[ns]).sort();
      const enKeys = Object.keys(en[ns]).sort();

      const missingInEn = ptKeys.filter((k) => !(k in en[ns]));
      const missingInPt = enKeys.filter((k) => !(k in ptBR[ns]));

      expect(missingInEn).toEqual([]);
      expect(missingInPt).toEqual([]);
    });
  }
});

describe("i18n Translation & Interpolation", () => {
  beforeEach(() => {
    i18n.setLocale("pt-BR");
  });

  it("should translate simple keys in default locale (pt-BR)", () => {
    expect(t("app_name")).toBe("Hegemonia");
    expect(t("save")).toBe("Salvar");
    expect(t("cancel")).toBe("Cancelar");
  });

  it("should interpolate parameters correctly", () => {
    expect(t("round", { round: 5 })).toBe("Rodada 5");
    expect(t("divisions", { count: 12 })).toBe("12 Divisões");
    expect(t("colonel_bot", { index: 2 })).toBe("General IA #2");
  });

  it("should switch locale reactively", () => {
    i18n.setLocale("en");
    expect(i18n.locale).toBe("en");
    expect(t("save")).toBe("Save");
    expect(t("cancel")).toBe("Cancel");
    expect(t("round", { round: 5 })).toBe("Round 5");
    expect(t("divisions", { count: 12 })).toBe("12 Divisions");

    i18n.setLocale("pt-BR");
    expect(i18n.locale).toBe("pt-BR");
    expect(t("save")).toBe("Salvar");
  });

  it("should fallback gracefully on unknown keys", () => {
    expect(t("unknown_key_xyz")).toBe("unknown_key_xyz");
  });
});

describe("i18n Content Resolvers", () => {
  it("should resolve territory names in pt-BR and en", () => {
    i18n.setLocale("pt-BR");
    expect(getTerritoryName("brasil")).toBe("Brasil");
    expect(getTerritoryName("brazil")).toBe("Brasil");
    expect(getTerritoryName("vietnam")).toBe("Vietnã");
    expect(getTerritoryName("japao")).toBe("Japão");
    expect(getTerritoryName("japan")).toBe("Japão");

    i18n.setLocale("en");
    expect(getTerritoryName("brasil")).toBe("Brazil");
    expect(getTerritoryName("brazil")).toBe("Brazil");
    expect(getTerritoryName("vietnam")).toBe("Vietnam");
    expect(getTerritoryName("japao")).toBe("Japan");
    expect(getTerritoryName("japan")).toBe("Japan");
  });

  it("should resolve continent and subregion names", () => {
    i18n.setLocale("pt-BR");
    expect(getContinentName("south_america")).toBe("América do Sul");
    expect(getSubregionName("east_asia")).toBe("Leste Asiático");
    expect(getSubregionName("asia_east")).toBe("Leste Asiático");

    i18n.setLocale("en");
    expect(getContinentName("south_america")).toBe("South America");
    expect(getSubregionName("east_asia")).toBe("East Asia");
    expect(getSubregionName("asia_east")).toBe("East Asia");
  });

  it("should resolve faction names and doctrines", () => {
    i18n.setLocale("pt-BR");
    expect(getFactionName("blue")).toBe("União Atlântica");
    expect(getFactionDoctrine("blue")).toBe("Supremacia Naval & OTAN");

    i18n.setLocale("en");
    expect(getFactionName("blue")).toBe("Atlantic Union");
    expect(getFactionDoctrine("blue")).toBe("Naval Supremacy & NATO");
  });

  it("should resolve badge names and descriptions", () => {
    i18n.setLocale("pt-BR");
    expect(getBadgeName("first_victory")).toBe("Primeira Conquista");
    expect(getBadgeDescription("first_victory")).toBe("Vença sua primeira partida.");

    i18n.setLocale("en");
    expect(getBadgeName("first_victory")).toBe("First Conquest");
    expect(getBadgeDescription("first_victory")).toBe("Win your first match.");
  });

  it("should resolve objectives in pt-BR and en", () => {
    i18n.setLocale("pt-BR");
    expect(getObjectiveDescription("obj_24_any")).toBe("Conquistar 24 TERRITÓRIOS à sua escolha.");
    expect(getObjectiveDescription("24_any")).toBe("Conquistar 24 TERRITÓRIOS à sua escolha.");
    expect(getObjectiveTitle("obj_rp_mongol_empire")).toBe("Império Mongol");

    i18n.setLocale("en");
    expect(getObjectiveDescription("obj_24_any")).toBe("Conquer 24 TERRITORIES of your choice.");
    expect(getObjectiveDescription("24_any")).toBe("Conquer 24 TERRITORIES of your choice.");
    expect(getObjectiveTitle("obj_rp_mongol_empire")).toBe("Mongol Empire");
  });
});

describe("i18n Formatting Helpers", () => {
  it("should format numbers according to active locale", () => {
    i18n.setLocale("pt-BR");
    const ptNum = i18n.formatNumber(1250000);
    // In pt-BR: 1.250.000
    expect(ptNum.replace(/\s/g, "")).toContain("1.250.000");

    i18n.setLocale("en");
    const enNum = i18n.formatNumber(1250000);
    // In en: 1,250,000
    expect(enNum).toBe("1,250,000");
  });

  it("should have correct supported locales list", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(2);
    expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual(["pt-BR", "en"]);
  });
});
