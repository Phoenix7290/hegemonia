import { z } from "zod";

export const DoctrineIdSchema = z.enum([
  "mass_assault",
  "tall_sovereign",
  "naval_supremacy",
  "blitzkrieg",
  "extermination",
  "guerrilla",
  "superior_firepower",
  // Legacy aliases
  "defense_in_depth",
  "fleet_in_being",
  "guerrilla_warfare",
]);

export type DoctrineId = z.infer<typeof DoctrineIdSchema>;

export interface DoctrineDef {
  id: DoctrineId;
  icon: "blitzkrieg" | "fortification" | "anchor" | "swords" | "infantry" | "skull" | "artillery";
  accentColor: string;
  badgeCode: string;
  namePt: string;
  nameEn: string;
  summaryPt: string;
  summaryEn: string;
  maxPerLobby: number;
  isDarkTheme?: boolean;
  orderIndex: number;
}

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  mass_assault: {
    id: "mass_assault",
    icon: "infantry",
    accentColor: "#ef4444",
    badgeCode: "MAS",
    namePt: "Ataque em Massa (Exército Vermelho)",
    nameEn: "Mass Assault (Red Army)",
    summaryPt:
      "Infantaria 30% mais barata ($2); +2 tropas bônus na troca de cartas. Bloqueio total de blindados, artilharia e caças; -40% tesouraria.",
    summaryEn:
      "Infantry 30% cheaper ($2); +2 bonus troops on card trades. Strict block on tanks, artillery, and fighters; -40% gross treasury.",
    maxPerLobby: 2,
    orderIndex: 1,
  },
  tall_sovereign: {
    id: "tall_sovereign",
    icon: "fortification",
    accentColor: "#10b981",
    badgeCode: "TAL",
    namePt: "Fortaleza Soberana (Desenvolvimento Tall)",
    nameEn: "Sovereign Fortress (Tall Development)",
    summaryPt:
      "Indústria e Fortaleza Nv. 2 exclusivas (+100% commodities em 3-5 territórios). Penalidade de Overextension (-15% economia e -1 DEF por território a partir do 6.º).",
    summaryEn:
      "Exclusive Lv. 2 Industry and Fortress (+100% commodities in 3-5 territories). Overextension penalty (-15% economy and -1 DEF per territory beyond 5th).",
    maxPerLobby: 2,
    orderIndex: 2,
  },
  naval_supremacy: {
    id: "naval_supremacy",
    icon: "anchor",
    accentColor: "#38bdf8",
    badgeCode: "NAV",
    namePt: "Supremacia Aeronaval (Talassocracia)",
    nameEn: "Air-Naval Supremacy (Thalassocracy)",
    summaryPt:
      "Portos e Aeródromos custam -$1. Permite 2 Pontes Aéreas (Airlifts) por turno e amplo acesso a armas combinadas.",
    summaryEn:
      "Ports and Airfields cost -$1. Allows 2 Airlifts per turn and full combined arms access.",
    maxPerLobby: 2,
    orderIndex: 3,
  },
  blitzkrieg: {
    id: "blitzkrieg",
    icon: "blitzkrieg",
    accentColor: "#f59e0b",
    badgeCode: "BLZ",
    namePt: "Blitzkrieg (Guerra-Relâmpago)",
    nameEn: "Blitzkrieg (Lightning War)",
    summaryPt:
      "Blindados ganham +1 no maior dado de ataque no 1.º round e custam -$1 Aço. 1.º avanço consome -50% combustível.",
    summaryEn:
      "Armor gains +1 on highest attack die in 1st round and costs -$1 Steel. 1st spearhead advance consumes 50% less oil.",
    maxPerLobby: 2,
    orderIndex: 4,
  },
  extermination: {
    id: "extermination",
    icon: "skull",
    accentColor: "#881337",
    badgeCode: "EXT",
    namePt: "Guerra Total & Extermínio (Aniquilação)",
    nameEn: "Total War & Extermination (Annihilation)",
    summaryPt:
      "+1 em todos os dados de ataque ao invadir e saque dobrado de províncias. Inicia com 50% de Tensão e Infâmia; proibido construir melhorias civis. Objetivos extremos.",
    summaryEn:
      "+1 on all attack dice when invading and double plunder on conquest. Starts with 50% Tension and Infamy; cannot build civilian structures. Extreme victory objectives.",
    maxPerLobby: 1,
    isDarkTheme: true,
    orderIndex: 5,
  },
  guerrilla: {
    id: "guerrilla",
    icon: "swords",
    accentColor: "#ea580c",
    badgeCode: "GRR",
    namePt: "Guerra de Guerrilha & Partisans",
    nameEn: "Guerrilla Warfare & Partisans",
    summaryPt:
      "Imunidade a desabastecimento em costas/ilhas e contra-ataque imediato em guarnições de 1 tropa. Capital Nômade (redefine capital a cada 2 rodadas).",
    summaryEn:
      "Supply immunity on coasts/islands and immediate partisan counter-strike in 1-army garrisons. Nomadic Capital (can relocate capital every 2 rounds).",
    maxPerLobby: 2,
    orderIndex: 6,
  },
  // NOTE FOR FUTURE DEVELOPERS (HEGEM-125):
  // We intentionally retain the `superior_firepower` enum ID so existing database records,
  // analytics, and historical match logs remain 100% compatible.
  // The original Artillery-focused "Superior Firepower / Grande Batalhão" doctrine (2 barrages/turn,
  // +1 die with artillery saturation) may be re-introduced as an 8th doctrine or scenario preset in the future.
  // Currently, `superior_firepower` serves as the "Classic / Standard Command" (Comando Clássico)
  // baseline doctrine: 0 buffs, 0 debuffs, pure classic War experience, prioritizing classic conquest objectives.
  superior_firepower: {
    id: "superior_firepower",
    icon: "swords",
    accentColor: "#94a3b8",
    badgeCode: "CLS",
    namePt: "Comando Clássico (Doutrina Padrão)",
    nameEn: "Classic Command (Standard Doctrine)",
    summaryPt:
      "Experiência neutra e equilibrada (sem bônus e sem penalidades). Acesso irrestrito a todas as unidades e estruturas, priorizando objetivos clássicos de conquista.",
    summaryEn:
      "Neutral, balanced baseline experience (no buffs, no debuffs). Full access to all units and structures, prioritizing classic War conquest objectives.",
    maxPerLobby: 2,
    orderIndex: 7,
  },

  // Legacy aliases for backward compatibility with earlier saves/tests
  defense_in_depth: {
    id: "defense_in_depth",
    icon: "fortification",
    accentColor: "#10b981",
    badgeCode: "TAL",
    namePt: "Defesa em Profundidade (Fortaleza Soberana)",
    nameEn: "Defense in Depth (Sovereign Fortress)",
    summaryPt:
      "Indústria e Fortaleza Nv. 2 exclusivas (+100% commodities em 3-5 territórios). Penalidade de Overextension (-15% economia e -1 DEF por território a partir do 6.º).",
    summaryEn:
      "Exclusive Lv. 2 Industry and Fortress (+100% commodities in 3-5 territories). Overextension penalty (-15% economy and -1 DEF per territory beyond 5th).",
    maxPerLobby: 2,
    orderIndex: 8,
  },
  fleet_in_being: {
    id: "fleet_in_being",
    icon: "anchor",
    accentColor: "#38bdf8",
    badgeCode: "NAV",
    namePt: "Frota em Potência (Supremacia Aeronaval)",
    nameEn: "Fleet in Being (Air-Naval Supremacy)",
    summaryPt:
      "Portos e Aeródromos custam -$1. Permite 2 Pontes Aéreas (Airlifts) por turno e amplo acesso a armas combinadas.",
    summaryEn:
      "Ports and Airfields cost -$1. Allows 2 Airlifts per turn and full combined arms access.",
    maxPerLobby: 2,
    orderIndex: 9,
  },
  guerrilla_warfare: {
    id: "guerrilla_warfare",
    icon: "swords",
    accentColor: "#ea580c",
    badgeCode: "GRR",
    namePt: "Guerra de Guerrilha & Partisans",
    nameEn: "Guerrilla Warfare & Partisans",
    summaryPt:
      "Imunidade a desabastecimento em costas/ilhas e contra-ataque imediato em guarnições de 1 tropa. Capital Nômade (redefine capital a cada 2 rodadas).",
    summaryEn:
      "Supply immunity on coasts/islands and immediate partisan counter-strike in 1-army garrisons. Nomadic Capital (can relocate capital every 2 rounds).",
    maxPerLobby: 2,
    orderIndex: 10,
  },
};

export const CORE_DOCTRINE_LIST: DoctrineDef[] = [
  DOCTRINES.mass_assault,
  DOCTRINES.tall_sovereign,
  DOCTRINES.naval_supremacy,
  DOCTRINES.blitzkrieg,
  DOCTRINES.guerrilla,
  DOCTRINES.superior_firepower,
  DOCTRINES.extermination,
];

export const DOCTRINE_LIST: DoctrineDef[] = CORE_DOCTRINE_LIST;

export function isDoctrineAvailableInLobby(
  doctrineId: DoctrineId,
  selectedDoctrines: (DoctrineId | undefined | null)[]
): boolean {
  const def = DOCTRINES[doctrineId];
  if (!def) return false;
  // Account for aliases
  const normalizedSelected = selectedDoctrines.map((d) => {
    if (d === "defense_in_depth") return "tall_sovereign";
    if (d === "fleet_in_being") return "naval_supremacy";
    if (d === "guerrilla_warfare") return "guerrilla";
    return d;
  });
  const normalizedCandidate =
    doctrineId === "defense_in_depth"
      ? "tall_sovereign"
      : doctrineId === "fleet_in_being"
        ? "naval_supremacy"
        : doctrineId === "guerrilla_warfare"
          ? "guerrilla"
          : doctrineId;

  const count = normalizedSelected.filter((d) => d === normalizedCandidate).length;
  return count < def.maxPerLobby;
}
