/**
 * Model data firewall (docs/04 模型資料防火牆). The planner only ever receives this typed DTO,
 * built by explicit field picking — never a serialised request, ShowPlan, session or provider
 * response. Extra properties smuggled onto the request object are dropped here.
 */
import type { LedgerRow, PlanRequest } from '@qualia/contracts';

export interface EditorialInput {
  readonly history: readonly LedgerRow[];
  readonly seedKind: 'feeling' | 'song' | 'sound';
  readonly seedText: string;
  readonly seedArtist: string | null;
  readonly tuning: string | null;
  readonly djEnabled: boolean;
  readonly djLength: 'short' | 'standard';
}

export const EDITORIAL_INPUT_KEYS: readonly (keyof EditorialInput)[] = [
  'history',
  'seedKind',
  'seedText',
  'seedArtist',
  'tuning',
  'djEnabled',
  'djLength',
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
  };
}
