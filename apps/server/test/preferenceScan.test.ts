import { expect, it } from 'vitest';
import { checkPreferences, scanPreferenceSource } from '../../../scripts/check-preferences.mjs';

it('V5 rejects added default tastes and unlabelled seed texture assumptions', () => {
  expect(scanPreferenceSource('TEST.ts', "const DEFAULT_PREFERENCES = ['TEST invented taste'];")).toHaveLength(1);
  expect(scanPreferenceSource('TEST.ts', "const output = '依你的描述設想：TEST invented texture';")).toHaveLength(1);
  expect(scanPreferenceSource('TEST.ts', "const example = 'TEST fake description';")).toEqual([]);
});

it('V5 scans repository code and allows only the confirmed seed default', async () => {
  const result = await checkPreferences(process.cwd());
  expect(result.count).toBeGreaterThan(100);
  expect(result.findings).toEqual([]);
});
