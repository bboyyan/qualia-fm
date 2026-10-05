import { PROVIDER_NOTICES, type ShowPlan } from '@qualia/contracts';
import type { ReactNode } from 'react';

/** Explicit, per-URL diagnostic opt-in. Never inferred from provider mode or persisted. */
export function developerMode(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('developer') === '1';
}

export function DeveloperOnly({ children }: { children: ReactNode }) {
  return developerMode() ? children : null;
}

/** Keep synthetic plans out of the listening journey, including AI fallback responses. */
export function canPresentShow(show: ShowPlan, llm: 'mock' | 'openai' | undefined, developer: boolean): boolean {
  return developer || (llm !== 'mock' && !show.segments.some((segment) => segment.track.provider === 'mock') &&
    !show.warnings.some((warning) => warning.startsWith(PROVIDER_NOTICES.llm)));
}
