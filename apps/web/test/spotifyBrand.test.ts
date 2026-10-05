import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpotifyTrackCard } from '../src/features/spotify/SpotifyTrackCard';
import { spotifySegment } from './spotifyFakes';

/**
 * BRA-111 A2：Spotify Design Guidelines 的標示要求。
 * - 官方 Spotify 圖示（不是自己打字的「Spotify」字樣），Spotify Green、數位最小 21px、四周留白＝圖示高度一半。
 * - 封面圓角：小／中尺寸 4px、大尺寸 8px（原為 12px）。
 * - 完整 metadata：曲名、歌手、專輯。
 */

const css = readFileSync(new URL('../src/features/spotify/spotify.module.css', import.meta.url), 'utf8');
const card = (album: string | null | undefined) => {
  const track = { ...spotifySegment().track, canonicalTitle: 'TEST 曲名', canonicalArtists: ['TEST 歌手甲', 'TEST 歌手乙'], ...(album === undefined ? {} : { canonicalAlbum: album }) };
  return renderToStaticMarkup(createElement(SpotifyTrackCard, { track, confirmed: false }));
};

/** 取出某個 selector 的宣告區塊（第一個符合者）。 */
const ruleBody = (source: string, selector: string): string => {
  const match = new RegExp(`(^|\\n|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[2] ?? '';
};
const mediaBlock = (source: string, query: string): string => {
  const start = source.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
};

describe('Spotify 官方圖示', () => {
  it('以官方圖示標示來源：SVG、role=img、aria-label=Spotify、Spotify Green、至少 21px', () => {
    const html = card('TEST 專輯');
    const svg = /<svg[^>]*data-testid="spotify-logo"[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
    expect(svg).toMatch(/role="img"/);
    expect(svg).toMatch(/aria-label="Spotify"/);
    expect(svg).toMatch(/viewBox="0 0 24 24"/);
    expect(svg).toMatch(/fill="#1ED760"/i);
    expect(Number(/width="(\d+)"/.exec(svg)?.[1])).toBeGreaterThanOrEqual(21);
    expect(Number(/height="(\d+)"/.exec(svg)?.[1])).toBeGreaterThanOrEqual(21);
    // 官方圖示的圓形外框＋三道聲波（不是文字）
    expect(svg).toMatch(/<path d="M12 0C5\.4 0 0 5\.4 0 12s5\.4 12 12 12 12-5\.4 12-12/);
  });

  it('不再用自製的「Spotify」文字標籤冒充標誌', () => {
    expect(card('TEST 專輯')).not.toMatch(/<span[^>]*>Spotify<\/span>/);
  });

  it('圖示四周留白至少為圖示高度的一半（21px → 11px）', () => {
    expect(ruleBody(css, '.brand')).toMatch(/padding:\s*11px/);
  });
});

describe('封面圓角（4px 小／中、8px 大）', () => {
  it('預設（手機）4px，不再是 12px', () => {
    const cover = ruleBody(css, '.cover');
    expect(cover).toMatch(/border-radius:\s*4px/);
    expect(cover).not.toMatch(/12px/);
  });

  it('大尺寸（寬螢幕放大封面）8px', () => {
    const large = mediaBlock(css, '(min-width: 600px)');
    expect(ruleBody(large, '.cover')).toMatch(/border-radius:\s*8px/);
    expect(ruleBody(large, '.cover')).toMatch(/width:\s*1[2-9]\dpx/);
  });
});

describe('完整曲目資訊', () => {
  it('顯示曲名、歌手、專輯', () => {
    const html = card('TEST 專輯');
    expect(html).toContain('TEST 曲名');
    expect(html).toContain('TEST 歌手甲、TEST 歌手乙');
    expect(html).toMatch(/data-testid="spotify-album"[^>]*>TEST 專輯</);
  });

  it('專輯未知（舊節目／未提供）時不顯示空白列', () => {
    expect(card(null)).not.toContain('spotify-album');
    expect(card(undefined)).not.toContain('spotify-album');
  });

  it('外連文字維持「在 Spotify 開啟」並連到 open.spotify.com', () => {
    expect(card('TEST 專輯')).toMatch(/<a[^>]*href="https:\/\/open\.spotify\.com\/track\/TEST"[^>]*>在 Spotify 開啟<\/a>/);
  });
});
