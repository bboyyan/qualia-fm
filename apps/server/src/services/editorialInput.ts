/**
 * Model data firewall (docs/04 模型資料防火牆). The planner only ever receives this typed DTO,
 * built by explicit field picking — never a serialised request, ShowPlan, session or provider
 * response. Extra properties smuggled onto the request object are dropped here.
 */
import type { LedgerRow, PlanRequest } from '@qualia/contracts';
import type { TrackRef } from './candidatePool.js';
import { EMPTY_TASTE_HINTS, type TasteHints } from './tasteRules.js';

export interface EditorialInput {
  readonly history: readonly LedgerRow[];
  /** 品味帳本的軟約束（BRA-134）：只含曲名／藝人／短評，由 PlanService 開台前填入。 */
  readonly tasteHints: TasteHints;
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
  'tasteHints',
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
    tasteHints: EMPTY_TASTE_HINTS,
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
