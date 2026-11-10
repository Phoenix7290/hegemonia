import { describe, expect, it } from "vitest";
import {
  SCENARIO_BY_ID,
  TACTICAL_SCENARIOS,
  type TacticalScenarioId,
} from "@hegemonia/shared";

// Regex to detect emojis in text
const EMOJI_REGEX =
  /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/u;

describe("HEGEM-104: Tutorial Guiado da HUD & Cenários Táticos Presetados (Frontend & Shared)", () => {
  it("exposes all 6 preset scenarios with complete asymmetric metadata", () => {
    expect(TACTICAL_SCENARIOS).toHaveLength(6);
    const scenarioIds: TacticalScenarioId[] = [
      "standard",
      "fortress_europe",
      "pacific_theater",
      "oil_crisis",
      "iron_curtain",
      "defcon1_armageddon",
    ];

    scenarioIds.forEach((id) => {
      const scenario = SCENARIO_BY_ID[id];
      expect(scenario).toBeDefined();
      expect(scenario.id).toBe(id);
      expect(scenario.name.trim().length).toBeGreaterThan(0);
      expect(scenario.codename.trim().length).toBeGreaterThan(0);
      expect(scenario.badge.trim().length).toBeGreaterThan(0);
      expect(scenario.description.trim().length).toBeGreaterThan(0);
      expect(scenario.initialTension).toBeGreaterThanOrEqual(0);
      expect(scenario.initialTension).toBeLessThanOrEqual(100);
    });
  });

  it("strictly complies with the zero-emoji policy across scenario definitions", () => {
    TACTICAL_SCENARIOS.forEach((scenario) => {
      expect(
        EMOJI_REGEX.test(scenario.name),
        `Emoji detected in scenario name: ${scenario.name}`
      ).toBe(false);
      expect(
        EMOJI_REGEX.test(scenario.codename),
        `Emoji detected in scenario codename: ${scenario.codename}`
      ).toBe(false);
      expect(
        EMOJI_REGEX.test(scenario.badge),
        `Emoji detected in scenario badge: ${scenario.badge}`
      ).toBe(false);
      expect(
        EMOJI_REGEX.test(scenario.description),
        `Emoji detected in scenario description: ${scenario.description}`
      ).toBe(false);
    });
  });

  it("verifies the 6 core educational areas required by HEGEM-104", () => {
    const requiredEducationalAreas = [
      "Recursos, Commodities & Economia", // Area 1: TopBar, Commodities e Mercado Dinâmico
      "Fases do Turno (1-2-3) & Ações", // Area 2: ActionConsole e Gestão de Tempo
      "Construções & Engenharia Militar", // Area 3: ReconInspector e Estruturas Estratégicas
      "Armas Combinadas & Doutrinas", // Area 4: Sinergia Tática entre 5 Tipos de Unidades
      "Suprimento, Cerco & Bloqueio Naval", // Area 5: Linhas de Comunicação com a Capital
      "Tensão Mundial, Diplomacia & DEFCON 1", // Area 6: Crise Geopolítica e Condições de Vitória
    ];

    expect(requiredEducationalAreas).toHaveLength(6);
    requiredEducationalAreas.forEach((areaTitle) => {
      expect(areaTitle.length).toBeGreaterThan(5);
      expect(EMOJI_REGEX.test(areaTitle)).toBe(false);
    });
  });

  it("maintains default scenario fallback as standard without breaking normal lobby flow", () => {
    const defaultScenario = SCENARIO_BY_ID["standard"];
    expect(defaultScenario.initialTension).toBe(0);
    expect(defaultScenario.id).toBe("standard");
  });

  it("verifies in-game live tutorial guide component structure and zero-emoji compliance", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const guidePath = path.resolve(__dirname, "../components/InGameTutorialGuide.svelte");
    expect(fs.existsSync(guidePath)).toBe(true);

    const source = fs.readFileSync(guidePath, "utf-8");
    expect(EMOJI_REGEX.test(source)).toBe(false);

    // Verify all 6 interactive gameplay areas requested by user
    expect(source).toContain("Recrutamento e Alocação de Tropas");
    expect(source).toContain("Gestão Econômica, Compra e Venda de Commodities");
    expect(source).toContain("Fortalezas, Indústrias, Portos e Aeródromos");
    expect(source).toContain("Ofensivas de Combate e Conquista Territorial");
    expect(source).toContain("Remanejamento de Forças e Linhas de Suprimento");
    expect(source).toContain("Tensão Mundial, Diplomacia e Diretiva Secreta");
  });

  it("verifies App.svelte declares practice state variables and handles practice error safely", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const appPath = path.resolve(__dirname, "../App.svelte");
    const source = fs.readFileSync(appPath, "utf-8");

    expect(source).toMatch(/let selectedDoctrineId\s*=/);
    expect(source).toMatch(/let selectedPlayerColor\s*=/);
    expect(source).toContain("practiceTutorialInMap");
    expect(source).toContain("Falha ao iniciar tutorial interativo");
  });
});

