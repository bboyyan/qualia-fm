import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { trackKeyOf, type SongDisplay, type TrackMark } from '@qualia/contracts';
import { SongArtworkView } from '../src/features/songs/SongArtwork';
import { SongRow } from '../src/features/songs/SongRow';
import { MySongsModel } from '../src/features/songs/mySongsModel';
import { ApiError } from '../src/api/client';

const noop = () => undefined;
const song: TrackMark = { title: '曲名', artist: '歌手', trackKey: trackKeyOf('歌手', '曲名'), rating: '愛', mark: 'pinned', note: null, lastAiredAt: null, updatedAt: new Date(0).toISOString() };
const display: SongDisplay = { trackKey: song.trackKey, status: 'available', metadata: { canonicalTitle: '正式曲名', canonicalArtists: ['正式歌手'], canonicalAlbum: '專輯', artworkUrl: 'https://i.scdn.co/image/test', externalUrl: 'https://open.spotify.com/track/test' } };
const api = () => ({ tasteMarks: vi.fn(async () => [song]), tasteEdit: vi.fn(async () => song), tasteHistory: vi.fn(async () => []), songDisplay: vi.fn(async (_keys: string[], _signal: AbortSignal): Promise<SongDisplay[]> => [display]) });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('封面展示', () => {
  it('有網址顯示 64×64 圖，error handler 可觸發佔位狀態', () => {
    const onError = vi.fn();
    const element = SongArtworkView({ url: 'https://i.scdn.co/image/test', title: '曲名', failed: false, onError });
    expect(renderToStaticMarkup(element)).toContain('data-testid="song-artwork"');
    expect(renderToStaticMarkup(element)).toContain('width="64" height="64"');
    element.props.onError();
    expect(onError).toHaveBeenCalledOnce();
  });
  it.each([{ url: null, failed: false }, { url: '壞網址', failed: true }])('無圖／載入失敗皆顯示固定佔位 %j', (state) => {
    const html = renderToStaticMarkup(createElement(SongArtworkView, { ...state, title: '曲名', onError: noop }));
    expect(html).toContain('song-artwork-placeholder');
    expect(html).not.toContain('<img');
  });
  it.each([undefined, { trackKey: song.trackKey, status: 'unavailable' as const }])('未取得展示或明確 unavailable 不標示 Spotify：%j', (display) => {
    const html = renderToStaticMarkup(createElement(SongRow, { song, display, pinFull: false, busy: false, disabled: false, history: undefined, onAction: noop, onSeed: noop, onLoadHistory: noop }));
    expect(html).toContain('song-artwork-placeholder');
    expect(html).toContain('曲名');
    expect(html).not.toContain('spotify-logo');
    expect(html).not.toContain('open.spotify.com');
    expect(html).not.toContain('song-artwork"');
  });
  it('有展示資料用官方標誌及正式曲名', () => {
    const props = { song, pinFull: false, busy: false, disabled: false, history: undefined, onAction: noop, onSeed: noop, onLoadHistory: noop };
    const available = renderToStaticMarkup(createElement(SongRow, { ...props, display }));
    expect(available).toContain('/brand/spotify/Spotify_Full_Logo_RGB_Green.png');
    expect(available).toContain('正式曲名');
  });
});

describe('展示生命週期與帳本操作隔離', () => {
  it('同 key 合併在途，最多每批 10 首，單批並行', async () => {
    const remote = api();
    const model = new MySongsModel(remote);
    for (let i = 0; i < 23; i++) { model.requestDisplay(`key${i}`); model.requestDisplay(`key${i}`); }
    await tick();
    expect(remote.songDisplay.mock.calls.map((call) => call[0].length)).toEqual([10, 10, 3]);
  });
  it('慢封面不擋收藏；清除會取消且忽略舊回應', async () => {
    const remote = api();
    let finish!: (items: SongDisplay[]) => void;
    remote.songDisplay = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const model = new MySongsModel(remote);
    await model.load();
    model.requestDisplay(song.trackKey);
    await tick();
    model.requestDisplay(song.trackKey);
    expect((await model.act(song.trackKey, 'love', true)).ok).toBe(true);
    expect(remote.songDisplay).toHaveBeenCalledOnce();
    const signal = remote.songDisplay.mock.calls[0]![1];
    model.clearDisplay();
    expect(signal.aborted).toBe(true);
    finish([display]);
    await tick();
    expect(model.getState().display).toEqual({});
  });
  it.each(['unavailable', 'error'] as const)('展示 API %s 完成後只留帳本曲名及佔位，沒有 Spotify 標誌', async (result) => {
    const remote = api();
    if (result === 'error') remote.songDisplay.mockRejectedValue(new Error('展示請求失敗'));
    else remote.songDisplay.mockResolvedValue([{ trackKey: song.trackKey, status: 'unavailable' }]);
    const model = new MySongsModel(remote);
    model.requestDisplay(song.trackKey);
    await tick();
    expect(remote.songDisplay).toHaveBeenCalledOnce();
    expect(model.getState().display[song.trackKey]).toEqual({ trackKey: song.trackKey, status: 'unavailable' });
    const html = renderToStaticMarkup(createElement(SongRow, { song, display: model.getState().display[song.trackKey], pinFull: false, busy: false, disabled: false, history: undefined, onAction: noop, onSeed: noop, onLoadHistory: noop }));
    expect(html).toContain('song-artwork-placeholder');
    expect(html).not.toContain('Spotify');
  });
  it('429 不自動重试且 Retry-After 期間不送後續列', async () => {
    const remote = api();
    remote.songDisplay.mockRejectedValue(new ApiError({ code: 'RATE_LIMITED', message: '稍後', retryable: true, requestId: 'test', retryAfterMs: 30000 }, 429));
    const model = new MySongsModel(remote, () => 1000);
    model.requestDisplay('a');
    await tick();
    model.requestDisplay('b');
    await tick();
    expect(remote.songDisplay).toHaveBeenCalledOnce();
  });
});
