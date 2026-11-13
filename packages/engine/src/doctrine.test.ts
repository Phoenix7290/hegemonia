import { describe, expect, it } from "vitest";
import { CLASSIC_MAP } from "@hegemonia/maps";
import {
  CORE_DOCTRINE_LIST,
  DOCTRINES,
  isDoctrineAvailableInLobby,
} from "@hegemonia/shared";
import {
  applyAction,
  canDegradeFortificationInCombat,
  createGame,
  createSeededRng,
  getEffectiveBlitzOilCost,
  getEffectiveBuildingMoneyCost,
  getMaxAirliftsPerTurn,
  getPlayerNativeContinent,
  resolveGuerrillaInsurgencyOnOccupy,
} from "./index.js";

describe("Epic IX — Doutrinas Militares Nacionais (Motor Determinístico)", () => {
  function setupMatch() {
    const rng = createSeededRng("doctrine-epic-ix-seed");
    const state = createGame({
      id: "match-doctrine",
      seed: "doctrine-epic-ix-seed",
      players: [
        { id: "p1", name: "General Azul", color: "blue", doctrineId: "blitzkrieg" },
        { id: "p2", name: "General Vermelho", color: "red", doctrineId: "defense_in_depth" },
      ],
    });
    return { state, rng };
  }

  it("permite escolher e trocar livremente de doutrina na Rodada 1 e bloqueia na Rodada 2+", () => {
    const rng = createSeededRng("select-doc-seed");
    const state = createGame({
      id: "m1",
      seed: "select-doc-seed",
      players: [
        { id: "p1", name: "Alice", color: "blue" },
        { id: "p2", name: "Bob", color: "red" },
      ],
    });

    // 1. Escolhe Frota em Potência na Rodada 1
    const step1 = applyAction(
      state,
      "p1",
      { type: "select_doctrine", doctrineId: "fleet_in_being" },
      rng,
      CLASSIC_MAP
    );
    expect(step1.players.find((p) => p.id === "p1")!.doctrineId).toBe("fleet_in_being");

    // 2. Troca livremente para Blitzkrieg ainda na Rodada 1
    const step2 = applyAction(
      step1,
      "p1",
      { type: "select_doctrine", doctrineId: "blitzkrieg" },
      rng,
      CLASSIC_MAP
    );
    expect(step2.players.find((p) => p.id === "p1")!.doctrineId).toBe("blitzkrieg");

    // 3. Bloqueia se tentar reenviar a mesma doutrina já ativa
    expect(() =>
      applyAction(
        step2,
        "p1",
        { type: "select_doctrine", doctrineId: "blitzkrieg" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/já foi estabelecida/i);

    // 4. Bloqueia troca a partir da Rodada 2
    const round2State = structuredClone(step2);
    round2State.round = 2;
    expect(() =>
      applyAction(
        round2State,
        "p1",
        { type: "select_doctrine", doctrineId: "guerrilla_warfare" },
        rng,
        CLASSIC_MAP
      )
    ).toThrow(/Rodada 1/i);
  });

  it("1. Blitzkrieg: reduz em 50% o custo de petróleo no 1.º blitz do turno", () => {
    const { state } = setupMatch();
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.doctrineId = "blitzkrieg";
    p1.blitzCountThisTurn = 0;

    expect(getEffectiveBlitzOilCost(p1, 1)).toBe(0);
    expect(getEffectiveBlitzOilCost(p1, 2)).toBe(1);

    p1.blitzCountThisTurn = 1;
    expect(getEffectiveBlitzOilCost(p1, 1)).toBe(1);
    expect(getEffectiveBlitzOilCost(p1, 2)).toBe(2);
  });

  it("2. Defesa em Profundidade: identifica continente natal e protege Fortificação Nv. 1 contra infantaria pura", () => {
    const { state } = setupMatch();
    const p2 = state.players.find((p) => p.id === "p2")!;
    p2.doctrineId = "defense_in_depth";
    p2.capitalTerritoryId = "brasil";

    expect(getPlayerNativeContinent(state, p2, CLASSIC_MAP)).toBe("south_america");

    expect(
      canDegradeFortificationInCombat(p2, {
        infantry: 3,
        tank: 0,
        artillery: 0,
        aircraft: 0,
        navy: 0,
      })
    ).toBe(false);

    expect(
      canDegradeFortificationInCombat(p2, {
        infantry: 1,
        tank: 1,
        artillery: 0,
        aircraft: 0,
        navy: 0,
      })
    ).toBe(true);
  });

  it("3. Frota em Potência: reduz custo de Portos e Aeródromos em $1 e libera 2 Pontes Aéreas", () => {
    const { state } = setupMatch();
    const p1 = state.players.find((p) => p.id === "p1")!;
    p1.doctrineId = "fleet_in_being";

    expect(getEffectiveBuildingMoneyCost(p1, "port", 5)).toBe(4);
    expect(getEffectiveBuildingMoneyCost(p1, "airfield", 5)).toBe(4);
    expect(getEffectiveBuildingMoneyCost(p1, "industry", 6)).toBe(6);
    expect(getMaxAirliftsPerTurn(p1)).toBe(2);
  });

  it("4. Guerra de Guerrilha: dispara insurgência partisan quando o conquistador deixa apenas 1 divisão", () => {
    const { state, rng } = setupMatch();
    const occupier = state.players.find((p) => p.id === "p1")!;
    const guerrillaOwner = state.players.find((p) => p.id === "p2")!;
    guerrillaOwner.doctrineId = "guerrilla_warfare";

    const targetId = CLASSIC_MAP.territories[0].id;
    const conquered = state.territories[targetId];
    conquered.ownerId = occupier.id;
    conquered.armies = 1;
    conquered.units = { infantry: 1, tank: 0, artillery: 0, aircraft: 0, navy: 0 };

    resolveGuerrillaInsurgencyOnOccupy({
      state,
      map: CLASSIC_MAP,
      rng,
      occupier,
      previousOwner: guerrillaOwner,
      conqueredTerritory: conquered,
    });

    expect(state.log.some((entry) => entry.includes("[GUERRILHA]"))).toBe(true);
  });
});

describe("HEGEM-139: Doutrinas Militares - Ícone de Capacete Militar na Doutrina Padrão e Posicionamento no Topo do Grid", () => {
  it("positions Classic Command / Standard Doctrine in 1st place in the doctrine grid with military helmet icon", () => {
    // 1. Verifies 1st place in CORE_DOCTRINE_LIST
    const firstDoc = CORE_DOCTRINE_LIST[0];
    expect(firstDoc.id).toBe("superior_firepower");
    expect(firstDoc.icon).toBe("helmet");
    expect(firstDoc.namePt).toContain("Comando Clássico");
    expect(firstDoc.orderIndex).toBe(1);

    // 2. Verifies Mass Assault was swapped to 6th position (orderIndex 6)
    const massAssaultDoc = CORE_DOCTRINE_LIST[5];
    expect(massAssaultDoc.id).toBe("mass_assault");
    expect(massAssaultDoc.icon).toBe("infantry");
    expect(massAssaultDoc.namePt).toContain("Ataque em Massa");
    expect(massAssaultDoc.orderIndex).toBe(6);
  });

  it("supports standard alias pointing to Classic Command with helmet icon and proper lobby normalization", () => {
    expect(DOCTRINES.standard).toBeDefined();
    expect(DOCTRINES.standard.icon).toBe("helmet");
    expect(DOCTRINES.standard.orderIndex).toBe(1);

    // Lobby normalization
    expect(isDoctrineAvailableInLobby("standard", ["superior_firepower"])).toBe(true);
    expect(
      isDoctrineAvailableInLobby("standard", ["superior_firepower", "standard"])
    ).toBe(false);
  });

  it("allows selecting standard / superior_firepower in Round 1 deploy phase", () => {
    const rng = createSeededRng("hegem139-doctrine-seed");
    const state = createGame({
      id: "match-hegem139",
      seed: "hegem139-doctrine-seed",
      players: [
        { id: "p1", name: "ClassicCommander", color: "blue" },
        { id: "p2", name: "Rival", color: "red" },
      ],
    });

    const updated = applyAction(
      state,
      "p1",
      { type: "select_doctrine", doctrineId: "standard" },
      rng,
      CLASSIC_MAP
    );
    expect(updated.players.find((p) => p.id === "p1")!.doctrineId).toBe("standard");
    expect(updated.log.some((l) => l.includes("Comando Clássico"))).toBe(true);
  });
});
