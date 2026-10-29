import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_OBJECTIVES,
  ASIA_SUBREGIONS,
  CLASSIC_MAP,
  CLASSIC_OBJECTIVES,
  COUNTRY_SOVEREIGNTIES,
  GLOBAL_LAND_SVG_PATH,
  GRATICULE_SVG_PATH,
  MAP_HEIGHT,
  MAP_WIDTH,
  ROLEPLAY_OBJECTIVES,
  TERRITORY_GEO_ECONOMY,
  ownsFullCountry,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@hegemonia/maps — Validação Cartográfica, Soberania Admin-1, Grafo e Economia", () => {
  const territories = CLASSIC_MAP.territories;
  const byId = new Map(territories.map((t) => [t.id, t]));
  const continentIds = new Set(CLASSIC_MAP.continents.map((c) => c.id));

  it("possui exatamente 53 territórios com IDs únicos e nomes iniciados por letra maiúscula", () => {
    expect(territories.length).toBe(53);

    const seenIds = new Set<string>();
    for (const t of territories) {
      expect(seenIds.has(t.id), `ID duplicado encontrado: ${t.id}`).toBe(false);
      seenIds.add(t.id);

      expect(t.name.trim().length, `name vazio em ${t.id}`).toBeGreaterThan(0);
      expect(t.namePt.trim().length, `namePt vazio em ${t.id}`).toBeGreaterThan(0);

      expect(
        /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(t.namePt),
        `namePt "${t.namePt}" no território "${t.id}" deve começar com letra maiúscula`
      ).toBe(true);
      expect(
        /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(t.name),
        `name "${t.name}" no território "${t.id}" deve começar com letra maiúscula`
      ).toBe(true);

      expect(
        continentIds.has(t.continent),
        `Continente inválido (${t.continent}) no território ${t.id}`
      ).toBe(true);
      expect(["circle", "square", "triangle"]).toContain(t.symbol);
    }
  });

  it("garante que os catálogos i18n (pt-BR e en) possuem todos os territórios com inicial maiúscula", () => {
    const ptMapPath = path.join(__dirname, "../../../apps/web/src/i18n/locales/pt-BR/map.ts");
    const enMapPath = path.join(__dirname, "../../../apps/web/src/i18n/locales/en/map.ts");

    for (const localePath of [ptMapPath, enMapPath]) {
      if (!fs.existsSync(localePath)) continue;
      const content = fs.readFileSync(localePath, "utf-8");

      for (const t of territories) {
        const match = content.match(
          new RegExp(`(?:^|[\\s,{])(?:territory_)?${t.id}\\s*:\\s*["']([^"']+)["']`, "m")
        );
        expect(
          match,
          `Tradução para "${t.id}" ausente no ficheiro ${path.basename(localePath)}`
        ).not.toBeNull();

        if (match) {
          const translatedLabel = match[1];
          expect(
            /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(translatedLabel),
            `Tradução "${translatedLabel}" para "${t.id}" em ${localePath} deve começar com maiúscula`
          ).toBe(true);
        }
      }
    }
  });

  it("contém todas as subdivisões Admin-1 (São Paulo, Patagônia, Texas, Espanha, Itália, Nigéria, Moçambique, Pequim e Xinjiang)", () => {
    const requiredSubdivisions = [
      // América do Sul
      "brasil",
      "sao_paulo",
      "argentina",
      "patagonia",
      "peru",
      "venezuela",
      // América do Norte (EUA subdividido)
      "california",
      "texas",
      "nova_york",
      "alasca",
      "havai",
      // Europa Ocidental e Mediterrâneo
      "franca",
      "espanha",
      "italia",
      // África subdividida
      "argelia",
      "nigeria",
      "egito",
      "sudao",
      "congo",
      "mocambique",
      "africa_do_sul",
      "madagascar",
      // Ásia / China subdividida
      "pequim",
      "china",
      "xinjiang",
      "india",
    ];

    for (const id of requiredSubdivisions) {
      expect(byId.has(id), `Subdivisão obrigatória ausente no mapa: ${id}`).toBe(true);
      expect(
        TERRITORY_GEO_ECONOMY[id],
        `Definição geoeconómica ausente para o território: ${id}`
      ).toBeDefined();
    }

    expect(byId.has("amazonia")).toBe(false);
  });

  it("valida as rotas marítimas e terrestres exigidas (Madagascar ↔ Índia, Argélia ↔ Espanha, Egito ↔ Itália, Brasil ↔ Nigéria)", () => {
    const requiredConnections: [string, string][] = [
      // 1. Oceano Índico: Madagascar ↔ Índia e costas africanas
      ["madagascar", "india"],
      ["madagascar", "mocambique"],
      ["madagascar", "africa_do_sul"],
      ["madagascar", "sudao"],

      // 2. Atlântico Sul e América do Sul: Brasil ↔ Nigéria e São Paulo
      ["brasil", "nigeria"],
      ["brasil", "sao_paulo"],
      ["brasil", "peru"],
      ["brasil", "venezuela"],
      ["sao_paulo", "argentina"],
      ["sao_paulo", "peru"],
      ["argentina", "patagonia"],
      ["argentina", "peru"],
      ["patagonia", "peru"],
      ["patagonia", "africa_do_sul"],
      ["patagonia", "australia"],

      // 3. Mediterrâneo e Europa Ocidental: Argélia ↔ Espanha e Egito ↔ Itália
      ["argelia", "espanha"],
      ["argelia", "egito"],
      ["argelia", "nigeria"],
      ["espanha", "franca"],
      ["espanha", "inglaterra"],
      ["espanha", "italia"],
      ["italia", "egito"],
      ["italia", "franca"],
      ["italia", "alemanha"],
      ["italia", "balcas"],

      // 4. Interior e Costa da África
      ["nigeria", "egito"],
      ["nigeria", "sudao"],
      ["nigeria", "congo"],
      ["congo", "sudao"],
      ["congo", "mocambique"],
      ["congo", "africa_do_sul"],
      ["mocambique", "sudao"],
      ["mocambique", "africa_do_sul"],

      // 5. América do Norte (Califórnia a oeste da linha verde, Texas no centro, Nova York a leste)
      ["california", "vancouver"],
      ["california", "texas"],
      ["california", "mexico"],
      ["california", "havai"],
      ["texas", "vancouver"],
      ["texas", "ottawa"],
      ["texas", "nova_york"],
      ["texas", "mexico"],

      // 6. China subdividida (Xinjiang, Pequim e China Sul/Leste)
      ["xinjiang", "aral"],
      ["xinjiang", "omsk"],
      ["xinjiang", "mongolia"],
      ["xinjiang", "pequim"],
      ["xinjiang", "china"],
      ["xinjiang", "india"],
      ["pequim", "mongolia"],
      ["pequim", "tchita"],
      ["pequim", "vladivostok"],
      ["pequim", "japao"],
      ["pequim", "china"],
    ];

    for (const [fromId, toId] of requiredConnections) {
      const fromTerr = byId.get(fromId);
      const toTerr = byId.get(toId);
      expect(fromTerr, `Território ${fromId} não encontrado`).toBeDefined();
      expect(toTerr, `Território ${toId} não encontrado`).toBeDefined();
      expect(
        fromTerr!.neighbors.includes(toId),
        `Conexão obrigatória ausente: ${fromId} -> ${toId}`
      ).toBe(true);
      expect(
        toTerr!.neighbors.includes(fromId),
        `Conexão recíproca obrigatória ausente: ${toId} -> ${fromId}`
      ).toBe(true);
    }

    // Conexões antigas que foram substituídas e NÃO devem existir:
    const forbiddenConnections: [string, string][] = [
        ["ottawa", "groenlandia"],
        ["brasil", "argelia"],
        ["brasil", "argentina"],
        ["franca", "argelia"],
        ["franca", "egito"],
        ["italia", "argelia"],
        ["argentina", "africa_do_sul"],
        ["argentina", "australia"],
        ["california", "nova_york"],
        ["california", "ottawa"],
        ];

    for (const [a, b] of forbiddenConnections) {
      expect(
        byId.get(a)!.neighbors.includes(b),
        `Conexão antiga indevida ainda presente: ${a} -> ${b}`
      ).toBe(false);
      expect(
        byId.get(b)!.neighbors.includes(a),
        `Conexão antiga indevida ainda presente: ${b} -> ${a}`
      ).toBe(false);
    }
  });

  it("exige todos os estados de uma potência para conquistar a sua soberania nacional (ownsFullCountry)", () => {
    const mockState: Record<string, { ownerId: string | null }> = {};
    for (const t of territories) {
      mockState[t.id] = { ownerId: null };
    }

    // 1. Brasil: exige "brasil" + "sao_paulo"
    mockState["brasil"].ownerId = "p1";
    expect(ownsFullCountry(mockState, "p1", "brazil")).toBe(false);
    mockState["sao_paulo"].ownerId = "p1";
    expect(ownsFullCountry(mockState, "p1", "brazil")).toBe(true);

    // 2. Argentina: exige "argentina" + "patagonia"
    mockState["argentina"].ownerId = "p1";
    expect(ownsFullCountry(mockState, "p1", "argentina")).toBe(false);
    mockState["patagonia"].ownerId = "p1";
    expect(ownsFullCountry(mockState, "p1", "argentina")).toBe(true);

    // 3. Estados Unidos: exige "california", "texas", "nova_york", "alasca" e "havai"
    for (const stateId of ["california", "texas", "nova_york", "alasca"]) {
      mockState[stateId].ownerId = "p2";
    }
    expect(ownsFullCountry(mockState, "p2", "usa")).toBe(false);
    mockState["havai"].ownerId = "p2";
    expect(ownsFullCountry(mockState, "p2", "usa")).toBe(true);

    // 4. China: exige "pequim", "china" e "xinjiang"
    mockState["pequim"].ownerId = "p3";
    mockState["china"].ownerId = "p3";
    expect(ownsFullCountry(mockState, "p3", "china")).toBe(false);
    mockState["xinjiang"].ownerId = "p3";
    expect(ownsFullCountry(mockState, "p3", "china")).toBe(true);

    // 5. Rússia: exige as 6 regiões ("moscou", "omsk", "dudinka", "siberia", "tchita", "vladivostok")
    for (const rusId of ["moscou", "omsk", "dudinka", "siberia", "tchita"]) {
      mockState[rusId].ownerId = "p4";
    }
    expect(ownsFullCountry(mockState, "p4", "russia")).toBe(false);
    mockState["vladivostok"].ownerId = "p4";
    expect(ownsFullCountry(mockState, "p4", "russia")).toBe(true);

    // 6. País inexistente devolve false
    expect(ownsFullCountry(mockState, "p1", "unknown_country")).toBe(false);

    for (const country of COUNTRY_SOVEREIGNTIES) {
      expect(country.territoryIds.length).toBeGreaterThanOrEqual(2);
      for (const tid of country.territoryIds) {
        expect(
          byId.has(tid),
          `Soberania ${country.id} referencia território inexistente: ${tid}`
        ).toBe(true);
      }
    }
  });

  it("garante simetria estrita no grafo de adjacências e grau mínimo >= 2 (sem gargalos isolados)", () => {
    for (const t of territories) {
      expect(
        t.neighbors.length,
        `Território ${t.id} possui menos de 2 conexões (gargalo intransponível)`
      ).toBeGreaterThanOrEqual(2);

      expect(t.neighbors.includes(t.id), `Auto-adjacência inválida em ${t.id}`).toBe(false);

      const uniqueNeighbors = new Set(t.neighbors);
      expect(uniqueNeighbors.size, `Vizinhos duplicados em ${t.id}`).toBe(t.neighbors.length);

      for (const neighborId of t.neighbors) {
        const neighbor = byId.get(neighborId);
        expect(
          neighbor,
          `Território ${t.id} aponta para vizinho inexistente: ${neighborId}`
        ).toBeDefined();
        expect(
          neighbor!.neighbors.includes(t.id),
          `Assimetria detectada: ${t.id} -> ${neighborId}, mas ${neighborId} não conecta de volta a ${t.id}`
        ).toBe(true);
      }
    }
  });

  it("garante que o grafo global e cada continente internamente são 100% conexos", () => {
    // 1. Conectividade do Grafo Global (BFS)
    const visitedGlobal = new Set<string>([territories[0].id]);
    const queueGlobal: string[] = [territories[0].id];

    while (queueGlobal.length > 0) {
      const currentId = queueGlobal.shift()!;
      const current = byId.get(currentId)!;
      for (const nId of current.neighbors) {
        if (!visitedGlobal.has(nId)) {
          visitedGlobal.add(nId);
          queueGlobal.push(nId);
        }
      }
    }

    const unreachableGlobal = territories
      .filter((t) => !visitedGlobal.has(t.id))
      .map((t) => t.id);
    expect(
      unreachableGlobal,
      `Territórios isolados do grafo global: ${unreachableGlobal.join(", ")}`
    ).toEqual([]);

    // 2. Conectividade Interna de cada Continente
    for (const cont of CLASSIC_MAP.continents) {
      const contTerritories = territories.filter((t) => t.continent === cont.id);
      expect(contTerritories.length, `Continente ${cont.id} está vazio`).toBeGreaterThan(0);

      const allowedIds = new Set(contTerritories.map((t) => t.id));
      const visitedCont = new Set<string>([contTerritories[0].id]);
      const queueCont: string[] = [contTerritories[0].id];

      while (queueCont.length > 0) {
        const currId = queueCont.shift()!;
        const curr = byId.get(currId)!;
        for (const nId of curr.neighbors) {
          if (allowedIds.has(nId) && !visitedCont.has(nId)) {
            visitedCont.add(nId);
            queueCont.push(nId);
          }
        }
      }

      expect(
        visitedCont.size,
        `Continente ${cont.id} possui sub-regiões desconectadas internamente`
      ).toBe(contTerritories.length);
    }
  });

  it("valida a partição exata das sub-regiões da Ásia e respetivos bónus", () => {
    const asiaTerritories = territories.filter((t) => t.continent === "asia");
    expect(asiaTerritories.length).toBe(14);

    const subRegionIds = new Set<string>();
    for (const sr of ASIA_SUBREGIONS) {
      expect(sr.bonus).toBeGreaterThanOrEqual(2);
      expect(sr.territoryIds.length).toBeGreaterThanOrEqual(4);
      for (const tid of sr.territoryIds) {
        expect(
          subRegionIds.has(tid),
          `Território ${tid} duplicado em múltiplas sub-regiões da Ásia`
        ).toBe(false);
        subRegionIds.add(tid);

        const terr = byId.get(tid);
        expect(terr, `Território asiático ${tid} não existe`).toBeDefined();
        expect(terr!.continent).toBe("asia");
        expect(terr!.subRegion).toBe(sr.id);
      }
    }

    expect(subRegionIds.size).toBe(asiaTerritories.length);
  });

  it("valida a geometria SVG de todos os territórios (sem NaN, sem polígonos abertos ou invertidos)", () => {
    expect(MAP_WIDTH).toBe(1200);
    expect(MAP_HEIGHT).toBe(620);
    expect(GLOBAL_LAND_SVG_PATH.length).toBeGreaterThan(1000);
    expect(GLOBAL_LAND_SVG_PATH).not.toContain("NaN");
    expect(GRATICULE_SVG_PATH.length).toBeGreaterThan(500);

    for (const t of territories) {
      expect(t.svgPath.length, `Caminho SVG vazio ou muito curto em ${t.id}`).toBeGreaterThan(20);
      expect(t.svgPath).not.toContain("NaN");
      expect(t.svgPath).not.toContain("Infinity");
      expect(
        t.svgPath.trim().endsWith("Z"),
        `Polígono SVG de ${t.id} não termina fechado com 'Z'`
      ).toBe(true);

      const [cx, cy] = t.center;
      expect(Number.isFinite(cx)).toBe(true);
      expect(Number.isFinite(cy)).toBe(true);
      expect(cx, `Centro X fora do mapa em ${t.id}`).toBeGreaterThanOrEqual(0);
      expect(cx, `Centro X fora do mapa em ${t.id}`).toBeLessThanOrEqual(MAP_WIDTH);
      expect(cy, `Centro Y fora do mapa em ${t.id}`).toBeGreaterThanOrEqual(0);
      expect(cy, `Centro Y fora do mapa em ${t.id}`).toBeLessThanOrEqual(MAP_HEIGHT);

      const pointMatches = [...t.svgPath.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
      expect(pointMatches.length, `Sem coordenadas válidas em ${t.id}`).toBeGreaterThan(2);

      const xs = pointMatches.map((m) => parseFloat(m[1]));
      const ys = pointMatches.map((m) => parseFloat(m[2]));
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);

      expect(
        width,
        `Bounding box horizontal de ${t.id} (${width}px) indica polígono invertido`
      ).toBeLessThanOrEqual(450);
      expect(
        height,
        `Bounding box vertical de ${t.id} (${height}px) indica polígono invertido`
      ).toBeLessThanOrEqual(300);
    }
  });

  it("valida a distribuição geoeconómica (Aço, Petróleo, Ouro, Rotas Comerciais e Costas)", () => {
    const totals = { steel: 0, oil: 0, gold: 0, tradeBonus: 0, coastal: 0, landlocked: 0 };

    for (const t of territories) {
      const econ = TERRITORY_GEO_ECONOMY[t.id];
      expect(econ, `TERRITORY_GEO_ECONOMY ausente para ${t.id}`).toBeDefined();
      expect(t.resource).toBe(econ.resource);
      expect(t.tradeBonus).toBe(econ.tradeBonus);
      expect(t.isCoastal).toBe(econ.isCoastal);

      if (t.resource === "steel") totals.steel++;
      if (t.resource === "oil") totals.oil++;
      if (t.resource === "gold") totals.gold++;
      if (t.tradeBonus) totals.tradeBonus += t.tradeBonus;
      if (t.isCoastal) totals.coastal++;
      else totals.landlocked++;
    }

    expect(totals.steel).toBeGreaterThanOrEqual(15);
    expect(totals.oil).toBeGreaterThanOrEqual(12);
    expect(totals.gold).toBeGreaterThanOrEqual(8);
    expect(totals.tradeBonus).toBeGreaterThanOrEqual(18);
    expect(totals.coastal + totals.landlocked).toBe(53);

    for (const inlandId of [
      "moscou",
      "ottawa",
      "aral",
      "omsk",
      "siberia",
      "tchita",
      "mongolia",
      "xinjiang",
    ]) {
      expect(
        byId.get(inlandId)?.isCoastal,
        `Território interior ${inlandId} está marcado incorretamente como costeiro`
      ).toBe(false);
    }
  });

  it("valida todos os cartões de objetivo (Clássicos e Roleplay) face à malha de 53 territórios", () => {
    expect(CLASSIC_OBJECTIVES.length).toBe(14);
    expect(ROLEPLAY_OBJECTIVES.length).toBe(10);
    expect(ALL_OBJECTIVES.length).toBe(24);

    for (const obj of ROLEPLAY_OBJECTIVES) {
      expect(obj.rule.type).toBe("specific_territories");
      if (obj.rule.type === "specific_territories") {
        expect(obj.rule.territoryIds.length).toBeGreaterThanOrEqual(10);
        for (const tid of obj.rule.territoryIds) {
          expect(
            byId.has(tid),
            `Objetivo Roleplay ${obj.id} referencia território inexistente: ${tid}`
          ).toBe(true);
        }
        for (const group of obj.rule.extraAnyOf ?? []) {
          for (const tid of group) {
            expect(
              byId.has(tid),
              `Grupo extraAnyOf de ${obj.id} referencia território inexistente: ${tid}`
            ).toBe(true);
          }
        }
      }

      for (const coreId of obj.coreTerritoryIds ?? []) {
        expect(
          byId.has(coreId),
          `coreTerritoryId ${coreId} em ${obj.id} não existe no mapa`
        ).toBe(true);
      }
    }
  });
});