import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SPOTIFY_LOGO, SpotifyTrackCardView } from '../src/features/spotify/SpotifyTrackCard';
import { spotifySegment } from './spotifyFakes';

/**
 * BRA-111 A2：Spotify Design Guidelines 的標示要求（Sylphy 審查 PR #7 後修正）。
 * - 卡片放得下，必須用完整官方 logo（圖示＋「Spotify」字標），且是官方下載素材（不得手刻 SVG），以靜態檔引用。
 * - 數位最小寬度 70px；四周留白＝圖示高度一半。
 * - 封面圓角：小／中尺寸 4px、大尺寸 8px。
 * - 完整 metadata：曲名、歌手、專輯，截斷後使用者一定能看到全文。
 */

const css = readFileSync(new URL('../src/features/spotify/spotify.module.css', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('../src/features/spotify/SpotifyTrackCard.tsx', import.meta.url), 'utf8');
const LONG_TITLE = 'TEST 很長很長的曲名 '.repeat(8).trim();
const card = (album: string | null | undefined, expanded = false) => {
  const track = { ...spotifySegment().track, canonicalTitle: 'TEST 曲名', canonicalArtists: ['TEST 歌手甲', 'TEST 歌手乙'], ...(album === undefined ? {} : { canonicalAlbum: album }) };
  return renderToStaticMarkup(createElement(SpotifyTrackCardView, { track, confirmed: false, expanded, onToggle: () => undefined }));
};
const longCard = (expanded: boolean) => renderToStaticMarkup(createElement(SpotifyTrackCardView, {
  track: { ...spotifySegment().track, canonicalTitle: LONG_TITLE, canonicalArtists: ['TEST 很長的歌手名'.repeat(5)], canonicalAlbum: 'TEST 很長的專輯名'.repeat(6) },
  confirmed: false,
  expanded,
  onToggle: () => undefined,
}));

/** 官方素材：Spotify Newsroom 媒體包（2024 Spotify Brand Assets）的 Spotify_Full_Logo_RGB_Green.png。 */
const OFFICIAL_SHA256 = '691d3c7145702c0533b651efa6c29af57235e2ba7a2f7d54f57e650086d8915c';
const logoFile = (): Buffer => readFileSync(new URL(`../public${SPOTIFY_LOGO.src}`, import.meta.url));

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

describe('Spotify 完整官方 logo（官方下載素材）', () => {
  it('logo 是官方下載的原檔（逐位元組相同），放在 public 以靜態檔引用', () => {
    expect(SPOTIFY_LOGO.src).toBe('/brand/spotify/Spotify_Full_Logo_RGB_Green.png');
    expect(createHash('sha256').update(logoFile()).digest('hex')).toBe(OFFICIAL_SHA256);
  });

  it('官方檔是完整 logo 的比例（3432×940，圖示＋字標）；顯示尺寸依原比例', () => {
    const png = logoFile();
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect([width, height]).toEqual([3432, 940]);
    expect(Math.abs(SPOTIFY_LOGO.width / SPOTIFY_LOGO.height - width / height)).toBeLessThan(0.1);
  });

  it('曲目卡用完整 logo：img、alt=Spotify、寬度至少 70px（數位最小尺寸）', () => {
    const img = /<img[^>]*data-testid="spotify-logo"[^>]*>/.exec(card('TEST 專輯'))?.[0] ?? '';
    expect(img).toContain(`src="${SPOTIFY_LOGO.src}"`);
    expect(img).toMatch(/alt="Spotify"/);
    expect(Number(/width="(\d+)"/.exec(img)?.[1])).toBeGreaterThanOrEqual(70);
    expect(Number(/height="(\d+)"/.exec(img)?.[1])).toBe(SPOTIFY_LOGO.height);
  });

  it('不手刻標誌：曲目卡沒有 SVG／path，原始碼也沒有內嵌圖形', () => {
    expect(card('TEST 專輯')).not.toMatch(/<svg|<path/);
    expect(cardSource).not.toMatch(/<svg|<path|M12 0C/);
    expect(card('TEST 專輯')).not.toMatch(/<span[^>]*>Spotify<\/span>/);
  });

  it('logo 四周留白至少為圖示高度一半（顯示高度 22px → 11px）', () => {
    expect(ruleBody(css, '.brand')).toMatch(/padding:\s*11px/);
    expect(SPOTIFY_LOGO.height / 2).toBeLessThanOrEqual(11);
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

  it('截斷的曲名／歌手／專輯一律帶 title（桌機滑過可看全文）', () => {
    const html = longCard(false);
    expect(html).toContain(`title="${LONG_TITLE}"`);
    expect(html).toContain(`title="${'TEST 很長的歌手名'.repeat(5)}"`);
    expect(html).toContain(`title="${'TEST 很長的專輯名'.repeat(6)}"`);
  });

  it('收合時：有「顯示完整曲目資訊」按鈕（aria-expanded=false、aria-controls 指向資訊區）', () => {
    const html = longCard(false);
    const button = /<button[^>]*data-testid="spotify-meta-toggle"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? '';
    expect(button).toMatch(/aria-expanded="false"/);
    expect(button).toContain('顯示完整曲目資訊');
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).toMatch(/data-expanded="false"/);
  });

  it('展開時：資訊區 data-expanded=true、按鈕改「收合」，全文都在畫面上', () => {
    const html = longCard(true);
    expect(html).toMatch(/data-expanded="true"/);
    expect(/<button[^>]*data-testid="spotify-meta-toggle"[^>]*>([^<]*)<\/button>/.exec(html)?.[1]).toBe('收合曲目資訊');
    expect(html).toMatch(/aria-expanded="true"/);
    expect(html).toContain(`>${LONG_TITLE}<`);
  });

  it('展開的 CSS 會換行顯示全文（取消 nowrap／省略號）', () => {
    const expanded = /\[data-expanded='true'\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(expanded).toMatch(/white-space:\s*normal/);
    expect(expanded).toMatch(/overflow:\s*visible/);
    expect(expanded).toMatch(/text-overflow:\s*clip/);
  });

  it('外連文字維持「在 Spotify 開啟」並連到 open.spotify.com', () => {
    expect(card('TEST 專輯')).toMatch(/<a[^>]*href="https:\/\/open\.spotify\.com\/track\/TEST"[^>]*>在 Spotify 開啟<\/a>/);
  });
});
