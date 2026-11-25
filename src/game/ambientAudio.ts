import { soundFX } from './sound';

/**
 * Procedural Web Audio Background Store Ambience Manager
 * Generates subtle, time-of-day-adaptive SCP-3008 store sounds:
 * - Continuous HVAC / fluorescent ceiling ballast bed (warm Day vs hollow Night)
 * - Distant overhead PA intercom chimes & muffled formant announcements
 * - Rolling shopping-cart wheel clacks & caster squeaks
 * - Flickering overhead fluorescent tube buzzes & starter pops
 * - Distant steel-rack settling creaks after closing
 */
class AmbientAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private hvacGain: GainNode | null = null;
  private hvacFilter: BiquadFilterNode | null = null;
  private hvacSource: AudioBufferSourceNode | null = null;
  private humGain: GainNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private schedulerTimer: number | null = null;
  private nextEventAtMs = 0;
  private started = false;

  public enabled = true;
  public isNight = false;
  public cycleProgress = 0;
  public paused = false;
  public auditNight = false;
  public anomalyType: string | null = null;

  public unlock(): void {
    if (!this.enabled) return;
    const ctx = soundFX.getContext();
    if (!ctx) return;
    this.ctx = ctx;

    if (!this.started) {
      this.started = true;
      this.buildGraph(ctx);
      this.updateBedLevels();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (this.schedulerTimer === null) {
      this.nextEventAtMs = performance.now() + 1800 + Math.random() * 1800;
      this.schedulerTimer = window.setInterval(() => this.tick(), 650);
    }
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.masterGain && this.ctx) {
      const target = on && !this.paused ? 1.0 : 0.0;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.18);
    }
    if (on) {
      this.unlock();
    }
  }

  public setPhase(
    isNight: boolean,
    cycleProgress: number,
    paused: boolean,
    auditNight = false,
    anomalyType: string | null = null
  ): void {
    const phaseChanged =
      this.isNight !== isNight ||
      this.paused !== paused ||
      this.auditNight !== auditNight ||
      this.anomalyType !== anomalyType ||
      Math.abs(this.cycleProgress - cycleProgress) > 0.08;

    this.isNight = isNight;
    this.cycleProgress = cycleProgress;
    this.paused = paused;
    this.auditNight = auditNight;
    this.anomalyType = anomalyType;

    if (phaseChanged) {
      this.updateBedLevels();
    }
  }

  private buildGraph(ctx: AudioContext): void {
    try {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.enabled && !this.paused ? 1.0 : 0.0;
      this.masterGain.connect(ctx.destination);

      // Build seamless 3-second pink-ish noise buffer once
      const length = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.05) * 0.45;
      }
      // Crossfade last 256 samples for click-free looping
      const fade = 256;
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
      }
      this.noiseBuffer = buf;

      // Continuous HVAC ventilation bed
      this.hvacSource = ctx.createBufferSource();
      this.hvacSource.buffer = buf;
      this.hvacSource.loop = true;

      this.hvacFilter = ctx.createBiquadFilter();
      this.hvacFilter.type = 'lowpass';
      this.hvacFilter.frequency.value = 380;

      this.hvacGain = ctx.createGain();
      this.hvacGain.gain.value = 0.018;

      this.hvacSource.connect(this.hvacFilter);
      this.hvacFilter.connect(this.hvacGain);
      this.hvacGain.connect(this.masterGain);
      this.hvacSource.start();

      // Subtle 120Hz ceiling fluorescent ballast hum
      this.humOsc = ctx.createOscillator();
      this.humOsc.type = 'sine';
      this.humOsc.frequency.value = 120;

      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0.0035;

      this.humOsc.connect(this.humGain);
      this.humGain.connect(this.masterGain);
      this.humOsc.start();
    } catch {
      // Ignore Web Audio graph errors on restricted devices
    }
  }

  private updateBedLevels(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const active = this.enabled && !this.paused && (typeof document === 'undefined' || !document.hidden);
    this.masterGain.gain.setTargetAtTime(active ? 1.0 : 0.0, t, 0.2);

    const isDusk = !this.isNight && this.cycleProgress >= 0.8;
    if (this.hvacFilter && this.hvacGain) {
      const targetCutoff = this.isNight ? 210 : isDusk ? 310 : 410;
      const targetGain = this.isNight ? (this.auditNight ? 0.032 : 0.025) : 0.018;
      this.hvacFilter.frequency.setTargetAtTime(targetCutoff, t, 0.9);
      this.hvacGain.gain.setTargetAtTime(targetGain, t, 0.8);
    }
    if (this.humGain) {
      const targetHum = this.isNight ? 0.0022 : isDusk ? 0.0052 : 0.0034;
      this.humGain.gain.setTargetAtTime(targetHum, t, 0.7);
    }
  }

  private tick(): void {
    if (!this.enabled || this.paused) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!this.ctx || this.ctx.state !== 'running' || !this.masterGain) return;

    this.updateBedLevels();

    const nowMs = performance.now();
    if (nowMs < this.nextEventAtMs) return;

    const isDusk = !this.isNight && this.cycleProgress >= 0.8;
    const roll = Math.random();

    if (this.isNight) {
      // Night: flickering lights, eerie warped intercom static, distant rack creaks, rare lonely cart
      if (roll < 0.38) {
        this.playLightFlicker(true, false);
      } else if (roll < 0.68) {
        this.playIntercomAnnouncement(true, false);
      } else if (roll < 0.88) {
        this.playDistantShelfCreak();
      } else {
        this.playCartSqueak(true);
      }
      this.nextEventAtMs = nowMs + (this.auditNight ? 2600 : 3400) + Math.random() * 3400;
    } else if (isDusk) {
      // Dusk: pre-closing PA chime + flickering fluorescent tubes + hurried carts
      if (roll < 0.44) {
        this.playIntercomAnnouncement(false, true);
      } else if (roll < 0.78) {
        this.playLightFlicker(false, true);
      } else {
        this.playCartSqueak(false);
      }
      this.nextEventAtMs = nowMs + 2800 + Math.random() * 2600;
    } else {
      // Daytime (Store Open): rolling shopping carts, distant showroom PA, occasional ballast flicker
      if (roll < 0.45) {
        this.playCartSqueak(false);
      } else if (roll < 0.82) {
        this.playIntercomAnnouncement(false, false);
      } else {
        this.playLightFlicker(false, false);
      }
      this.nextEventAtMs = nowMs + 3600 + Math.random() * 3600;
    }
  }

  private createPanner(ctx: AudioContext, pan: number): AudioNode {
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      return p;
    }
    const g = ctx.createGain();
    g.gain.value = 1;
    return g;
  }

  private playIntercomAnnouncement(isNight: boolean, isDusk: boolean): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;

    try {
      const t = ctx.currentTime + 0.03;
      const pan = (Math.random() - 0.5) * 0.8;
      const panner = this.createPanner(ctx, pan);

      // PA horn speaker bandpass filter + subtle slapback echo
      const horn = ctx.createBiquadFilter();
      horn.type = 'bandpass';
      horn.frequency.value = isNight ? 980 : 1420;
      horn.Q.value = 1.6;

      const bus = ctx.createGain();
      bus.gain.value = isNight ? 0.55 : 0.72;

      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.16;
      const echoGain = ctx.createGain();
      echoGain.gain.value = 0.24;

      bus.connect(horn);
      horn.connect(panner);
      horn.connect(delay);
      delay.connect(echoGain);
      echoGain.connect(panner);
      panner.connect(dest);

      // 1. Overhead chime notes
      const notes = isNight
        ? [311.13, 293.66, 207.65] // eerie detuned tritone drop
        : isDusk
          ? [659.25, 523.25, 440.0] // polite closing tone
          : [587.33, 739.99, 880.0]; // cheerful D major chime

      notes.forEach((freq, idx) => {
        const nt = t + idx * (isNight ? 0.22 : 0.14);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = isNight ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, nt);
        if (isNight) {
          osc.frequency.linearRampToValueAtTime(freq * 0.96, nt + 0.35);
        }
        g.gain.setValueAtTime(0.0005, nt);
        g.gain.linearRampToValueAtTime(isNight ? 0.018 : 0.022, nt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0005, nt + (isNight ? 0.38 : 0.24));
        osc.connect(g);
        g.connect(bus);
        osc.start(nt);
        osc.stop(nt + 0.42);
      });

      // 2. Subtle PA static click + muffled distant formant voice syllables
      const voiceStart = t + (isNight ? 0.72 : 0.52);
      if (this.noiseBuffer) {
        const hiss = ctx.createBufferSource();
        hiss.buffer = this.noiseBuffer;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.001, voiceStart - 0.04);
        hg.gain.linearRampToValueAtTime(isNight ? 0.014 : 0.008, voiceStart + 0.04);
        hg.gain.linearRampToValueAtTime(0.0008, voiceStart + 1.15);
        hiss.connect(hg);
        hg.connect(bus);
        hiss.start(voiceStart - 0.04);
        hiss.stop(voiceStart + 1.2);
      }

      const syllableCount = isNight ? 3 : 5;
      const basePitch = isNight ? 132 : 168 + Math.random() * 45;
      for (let s = 0; s < syllableCount; s++) {
        const st = voiceStart + s * (isNight ? 0.24 : 0.16);
        const sylDur = isNight ? 0.17 : 0.11;
        const vOsc = ctx.createOscillator();
        const fFilter = ctx.createBiquadFilter();
        const vg = ctx.createGain();

        vOsc.type = 'sawtooth';
        const p = basePitch * (0.92 + Math.random() * 0.18);
        vOsc.frequency.setValueAtTime(p, st);
        vOsc.frequency.linearRampToValueAtTime(p * (isNight ? 0.88 : 0.96), st + sylDur);

        fFilter.type = 'bandpass';
        fFilter.frequency.setValueAtTime(750 + Math.random() * 650, st);
        fFilter.Q.value = 3.2;

        vg.gain.setValueAtTime(0.0005, st);
        vg.gain.linearRampToValueAtTime(isNight ? 0.012 : 0.014, st + 0.02);
        vg.gain.exponentialRampToValueAtTime(0.0005, st + sylDur);

        vOsc.connect(fFilter);
        fFilter.connect(vg);
        vg.connect(bus);
        vOsc.start(st);
        vOsc.stop(st + sylDur + 0.02);
      }
    } catch {
      // Ignore
    }
  }

  private playCartSqueak(isNight: boolean): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;

    try {
      const t = ctx.currentTime + 0.02;
      const panStart = (Math.random() - 0.5) * 1.1;
      const panner = this.createPanner(ctx, panStart);
      panner.connect(dest);

      // 1. Rolling caster wheel rumble across concrete tile seams
      if (this.noiseBuffer) {
        const roll = ctx.createBufferSource();
        roll.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 280;
        bp.Q.value = 1.4;

        const rg = ctx.createGain();
        rg.gain.setValueAtTime(0.0008, t);
        rg.gain.linearRampToValueAtTime(isNight ? 0.014 : 0.022, t + 0.25);
        rg.gain.exponentialRampToValueAtTime(0.0008, t + 0.85);

        roll.connect(bp);
        bp.connect(rg);
        rg.connect(panner);
        roll.start(t);
        roll.stop(t + 0.9);
      }

      // 2. Subtle high metal wheel squeak chirps
      const squeaks = Math.random() < 0.55 ? 2 : 1;
      for (let i = 0; i < squeaks; i++) {
        const st = t + 0.14 + i * 0.26;
        const sqOsc = ctx.createOscillator();
        const sqGain = ctx.createGain();
        const f0 = 1780 + Math.random() * 580;

        sqOsc.type = 'sine';
        sqOsc.frequency.setValueAtTime(f0, st);
        sqOsc.frequency.exponentialRampToValueAtTime(f0 * 1.18, st + 0.07);
        sqOsc.frequency.exponentialRampToValueAtTime(f0 * 0.94, st + 0.16);

        sqGain.gain.setValueAtTime(0.0004, st);
        sqGain.gain.linearRampToValueAtTime(isNight ? 0.0075 : 0.0095, st + 0.025);
        sqGain.gain.exponentialRampToValueAtTime(0.0004, st + 0.17);

        sqOsc.connect(sqGain);
        sqGain.connect(panner);
        sqOsc.start(st);
        sqOsc.stop(st + 0.19);
      }
    } catch {
      // Ignore
    }
  }

  private playLightFlicker(isNight: boolean, isDusk: boolean): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;

    try {
      const t = ctx.currentTime + 0.02;
      const panner = this.createPanner(ctx, (Math.random() - 0.5) * 1.2);
      panner.connect(dest);

      const pulses = isNight || isDusk ? 4 : 3;
      const buzzVol = isNight ? 0.016 : 0.012;

      for (let i = 0; i < pulses; i++) {
        const pt = t + i * (0.07 + Math.random() * 0.07);
        const dur = 0.03 + Math.random() * 0.04;

        // 120Hz ballast buzz stutter
        const osc = ctx.createOscillator();
        const bp = ctx.createBiquadFilter();
        const g = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, pt);
        bp.type = 'bandpass';
        bp.frequency.value = 360;
        bp.Q.value = 2.0;

        g.gain.setValueAtTime(0.0005, pt);
        g.gain.linearRampToValueAtTime(buzzVol, pt + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, pt + dur);

        osc.connect(bp);
        bp.connect(g);
        g.connect(panner);
        osc.start(pt);
        osc.stop(pt + dur + 0.01);

        // Tiny fluorescent starter tick
        if (i === 0 || i === pulses - 1) {
          const tickOsc = ctx.createOscillator();
          const tg = ctx.createGain();
          tickOsc.type = 'triangle';
          tickOsc.frequency.setValueAtTime(2800 + Math.random() * 600, pt);
          tg.gain.setValueAtTime(0.007, pt);
          tg.gain.exponentialRampToValueAtTime(0.0004, pt + 0.018);
          tickOsc.connect(tg);
          tg.connect(panner);
          tickOsc.start(pt);
          tickOsc.stop(pt + 0.02);
        }
      }
    } catch {
      // Ignore
    }
  }

  private playDistantShelfCreak(): void {
    const ctx = this.ctx;
    const dest = this.masterGain;
    if (!ctx || !dest) return;

    try {
      const t = ctx.currentTime + 0.03;
      const panner = this.createPanner(ctx, (Math.random() - 0.5) * 1.4);
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = 'sawtooth';
      const f = 92 + Math.random() * 35;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.48);

      lp.type = 'lowpass';
      lp.frequency.value = 340;
      lp.Q.value = 3.5;

      g.gain.setValueAtTime(0.0004, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.5);

      osc.connect(lp);
      lp.connect(g);
      g.connect(panner);
      panner.connect(dest);
      osc.start(t);
      osc.stop(t + 0.52);
    } catch {
      // Ignore
    }
  }
}

export const ambientAudio = new AmbientAudioManager();
