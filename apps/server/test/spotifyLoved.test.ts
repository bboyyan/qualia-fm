import { describe, expect, it } from 'vitest';
import { LovedPlaylist } from '../src/spotify/loved.js';
import type { SpotifyWebApi } from '../src/spotify/webApi.js';

const PLAYLIST = '0dF9anAJZv0IotD6lo2kl2';
const URI = 'spotify:track:TESTtrack0000000000001';

/** 去重查詢由測試手動放行，確保兩次「愛」真的同時在路上（M8b）。 */
function deferredApi() {
  const checks: (() => void)[] = [];
  const adds: string[] = [];
  const api = {
    playlistHas: (_playlistId: string, _uri: string) => new Promise<boolean>((resolve) => checks.push(() => resolve(false))),
    addToPlaylist: async (_playlistId: string, uri: string) => {
      adds.push(uri);
    },
  } as unknown as SpotifyWebApi;
  return { api, checks, adds };
}

describe('LovedPlaylist 並行（M8b）', () => {
  it('同一首同時按兩次：共用同一個進行中的寫入，只查一次、只加一次', async () => {
    const { api, checks, adds } = deferredApi();
    const loved = new LovedPlaylist(api, PLAYLIST);
    const first = loved.add(URI);
    const second = loved.add(URI);
    expect(second).toBe(first);
    expect(checks).toHaveLength(1);
    checks[0]?.();
    expect(await Promise.all([first, second])).toEqual([{ status: 'added', playlistId: PLAYLIST }, { status: 'added', playlistId: PLAYLIST }]);
    expect(adds).toEqual([URI]);
  });

  it('前一次完成後再按：重新查一次（不會永遠沿用舊結果）', async () => {
    const { api, checks } = deferredApi();
    const loved = new LovedPlaylist(api, PLAYLIST);
    const first = loved.add(URI);
    checks[0]?.();
    await first;
    void loved.add(URI);
    expect(checks).toHaveLength(2);
  });
});
