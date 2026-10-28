// Hegemonia Grand Strategy Audio Engine (Web Audio API + Custom MP3 Player)

class SoundEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private isMusicPlaying = false;
  private volume = 0.5;
  private sfxVolume = 0.7;
  private isMuted = false;
  private currentTrack = "ambient_procedural";
  private audioEl: HTMLAudioElement | null = null;
  private musicInterval: number | null = null;
  private sfxBuffers: Record<string, AudioBuffer> = {};
  private sfxLoading = false;

  constructor() {
    if (typeof window !== "undefined") {
      const savedVol = localStorage.getItem("hegemonia_music_volume");
      if (savedVol !== null) this.volume = parseFloat(savedVol);
      const savedSfxVol = localStorage.getItem("hegemonia_sfx_volume");
      if (savedSfxVol !== null) this.sfxVolume = parseFloat(savedSfxVol);
      const savedMuted = localStorage.getItem("hegemonia_muted");
      if (savedMuted !== null) this.isMuted = savedMuted === "true";
      const savedTrack = localStorage.getItem("hegemonia_music_track");
      if (savedTrack) this.currentTrack = savedTrack;
    }
  }

  private initContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.isMuted ? 0 : this.volume;
      this.musicGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.isMuted ? 0 : this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);

      this.loadSfxFiles();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  private async loadSfxFiles() {
    if (!this.ctx || this.sfxLoading) return;
    this.sfxLoading = true;
    const sfxList: Record<string, string> = {
      dice: "/sfx/sfx_dice.mp3",
      combat: "/sfx/sfx_combat.mp3",
      conquest: "/sfx/sfx_conquest.mp3",
      turn: "/sfx/sfx_turn.mp3",
    };
    for (const [key, url] of Object.entries(sfxList)) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const arr = await resp.arrayBuffer();
          this.sfxBuffers[key] = await this.ctx.decodeAudioData(arr);
        }
      } catch {
        // Fallback to Web Audio synthesis if local audio unavailable
      }
    }
  }

  private playBuffer(key: string): boolean {
    if (!this.ctx || !this.sfxGain || !this.sfxBuffers[key] || this.isMuted) return false;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sfxBuffers[key];
      src.connect(this.sfxGain);
      src.start();
      return true;
    } catch {
      return false;
    }
  }

  // --- Sound Effects ---
  public playClick() {
    this.initContext();
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.04);
    g.gain.setValueAtTime(0.15, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }

  public playDiceRoll() {
    this.initContext();
    if (this.playBuffer("dice")) return;
    if (!this.ctx || !this.sfxGain) return;
    // Fallback: Rattle of 4 clicks
    for (let i = 0; i < 4; i++) {
      const time = this.ctx.currentTime + i * 0.06;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(250 + Math.random() * 300, time);
      g.gain.setValueAtTime(0.2, time);
      g.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(time);
      osc.stop(time + 0.05);
    }
  }

  public playCombatAttack() {
    this.initContext();
    if (this.playBuffer("combat")) return;
    if (!this.ctx || !this.sfxGain) return;
    // Fallback: Heavy artillery thud
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.3, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  public playConquest() {
    this.initContext();
    if (this.playBuffer("conquest")) return;
    if (!this.ctx || !this.sfxGain) return;
    // Fallback: Triumphant rising two-tone horn
    const chord = [330, 440, 554];
    chord.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, this.ctx!.currentTime + idx * 0.08);
      g.gain.setValueAtTime(0.12, this.ctx!.currentTime + idx * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + idx * 0.08 + 0.4);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(this.ctx!.currentTime + idx * 0.08);
      osc.stop(this.ctx!.currentTime + idx * 0.08 + 0.45);
    });
  }

  public playTurnChime() {
    this.initContext();
    if (this.playBuffer("turn")) return;
    if (!this.ctx || !this.sfxGain) return;
    // Fallback: 3-tone arpeggio
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.12); // E5
    osc.frequency.setValueAtTime(783.99, this.ctx.currentTime + 0.24); // G5
    g.gain.setValueAtTime(0.25, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.6);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.6);
  }

  // --- Procedural Grand Strategy Ambient Music ---
  private startProceduralMusic() {
    if (!this.ctx || !this.musicGain) return;
    const chords = [
      [110, 164.81, 220], // A minor
      [98, 146.83, 196],  // G major
      [87.31, 130.81, 174.61], // F major
      [82.41, 123.47, 164.81], // E minor
    ];
    let chordIdx = 0;

    const playChord = () => {
      if (!this.isMusicPlaying || this.currentTrack !== "ambient_procedural" || !this.ctx || !this.musicGain) return;
      const notes = chords[chordIdx % chords.length];
      chordIdx++;

      notes.forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        const filter = this.ctx!.createBiquadFilter();
        const g = this.ctx!.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, this.ctx!.currentTime);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(450, this.ctx!.currentTime);

        g.gain.setValueAtTime(0.001, this.ctx!.currentTime);
        g.gain.linearRampToValueAtTime(0.04 * this.volume, this.ctx!.currentTime + 2.5);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + 7.5);

        osc.connect(filter);
        filter.connect(g);
        g.connect(this.musicGain!);

        osc.start();
        osc.stop(this.ctx!.currentTime + 8);
      });
    };

    playChord();
    this.musicInterval = window.setInterval(playChord, 7000);
  }

  // --- Track & Playback Controls ---
  public toggleMusic(): boolean {
    this.initContext();
    this.isMusicPlaying = !this.isMusicPlaying;

    if (this.isMusicPlaying) {
      if (this.currentTrack === "ambient_procedural") {
        this.startProceduralMusic();
      } else {
        this.playCustomFile(this.currentTrack);
      }
    } else {
      this.stopMusic();
    }
    return this.isMusicPlaying;
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.musicGain && this.ctx && !this.isMuted) {
      this.musicGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
    if (this.audioEl) {
      this.audioEl.volume = this.isMuted ? 0 : this.volume;
    }
    localStorage.setItem("hegemonia_music_volume", this.volume.toString());
  }

  public getVolume(): number {
    return this.volume;
  }

  public setSfxVolume(val: number) {
    this.sfxVolume = Math.max(0, Math.min(1, val));
    if (this.sfxGain && this.ctx && !this.isMuted) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
    localStorage.setItem("hegemonia_sfx_volume", this.sfxVolume.toString());
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public toggleMute(): boolean {
    this.initContext();
    this.isMuted = !this.isMuted;
    const effectiveMusic = this.isMuted ? 0 : this.volume;
    const effectiveSfx = this.isMuted ? 0 : this.sfxVolume;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(effectiveMusic, this.ctx.currentTime);
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(effectiveSfx, this.ctx.currentTime);
    }
    if (this.audioEl) {
      this.audioEl.volume = effectiveMusic;
    }
    localStorage.setItem("hegemonia_muted", this.isMuted.toString());
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getIsPlaying(): boolean {
    return this.isMusicPlaying;
  }

  public getCurrentTrack(): string {
    return this.currentTrack;
  }

  public setTrack(trackId: string) {
    this.currentTrack = trackId;
    localStorage.setItem("hegemonia_music_track", trackId);
    if (this.isMusicPlaying) {
      this.stopMusic();
      this.isMusicPlaying = true;
      if (trackId === "ambient_procedural") {
        this.startProceduralMusic();
      } else {
        this.playCustomFile(trackId);
      }
    }
  }

  private playCustomFile(fileName: string) {
    if (!this.audioEl) {
      this.audioEl = new Audio(`/music/${fileName}`);
      this.audioEl.loop = true;
    } else {
      this.audioEl.src = `/music/${fileName}`;
    }
    this.audioEl.volume = this.volume;
    this.audioEl.play().catch(() => {
      // Fallback to procedural if file missing
      this.currentTrack = "ambient_procedural";
      this.startProceduralMusic();
    });
  }

  public stopMusic() {
    this.isMusicPlaying = false;
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
    }
  }
}

export const sound = new SoundEngine();
