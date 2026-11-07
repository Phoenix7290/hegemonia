import type { CompetitionMode } from "./multiplayer.js";

export interface XpConfig {
  minRounds: number;
  maxRoundsCap: number;
  baseXp: Record<CompetitionMode, number>;
  winBonus: Record<CompetitionMode, number>;
  placementBonus: Record<CompetitionMode, number[]>;
}

export const XP_CONFIG: XpConfig = {
  minRounds: 3,
  maxRoundsCap: 30,
  baseXp: {
    custom: 25,
    casual: 75,
    ranked: 150,
  },
  winBonus: {
    custom: 15,
    casual: 45,
    ranked: 90,
  },
  // Bonus per placement: 1st, 2nd, 3rd, 4th+
  placementBonus: {
    custom: [15, 10, 5, 0],
    casual: [45, 25, 15, 0],
    ranked: [90, 50, 25, 0],
  },
};

/**
 * Total cumulative XP required to reach a specific level.
 * Level 1 starts at 0 XP.
 * For N >= 2: floor(100 * (N - 1)^1.6)
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.6));
}

/**
 * Calculates current player level from cumulative total XP.
 * Monotonic, strictly non-regressive, minimum Level 1.
 */
export function calculateLevel(totalXp: number): number {
  if (!totalXp || totalXp <= 0) return 1;
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) {
    level++;
    if (level >= 999) break; // Defensive upper bound
  }
  return level;
}

export interface LevelProgress {
  level: number;
  totalXp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpInCurrentLevel: number;
  xpNeededForNextLevel: number;
  progressPct: number;
}

export interface MilitaryRank {
  titlePt: string;
  titleEn: string;
  minLevel: number;
}

export const MILITARY_RANKS: MilitaryRank[] = [
  { minLevel: 1, titlePt: "Recruta", titleEn: "Recruit" },
  { minLevel: 2, titlePt: "Soldado", titleEn: "Private" },
  { minLevel: 3, titlePt: "Cabo", titleEn: "Corporal" },
  { minLevel: 4, titlePt: "Sargento", titleEn: "Sergeant" },
  { minLevel: 5, titlePt: "Subtenente", titleEn: "Warrant Officer" },
  { minLevel: 6, titlePt: "Tenente", titleEn: "Lieutenant" },
  { minLevel: 7, titlePt: "Capitão", titleEn: "Captain" },
  { minLevel: 8, titlePt: "Major", titleEn: "Major" },
  { minLevel: 9, titlePt: "Tenente-Coronel", titleEn: "Lt. Colonel" },
  { minLevel: 10, titlePt: "Coronel", titleEn: "Colonel" },
  { minLevel: 12, titlePt: "General de Brigada", titleEn: "Brigadier General" },
  { minLevel: 15, titlePt: "General de Divisão", titleEn: "Major General" },
  { minLevel: 20, titlePt: "General de Exército", titleEn: "Army General" },
  { minLevel: 25, titlePt: "Marechal de Campo", titleEn: "Field Marshal" },
];

export function getMilitaryRank(level: number): MilitaryRank {
  const safeLevel = Math.max(1, Math.floor(level || 1));
  let rank = MILITARY_RANKS[0];
  for (const r of MILITARY_RANKS) {
    if (safeLevel >= r.minLevel) {
      rank = r;
    } else {
      break;
    }
  }
  return rank;
}

/**
 * Detailed progress metrics for UI display (bars, percentages, counters).
 */
export function calculateLevelProgress(totalXp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(totalXp || 0));
  const level = calculateLevel(safeXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const xpInCurrentLevel = safeXp - currentLevelXp;
  const xpNeededForNextLevel = nextLevelXp - currentLevelXp;
  const progressPct =
    xpNeededForNextLevel > 0
      ? Math.min(100, Math.max(0, Math.round((xpInCurrentLevel / xpNeededForNextLevel) * 100)))
      : 100;

  return {
    level,
    totalXp: safeXp,
    currentLevelXp,
    nextLevelXp,
    xpInCurrentLevel,
    xpNeededForNextLevel,
    progressPct,
  };
}

export interface MatchXpCalculationInput {
  competitionMode: CompetitionMode;
  roundsPlayed: number;
  placement: number;
  won: boolean;
  isBot: boolean;
  hasAuthenticatedUser: boolean;
  totalHumanPlayers: number;
  totalBotPlayers: number;
  abandoned?: boolean;
}

export interface MatchXpBreakdown {
  eligible: boolean;
  ineligibilityReason?:
    | "guest"
    | "bot"
    | "too_short"
    | "majority_bots"
    | "abandoned";
  competitionMode: CompetitionMode;
  baseXp: number;
  winBonus: number;
  placementBonus: number;
  totalXp: number;
}

/**
 * Core versioned XP reward calculator.
 * Strictly guarantees under equivalent conditions:
 * XP Custom < XP Casual < XP Ranqueada
 */
export function calculateMatchXp(input: MatchXpCalculationInput): MatchXpBreakdown {
  const mode = input.competitionMode ?? "casual";

  // Eligibility Rule 1: Authenticated users only
  if (!input.hasAuthenticatedUser || input.isBot) {
    return {
      eligible: false,
      ineligibilityReason: input.isBot ? "bot" : "guest",
      competitionMode: mode,
      baseXp: 0,
      winBonus: 0,
      placementBonus: 0,
      totalXp: 0,
    };
  }

  // Eligibility Rule 2: Minimum rounds duration (anti-farm / instant surrender)
  if (input.roundsPlayed < XP_CONFIG.minRounds) {
    return {
      eligible: false,
      ineligibilityReason: "too_short",
      competitionMode: mode,
      baseXp: 0,
      winBonus: 0,
      placementBonus: 0,
      totalXp: 0,
    };
  }

  // Eligibility Rule 3: Abandoned / ragequit before legitimate elimination
  if (input.abandoned) {
    return {
      eligible: false,
      ineligibilityReason: "abandoned",
      competitionMode: mode,
      baseXp: 0,
      winBonus: 0,
      placementBonus: 0,
      totalXp: 0,
    };
  }

  // Eligibility Rule 4: Custom matches must have at least 2 humans to avoid bot farm
  if (mode === "custom" && input.totalHumanPlayers < 2) {
    return {
      eligible: false,
      ineligibilityReason: "majority_bots",
      competitionMode: mode,
      baseXp: 0,
      winBonus: 0,
      placementBonus: 0,
      totalXp: 0,
    };
  }

  const baseXp = XP_CONFIG.baseXp[mode] ?? XP_CONFIG.baseXp.casual;
  const winBonus = input.won ? (XP_CONFIG.winBonus[mode] ?? 0) : 0;

  const placementIdx = Math.max(0, input.placement - 1);
  const bonuses = XP_CONFIG.placementBonus[mode] ?? [0];
  const placementBonus = placementIdx < bonuses.length ? bonuses[placementIdx] : 0;

  const totalXp = baseXp + winBonus + placementBonus;

  return {
    eligible: true,
    competitionMode: mode,
    baseXp,
    winBonus,
    placementBonus,
    totalXp,
  };
}
