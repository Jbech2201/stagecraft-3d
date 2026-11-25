/**
 * Built-in Web Audio API Beat Synthesizer & Real-Time Canvas Spectrum Visualizer.
 * Zero external audio assets required.
 */
export class AudioSynth {
  constructor(visualizerCanvas) {
    this.canvas = visualizerCanvas;
    this.ctx2d = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;
    this.audioCtx = null;
    this.beatInterval = null;
    this.beatEnergy = 0;
    this.beatStep = 0;
    this.active = false;
  }

  start() {
    this.active = true;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    if (this.beatInterval) clearInterval(this.beatInterval);
    // 128 BPM => 234ms per eighth note
    this.beatInterval = setInterval(() => {
      if (!this.active) return;
      this.triggerStep(this.beatStep);
      this.beatStep = (this.beatStep + 1) % 8;
    }, 234);
  }

  stop() {
    this.active = false;
    if (this.beatInterval) {
      clearInterval(this.beatInterval);
      this.beatInterval = null;
    }
    this.beatEnergy = 0;
  }

  triggerStep(step) {
    this.beatEnergy = step % 2 === 0 ? 1.0 : 0.45;
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    if (step % 2 === 0) {
      // Punchy EDM Kick Drum
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(135, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      // Synth Arp Pulse
      const notes = [220, 261.63, 329.63, 392.0];
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(notes[(step >> 1) % notes.length], now);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  tick(timeSec, cueMode) {
    this.beatEnergy = Math.max(0, this.beatEnergy * 0.91);
    this.renderVisualizer(timeSec, cueMode);
    return this.beatEnergy;
  }

  renderVisualizer(timeSec, cueMode) {
    if (!this.ctx2d || !this.canvas) return;
    const { width, height } = this.canvas;
    this.ctx2d.clearRect(0, 0, width, height);

    const bars = 12;
    const barW = 5;
    const gap = 2;

    for (let i = 0; i < bars; i++) {
      let val = 0.15;
      if (this.active) {
        val = Math.min(1, this.beatEnergy * (0.4 + 0.6 * Math.abs(Math.sin(timeSec * 8 + i * 0.7))));
      } else if (cueMode !== 'BLACKOUT') {
        val = 0.2 + 0.25 * Math.abs(Math.sin(timeSec * 2 + i * 0.5));
      }
      const h = Math.max(3, val * (height - 4));
      this.ctx2d.fillStyle = i < 4 ? '#ec4899' : i < 8 ? '#06b6d4' : '#f59e0b';
      this.ctx2d.fillRect(2 + i * (barW + gap), height - h - 2, barW, h);
    }
  }

  destroy() {
    this.stop();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
  }
}
