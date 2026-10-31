import { describe, it, expect } from "vitest";
import {
  calculateLevel,
  calculateLevelProgress,
  calculateMatchXp,
  xpForLevel,
} from "./xp.js";

describe("XP & Level Progression Engine (HEGEM-66)", () => {
  describe("Hierarchical Guarantee: XP Custom < XP Casual < XP Ranqueada", () => {
    it("guarantees Custom < Casual < Ranked for winning players", () => {
      const custom = calculateMatchXp({
        competitionMode: "custom",
        roundsPlayed: 6,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 3,
        totalBotPlayers: 0,
      });

      const casual = calculateMatchXp({
        competitionMode: "casual",
        roundsPlayed: 6,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 3,
        totalBotPlayers: 0,
      });

      const ranked = calculateMatchXp({
        competitionMode: "ranked",
        roundsPlayed: 6,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 3,
        totalBotPlayers: 0,
      });

      expect(custom.totalXp).toBeGreaterThan(0);
      expect(casual.totalXp).toBeGreaterThan(custom.totalXp);
      expect(ranked.totalXp).toBeGreaterThan(casual.totalXp);
    });

    it("guarantees Custom < Casual < Ranked for non-winning participants", () => {
      const custom = calculateMatchXp({
        competitionMode: "custom",
        roundsPlayed: 8,
        placement: 2,
        won: false,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 4,
        totalBotPlayers: 0,
      });

      const casual = calculateMatchXp({
        competitionMode: "casual",
        roundsPlayed: 8,
        placement: 2,
        won: false,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 4,
        totalBotPlayers: 0,
      });

      const ranked = calculateMatchXp({
        competitionMode: "ranked",
        roundsPlayed: 8,
        placement: 2,
        won: false,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 4,
        totalBotPlayers: 0,
      });

      expect(custom.totalXp).toBeGreaterThan(0);
      expect(casual.totalXp).toBeGreaterThan(custom.totalXp);
      expect(ranked.totalXp).toBeGreaterThan(casual.totalXp);
    });
  });

  describe("Eligibility & Anti-Fraud Safeguards", () => {
    it("grants 0 XP to unauthenticated guests", () => {
      const res = calculateMatchXp({
        competitionMode: "casual",
        roundsPlayed: 10,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: false,
        totalHumanPlayers: 2,
        totalBotPlayers: 0,
      });
      expect(res.eligible).toBe(false);
      expect(res.ineligibilityReason).toBe("guest");
      expect(res.totalXp).toBe(0);
    });

    it("grants 0 XP to bot participants", () => {
      const res = calculateMatchXp({
        competitionMode: "ranked",
        roundsPlayed: 10,
        placement: 1,
        won: true,
        isBot: true,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 2,
        totalBotPlayers: 1,
      });
      expect(res.eligible).toBe(false);
      expect(res.ineligibilityReason).toBe("bot");
      expect(res.totalXp).toBe(0);
    });

    it("grants 0 XP to matches with fewer than 3 rounds (instant surrender / farm)", () => {
      const res = calculateMatchXp({
        competitionMode: "ranked",
        roundsPlayed: 2,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 2,
        totalBotPlayers: 0,
      });
      expect(res.eligible).toBe(false);
      expect(res.ineligibilityReason).toBe("too_short");
      expect(res.totalXp).toBe(0);
    });

    it("grants 0 XP to custom matches with only 1 human player", () => {
      const res = calculateMatchXp({
        competitionMode: "custom",
        roundsPlayed: 12,
        placement: 1,
        won: true,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 1,
        totalBotPlayers: 3,
      });
      expect(res.eligible).toBe(false);
      expect(res.ineligibilityReason).toBe("majority_bots");
      expect(res.totalXp).toBe(0);
    });

    it("grants 0 XP if player abandoned", () => {
      const res = calculateMatchXp({
        competitionMode: "ranked",
        roundsPlayed: 12,
        placement: 4,
        won: false,
        isBot: false,
        hasAuthenticatedUser: true,
        totalHumanPlayers: 4,
        totalBotPlayers: 0,
        abandoned: true,
      });
      expect(res.eligible).toBe(false);
      expect(res.ineligibilityReason).toBe("abandoned");
      expect(res.totalXp).toBe(0);
    });
  });

  describe("Level Curve and Progression Metrics", () => {
    it("starts at level 1 with 0 XP", () => {
      expect(calculateLevel(0)).toBe(1);
      expect(calculateLevel(-50)).toBe(1);
      expect(xpForLevel(1)).toBe(0);
    });

    it("strictly advances levels as XP thresholds are crossed", () => {
      const lvl2Threshold = xpForLevel(2);
      expect(lvl2Threshold).toBe(100);
      expect(calculateLevel(lvl2Threshold - 1)).toBe(1);
      expect(calculateLevel(lvl2Threshold)).toBe(2);

      const lvl3Threshold = xpForLevel(3);
      expect(lvl3Threshold).toBe(303);
      expect(calculateLevel(lvl3Threshold - 1)).toBe(2);
      expect(calculateLevel(lvl3Threshold)).toBe(3);
    });

    it("calculates accurate level progress breakdown for UI", () => {
      // Level 2 requires 100 XP, Level 3 requires 303 XP (gap of 203 XP)
      const progress = calculateLevelProgress(200);
      expect(progress.level).toBe(2);
      expect(progress.currentLevelXp).toBe(100);
      expect(progress.nextLevelXp).toBe(303);
      expect(progress.xpInCurrentLevel).toBe(100);
      expect(progress.xpNeededForNextLevel).toBe(203);
      expect(progress.progressPct).toBe(49); // 100 / 203 ≈ 49%
    });
  });
});
