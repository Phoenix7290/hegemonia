import { sound } from "../audio";
import {
  type CombatAnimationSpeed,
  loadCombatAnimationSpeed,
  saveCombatAnimationSpeed,
} from "./combat-animations";

const TOOLTIPS_KEY = "hegemonia_tooltips_enabled";
const TURN_TIMER_ALERTS_KEY = "hegemonia_turn_timer_alerts_enabled";

function loadTurnTimerAlertsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const val = localStorage.getItem(TURN_TIMER_ALERTS_KEY);
  return val === null ? true : val === "true";
}

function loadTooltipsEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const val = localStorage.getItem(TOOLTIPS_KEY);
  return val === null ? true : val === "true";
}

export interface ActiveTooltipState {
  text: string;
  subtext?: string;
  x: number;
  y: number;
  visible: boolean;
}

class UiState {
  inActiveBattle = $state(false);
  isMusicPlaying = $state(sound.getIsPlaying());
  isMuted = $state(sound.getIsMuted());
  musicVolume = $state(sound.getVolume());
  sfxVolume = $state(sound.getSfxVolume());
  selectedTrack = $state(sound.getCurrentTrack());
  combatAnimationSpeed = $state<CombatAnimationSpeed>(loadCombatAnimationSpeed());
  tooltipsEnabled = $state<boolean>(loadTooltipsEnabled());
  turnTimerAlertsEnabled = $state<boolean>(loadTurnTimerAlertsEnabled());
  activeTooltip = $state<ActiveTooltipState>({
    text: "",
    x: 0,
    y: 0,
    visible: false,
  });

  toggleTurnTimerAlerts() {
    this.turnTimerAlertsEnabled = !this.turnTimerAlertsEnabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TURN_TIMER_ALERTS_KEY, String(this.turnTimerAlertsEnabled));
    }
  }

  setTurnTimerAlerts(enabled: boolean) {
    this.turnTimerAlertsEnabled = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TURN_TIMER_ALERTS_KEY, String(this.turnTimerAlertsEnabled));
    }
  }

  toggleTooltips() {
    this.tooltipsEnabled = !this.tooltipsEnabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TOOLTIPS_KEY, String(this.tooltipsEnabled));
    }
    if (!this.tooltipsEnabled) {
      this.hideTooltip();
    }
  }

  showTooltip(text: string, x: number, y: number, subtext?: string) {
    if (!this.tooltipsEnabled || !text) return;
    this.activeTooltip = { text, subtext, x, y, visible: true };
  }

  hideTooltip() {
    this.activeTooltip = { ...this.activeTooltip, visible: false };
  }

  setCombatAnimationSpeed(speed: CombatAnimationSpeed) {
    this.combatAnimationSpeed = speed;
    saveCombatAnimationSpeed(speed);
  }

  toggleMusic() {
    this.isMusicPlaying = sound.toggleMusic();
  }

  toggleMute() {
    this.isMuted = sound.toggleMute();
  }

  setMusicVolume(val: number) {
    this.musicVolume = val;
    sound.setVolume(val);
  }

  setSfxVolume(val: number) {
    this.sfxVolume = val;
    sound.setSfxVolume(val);
  }

  setTrack(trackId: string) {
    this.selectedTrack = trackId;
    sound.setTrack(trackId);
    this.isMusicPlaying = sound.getIsPlaying();
  }
}

export const ui = new UiState();
