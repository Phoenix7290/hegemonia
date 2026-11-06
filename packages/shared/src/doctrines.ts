import { z } from "zod";

export const DoctrineIdSchema = z.enum([
  "blitzkrieg",
  "defense_in_depth",
  "fleet_in_being",
  "guerrilla_warfare",
]);

export type DoctrineId = z.infer<typeof DoctrineIdSchema>;

export interface DoctrineDef {
  id: DoctrineId;
  icon: "blitzkrieg" | "fortification" | "anchor" | "swords";
  accentColor: string;
  badgeCode: string;
  namePt: string;
  nameEn: string;
  summaryPt: string;
  summaryEn: string;
}

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  blitzkrieg: {
    id: "blitzkrieg",
    icon: "blitzkrieg",
    accentColor: "#f59e0b",
    badgeCode: "BLZ",
    namePt: "Blitzkrieg (Guerra-Relâmpago)",
    nameEn: "Blitzkrieg (Lightning War)",
    summaryPt:
      "Blindados ganham +1 no maior dado de ataque no 1.º round de combate e avançam com custo de petróleo reduzido em 50% no 1.º blitz de cada turno.",
    summaryEn:
      "Armor gains +1 on the highest attack die in the 1st combat round and advances with 50% reduced oil cost on the 1st blitz each turn.",
  },
  defense_in_depth: {
    id: "defense_in_depth",
    icon: "fortification",
    accentColor: "#10b981",
    badgeCode: "DEF",
    namePt: "Defesa em Profundidade (Fortaleza Patriótica)",
    nameEn: "Defense in Depth (Patriotic Fortress)",
    summaryPt:
      "Infantarias ganham +1 no maior dado defensivo dentro do continente natal. Fortificações Nv. 1 degradam apenas se atacadas por artilharia ou tanques.",
    summaryEn:
      "Infantry gains +1 on the highest defense die inside your native continent. Lv. 1 Fortifications degrade only when attacked by artillery or tanks.",
  },
  fleet_in_being: {
    id: "fleet_in_being",
    icon: "anchor",
    accentColor: "#38bdf8",
    badgeCode: "NAV",
    namePt: "Frota em Potência (Projeção Aeronaval)",
    nameEn: "Fleet in Being (Aero-Naval Projection)",
    summaryPt:
      "Custo de construção de Portos e Aeródromos reduzido em $1. Permite realizar 1 Ponte Aérea (Airlift) adicional por turno.",
    summaryEn:
      "Port and Airfield construction cost reduced by $1. Allows 1 additional Airlift per turn.",
  },
  guerrilla_warfare: {
    id: "guerrilla_warfare",
    icon: "swords",
    accentColor: "#ef4444",
    badgeCode: "GRR",
    namePt: "Guerra de Guerrilha (Resistência Insurgente)",
    nameEn: "Guerrilla Warfare (Insurgent Resistance)",
    summaryPt:
      "Quando um adversário conquista um território seu e avança deixando apenas 1 divisão de guarnição, surge 1 divisão partisan para contestar a posse.",
    summaryEn:
      "When an enemy conquers your territory and advances leaving only 1 garrison division, 1 partisan division spawns to contest possession.",
  },
};

export const DOCTRINE_LIST: DoctrineDef[] = Object.values(DOCTRINES);