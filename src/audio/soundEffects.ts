/**
 * Procedural WebAudio synthesizer for Dao Den Long (Phase 2).
 * Includes an ambient night pentatonic music loop + all gameplay sound effects.
 * Autoplay-safe: AudioContext is created/resumed only after the first user gesture.
 */
export class SoundEffects {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private volume = 0.7;
  private muted = false;
  private musicDucked = false;
  private musicTimerId: number | null = null;
  private musicStep = 0;
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  // Vietnamese/East-Asian pentatonic scale (D minor pentatonic: D4, F4, G4, A4, C5, D5, F5)
  private readonly melodyNotes = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 440.0, 392.0];

  public unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicDucked ? 0.14 : 0.28;
      this.musicGain.connect(this.masterGain);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      this.startNightMusic();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.min(1, Math.max(0, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.02
      );
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMusicDucked(ducked: boolean): void {
    this.musicDucked = ducked;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(ducked ? 0.12 : 0.28, this.ctx.currentTime, 0.15);
    }
  }

  public dispose(): void {
    if (this.musicTimerId !== null) {
      window.clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
    if (this.droneOsc) {
      try {
        this.droneOsc.stop();
      } catch {
        // Ignore already stopped
      }
      this.droneOsc = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private getReadyContext(): { ctx: AudioContext; out: GainNode } | null {
    if (this.muted || this.volume <= 0.001 || !this.ctx || !this.masterGain) {
      return null;
    }
    if (this.ctx.state !== "running") {
      return null;
    }
    return { ctx: this.ctx, out: this.masterGain };
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private startNightMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimerId !== null) return;

    // Warm low night drone (D2 = 73.42 Hz)
    const drone = this.ctx.createOscillator();
    const droneFilter = this.ctx.createBiquadFilter();
    const dGain = this.ctx.createGain();
    drone.type = "triangle";
    drone.frequency.value = 73.42;
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 180;
    dGain.gain.value = 0.12;
    drone.connect(droneFilter);
    droneFilter.connect(dGain);
    dGain.connect(this.musicGain);
    drone.start();
    this.droneOsc = drone;
    this.droneGain = dGain;

    // Gentle pentatonic chime phrase every 1.4s
    const playMusicNote = (): void => {
      if (!this.ctx || !this.musicGain || this.ctx.state !== "running") return;
      if (this.muted || this.volume <= 0.001) return;

      const now = this.ctx.currentTime;
      const step = this.musicStep++;
      // Leave breathing room on some beats
      if (step % 4 === 3) return;

      const idx = (step * 3 + (step >> 2)) % this.melodyNotes.length;
      const freq = this.melodyNotes[idx];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0005, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.25);

      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start(now);
      osc.stop(now + 1.3);

      // Soft fifth harmony on phrase start
      if (step % 8 === 0) {
        const pad = this.ctx.createOscillator();
        const padGain = this.ctx.createGain();
        pad.type = "triangle";
        pad.frequency.setValueAtTime(146.83, now); // D3
        padGain.gain.setValueAtTime(0.0005, now);
        padGain.gain.linearRampToValueAtTime(0.06, now + 0.4);
        padGain.gain.exponentialRampToValueAtTime(0.0005, now + 2.4);
        pad.connect(padGain);
        padGain.connect(this.musicGain);
        pad.start(now);
        pad.stop(now + 2.45);
      }
    };

    this.musicTimerId = window.setInterval(playMusicNote, 1400);
  }

  public playPickup(carried: number): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const baseFreq = 500 + Math.min(carried, 10) * 48;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.22);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.23);
  }

  public playCharmPickup(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const notes = [587.33, 783.99, 1046.5, 1174.66];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.13, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.38);

      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  public playDeposit(deposited: number): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const freq = 320 + Math.min(deposited, 10) * 32;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.18);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  public playLanternLit(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const notes = [392.0, 493.88, 587.33, 783.99];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.15, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.48);

      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  }

  public playPulse(stunnedCount: number): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.34);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.19, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.36);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.38);

    if (stunnedCount > 0) {
      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = "triangle";
      chime.frequency.setValueAtTime(880, now + 0.06);
      chime.frequency.exponentialRampToValueAtTime(660, now + 0.28);

      chimeGain.gain.setValueAtTime(0.001, now + 0.06);
      chimeGain.gain.linearRampToValueAtTime(0.12, now + 0.09);
      chimeGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.3);

      chime.connect(chimeGain);
      chimeGain.connect(out);
      chime.start(now + 0.06);
      chime.stop(now + 0.32);
    }
  }

  public playHit(by: "shade" | "fall" = "shade"): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = by === "fall" ? "triangle" : "sawtooth";
    osc.frequency.setValueAtTime(by === "fall" ? 260 : 170, now);
    osc.frequency.exponentialRampToValueAtTime(by === "fall" ? 55 : 62, now + 0.3);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.32);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  public playJump(isJumpPad = false): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isJumpPad ? 220 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(isJumpPad ? 780 : 480, now + (isJumpPad ? 0.24 : 0.13));

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(isJumpPad ? 0.16 : 0.11, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + (isJumpPad ? 0.28 : 0.16));

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + (isJumpPad ? 0.3 : 0.18));
  }

  public playDash(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.18);
      filter.Q.value = 1.6;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.2);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      src.start(now);
      src.stop(now + 0.22);
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.18);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playShadeSpawn(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(138, now + 0.25);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.5);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.52);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.55);
  }

  public playDrifterSteal(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.24);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.26);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  public playDrifterDrop(): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const notes = [659.25, 783.99, 987.77];
    notes.forEach((f, i) => {
      const start = now + i * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.22);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  public playWindWarning(): void {
    const ready = this.getReadyContext();
    if (!ready || !this.noiseBuffer) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(360, now);
    filter.frequency.exponentialRampToValueAtTime(920, now + 0.8);
    filter.frequency.exponentialRampToValueAtTime(420, now + 1.4);
    filter.Q.value = 3.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.45);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(now);
    src.stop(now + 1.48);
  }

  public playCountdownTick(secondsLeft: number): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const urgent = secondsLeft <= 3;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(urgent ? 980 : 740, now);
    osc.frequency.exponentialRampToValueAtTime(urgent ? 640 : 520, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(urgent ? 0.16 : 0.11, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playGameOver(won: boolean): void {
    const ready = this.getReadyContext();
    if (!ready) return;
    const { ctx, out } = ready;

    const now = ctx.currentTime;
    const notes = won ? [440, 554.37, 659.25, 880] : [293.66, 261.63, 220, 174.61];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = won ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0008, start + 0.52);

      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }
}
