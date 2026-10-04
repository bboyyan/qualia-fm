import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, synthesizeChime, synthesizePad } from '../src/audio/tone';

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));

describe('MOCK tone synthesis', () => {
  it('writes a valid RIFF/WAVE PCM header', () => {
    const wav = synthesizePad(0, 1_000);
    expect([ascii(wav, 0, 4), ascii(wav, 8, 4), ascii(wav, 36, 4)]).toEqual(['RIFF', 'WAVE', 'data']);
  });

  it('produces exactly the requested duration of 16-bit mono samples', () => {
    expect(synthesizePad(3, 2_000).length).toBe(44 + SAMPLE_RATE * 2 * 2);
  });

  it('keeps samples well below clipping', () => {
    const wav = synthesizePad(4, 3_000);
    const view = new DataView(wav.buffer);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeLessThan(32_767 * 0.5);
  });

  it('starts and ends silent (no clicks from abrupt edges)', () => {
    const wav = synthesizeChime(1_000);
    const view = new DataView(wav.buffer);
    expect([view.getInt16(44, true), view.getInt16(wav.length - 2, true)]).toEqual([0, 0]);
  });

  it('gives each palette a different signal', () => {
    expect(synthesizePad(0, 500)).not.toEqual(synthesizePad(1, 500));
  });
});
