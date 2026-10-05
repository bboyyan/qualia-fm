import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaybackModeSettings } from '../src/features/settings/PlaybackModeSettings';
import { DeviceStatusPill } from '../src/features/spotify/DeviceStatusView';
import { DeviceLostStages, PausedTooLong } from '../src/features/spotify/DeviceLostCard';
import { ModeStrip } from '../src/features/spotify/ModeStrip';
import { SpotifyLinkView } from '../src/features/spotify/SpotifySettings';
import { SpotifyTrackCard } from '../src/features/spotify/SpotifyTrackCard';
import { LoveConfirmContent, LoveResultCard } from '../src/features/player/LoveStep';
import { spotifySegment } from './spotifyFakes';

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const noop = () => undefined;

describe('串流時的 Spotify 標示（Policy II.4／II.5）', () => {
  it('每首顯示封面、Spotify 正式曲名／藝人、Spotify 標示與「在 Spotify 開啟」', () => {
    const segment = spotifySegment();
    const html = render(createElement(SpotifyTrackCard, { track: { ...segment.track, canonicalTitle: 'TEST 正式曲名', canonicalArtists: ['TEST 甲', 'TEST 乙'] }, confirmed: true }));
    expect(html).toContain('src="https://i.scdn.co/image/TEST"');
    expect(html).toContain('width="96"');
    expect(html).toContain('TEST 正式曲名');
    expect(html).toContain('TEST 甲、TEST 乙');
    expect(html).toContain('Spotify');
    expect(html).toMatch(/<a[^>]*href="https:\/\/open\.spotify\.com\/track\/TEST"[^>]*rel="noopener noreferrer"[^>]*>在 Spotify 開啟<\/a>/);
    expect(html).toContain('已確認有聲音');
  });

  it('還沒確認在播時不顯示「已確認有聲音」', () => {
    expect(render(createElement(SpotifyTrackCard, { track: spotifySegment().track, confirmed: false }))).not.toContain('已確認有聲音');
  });
});

describe('裝置狀態與友善提示', () => {
  it('裝置狀態小元件三種狀態', () => {
    expect(render(createElement(DeviceStatusPill, { status: { path: 'P', state: 'connecting', deviceName: 'Qualia FM', reason: null } }))).toContain('接上中');
    expect(render(createElement(DeviceStatusPill, { status: { path: 'P', state: 'online', deviceName: 'Qualia FM', reason: null } }))).toContain('已接上');
    expect(render(createElement(DeviceStatusPill, { status: { path: 'C', state: 'offline', deviceName: 'TEST iPhone', reason: 'not_found' } }))).toContain('已離線');
    expect(render(createElement(DeviceStatusPill, { status: null }))).toContain('尚未接上');
  });

  it('裝置消失：三段依序（叫醒播放器 → Spotify app 接手＋重新偵測 → 手動），不用靜音保活', () => {
    const html = render(createElement(DeviceLostStages, { title: '遠方的燈', position: '第 2／5 首', devices: null, detecting: false, onWake: noop, onDetect: noop, onHandOver: noop, onManual: noop }));
    const order = ['播放器睡著了', '叫醒播放器', '讓 Spotify app 接手', '打開 Spotify', '重新偵測', '改用手動播放'].map((text) => html.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('href="spotify:"');
    expect(html).toContain('不會用靜音音訊或背景計時器硬撐連線');
  });

  it('重新偵測後列出可接手的裝置；沒有就說明下一步', () => {
    const withDevice = render(createElement(DeviceLostStages, { title: 'x', position: 'y', devices: [{ id: 'TESTphone', name: 'TEST iPhone', type: 'Smartphone', isActive: false }], detecting: false, onWake: noop, onDetect: noop, onHandOver: noop, onManual: noop }));
    expect(withDevice).toContain('改由 TEST iPhone 播放');
    const none = render(createElement(DeviceLostStages, { title: 'x', position: 'y', devices: [], detecting: false, onWake: noop, onDetect: noop, onHandOver: noop, onManual: noop }));
    expect(none).toContain('還沒看到 Spotify app');
  });

  it('暫停超過 10 分鐘：先重新確認，不直接亂播', () => {
    const html = render(createElement(PausedTooLong, { title: '遠方的燈', position: '第 2／5 首', onReconnect: noop, onOther: noop }));
    for (const text of ['暫停超過 10 分鐘了', '不會直接亂播', '重新接上並繼續', '接不上？看其他方法']) expect(html).toContain(text);
  });
});

describe('「愛」確認 sheet 與結果', () => {
  it('確認內容說明會寫入你的 Spotify Qualia Loved、歌單 ID、去重，並可只記帳本', () => {
    const html = render(createElement(LoveConfirmContent, { title: '遠方的燈', playlistId: '0dF9anAJZv0IotD6lo2kl2' }));
    for (const text of ['你的 Spotify 帳號', '〈遠方的燈〉', 'Qualia Loved', '0dF9anAJZv0IotD6lo2kl2', '已在歌單就不再加入', '先問你一次']) expect(html).toContain(text);
  });

  it('結果分別說明帳本與 Loved；失敗不卡住旅程', () => {
    const added = render(createElement(LoveResultCard, { title: '遠方的燈', state: { stage: 'result', loved: 'added', playlistId: '0dF9anAJZv0IotD6lo2kl2' }, ledger: 'TEST 假帳本', reason: '空間感對了', nextLabel: '繼續・聽第 3 首介紹', onContinue: noop }));
    expect(added).toContain('已加入 Qualia Loved');
    expect(added).toContain('https://open.spotify.com/playlist/0dF9anAJZv0IotD6lo2kl2');
    expect(added).toContain('TEST 假帳本已寫入');
    expect(added).toContain('繼續・聽第 3 首介紹');
    const failed = render(createElement(LoveResultCard, { title: 'x', state: { stage: 'result', loved: 'failed', message: 'TEST 拒絕' }, ledger: 'TEST 假帳本', reason: '', nextLabel: '繼續', onContinue: noop }));
    expect(failed).toContain('TEST 拒絕');
    expect(failed).toContain('帳本照常寫入');
    expect(failed).not.toContain('open.spotify.com/playlist');
  });
});

describe('設定：E 模式、L2 說明、中斷連結', () => {
  const props = { clientId: 'TESTclientid0000', redirectUri: 'https://qualia.example.test/callback', scopes: ['streaming', 'playlist-modify-private'], djApproved: true, onLink: noop, onDisconnect: noop, disconnecting: false };

  it('未連結：E 模式關、L2 說明、會做／不會做；中斷連結不可按', () => {
    const html = render(createElement(SpotifyLinkView, { ...props, linked: false }));
    for (const text of ['E 模式', 'L2・需你明確同意', '預設關閉', '把任何 Spotify 資料交給 AI', 'Premium', '未連結', 'TESTclientid0000', 'https://qualia.example.test/callback', 'streaming']) expect(html).toContain(text);
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*><span[^>]*>中斷 Spotify 連結/);
  });

  it('已連結：中斷連結可按，並說明會刪除什麼', () => {
    const html = render(createElement(SpotifyLinkView, { ...props, linked: true }));
    expect(html).toContain('已連結');
    expect(html).not.toMatch(/<button(?=[^>]*disabled="")[^>]*><span[^>]*>中斷 Spotify 連結/);
    expect(html).toContain('中斷 Spotify 連結');
    expect(html).toContain('刪除 Mac mini 上的 Spotify 授權檔');
  });

  it('BRA-111 A1：已由另一台裝置連結：顯示狀態、不能在這裡連結或中斷，並說明只有擁有者能用', () => {
    const html = render(createElement(SpotifyLinkView, { ...props, linked: false, linkedElsewhere: true }));
    expect(html).toContain('已由另一台裝置連結');
    expect(html).toContain('只有完成連結的那台裝置');
    expect(html).not.toContain('data-testid="open-consent"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*><span[^>]*>中斷 Spotify 連結/);
  });

  it('伺服器未核可 E 模式時說明只能手動', () => {
    expect(render(createElement(SpotifyLinkView, { ...props, linked: true, djApproved: false }))).toContain('只能連結 Spotify、在 Spotify 開啟連結並自己播放');
  });

  it('播放模式：伺服器核可＋已連結時 E 可選；預設仍是停用（既有測試不變）', () => {
    const html = render(createElement(PlaybackModeSettings, { mode: 'manual', disabled: false, onChange: noop, eAvailable: true, eActive: true, onSelectE: noop }));
    expect(html).toMatch(/<input(?=[^>]*value="spotify")(?![^>]*disabled="")(?=[^>]*checked="")[^>]*>/);
    expect(html).toMatch(/<input(?=[^>]*value="manual")(?![^>]*checked="")[^>]*>/);
  });

  it('模式列三格', () => {
    const html = render(createElement(ModeStrip, { labels: { selection: '真 AI', playback: 'Spotify 自動串接（E）', ledger: 'TEST 假帳本' } }));
    for (const text of ['選曲／語音', '真 AI', '播放', 'Spotify 自動串接（E）', '帳本', 'TEST 假帳本']) expect(html).toContain(text);
  });
});
