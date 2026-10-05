/**
 * Spotify Search 只做一件事：把 LLM 提名的曲名／藝人對應成可播放的 URI（含顯示用封面與外連）。
 * 結果只進 ResolvedTrack（播放與 Loved 用），永遠不回到 planner、不寫進帳本（Policy III.13／III.14）。
 */
import type { Candidate, ResolvedTrack } from '@qualia/contracts';
import type { CatalogResolver, ResolverContext } from '../providers/types.js';
import type { ApiTrack, SpotifyWebApi } from './webApi.js';

/** 只需要 Search；方便以假物件測試。 */
export type TrackSearch = Pick<SpotifyWebApi, 'searchTracks'>;

const ARTWORK_HOST = 'i.scdn.co';
const EXTERNAL_PREFIX = 'https://open.spotify.com/';
const PREFERRED_ARTWORK_PX = 300;

/** Spotify 查詢語法用的字串：去掉引號與欄位分隔符，避免把提名文字變成查詢運算子。 */
const clean = (value: string): string => value.replace(/["':]/g, ' ').replace(/\s+/g, ' ').trim();
/** NFKC（全形→半形）＋小寫＋去掉空白與標點。 */
const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** 去掉版本註記：「 - Remastered 2024」這類後綴與括號內容（含全形括號，NFKC 後一併處理）。 */
const stripDecorations = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\s+-\s+.*$/u, '')
    .replace(/[([{][^)\]}]*[)\]}]/gu, ' ')
    .trim();

/** 曲名要對上：正規化後完全相同（允許 Spotify 的版本後綴／括號註記），部分重疊不算。 */
export function titlesMatch(nominated: string, spotifyName: string): boolean {
  const wanted = normalize(stripDecorations(nominated)) || normalize(nominated);
  const actual = normalize(stripDecorations(spotifyName)) || normalize(spotifyName);
  return wanted.length > 0 && wanted === actual;
}

export function searchQuery(candidate: Pick<Candidate, 'title' | 'artist'>): string {
  return `track:${clean(candidate.title)} artist:${clean(candidate.artist)}`;
}

/** 藝人要對得上（任一位 Spotify 藝人與提名互相包含），避免同名不同人的歌被當成提名。 */
function artistMatches(track: ApiTrack, artist: string): boolean {
  const wanted = normalize(artist);
  return wanted.length > 0 && track.artists.some((a) => {
    const name = normalize(a.name);
    return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
  });
}

function artworkOf(track: ApiTrack): string | null {
  const images = (track.album?.images ?? []).filter((image) => {
    try {
      return new URL(image.url).hostname === ARTWORK_HOST;
    } catch {
      return false;
    }
  });
  const sized = [...images].sort((a, b) => Math.abs((a.width ?? 0) - PREFERRED_ARTWORK_PX) - Math.abs((b.width ?? 0) - PREFERRED_ARTWORK_PX));
  return sized[0]?.url ?? null;
}

function toResolved(track: ApiTrack): ResolvedTrack {
  const external = track.external_urls?.spotify;
  return {
    provider: 'spotify',
    providerTrackId: track.id,
    canonicalTitle: track.name.slice(0, 200) || '（無曲名）',
    canonicalArtists: track.artists.map((a) => a.name.slice(0, 200)).filter(Boolean).slice(0, 10),
    artworkUrl: artworkOf(track),
    durationMs: track.duration_ms > 0 ? track.duration_ms : null,
    externalUrl: external?.startsWith(EXTERNAL_PREFIX) ? external : null,
    availability: 'resolved',
    canAttemptPlayback: true,
    audioLocator: { kind: 'spotify_uri', uri: track.uri },
  };
}

const unavailable = (candidate: Candidate): ResolvedTrack => ({
  provider: 'spotify',
  providerTrackId: null,
  canonicalTitle: candidate.title,
  canonicalArtists: [candidate.artist],
  artworkUrl: null,
  durationMs: null,
  externalUrl: null,
  availability: 'unavailable',
  canAttemptPlayback: false,
  audioLocator: { kind: 'none' },
});

export class SpotifyCatalogResolver implements CatalogResolver {
  constructor(private readonly api: TrackSearch) {}

  async resolve(candidate: Candidate, context: ResolverContext): Promise<ResolvedTrack> {
    if (context.signal.aborted) throw context.signal.reason;
    const results = await this.api.searchTracks(searchQuery(candidate), context.signal);
    // 曲名與藝人都要對上（正規化後），且可播放；對不上就標 unavailable，由 PlanService 換下一位候選並記 warning。
    const match = results.find((track) =>
      track.is_playable !== false &&
      /^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri) &&
      titlesMatch(candidate.title, track.name) &&
      artistMatches(track, candidate.artist));
    return match ? toResolved(match) : unavailable(candidate);
  }
}
