import { describe, it, expect, beforeEach, vi } from "vitest";
import { sound, REPLAY_GAIN_CONFIG, SFX_ASSET_PATHS } from "../audio.js";
import manifest from "../../public/sfx/manifest.json";
import library from "../../public/music/library.json";

describe("HEGEM-93: Tactical Audio & SFX Engine with User Audio Assets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes all calibrated ReplayGain entries with valid target LUFS and gains", () => {
    const requiredKeys = [
      "offensive_order",
      "defensive_alarm",
      "infantry",
      "tank",
      "artillery",
      "aircraft",
      "navy",
      "turn_radio",
      "turn_chime",
      "market_sell",
      "market_buy",
      "treaty_broken",
      "defcon1_crisis",
      "faction_eliminated",
      "victory_match",
      "click",
      "dice",
      "conquest",
      "music",
    ];

    requiredKeys.forEach((key) => {
      expect(REPLAY_GAIN_CONFIG[key]).toBeDefined();
      expect(REPLAY_GAIN_CONFIG[key].targetLufs).toBeLessThanOrEqual(-10);
      expect(REPLAY_GAIN_CONFIG[key].targetLufs).toBeGreaterThanOrEqual(-25);
      expect(REPLAY_GAIN_CONFIG[key].gainDb).toBeLessThanOrEqual(0);
      expect(REPLAY_GAIN_CONFIG[key].gainDb).toBeGreaterThanOrEqual(-12);
    });
  });

  it("defines primary MP3 and fallback WAV asset paths for all tactical cues", () => {
    expect(SFX_ASSET_PATHS.offensive_order).toContain("/sfx/combat/offensive_order.mp3");
    expect(SFX_ASSET_PATHS.defensive_alarm).toContain("/sfx/combat/defensive_alarm.mp3");
    expect(SFX_ASSET_PATHS.infantry).toContain("/sfx/combat/infantry_rifle.mp3");
    expect(SFX_ASSET_PATHS.tank).toContain("/sfx/combat/armor_cannon.mp3");
    expect(SFX_ASSET_PATHS.artillery).toContain("/sfx/combat/artillery_barrage.mp3");
    expect(SFX_ASSET_PATHS.aircraft).toContain("/sfx/combat/aircraft_strike.mp3");
    expect(SFX_ASSET_PATHS.navy).toContain("/sfx/combat/naval_salvo.mp3");
    expect(SFX_ASSET_PATHS.turn_radio).toContain("/sfx/turn/turn_start_radio.mp3");
    expect(SFX_ASSET_PATHS.market_sell).toContain("/sfx/economy/market_sell_coins.mp3");
    expect(SFX_ASSET_PATHS.market_buy).toContain("/sfx/economy/market_buy_cargo.mp3");
    expect(SFX_ASSET_PATHS.treaty_broken).toContain("/sfx/global/treaty_broken.mp3");
    expect(SFX_ASSET_PATHS.defcon1_crisis).toContain("/sfx/global/defcon1_crisis.mp3");
    expect(SFX_ASSET_PATHS.faction_eliminated).toContain("/sfx/global/faction_eliminated.mp3");
    expect(SFX_ASSET_PATHS.victory_match).toContain("/sfx/global/victory_match.mp3");
  });

  it("executes all tactical audio cue methods safely without throwing in headless mode", () => {
    expect(() => sound.playOffensiveOrder()).not.toThrow();
    expect(() => sound.playDefensiveAlarm()).not.toThrow();
    expect(() => sound.playInfantryRifle()).not.toThrow();
    expect(() => sound.playArmorCannon()).not.toThrow();
    expect(() => sound.playArtilleryBarrage()).not.toThrow();
    expect(() => sound.playAircraftStrike()).not.toThrow();
    expect(() => sound.playNavalSalvo()).not.toThrow();
    expect(() => sound.playTroopCombat("infantry")).not.toThrow();
    expect(() => sound.playTroopCombat("blindado")).not.toThrow();
    expect(() => sound.playTroopCombat("artilharia")).not.toThrow();
    expect(() => sound.playTroopCombat("aeronave")).not.toThrow();
    expect(() => sound.playTroopCombat("marinha")).not.toThrow();
    expect(() => sound.playTurnRadioAlert()).not.toThrow();
    expect(() => sound.playMarketSell()).not.toThrow();
    expect(() => sound.playMarketBuy()).not.toThrow();
    expect(() => sound.playTreatyBroken()).not.toThrow();
    expect(() => sound.playDefcon1Alert()).not.toThrow();
    expect(() => sound.playFactionEliminated()).not.toThrow();
    expect(() => sound.playVictoryMatch()).not.toThrow();
    expect(() => sound.playVictory()).not.toThrow();
    expect(() => sound.playClick()).not.toThrow();
    expect(() => sound.playDice()).not.toThrow();
    expect(() => sound.playConquest()).not.toThrow();
    expect(() => sound.playTurn()).not.toThrow();
    expect(() => sound.playCommsNotification()).not.toThrow();
  });

  it("handles volume adjustments, mute toggling and legacy UI getters correctly", () => {
    sound.setVolume(0.8);
    expect(sound.getVolume()).toBe(0.8);

    sound.setSfxVolume(0.9);
    expect(sound.getSfxVolume()).toBe(0.9);

    const initialMute = sound.getMuted();
    expect(sound.getIsMuted()).toBe(initialMute);

    const toggled = sound.toggleMute();
    expect(toggled).toBe(!initialMute);
    expect(sound.getMuted()).toBe(!initialMute);
    expect(sound.getIsMuted()).toBe(!initialMute);

    sound.setMuted(false);
    expect(sound.getIsMuted()).toBe(false);
    expect(sound.getMuted()).toBe(false);

    expect(typeof sound.getIsPlaying()).toBe("boolean");
    expect(typeof sound.getCurrentTrack()).toBe("string");
    expect(sound.getCurrentTrack()).toBe(sound.getTrack());

    // Restore original mute state
    sound.setMuted(initialMute);
  });

  it("validates that the Navidrome SFX manifest defines masterLimiter and all 5 categories", () => {
    expect(manifest.version).toBe("1.0");
    expect(manifest.masterLimiter.enabled).toBe(true);
    expect(manifest.masterLimiter.thresholdDb).toBe(-12.0);
    expect(manifest.masterLimiter.ratio).toBe(12.0);

    expect(manifest.categories.combat.items.offensive_order).toBeDefined();
    expect(manifest.categories.combat.items.defensive_alarm).toBeDefined();
    expect(manifest.categories.combat.items.infantry).toBeDefined();
    expect(manifest.categories.combat.items.tank).toBeDefined();
    expect(manifest.categories.combat.items.artillery).toBeDefined();
    expect(manifest.categories.combat.items.aircraft).toBeDefined();
    expect(manifest.categories.combat.items.navy).toBeDefined();

    expect(manifest.categories.turn.items.turn_radio).toBeDefined();
    expect(manifest.categories.economy.items.market_sell).toBeDefined();
    expect(manifest.categories.economy.items.market_buy).toBeDefined();
    expect(manifest.categories.global.items.treaty_broken).toBeDefined();
    expect(manifest.categories.global.items.defcon1_crisis).toBeDefined();
    expect(manifest.categories.global.items.faction_eliminated).toBeDefined();
    expect(manifest.categories.global.items.victory_match).toBeDefined();
  });

  it("validates that the Navidrome music library defines tactical albums and tracks", () => {
    expect(library.version).toBe("1.0");
    expect(Array.isArray(library.albums)).toBe(true);
    expect(library.albums.length).toBeGreaterThan(0);
    expect(library.albums[0].id).toBe("tactical_ambient");
    expect(library.albums[0].tracks.length).toBeGreaterThan(0);
  });
});

