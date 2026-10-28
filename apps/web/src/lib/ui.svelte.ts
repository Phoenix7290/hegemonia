import { sound } from "../audio";

class UiState {
  inActiveBattle = $state(false);
  isMusicPlaying = $state(sound.getIsPlaying());
  isMuted = $state(sound.getIsMuted());
  musicVolume = $state(sound.getVolume());
  sfxVolume = $state(sound.getSfxVolume());
  selectedTrack = $state(sound.getCurrentTrack());

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
