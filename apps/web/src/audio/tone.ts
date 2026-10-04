/**
 * Programmatic MOCK audio (decision D-03). Produces 16-bit mono PCM WAV bytes:
 * - track: a soft two-chord synth pad per palette — a test tone, explicitly not music;
 * - chime: a short bell motif standing in for the DJ intro — not an AI voice.
 * Pure functions; no network, no third-party audio.
 */
export const SAMPLE_RATE = 22_050;

const PADS: readonly (readonly [readonly number[], readonly number[]])[] = [
  [[220.0, 261.63, 329.63, 392.0], [196.0, 246.94, 293.66, 369.99]],
  [[174.61, 220.0, 261.63, 329.63], [196.0, 233.08, 293.66, 349.23]],
  [[246.94, 293.66, 369.99, 440.0], [220.0, 277.18, 329.63, 415.3]],
  [[164.81, 207.65, 246.94, 311.13], [185.0, 220.0, 277.18, 329.63]],
  [[261.63, 329.63, 392.0, 493.88], [293.66, 349.23, 440.0, 523.25]],
  [[155.56, 196.0, 233.08, 293.66], [174.61, 207.65, 261.63, 311.13]],
  [[207.65, 261.63, 311.13, 392.0], [185.0, 233.08, 277.18, 349.23]],
  [[233.08, 293.66, 349.23, 440.0], [207.65, 261.63, 311.13, 392.0]],
];

const CHIME_NOTES = [659.25, 880.0, 987.77] as const;
const CHORD_SECONDS = 4;
const PAD_GAIN = 0.2;
const CHIME_GAIN = 0.28;

function wavBytes(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(s * 32_767), true);
  }
  return new Uint8Array(buffer);
}

function envelope(t: number, total: number, attack: number, release: number): number {
  return Math.min(1, t / attack, Math.max(0, (total - t) / release));
}

export function synthesizePad(palette: number, durationMs: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const chords = PADS[((palette % PADS.length) + PADS.length) % PADS.length] ?? PADS[0]!;
  const total = durationMs / 1000;
  const samples = new Float32Array(Math.round(total * sampleRate));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const cycle = t / CHORD_SECONDS;
    const current = Math.floor(cycle) % 2;
    const fade = Math.max(0, (cycle - Math.floor(cycle) - 0.85) / 0.15);
    const blend = 0.5 - 0.5 * Math.cos(Math.PI * fade);
    const from = chords[current] ?? chords[0];
    const to = chords[1 - current] ?? chords[1];
    let value = 0;
    for (let v = 0; v < 4; v += 1) {
      value += Math.sin(2 * Math.PI * (from[v] ?? 220) * t) * (1 - blend) + Math.sin(2 * Math.PI * (to[v] ?? 220) * t) * blend;
    }
    const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
    samples[i] = (value / 4) * tremolo * PAD_GAIN * envelope(t, total, 1.2, 1.5);
  }
  return wavBytes(samples, sampleRate);
}

export function synthesizeChime(durationMs: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const total = durationMs / 1000;
  const samples = new Float32Array(Math.round(total * sampleRate));
  const spacing = 0.32;
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    let value = 0;
    CHIME_NOTES.forEach((freq, n) => {
      const local = t - n * spacing;
      if (local < 0) return;
      const decay = Math.exp(-3.2 * local);
      value += (Math.sin(2 * Math.PI * freq * local) + 0.3 * Math.sin(4 * Math.PI * freq * local)) * decay;
    });
    samples[i] = (value / 2) * CHIME_GAIN * envelope(t, total, 0.01, 0.25);
  }
  return wavBytes(samples, sampleRate);
}
