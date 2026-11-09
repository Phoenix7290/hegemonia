// Hegemonia Grand Strategy Audio Engine (Web Audio API + Custom MP3 Player + Independent SFX/Music Equalizer)
// HEGEM-93: Tactical SFX Audio Engine with HOI4 Cues, ReplayGain & Broadcast Limiter Dynamics

export interface ReplayGainEntry {
  category: "combat" | "turn" | "economy" | "global" | "ui" | "music";
  targetLufs: number;
  gainDb: number;
}

export const REPLAY_GAIN_CONFIG: Record<string, ReplayGainEntry> = {
  offensive_order: { category: "combat", targetLufs: -16, gainDb: -2.0 },
  defensive_alarm: { category: "combat", targetLufs: -14, gainDb: -1.5 },
  infantry: { category: "combat", targetLufs: -16, gainDb: -2.0 },
  tank: { category: "combat", targetLufs: -15, gainDb: -1.5 },
  artillery: { category: "combat", targetLufs: -15, gainDb: -1.5 },
  aircraft: { category: "combat", targetLufs: -16, gainDb: -2.0 },
  navy: { category: "combat", targetLufs: -15, gainDb: -1.5 },
  turn_radio: { category: "turn", targetLufs: -13, gainDb: -1.0 },
  turn_chime: { category: "turn", targetLufs: -15, gainDb: -3.0 },
  market_sell: { category: "economy", targetLufs: -18, gainDb: -3.0 },
  market_buy: { category: "economy", targetLufs: -16, gainDb: -2.0 },
  treaty_broken: { category: "global", targetLufs: -14, gainDb: -1.5 },
  defcon1_crisis: { category: "global", targetLufs: -12, gainDb: -1.0 },
  faction_eliminated: { category: "global", targetLufs: -16, gainDb: -2.0 },
  victory_match: { category: "global", targetLufs: -14, gainDb: -1.5 },
  click: { category: "ui", targetLufs: -20, gainDb: -6.0 },
  dice: { category: "ui", targetLufs: -18, gainDb: -3.0 },
  conquest: { category: "ui", targetLufs: -15, gainDb: -3.0 },
  music: { category: "music", targetLufs: -18, gainDb: -4.0 },
};

export const SFX_ASSET_PATHS: Record<string, string[]> = {
  offensive_order: ["/sfx/combat/offensive_order.mp3", "/sfx/combat/offensive_order.wav"],
  defensive_alarm: ["/sfx/combat/defensive_alarm.mp3", "/sfx/combat/defensive_alarm.wav"],
  infantry: ["/sfx/combat/infantry_rifle.mp3", "/sfx/combat/infantry_rifle.wav"],
  tank: ["/sfx/combat/armor_cannon.mp3", "/sfx/combat/armor_cannon.wav"],
  artillery: ["/sfx/combat/artillery_barrage.mp3", "/sfx/combat/artillery_barrage.wav"],
  aircraft: ["/sfx/combat/aircraft_strike.mp3", "/sfx/combat/aircraft_strike.wav"],
  navy: ["/sfx/combat/naval_salvo.mp3", "/sfx/combat/naval_salvo.wav"],
  turn_radio: ["/sfx/turn/turn_start_radio.mp3", "/sfx/turn/turn_start_radio.wav"],
  turn_chime: ["/sfx/turn/turn_chime.mp3", "/sfx/turn/turn_chime.wav"],
  market_sell: ["/sfx/economy/market_sell_coins.mp3", "/sfx/economy/market_sell_coins.wav"],
  market_buy: ["/sfx/economy/market_buy_cargo.mp3", "/sfx/economy/market_buy_cargo.wav"],
  treaty_broken: ["/sfx/global/treaty_broken.mp3", "/sfx/global/treaty_broken.wav"],
  defcon1_crisis: ["/sfx/global/defcon1_crisis.mp3", "/sfx/global/defcon1_crisis.wav"],
  faction_eliminated: ["/sfx/global/faction_eliminated.mp3", "/sfx/global/faction_eliminated.wav"],
  victory_match: ["/sfx/global/victory_match.mp3", "/sfx/global/victory_match.wav"],
  click: ["/sfx/ui/click.mp3", "/sfx/ui/click.wav"],
  dice: ["/sfx/ui/dice.mp3", "/sfx/ui/dice.wav"],
  conquest: ["/sfx/ui/conquest.mp3", "/sfx/ui/conquest.wav"],
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private isMusicPlaying = false;
  private isMuted = false;
  private volume = 0.5;
  private sfxVolume = 0.7;
  private currentTrack = "ambient_procedural";
  private audioEl: HTMLAudioElement | null = null;
  private musicInterval: number | null = null;
  private sfxBuffers: Record<string, AudioBuffer> = {};
  private sfxLoading = false;

  constructor() {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const savedVol = localStorage.getItem("hegemonia_music_volume");
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol);
        if (!Number.isNaN(parsed)) this.volume = Math.max(0, Math.min(1, parsed));
      }
      const savedSfx = localStorage.getItem("hegemonia_sfx_volume");
      if (savedSfx !== null) {
        const parsed = parseFloat(savedSfx);
        if (!Number.isNaN(parsed)) this.sfxVolume = Math.max(0, Math.min(1, parsed));
      }
      const savedMuted = localStorage.getItem("hegemonia_audio_muted");
      if (savedMuted !== null) {
        this.isMuted = savedMuted === "true";
      }
      const savedTrack = localStorage.getItem("hegemonia_music_track");
      if (savedTrack) this.currentTrack = savedTrack;
    }
  }

  private initContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Studio Broadcast Dynamics Compressor / Limiter
      // Protects master bus from volume spikes and ensures zero digital clipping
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.masterLimiter.knee.setValueAtTime(10, this.ctx.currentTime);
      this.masterLimiter.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.masterLimiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.masterLimiter.release.setValueAtTime(0.15, this.ctx.currentTime);
      this.masterLimiter.connect(this.ctx.destination);

      // Music Master Bus
      this.musicGain = this.ctx.createGain();
      const musicLinear = (this.isMuted ? 0 : this.volume) * Math.pow(10, REPLAY_GAIN_CONFIG.music.gainDb / 20);
      this.musicGain.gain.setValueAtTime(musicLinear, this.ctx.currentTime);
      this.musicGain.connect(this.masterLimiter);

      // Tactical SFX Master Bus
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : this.sfxVolume, this.ctx.currentTime);
      this.sfxGain.connect(this.masterLimiter);

      void this.loadSfxFiles();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  private async loadSfxFiles() {
    if (!this.ctx || this.sfxLoading) return;
    this.sfxLoading = true;

    for (const [key, paths] of Object.entries(SFX_ASSET_PATHS)) {
      if (this.sfxBuffers[key]) continue;
      for (const url of paths) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            this.sfxBuffers[key] = await this.ctx.decodeAudioData(arr);
            break; // Successfully loaded primary format
          }
        } catch {
          // Fallback to next path or procedural Web Audio synthesis
        }
      }
    }
  }

  private playBuffer(key: string, gainMultiplier = 1.0): boolean {
    if (!this.ctx || !this.sfxGain || !this.sfxBuffers[key] || this.isMuted || this.sfxVolume <= 0) {
      return false;
    }
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.sfxBuffers[key];

      const nodeGain = this.ctx.createGain();
      const calib = REPLAY_GAIN_CONFIG[key]?.gainDb ?? 0;
      const linearGain = Math.pow(10, calib / 20) * gainMultiplier;
      nodeGain.gain.setValueAtTime(linearGain, this.ctx.currentTime);

      src.connect(nodeGain);
      nodeGain.connect(this.sfxGain);
      src.start();
      return true;
    } catch {
      return false;
    }
  }

  private applyGains() {
    const effectiveMusic = this.isMuted ? 0 : this.volume;
    const effectiveSfx = this.isMuted ? 0 : this.sfxVolume;

    if (this.musicGain && this.ctx) {
      const musicLinear = effectiveMusic * Math.pow(10, REPLAY_GAIN_CONFIG.music.gainDb / 20);
      this.musicGain.gain.setValueAtTime(musicLinear, this.ctx.currentTime);
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(effectiveSfx, this.ctx.currentTime);
    }
    if (this.audioEl) {
      this.audioEl.volume = effectiveMusic;
      this.audioEl.muted = this.isMuted;
    }
  }

  // =========================================================================
  // HEGEM-93: Diferenciação Ofensiva vs Defensiva
  // =========================================================================

  /**
   * Ordem de Avanço Tático (Ofensiva):
   * Disparo sonoro militar com fanfarra clarim e rufar de marcha ao iniciar ofensiva.
   */
  public playOffensiveOrder() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("offensive_order")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    [0.0, 0.07, 0.14].forEach((hitT) => {
      const t = now + hitT;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.05);
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.06);
    });

    const notes = [
      { t: 0.28, dur: 0.22, f: 466.16 },
      { t: 0.52, dur: 0.22, f: 587.33 },
      { t: 0.76, dur: 0.65, f: 698.46 },
    ];
    notes.forEach((n) => {
      const t = now + n.t;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(n.f, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.dur);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + n.dur);
    });
  }

  /**
   * Sirene de Combate / Alarme de Invasão (Defensiva):
   * Disparo acústico urgente com sirene de ataque aéreo quando território do jogador é alvo.
   */
  public playDefensiveAlarm() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("defensive_alarm")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "triangle";
    subOsc.type = "sine";

    osc1.frequency.setValueAtTime(460, now);
    osc1.frequency.linearRampToValueAtTime(840, now + 0.45);
    osc1.frequency.linearRampToValueAtTime(460, now + 0.9);
    osc1.frequency.linearRampToValueAtTime(840, now + 1.35);
    osc1.frequency.linearRampToValueAtTime(460, now + 1.8);

    osc2.frequency.setValueAtTime(490, now);
    osc2.frequency.linearRampToValueAtTime(890, now + 0.45);
    osc2.frequency.linearRampToValueAtTime(490, now + 0.9);
    osc2.frequency.linearRampToValueAtTime(890, now + 1.35);
    osc2.frequency.linearRampToValueAtTime(490, now + 1.8);

    subOsc.frequency.setValueAtTime(55, now);

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.35, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.9);

    osc1.connect(g);
    osc2.connect(g);
    subOsc.connect(g);
    g.connect(this.sfxGain);

    osc1.start(now);
    osc2.start(now);
    subOsc.start(now);
    osc1.stop(now + 1.95);
    osc2.stop(now + 1.95);
    subOsc.stop(now + 1.95);
  }

  // =========================================================================
  // HEGEM-93: SFX Dedicado por Categoria de Tropa
  // =========================================================================

  /**
   * Infantaria: Fuzilaria tática e estalos de rifle.
   */
  public playInfantryRifle() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("infantry")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    [0.0, 0.16, 0.34].forEach((st) => {
      const t = now + st;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.09);
    });
  }

  /**
   * Blindados: Esteiras de aço e detonação de canhão 88mm pesado.
   */
  public playArmorCannon() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("tank")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const squeal = this.ctx.createOscillator();
    const sqGain = this.ctx.createGain();
    squeal.type = "triangle";
    squeal.frequency.setValueAtTime(1600, now);
    squeal.frequency.linearRampToValueAtTime(1900, now + 0.12);
    sqGain.gain.setValueAtTime(0.12, now);
    sqGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    squeal.connect(sqGain);
    sqGain.connect(this.sfxGain);
    squeal.start(now);
    squeal.stop(now + 0.15);

    const cannonT = now + 0.1;
    const boom = this.ctx.createOscillator();
    const boomGain = this.ctx.createGain();
    boom.type = "sawtooth";
    boom.frequency.setValueAtTime(110, cannonT);
    boom.frequency.exponentialRampToValueAtTime(28, cannonT + 0.5);
    boomGain.gain.setValueAtTime(0.55, cannonT);
    boomGain.gain.exponentialRampToValueAtTime(0.001, cannonT + 0.55);
    boom.connect(boomGain);
    boomGain.connect(this.sfxGain);
    boom.start(cannonT);
    boom.stop(cannonT + 0.55);
  }

  /**
   * Artilharia: Barragem pesada de obuseiros distantes com eco reverberante.
   */
  public playArtilleryBarrage() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("artillery")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    [0.05, 0.45, 0.85].forEach((st) => {
      const t = now + st;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(65, t);
      osc.frequency.exponentialRampToValueAtTime(26, t + 0.65);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  }

  /**
   * Aeronaves: Rasante aéreo cortante (Stuka dive / fighter pass) e detonação de bombas.
   */
  public playAircraftStrike() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("aircraft")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const dive = this.ctx.createOscillator();
    const diveGain = this.ctx.createGain();
    dive.type = "sawtooth";
    dive.frequency.setValueAtTime(950, now);
    dive.frequency.exponentialRampToValueAtTime(320, now + 0.6);
    diveGain.gain.setValueAtTime(0.001, now);
    diveGain.gain.linearRampToValueAtTime(0.35, now + 0.3);
    diveGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    dive.connect(diveGain);
    diveGain.connect(this.sfxGain);
    dive.start(now);
    dive.stop(now + 0.65);

    const bombT = now + 0.55;
    const bomb = this.ctx.createOscillator();
    const bombGain = this.ctx.createGain();
    bomb.type = "sawtooth";
    bomb.frequency.setValueAtTime(140, bombT);
    bomb.frequency.exponentialRampToValueAtTime(32, bombT + 0.7);
    bombGain.gain.setValueAtTime(0.5, bombT);
    bombGain.gain.exponentialRampToValueAtTime(0.001, bombT + 0.75);
    bomb.connect(bombGain);
    bombGain.connect(this.sfxGain);
    bomb.start(bombT);
    bomb.stop(bombT + 0.75);
  }

  /**
   * Marinha: Apito náutico / corneta naval seguida de salvas pesadas de encouraçado.
   */
  public playNavalSalvo() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("navy")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const whistle = this.ctx.createOscillator();
    const wGain = this.ctx.createGain();
    whistle.type = "sine";
    whistle.frequency.setValueAtTime(174.61, now);
    whistle.frequency.linearRampToValueAtTime(220.0, now + 0.35);
    wGain.gain.setValueAtTime(0.001, now);
    wGain.gain.linearRampToValueAtTime(0.28, now + 0.08);
    wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    whistle.connect(wGain);
    wGain.connect(this.sfxGain);
    whistle.start(now);
    whistle.stop(now + 0.4);

    const salvoT = now + 0.35;
    const salvo = this.ctx.createOscillator();
    const salvoGain = this.ctx.createGain();
    salvo.type = "sawtooth";
    salvo.frequency.setValueAtTime(80, salvoT);
    salvo.frequency.exponentialRampToValueAtTime(24, salvoT + 0.85);
    salvoGain.gain.setValueAtTime(0.6, salvoT);
    salvoGain.gain.exponentialRampToValueAtTime(0.001, salvoT + 0.9);
    salvo.connect(salvoGain);
    salvoGain.connect(this.sfxGain);
    salvo.start(salvoT);
    salvo.stop(salvoT + 0.9);
  }

  /**
   * Helper unificado para disparar o SFX correspondente à tropa engajada.
   */
  public playTroopCombat(category?: string | null) {
    const cat = category?.toLowerCase().trim();
    if (!cat) {
      this.playInfantryRifle();
      return;
    }
    if (cat.includes("infant") || cat === "soldier" || cat === "milicia") {
      this.playInfantryRifle();
    } else if (cat.includes("blind") || cat.includes("tank") || cat.includes("armor")) {
      this.playArmorCannon();
    } else if (cat.includes("artil") || cat.includes("howitzer") || cat.includes("obuseiro")) {
      this.playArtilleryBarrage();
    } else if (cat.includes("aero") || cat.includes("air") || cat.includes("aviao") || cat.includes("plane")) {
      this.playAircraftStrike();
    } else if (cat.includes("nav") || cat.includes("mar") || cat.includes("ship") || cat.includes("fleet")) {
      this.playNavalSalvo();
    } else {
      this.playInfantryRifle();
    }
  }

  // =========================================================================
  // HEGEM-93: Alerta de Início de Turno (Rádio Militar)
  // =========================================================================

  /**
   * Rádio Militar / Toque Tático de Início de Turno:
   * Alerta sonoro proeminente para notificar o jogador imediatamente, inclusive em background tab.
   */
  public playTurnRadioAlert() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("turn_radio")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const staticOsc = this.ctx.createOscillator();
    const staticGain = this.ctx.createGain();
    staticOsc.type = "sawtooth";
    staticOsc.frequency.setValueAtTime(3200, now);
    staticOsc.frequency.linearRampToValueAtTime(450, now + 0.05);
    staticGain.gain.setValueAtTime(0.2, now);
    staticGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    staticOsc.connect(staticGain);
    staticGain.connect(this.sfxGain);
    staticOsc.start(now);
    staticOsc.stop(now + 0.06);

    const ping1T = now + 0.06;
    const ping1 = this.ctx.createOscillator();
    const p1Gain = this.ctx.createGain();
    ping1.type = "sine";
    ping1.frequency.setValueAtTime(880, ping1T);
    p1Gain.gain.setValueAtTime(0.001, ping1T);
    p1Gain.gain.linearRampToValueAtTime(0.35, ping1T + 0.02);
    p1Gain.gain.exponentialRampToValueAtTime(0.001, ping1T + 0.14);
    ping1.connect(p1Gain);
    p1Gain.connect(this.sfxGain);
    ping1.start(ping1T);
    ping1.stop(ping1T + 0.14);

    const ping2T = now + 0.16;
    const ping2 = this.ctx.createOscillator();
    const p2Gain = this.ctx.createGain();
    ping2.type = "sine";
    ping2.frequency.setValueAtTime(1318.51, ping2T);
    p2Gain.gain.setValueAtTime(0.001, ping2T);
    p2Gain.gain.linearRampToValueAtTime(0.4, ping2T + 0.02);
    p2Gain.gain.exponentialRampToValueAtTime(0.001, ping2T + 0.35);
    ping2.connect(p2Gain);
    p2Gain.connect(this.sfxGain);
    ping2.start(ping2T);
    ping2.stop(ping2T + 0.35);
  }

  // =========================================================================
  // HEGEM-93: Mercado & Economia
  // =========================================================================

  /**
   * Venda de Commodities: Tilintar cristalino de moedas/metais preciosos.
   */
  public playMarketSell() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("market_sell")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    [
      { f: 2489.02, t: 0.0 },
      { f: 3135.96, t: 0.06 },
      { f: 3729.31, t: 0.14 },
    ].forEach((coin) => {
      const t = now + coin.t;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(coin.f, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /**
   * Compra de Insumos: Estivamento e baque seco de caixas/contêineres de suprimentos.
   */
  public playMarketBuy() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("market_buy")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    g.gain.setValueAtTime(0.45, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // =========================================================================
  // HEGEM-93: Gatilhos Globais Dramáticos
  // =========================================================================

  /**
   * Quebra de Tratados / Traição Diplomática:
   * Acorde fúnebre tenso e gongo marcial sombrio.
   */
  public playTreatyBroken() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("treaty_broken")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(116.54, now); // Bb2
    osc2.frequency.setValueAtTime(123.47, now); // B2 (Minor 2nd dissonance)

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.4, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    osc1.connect(g);
    osc2.connect(g);
    g.connect(this.sfxGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.65);
    osc2.stop(now + 1.65);
  }

  /**
   * Subida para Defcon 1 na Tensão Mundial:
   * Alerta acústico estratégico de crise geopolítica global iminente.
   */
  public playDefcon1Alert() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("defcon1_crisis")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    [0.0, 0.45, 0.9, 1.35].forEach((pulseT) => {
      const t = now + pulseT;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(740, t);
      osc.frequency.linearRampToValueAtTime(520, t + 0.35);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /**
   * Rendição / Eliminação de Facção:
   * Toque marcial fúnebre e solene marcando a queda de um império.
   */
  public playFactionEliminated() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("faction_eliminated")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const notes = [
      { f: 196.0, dur: 0.4, t: 0.0 },   // G3
      { f: 164.81, dur: 0.4, t: 0.45 }, // E3
      { f: 130.81, dur: 0.9, t: 0.9 },  // C3
    ];
    notes.forEach((n) => {
      const t = now + n.t;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(n.f, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.dur);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + n.dur);
    });
  }

  /**
   * Triunfo Supremo / Hegemonia Alcançada (Vitória na Partida):
   * Fanfarra triunfal solene de metais e glória militar no encerramento da partida.
   */
  public playVictoryMatch() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("victory_match")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const notes = [
      { f: 293.66, dur: 0.22, t: 0.0 },   // D4
      { f: 369.99, dur: 0.22, t: 0.2 },   // F#4
      { f: 440.00, dur: 0.28, t: 0.4 },   // A4
      { f: 587.33, dur: 1.80, t: 0.65 },  // D5 (triunfo sustentado)
      { f: 440.00, dur: 1.80, t: 0.65 },  // A4 (harmonia de apoio)
      { f: 369.99, dur: 1.80, t: 0.65 },  // F#4 (harmonia de apoio)
    ];

    notes.forEach((n) => {
      const t = now + n.t;
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(n.f, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.dur);
      osc.connect(g);
      g.connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + n.dur);
    });
  }

  public playVictory() {
    this.playVictoryMatch();
  }

  // =========================================================================
  // Core UI & Gameplay Cues (Click, Dice, Conquest, Turn Chime)
  // =========================================================================

  public playClick() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("click")) return;
    if (!this.ctx || !this.sfxGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  public playCommsNotification() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(740, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(520, this.ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.12);
  }

  public playDice() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("dice")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const time = now + i * 0.06;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(200 + Math.random() * 300, time);
      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(time);
      osc.stop(time + 0.04);
    }
  }

  public playCombat() {
    this.playTroopCombat("infantry");
  }

  public playCombatAttack() {
    this.playTroopCombat("infantry");
  }

  public playDiceRoll() {
    this.playDice();
  }

  public playTurnChime() {
    this.playTurn();
  }

  public playConquest() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("conquest")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const time = now + idx * 0.08;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(time);
      osc.stop(time + 0.25);
    });
  }

  public playTurn() {
    if (this.isMuted || this.sfxVolume <= 0) return;
    this.initContext();
    if (this.playBuffer("turn_chime")) return;
    if (!this.ctx || !this.sfxGain) return;

    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      const time = now + idx * 0.05;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(time);
      osc.stop(time + 0.18);
    });
  }

  // =========================================================================
  // Music & Volume Controls
  // =========================================================================

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("hegemonia_audio_muted", String(this.isMuted));
    }
    this.applyGains();
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("hegemonia_audio_muted", String(this.isMuted));
    }
    this.applyGains();
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("hegemonia_music_volume", String(this.volume));
    }
    this.applyGains();
  }

  public getVolume(): number {
    return this.volume;
  }

  public setSfxVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("hegemonia_sfx_volume", String(this.sfxVolume));
    }
    this.applyGains();
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public setTrack(trackId: string) {
    this.currentTrack = trackId;
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem("hegemonia_music_track", trackId);
    }
    if (this.isMusicPlaying) {
      this.playMusic();
    }
  }

  public getTrack(): string {
    return this.currentTrack;
  }

  public getCurrentTrack(): string {
    return this.currentTrack;
  }

  public playMusic() {
    this.initContext();
    this.stopMusic();
    this.isMusicPlaying = true;

    if (this.currentTrack === "ambient_procedural") {
      this.startProceduralAmbient();
      return;
    }

    const trackPath = `/music/${this.currentTrack}.mp3`;
    this.audioEl = new Audio(trackPath);
    this.audioEl.loop = true;
    this.audioEl.volume = this.isMuted ? 0 : this.volume;
    this.audioEl.play().catch(() => {
      this.startProceduralAmbient();
    });
  }

  public stopMusic() {
    this.isMusicPlaying = false;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  public toggleMusic(): boolean {
    if (this.isMusicPlaying) {
      this.stopMusic();
    } else {
      this.playMusic();
    }
    return this.isMusicPlaying;
  }

  public getIsMusicPlaying(): boolean {
    return this.isMusicPlaying;
  }

  public getIsPlaying(): boolean {
    return this.isMusicPlaying;
  }

  private startProceduralAmbient() {
    if (!this.ctx || !this.musicGain) return;

    const playDrone = () => {
      if (!this.ctx || !this.musicGain || !this.isMusicPlaying) return;
      const baseFreqs = [55, 65.41, 73.42, 82.41]; // A1, C2, D2, E2
      const chosen = baseFreqs[Math.floor(Math.random() * baseFreqs.length)];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(chosen, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 3);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 10);

      osc.connect(gain);
      gain.connect(this.musicGain);

      osc.start();
      osc.stop(this.ctx.currentTime + 10);
    };

    playDrone();
    this.musicInterval = window.setInterval(playDrone, 7000);
  }
}

export const sound = new SoundEngine();
