/**
 * BRA-129 旅程精選集分享＋繼續旅程：連結解析、分享頁狀態模型（開啟／繼續旅程／先改一句）、卡片文字，以及頁面靜態輸出。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanRequestSchema, spotifySearchUrl, trackKeyOf, type PlanRequest, type ShareView } from '@qualia/contracts';
import { ApiError, localError } from '../src/api/client';
import { DEFAULT_SETTINGS } from '../src/features/settings/settings';
import { cardLines, imageFileName } from '../src/features/share/shareCard';
import { internalShareUrl, readShareCode, urlWithoutShare } from '../src/features/share/shareLink';
import { ShareController, type ShareApi } from '../src/features/share/shareController';
import { ShareContent } from '../src/features/share/ShareContent';

const CODE = 'Ab3_-Zx9Qw2k';
const tracks = ['晚安練習曲', '霧中電車', '遠方的燈', '慢慢醒來', '城市換氣'].map((title, i) => {
  const artist = i < 2 ? 'Mono Lune' : '夜行者';
  return { trackKey: trackKeyOf(artist, title), title, artist, palette: i, spotifyUrl: spotifySearchUrl(title, artist) };
});
const VIEW: ShareView = { code: CODE, selectionNo: 2, createdAt: '2026-10-06T08:00:00.000Z', tracks, counts: { shared: 1, opened: 0, continued: 0 }, publicLinkEnabled: false };

function fakeApi(overrides: Partial<ShareApi> = {}): ShareApi {
  return {
    create: vi.fn(async () => VIEW),
    get: vi.fn(async () => VIEW),
    event: vi.fn(async () => VIEW.counts),
    ...overrides,
  };
}

function controller(api = fakeApi()) {
  const started: PlanRequest[] = [];
  const instance = new ShareController({ api, startPlan: (request) => { started.push(request); }, settings: () => DEFAULT_SETTINGS });
  return { instance, api, started };
}

describe('分享連結（內部短碼）', () => {
  it('從網址讀出短碼；格式不符一律忽略', () => {
    expect(readShareCode(`?share=${CODE}`)).toBe(CODE);
    expect(readShareCode('?share=../../etc')).toBeNull();
    expect(readShareCode('?developer=1')).toBeNull();
  });

  it('內部連結是同一個 app 的 /?share=短碼；讀完後網址拿掉 share、保留其他參數', () => {
    expect(internalShareUrl('http://127.0.0.1:8737', CODE)).toBe(`http://127.0.0.1:8737/?share=${CODE}`);
    expect(urlWithoutShare('/', `?developer=1&share=${CODE}`, '#x')).toBe('/?developer=1#x');
    expect(urlWithoutShare('/', `?share=${CODE}`, '')).toBe('/');
  });
});

describe('ShareController', () => {
  it('用連結開啟：解析短碼、顯示唯讀內容，並記一次「開啟」', async () => {
    const { instance, api } = controller();
    await instance.openFromLink(CODE);
    expect(instance.getState()).toMatchObject({ status: 'ready', view: VIEW });
    expect(api.get).toHaveBeenCalledWith(CODE);
    expect(api.event).toHaveBeenCalledWith(CODE, 'opened');
  });

  it('剛建立的分享直接顯示，不記「開啟」', async () => {
    const { instance, api } = controller();
    await instance.share({ selectionNo: 2, tracks: tracks.map(({ spotifyUrl: _url, ...track }) => track) });
    expect(instance.getState().status).toBe('ready');
    expect(api.event).not.toHaveBeenCalled();
  });

  it('找不到短碼時給出可理解的狀態，不丟例外', async () => {
    const { instance } = controller(fakeApi({ get: vi.fn(async () => { throw new ApiError({ ...localError('NOT_FOUND').info }, 404); }) }));
    await instance.openFromLink(CODE);
    expect(instance.getState()).toMatchObject({ status: 'missing', view: null });
  });

  it('繼續旅程：直接用這五首當歌曲種子開台，並記一次「繼續」', async () => {
    const { instance, api, started } = controller();
    await instance.openFromLink(CODE);
    await instance.continueJourney();
    expect(started).toHaveLength(1);
    const request = PlanRequestSchema.parse(started[0]);
    expect(request.seed).toEqual({ kind: 'song', text: '晚安練習曲／霧中電車／遠方的燈／慢慢醒來／城市換氣', artist: 'Mono Lune／夜行者' });
    expect(request.dj).toEqual({ enabled: DEFAULT_SETTINGS.djEnabled, length: DEFAULT_SETTINGS.djLength });
    expect(api.event).toHaveBeenLastCalledWith(CODE, 'continued');
    expect(instance.getState().status).toBe('closed');
  });

  it('先改一句：預填五首串成的種子文字，改完送出用改過的句子開台', async () => {
    const { instance, started } = controller();
    await instance.openFromLink(CODE);
    instance.startEdit();
    expect(instance.getState().draft).toBe('晚安練習曲／霧中電車／遠方的燈／慢慢醒來／城市換氣');
    instance.setDraft('晚安練習曲／霧中電車，但更安靜一點');
    await instance.continueJourney();
    expect(PlanRequestSchema.parse(started[0]).seed).toEqual({ kind: 'song', text: '晚安練習曲／霧中電車，但更安靜一點', artist: 'Mono Lune／夜行者' });
  });

  it('先改一句：空白或超過字數不送出，保留輸入並說明', async () => {
    const { instance, started } = controller();
    await instance.openFromLink(CODE);
    instance.startEdit();
    instance.setDraft('   ');
    await instance.continueJourney();
    expect(started).toHaveLength(0);
    expect(instance.getState()).toMatchObject({ status: 'ready', editing: true, problem: '先寫下一點想去的方向，或保留原本的五首。' });
    instance.setDraft('長'.repeat(501));
    await instance.continueJourney();
    expect(started).toHaveLength(0);
    expect(instance.getState().draft).toHaveLength(501);
  });

  it('計數失敗不影響開台', async () => {
    const { instance, started } = controller(fakeApi({ event: vi.fn(async () => { throw localError('NETWORK_ERROR'); }) }));
    await instance.openFromLink(CODE);
    await instance.continueJourney();
    expect(started).toHaveLength(1);
  });
});

describe('分享卡（存成圖片）', () => {
  it('卡片只有編號、五首曲名與藝人、Qualia 字標；沒有種子或網址', () => {
    const lines = cardLines(VIEW);
    expect(lines.kicker).toBe('JOURNEY SELECTION · NO.02');
    expect(lines.tracks).toEqual(tracks.map((track) => ({ title: track.title, artist: track.artist })));
    expect(JSON.stringify(lines)).not.toMatch(/share=|https?:|種子/);
    expect(imageFileName(VIEW)).toBe('qualia-journey-selection-02.png');
  });
});

describe('分享頁靜態輸出', () => {
  const html = renderToStaticMarkup(createElement(ShareContent, {
    state: { status: 'ready', view: VIEW, editing: false, draft: '', problem: null },
    actions: { saveImage: () => undefined, copyLink: () => undefined, continueJourney: () => undefined, startEdit: () => undefined, cancelEdit: () => undefined, setDraft: () => undefined },
  }));

  it('列出五首與各自的 Spotify 單曲連結（新分頁、noopener）', () => {
    for (const track of tracks) {
      expect(html).toContain(track.title);
      expect(html).toContain(`href="${track.spotifyUrl.replaceAll('&', '&amp;')}"`);
    }
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(5);
  });

  it('公開連結按鈕停用並說明「公開分享尚未開放」；存圖、複製連結、繼續旅程、先改一句都在', () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="share-public-link"/);
    expect(html).toContain('公開分享尚未開放');
    for (const label of ['存成圖片', '複製連結', '繼續旅程', '先改一句']) expect(html).toContain(label);
  });

  it('不顯示任何種子原文欄位', () => {
    expect(html).not.toContain('種子文字');
  });
});
