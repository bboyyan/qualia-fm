import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ManualControls } from '../src/features/player/ManualControls';

it('offers start before external playback, then finish, and never claims to know progress', () => {
  const props = { onStart: () => undefined, onFinish: () => undefined, onSkip: () => undefined };
  const ready = renderToStaticMarkup(createElement(ManualControls, { ...props, phase: 'manual_ready' }));
  expect(ready).toContain('我開始播了');
  expect(ready).not.toContain('這首播完了');
  const playing = renderToStaticMarkup(createElement(ManualControls, { ...props, phase: 'manual_playing' }));
  expect(playing).toContain('這首播完了');
  expect(playing).toContain('外部播放中（由你確認）');
  expect(playing).toContain('本站不知道播放進度');
});
