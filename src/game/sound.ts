/**
 * Web Audio API Sound FX & Adaptive SCP-3008 Infinite IKEA Soundtrack
 * Day: Cheerful Swedish department-store Showroom Muzak (Fmaj7 -> Dm7 -> Bbmaj7 -> C7)
 * Night: Slowed, detuned eerie PA-speaker horror music-box + fluorescent HVAC sub-drone
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private fxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  public enabled = true;
  public musicEnabled = true;
  public isNight = false;
  public paused = false;

  private stepIndex = 0;
  private schedulerTimer: number | null = null;
  private nextNoteTime = 0;

  // Cheerful IKEA Showroom Muzak melody (MIDI note numbers, 0 = rest)
  // F major pentatonic/lydian bouncy mallsoft loop (16 eighth-note steps)
  private readonly DAY_MELODY = [
    77, 0, 81, 84, 81, 0, 79, 77,
    74, 0, 77, 81, 79, 0, 76, 0,
    70, 0, 74, 77, 81, 0, 79, 77,
    79, 81, 84, 0, 86, 0, 84, 0,
  ];
  private readonly DAY_BASS = [
    53, 0, 60, 0, 53, 0, 60, 0,
    50, 0, 57, 0, 50, 0, 57, 0,
    46, 0, 53, 0, 46, 0, 53, 0,
    48, 0, 55, 0, 48, 0, 55, 0,
  ];

  // Eerie SCP-3008 Night Horror motif (detuned minor / tritone music box)
  private readonly NIGHT_MELODY = [
    77, 0, 0, 76, 0, 71, 0, 0,
    72, 0, 0, 68, 0, 0, 65, 0,
    71, 0, 77, 0, 76, 0, 0, 64,
    65, 0, 0, 60, 0, 0, 0, 0,
  ];
  private readonly NIGHT_BASS = [
    41, 0, 0, 0, 47, 0, 0, 0,
    40, 0, 0, 0, 36, 0, 0, 0,
    41, 0, 0, 0, 42, 0, 0, 0,
    36, 0, 0, 0, 35, 0, 0, 0,
  ];

  private midiToFreq(midi: number, detuneCents = 0): number {
    return 440 * Math.pow(2, (midi - 69 + detuneCents / 100) / 12);
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      this.fxGain = this.ctx.createGain();
      this.fxGain.gain.value = this.enabled ? 1 : 0;
      this.fxGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.42 : 0;
      // Overhead IKEA store PA speaker warmth filter
      const speakerFilter = this.ctx.createBiquadFilter();
      speakerFilter.type = 'lowpass';
      speakerFilter.frequency.value = 2600;
      this.musicGain.connect(speakerFilter);
      speakerFilter.connect(this.ctx.destination);

      // Night sub-drone nodes (kept silent during Day)
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0;
      this.droneGain.connect(this.musicGain);

      this.droneOsc1 = this.ctx.createOscillator();
      this.droneOsc1.type = 'sawtooth';
      this.droneOsc1.frequency.value = 55;
      const droneFilter = this.ctx.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.value = 160;
      this.droneOsc1.connect(droneFilter);
      droneFilter.connect(this.droneGain);
      this.droneOsc1.start();

      this.droneOsc2 = this.ctx.createOscillator();
      this.droneOsc2.type = 'sine';
      this.droneOsc2.frequency.value = 58.2; // eerie binaural beat
      this.droneOsc2.connect(this.droneGain);
      this.droneOsc2.start();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlockAndStartMusic(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (this.schedulerTimer === null) {
      this.nextNoteTime = ctx.currentTime + 0.05;
      this.schedulerTimer = window.setInterval(() => this.tickScheduler(), 80);
    }
  }

  public setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.12);
    }
    if (on) {
      this.unlockAndStartMusic();
    }
  }

  public setFxEnabled(on: boolean): void {
    this.enabled = on;
    if (this.fxGain && this.ctx) {
      this.fxGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    }
  }

  public setPhase(isNight: boolean, paused: boolean): void {
    this.isNight = isNight;
    this.paused = paused;
    if (this.droneGain && this.ctx) {
      const targetDrone = isNight && this.musicEnabled && !paused ? 0.18 : 0;
      this.droneGain.gain.setTargetAtTime(targetDrone, this.ctx.currentTime, 0.8);
    }
  }

  private tickScheduler(): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.musicEnabled || this.paused) {
      if (this.ctx) this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.05);
      return;
    }

    const stepDur = this.isNight ? 0.44 : 0.25; // Night drags eerily slow!
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      this.scheduleStep(this.stepIndex, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 32;
    }
  }

  private scheduleStep(step: number, time: number, dur: number): void {
    const ctx = this.ctx;
    const dest = this.musicGain;
    if (!ctx || !dest) return;

    const melody = this.isNight ? this.NIGHT_MELODY : this.DAY_MELODY;
    const bass = this.isNight ? this.NIGHT_BASS : this.DAY_BASS;

    const mNote = melody[step];
    const bNote = bass[step];

    if (mNote > 0) {
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const g = ctx.createGain();

      // Night adds creepy pitch drift & metallic detuned music-box overtone
      const detune = this.isNight ? Math.sin(step * 1.7) * 28 - 18 : 0;
      const freq = this.midiToFreq(mNote, detune);

      osc.type = this.isNight ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      if (this.isNight) {
        osc.frequency.linearRampToValueAtTime(freq * 0.985, time + dur * 1.4);
      }

      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(freq * (this.isNight ? 2.71 : 2.0), time); // inharmonic bell at night!

      const og = ctx.createGain();
      og.gain.setValueAtTime(this.isNight ? 0.035 : 0.025, time);
      og.gain.exponentialRampToValueAtTime(0.0008, time + dur * (this.isNight ? 1.5 : 0.9));

      g.gain.setValueAtTime(0.001, time);
      g.gain.linearRampToValueAtTime(this.isNight ? 0.11 : 0.09, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur * (this.isNight ? 1.7 : 1.15));

      osc.connect(g);
      overtone.connect(og);
      og.connect(g);
      g.connect(dest);

      osc.start(time);
      overtone.start(time);
      const stopT = time + dur * 1.8;
      osc.stop(stopT);
      overtone.stop(stopT);
    }

    if (bNote > 0) {
      const bOsc = ctx.createOscillator();
      const bg = ctx.createGain();
      bOsc.type = this.isNight ? 'sawtooth' : 'sine';
      const bFreq = this.midiToFreq(bNote, this.isNight ? -15 : 0);
      bOsc.frequency.setValueAtTime(bFreq, time);

      bg.gain.setValueAtTime(0.001, time);
      bg.gain.linearRampToValueAtTime(this.isNight ? 0.075 : 0.11, time + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.001, time + dur * (this.isNight ? 2.1 : 1.4));

      if (this.isNight) {
        const bf = ctx.createBiquadFilter();
        bf.type = 'lowpass';
        bf.frequency.value = 240;
        bOsc.connect(bf);
        bf.connect(bg);
      } else {
        bOsc.connect(bg);
      }
      bg.connect(dest);
      bOsc.start(time);
      bOsc.stop(time + dur * 2.2);
    }
  }

  public playChime(freq = 520, duration = 0.08, type: OscillatorType = 'triangle', gainVal = 0.04): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.fxGain) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.fxGain);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Ignore audio failures on locked devices
    }
  }

  public playAlert(isNight: boolean): void {
    if (!this.enabled) return;
    if (isNight) {
      this.playChime(220, 0.28, 'sawtooth', 0.04);
      setTimeout(() => this.playChime(175, 0.35, 'sawtooth', 0.035), 170);
    } else {
      this.playChime(523, 0.12, 'triangle', 0.04);
      setTimeout(() => this.playChime(659, 0.16, 'triangle', 0.04), 90);
    }
  }

  public playPower(): void {
    if (!this.enabled) return;
    this.playChime(440, 0.1, 'sine', 0.04);
    setTimeout(() => this.playChime(660, 0.12, 'sine', 0.03), 50);
  }
}

export const soundFX = new SoundManager();
