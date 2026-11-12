/**
 * TANVION ROYALE TRADING PLATFORM — WEB AUDIO SYNTHESIZER
 * Zero external audio dependencies. Uses native HTML5 Web Audio API.
 * Synthesizes institutional chimes, alert pings, error buzzers, and connection tones.
 */

export type SoundEffectType =
  | 'orderExecution'
  | 'orderRejection'
  | 'takeProfit'
  | 'stopLoss'
  | 'stopOut'
  | 'pendingOrderActivation'
  | 'priceAlert'
  | 'marginWarning'
  | 'connectionLost'
  | 'connectionRestored';

export interface SoundConfig {
  enabled: boolean;
  masterVolume: number; // 0.0 to 1.0
  effects: Record<SoundEffectType, boolean>;
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  masterVolume: 0.7,
  effects: {
    orderExecution: true,
    orderRejection: true,
    takeProfit: true,
    stopLoss: true,
    stopOut: true,
    pendingOrderActivation: true,
    priceAlert: true,
    marginWarning: true,
    connectionLost: true,
    connectionRestored: true,
  },
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play synthesized institutional sound effect
 */
export function playTradingSound(type: SoundEffectType, config: SoundConfig = DEFAULT_SOUND_CONFIG): void {
  if (!config.enabled) return;
  if (config.effects[type] === false) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(config.masterVolume, now);
  masterGain.connect(ctx.destination);

  switch (type) {
    case 'orderExecution': {
      // Crisp 2-stage upward affirmative chime (587 Hz -> 880 Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
      break;
    }

    case 'takeProfit': {
      // Celebratory 3-note major chord chime (C6, E6, G6)
      [1046.5, 1318.5, 1567.98].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.35, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
      });
      break;
    }

    case 'stopLoss': {
      // Descending warning sweep (440 Hz -> 220 Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440.0, now);
      osc.frequency.exponentialRampToValueAtTime(220.0, now + 0.3);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.35);
      break;
    }

    case 'stopOut': {
      // Harsh liquidation alarm (two pulses)
      [0, 0.18].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(293.66, now + delay);
        osc.frequency.linearRampToValueAtTime(146.83, now + delay + 0.15);
        gain.gain.setValueAtTime(0.4, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.16);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 0.16);
      });
      break;
    }

    case 'orderRejection': {
      // Dual low reject buzz
      [0, 0.1].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(160.0, now + delay);
        gain.gain.setValueAtTime(0.2, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.08);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 0.08);
      });
      break;
    }

    case 'pendingOrderActivation': {
      // Upward single ping
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
    }

    case 'priceAlert': {
      // Double bright alert ping
      [0, 0.12].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1760.0, now + delay); // A6
        gain.gain.setValueAtTime(0.35, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 0.15);
      });
      break;
    }

    case 'marginWarning': {
      // 3 rapid pulses
      [0, 0.1, 0.2].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520.0, now + delay);
        gain.gain.setValueAtTime(0.3, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.07);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 0.07);
      });
      break;
    }

    case 'connectionLost': {
      // Minor descending tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(392.0, now);
      osc.frequency.linearRampToValueAtTime(261.63, now + 0.28);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
    }

    case 'connectionRestored': {
      // Clean ascending reconnect sweep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(261.63, now);
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.22);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
      break;
    }
  }
}
