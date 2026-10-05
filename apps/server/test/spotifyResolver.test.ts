import { describe, expect, it } from 'vitest';
import type { Candidate } from '@qualia/contracts';
import { SpotifyCatalogResolver, titlesMatch } from '../src/spotify/resolver.js';
import type { ApiTrack } from '../src/spotify/webApi.js';

const candidate = (title: string, artist: string): Candidate => ({
  candidateId: 'c1',
  title,
  artist,
  versionHint: null,
  seedBridge: 'TEST bridge',
  transitionBridge: null,
  vibe: ['TEST', 'TEST', 'TEST'],
  djLine: 'TEST line',
  evidenceLevel: 'model_knowledge',
  evidenceRefs: [],
  uncertainty: null,
});

const apiTrack = (name: string, artists: string[], id = 'TESTtrack0000000000001'): ApiTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  duration_ms: 200_000,
  artists: artists.map((artist) => ({ name: artist })),
});

function resolverReturning(tracks: ApiTrack[]) {
  const queries: string[] = [];
  const resolver = new SpotifyCatalogResolver({ searchTracks: async (query: string) => (queries.push(query), tracks) });
  return { resolver, queries };
}

const context = { signal: new AbortController().signal, scenario: 'five' as const, index: 0 };

describe('Spotify 對歌：曲名與藝人都要對上（正規化後）', () => {
  it('同藝人不同曲 → 拒絕（unavailable），不會把別首歌當成提名', async () => {
    const { resolver } = resolverReturning([apiTrack('Another Song Entirely', ['Evan Call'])]);
    const track = await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context);
    expect(track).toMatchObject({ availability: 'unavailable', canAttemptPlayback: false, audioLocator: { kind: 'none' } });
  });

  it('曲名對但藝人不同 → 拒絕', async () => {
    const { resolver } = resolverReturning([apiTrack('Time Flows Ever Onward', ['Someone Else'])]);
    expect((await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).availability).toBe('unavailable');
  });

  it.each([
    ['大小寫', 'time flows ever onward'],
    ['標點', 'Time Flows, Ever Onward!'],
    ['全形', 'Ｔｉｍｅ　Ｆｌｏｗｓ　Ｅｖｅｒ　Ｏｎｗａｒｄ'],
    ['Spotify 版本後綴', 'Time Flows Ever Onward - Remastered 2024'],
    ['括號註記', 'Time Flows Ever Onward (from "Frieren")'],
  ])('%s差異可以通過', async (_name, spotifyName) => {
    const { resolver } = resolverReturning([apiTrack(spotifyName, ['Ｅｖａｎ　Ｃａｌｌ'])]);
    const track = await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context);
    expect(track).toMatchObject({ availability: 'resolved', audioLocator: { kind: 'spotify_uri', uri: 'spotify:track:TESTtrack0000000000001' } });
  });

  it('多筆結果時選第一筆曲名與藝人都對上的', async () => {
    const { resolver } = resolverReturning([
      apiTrack('Another Song', ['Evan Call'], 'TESTtrack0000000000009'),
      apiTrack('Time Flows Ever Onward', ['Evan Call'], 'TESTtrack0000000000002'),
    ]);
    expect((await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).providerTrackId).toBe('TESTtrack0000000000002');
  });

  it('N13：LLM 提名那一側的版本註記也要去掉（後綴與括號，含全形）', () => {
    expect(titlesMatch('Time Flows Ever Onward - Live', 'Time Flows Ever Onward')).toBe(true);
    expect(titlesMatch('Time Flows Ever Onward（Frieren OST）', 'Time Flows Ever Onward')).toBe(true);
    expect(titlesMatch('Time Flows Ever Onward [2023]', 'Time Flows Ever Onward - Remastered')).toBe(true);
  });

  it('N13：整個曲名都在括號裡時退回不去註記的比對，不會變成空字串而全部拒絕', () => {
    expect(titlesMatch('(Untitled)', '(Untitled)')).toBe(true);
    expect(titlesMatch('(Untitled)', '(Something Else)')).toBe(false);
  });

  it('titlesMatch 不接受只是部分重疊的曲名', () => {
    expect(titlesMatch('Time', 'Time Flows Ever Onward')).toBe(false);
    expect(titlesMatch('Time Flows Ever Onward', 'Time Flows')).toBe(false);
    expect(titlesMatch('夜に駆ける', '夜に駆ける')).toBe(true);
  });
});

describe('BRA-111 A2：完整 metadata（專輯）只放在 track', () => {
  it('對上時帶出 Spotify 的專輯名稱', async () => {
    const { resolver } = resolverReturning([{ ...apiTrack('Time Flows Ever Onward', ['Evan Call']), album: { name: 'TEST Album 名', images: [] } }]);
    expect((await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).canonicalAlbum).toBe('TEST Album 名');
  });

  it('Spotify 沒給專輯或為空字串 → null；過長截到 200 字', async () => {
    const none = resolverReturning([apiTrack('Time Flows Ever Onward', ['Evan Call'])]);
    expect((await none.resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).canonicalAlbum).toBeNull();
    const empty = resolverReturning([{ ...apiTrack('Time Flows Ever Onward', ['Evan Call']), album: { name: '', images: [] } }]);
    expect((await empty.resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).canonicalAlbum).toBeNull();
    const long = resolverReturning([{ ...apiTrack('Time Flows Ever Onward', ['Evan Call']), album: { name: 'A'.repeat(250), images: [] } }]);
    expect((await long.resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).canonicalAlbum).toHaveLength(200);
  });

  it('對不上（unavailable）時不帶專輯', async () => {
    const { resolver } = resolverReturning([apiTrack('Other', ['Evan Call'])]);
    expect((await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).canonicalAlbum).toBeNull();
  });
});

describe('mutation 補測（BRA-111 重跑 PR #6）', () => {
  it('S22：外連只接受 open.spotify.com，其他網址一律不顯示', async () => {
    const { resolver } = resolverReturning([{ ...apiTrack('Time Flows Ever Onward', ['Evan Call']), external_urls: { spotify: 'https://evil.example.test/track/x' } }]);
    expect((await resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).externalUrl).toBeNull();
    const ok = resolverReturning([{ ...apiTrack('Time Flows Ever Onward', ['Evan Call']), external_urls: { spotify: 'https://open.spotify.com/track/TESTtrack0000000000001' } }]);
    expect((await ok.resolver.resolve(candidate('Time Flows Ever Onward', 'Evan Call'), context)).externalUrl).toBe('https://open.spotify.com/track/TESTtrack0000000000001');
  });
});
