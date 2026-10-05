/**
 * Model data firewall (docs/04 模型資料防火牆). The planner only ever receives this typed DTO,
 * built by explicit field picking — never a serialised request, ShowPlan, session or provider
 * response. Extra properties smuggled onto the request object are dropped here.
 */
import type { LedgerRow, PlanRequest } from '@qualia/contracts';
import type { TrackRef } from './candidatePool.js';

export interface EditorialInput {
  readonly history: readonly LedgerRow[];
  readonly seedKind: 'feeling' | 'song' | 'sound';
  readonly seedText: string;
  readonly seedArtist: string | null;
  readonly tuning: string | null;
  readonly djEnabled: boolean;
  readonly djLength: 'short' | 'standard';
  /** BRA-127：同種子最近幾輪已選（只來自先前 LLM 提名的曲名／藝人，不含 Spotify 回傳欄位）。 */
  readonly recentPicks: readonly TrackRef[];
  /** BRA-127：0–1，越高越往較少被想到的 Vibe Cousins 走。 */
  readonly exploration: number;
}

export const EDITORIAL_INPUT_KEYS: readonly (keyof EditorialInput)[] = [
  'history',
  'seedKind',
  'seedText',
  'seedArtist',
  'tuning',
  'djEnabled',
  'djLength',
  'recentPicks',
  'exploration',
];

export function toEditorialInput(request: PlanRequest): EditorialInput {
  return {
    history: [],
    seedKind: request.seed.kind,
    seedText: request.seed.text,
    seedArtist: request.seed.artist,
    tuning: request.tuning,
    djEnabled: request.dj.enabled,
    djLength: request.dj.length,
    recentPicks: [],
    exploration: 0,
  };
}
