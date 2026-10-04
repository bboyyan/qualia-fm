import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PlaybackModeSettings } from '../src/features/settings/PlaybackModeSettings';
import { parseSettings } from '../src/features/settings/settings';

it('defaults new and old settings to B, accepts mock and rejects any E setting', () => {
  expect(parseSettings(null).playbackMode).toBe('manual');
  expect(parseSettings({ djEnabled: false }).playbackMode).toBe('manual');
  expect(parseSettings({ playbackMode: 'mock' }).playbackMode).toBe('mock');
  expect(parseSettings({ playbackMode: 'spotify' }).playbackMode).toBe('manual');
});

it('renders B/mock as selectable radios and E as disabled with explicit approval text', () => {
  const html = renderToStaticMarkup(createElement(PlaybackModeSettings, { mode: 'manual', disabled: false, onChange: () => undefined }));
  expect(html).toContain('B · 手動（預設）');
  expect(html).toContain('MOCK · 合成測試音');
  expect(html).toContain('E · Spotify 自動串接');
  expect(html).toMatch(/<input(?=[^>]*value="spotify")(?=[^>]*disabled="")[^>]*>/);
  expect(html).toContain('需曄當次明確同意，預設關閉');
});
