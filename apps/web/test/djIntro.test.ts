/**
 * BRA-117 C：加厚 DJ 引言。預設改為標準（加厚）版，舊的已存設定也升級；畫面可展開看完整介紹。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DjIntroduction } from '../src/features/player/DjIntroduction';
import { DEFAULT_SETTINGS, migrateLegacySettings, parseSettings } from '../src/features/settings/settings';

const noop = () => undefined;
const THICK = 'TEST 接下來這首是〈雨後的底片〉，藝人是 TEST 藝人。為什麼接這首：示範用的虛構理由。聽的時候可以留意：這是合成測試音，不是真的歌。';

describe('DJ 串詞長度設定', () => {
  it('預設是標準（加厚）版', () => {
    expect(DEFAULT_SETTINGS.djLength).toBe('standard');
    expect(parseSettings(null).djLength).toBe('standard');
  });

  it('使用者明確選了短版就保留', () => {
    expect(parseSettings({ djLength: 'short' }).djLength).toBe('short');
  });

  it('舊版（v1）存的設定升級時改用加厚版，其他選擇保留', () => {
    expect(migrateLegacySettings({ playbackMode: 'mock', djEnabled: false, djLength: 'short' })).toEqual({ playbackMode: 'mock', djEnabled: false, djLength: 'standard' });
    expect(migrateLegacySettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('DjIntroduction：可展開看完整', () => {
  it('長引言：全文都在畫面上，預設收合，提供「看全文」', () => {
    const html = renderToStaticMarkup(createElement(DjIntroduction, { djLine: THICK, paused: false, aiVoice: true, onSkip: noop }));
    expect(html).toContain(THICK);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>看全文<\/button>/);
    expect(html).toContain('AI 合成語音');
  });

  it('展開鈕和收合的兩行引言同一列，不多佔一行（360 寬首屏播放鍵要露出）', () => {
    const html = renderToStaticMarkup(createElement(DjIntroduction, { djLine: THICK, paused: false, onSkip: noop }));
    expect(html).toMatch(/<div class="[^"]*djBody[^"]*"><p[^>]*>[\s\S]*?<\/p><button[^>]*data-testid="dj-expand"/);
  });

  it('短引言不需要展開按鈕', () => {
    const html = renderToStaticMarkup(createElement(DjIntroduction, { djLine: 'TEST 短短一句。', paused: false, onSkip: noop }));
    expect(html).not.toContain('看全文');
  });
});
