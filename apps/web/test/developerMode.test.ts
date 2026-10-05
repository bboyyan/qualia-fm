import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { PROVIDER_NOTICES } from '@qualia/contracts';
import { DeveloperOnly, canPresentShow, developerMode } from '../src/app/developerMode';
import { AppShell } from '../src/app/AppShell';
import { ReadyView } from '../src/features/seed/ReadyView';
import { makeShow } from './fixtures';
import { spotifySegment } from './spotifyFakes';

vi.mock('../src/app/hooks', () => ({ useEffectivePlaybackMode: () => 'manual', useKeyboardOpen: () => false }));

afterEach(() => vi.unstubAllGlobals());
const noop = () => undefined;

it('diagnostics require an exact explicit URL opt-in and are absent from default shell markup', () => {
  for (const search of ['', '?developer=0', '?developer=true', '?debug=1']) expect(developerMode(search)).toBe(false);
  expect(developerMode('?developer=1')).toBe(true);
  expect(renderToStaticMarkup(createElement(DeveloperOnly, { children: 'TEST 假帳本' }))).toBe('');
  const shell = renderToStaticMarkup(createElement(AppShell, { children: '開台' }));
  expect(shell).not.toMatch(/MOCK|\bTEST\b|假帳本|mode-badge|經核可模式/i);
  vi.stubGlobal('window', { location: { search: '?developer=1' } });
  expect(renderToStaticMarkup(createElement(DeveloperOnly, { children: 'TEST 假帳本' }))).toBe('TEST 假帳本');
});

it('synthetic plans and AI fallback stay in developer mode; real Spotify plans still pass', () => {
  const demo = makeShow();
  const real = { ...demo, segments: [spotifySegment()] };
  expect(canPresentShow(demo, 'mock', false)).toBe(false);
  expect(canPresentShow(demo, 'openai', false)).toBe(false);
  expect(canPresentShow(demo, 'mock', true)).toBe(true);
  expect(canPresentShow(real, 'openai', false)).toBe(true);
  expect(canPresentShow({ ...real, warnings: [PROVIDER_NOTICES.llm] }, 'openai', false)).toBe(false);
  expect(canPresentShow({ ...demo, segments: [] }, 'mock', false)).toBe(false);
});

it.each([0, 3, 4, 5])('ready count %s has a compact partial notice only when needed', (count) => {
  const show = { ...makeShow('ready', count), segments: Array.from({ length: count }, (_, i) => ({ ...spotifySegment(), segmentId: `s${i}` })) };
  const html = renderToStaticMarkup(createElement(ReadyView, { show, hasActiveShow: false, onStart: noop, onEdit: noop, onRegenerate: noop, onBackToListen: noop }));
  expect(html.includes('data-testid="partial-notice"')).toBe(count > 0 && count < 5);
  if (count > 0 && count < 5) {
    expect(html).toContain(`先聽這 ${count} 首。`);
    expect(html).toContain('重新選歌');
    expect(html).not.toContain('role="alert"');
  }
  expect(html).not.toContain('MOCK 虛構曲目');
  expect(html).not.toContain('不會用別的歌充數');
});
