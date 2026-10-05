import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Candidate } from '@qualia/contracts';
import type { EditorialPlanner } from '../src/providers/types.js';
import { MockEditorialPlanner } from '../src/providers/mockPlanner.js';
import { ORIGIN, bootstrap, planRequest, postPlan, testApp, waitForJob, type Client } from './helpers.js';
import type { AppOverrides } from '../src/app.js';

/** 測試專用的假值：Client ID 不是 Qualia FM 的真實 ID，金鑰每次隨機產生；不呼叫任何真實 Spotify。 */
export const SPOTIFY_TEST_ENV = {
  SPOTIFY_ENABLED: 'true',
  SPOTIFY_CLIENT_ID: '00000000000000000000000000000000',
  SPOTIFY_REDIRECT_URI: 'https://qualia.example.test/callback',
  SPOTIFY_TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
  /** 只有這個 Spotify 帳號（/v1/me 的 id）能成為擁有者；假帳號。 */
  SPOTIFY_OWNER_USER_ID: 'TESTowner',
} as const;

export const DJ_TEST_ENV = { ...SPOTIFY_TEST_ENV, SPOTIFY_DJ_APPROVED: 'true', SPOTIFY_APPROVAL_REFERENCE: 'BRA-109 TEST approval' } as const;

export function tokenFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'qualia-spotify-')), 'spotify-token.enc');
}

export interface FakeTrack {
  readonly id: string;
  readonly name: string;
  readonly artists: readonly string[];
  readonly durationMs?: number;
  readonly playable?: boolean;
}

export interface FakeCall {
  readonly method: string;
  readonly url: URL;
  readonly body: string | null;
  readonly authorization: string | null;
}

interface Override {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const trackId = (n: number): string => `TESTtrack${String(n).padStart(13, '0')}`;
export const trackUri = (n: number): string => `spotify:track:${trackId(n)}`;
export const artworkUrl = (id: string): string => `https://i.scdn.co/image/TEST-${id}`;

/**
 * 假 Spotify（accounts＋Web API），只回應測試資料並記錄每次呼叫。
 * 任何不認得的網址都丟錯，確保測試不會意外連到真實網路。
 */
export class FakeSpotify {
  readonly calls: FakeCall[] = [];
  readonly tracks: FakeTrack[] = [];
  devices: { id: string; name: string; type: string; is_active: boolean }[] = [{ id: 'TESTdeviceP', name: 'Qualia FM', type: 'Computer', is_active: false }];
  playlist: string[] = [];
  player: Record<string, unknown> | null = null;
  rotateRefresh = false;
  /** /v1/me 回傳的帳號 id（模擬「誰完成了 Spotify 授權」）。 */
  meId = 'TESTowner';
  private readonly overrides: Override[] = [];
  private readonly validAccess = new Set<string>();
  private readonly validRefresh = new Set<string>();
  private seq = 0;

  respondOnce(method: string, path: string, status: number, body?: unknown, headers?: Record<string, string>): void {
    this.overrides.push({ method, path, status, body, headers });
  }

  revokeAccessTokens(): void {
    this.validAccess.clear();
  }

  callsTo(method: string, path: string): FakeCall[] {
    return this.calls.filter((call) => call.method === method && call.url.pathname === path);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : null;
    this.calls.push({ method, url, body, authorization: headers.get('authorization') });
    const index = this.overrides.findIndex((o) => o.method === method && url.pathname.startsWith(o.path));
    if (index >= 0) {
      const [override] = this.overrides.splice(index, 1);
      return json(override!.status, override!.body, override!.headers);
    }
    if (url.origin === 'https://accounts.spotify.com' && url.pathname === '/api/token' && method === 'POST') return this.token(new URLSearchParams(body ?? ''));
    if (url.origin !== 'https://api.spotify.com') throw new Error(`FakeSpotify: unexpected ${method} ${url.href}`);
    const bearer = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!this.validAccess.has(bearer)) return json(401, { error: { status: 401, message: 'The access token expired' } });
    return this.api(method, url, body);
  };

  private token(form: URLSearchParams): Response {
    if (form.has('client_secret')) throw new Error('PKCE flow must never send a client secret');
    const grant = form.get('grant_type');
    if (grant === 'refresh_token' && !this.validRefresh.has(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' });
    if (grant !== 'authorization_code' && grant !== 'refresh_token') return json(400, { error: 'unsupported_grant_type' });
    this.seq += 1;
    const access = `TEST-access-${this.seq}`;
    this.validAccess.add(access);
    const issueRefresh = grant === 'authorization_code' || this.rotateRefresh;
    const refresh = `TEST-refresh-${this.seq}`;
    if (issueRefresh) this.validRefresh.add(refresh);
    return json(200, {
      access_token: access,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-modify-private playlist-read-private',
      ...(issueRefresh ? { refresh_token: refresh } : {}),
    });
  }

  private trackJson(track: FakeTrack) {
    return {
      id: track.id,
      uri: `spotify:track:${track.id}`,
      name: track.name,
      duration_ms: track.durationMs ?? 200_000,
      is_playable: track.playable ?? true,
      artists: track.artists.map((name) => ({ name })),
      album: { name: 'TEST album', images: [{ url: artworkUrl(track.id), width: 640, height: 640 }, { url: `${artworkUrl(track.id)}-300`, width: 300, height: 300 }] },
      external_urls: { spotify: `https://open.spotify.com/track/${track.id}` },
    };
  }

  private api(method: string, url: URL, body: string | null): Response {
    const path = url.pathname.replace(/^\/v1/, '');
    if (method === 'GET' && path === '/search') {
      const q = url.searchParams.get('q') ?? '';
      const items = this.tracks.filter((t) => q.toLowerCase().includes(`track:${t.name.split(' - ')[0]!.toLowerCase()} `)).map((t) => this.trackJson(t));
      return json(200, { tracks: { items } });
    }
    if (method === 'GET' && path === '/me') return json(200, { id: this.meId, display_name: 'TEST Display Name', email: 'test-owner@example.test', country: 'TW', product: 'premium' });
    if (method === 'GET' && path === '/me/player/devices') return json(200, { devices: this.devices });
    if (method === 'GET' && path === '/me/player') return this.player ? json(200, this.player) : new Response(null, { status: 204 });
    if (method === 'PUT' && (path === '/me/player/play' || path === '/me/player/pause')) {
      const deviceId = url.searchParams.get('device_id');
      if (!this.devices.some((d) => d.id === deviceId)) return json(404, { error: { status: 404, message: 'Device not found', reason: 'NO_ACTIVE_DEVICE' } });
      return new Response(null, { status: 204 });
    }
    const playlist = /^\/playlists\/([A-Za-z0-9]{22})\/items$/.exec(path);
    if (playlist && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const page = this.playlist.slice(offset, offset + limit).map((uri) => ({ item: { uri } }));
      const next = offset + limit < this.playlist.length ? `https://api.spotify.com/v1/playlists/${playlist[1]}/items?offset=${offset + limit}&limit=${limit}` : null;
      return json(200, { items: page, next });
    }
    if (playlist && method === 'POST') {
      const uris = (JSON.parse(body ?? '{}') as { uris?: string[] }).uris ?? [];
      this.playlist.push(...uris);
      return json(201, { snapshot_id: 'TEST-snapshot' });
    }
    throw new Error(`FakeSpotify: unexpected ${method} ${url.href}`);
  }
}

/** S256(code_verifier) — 用來驗證伺服器送出的 verifier 與 authorize 時的 challenge 相符。 */
export const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/** 用假的「真實」planner 產生 LLM 提名（非 MOCK），讓 Search 對應路徑被走到。 */
export function nominatingPlanner(names: readonly { title: string; artist: string }[], seen: unknown[] = []): EditorialPlanner {
  const mock = new MockEditorialPlanner();
  return {
    kind: 'real',
    draft: async (input, context) => {
      seen.push(input);
      const base = (await mock.draft(input, context)) as { candidates: Candidate[] } & Record<string, unknown>;
      const candidates = names.map((name, i) => ({ ...base.candidates[i % base.candidates.length]!, candidateId: `n${i + 1}`, title: name.title, artist: name.artist, transitionBridge: null }));
      return { ...base, candidates };
    },
  };
}

export interface LinkedApp {
  readonly client: Client;
  readonly app: ReturnType<typeof testApp>;
  readonly fake: FakeSpotify;
  readonly file: string;
}

/** 走一次假的 PKCE 登入，回傳已連結的 app。 */
export async function linkedApp(env: Record<string, string>, overrides: AppOverrides = {}, fake = new FakeSpotify()): Promise<LinkedApp> {
  const file = tokenFile();
  const app = testApp({ ...env, SPOTIFY_TOKEN_FILE: file }, { fetchImpl: fake.fetch, ...overrides });
  const client = await bootstrap(app.app);
  const login = await client.agent.get('/api/auth/spotify/login').set('Sec-Fetch-Site', 'same-origin').expect(302);
  const state = new URL(String(login.headers.location)).searchParams.get('state') ?? '';
  await client.agent.get(`/callback?code=TEST-code&state=${state}`).expect(303);
  return { client, app, fake, file };
}

export async function spotifyShow(linked: LinkedApp): Promise<{ showId: string; segments: { segmentId: string; track: { audioLocator: { kind: string; uri?: string } } }[] }> {
  const job = await waitForJob(linked.client, (await postPlan(linked.client, planRequest())).body.jobId);
  return (await linked.client.agent.get(`/api/shows/${job.showId}`).expect(200)).body;
}

export const post = (client: Client, path: string, body: object = {}) =>
  client.agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf).send(body);
