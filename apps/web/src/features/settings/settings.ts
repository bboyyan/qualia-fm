export interface Settings {
  playbackMode: 'manual' | 'mock';
  djEnabled: boolean;
  djLength: 'short' | 'standard';
}
export const DEFAULT_SETTINGS: Settings = { playbackMode: 'manual', djEnabled: true, djLength: 'short' };

/** Persisted settings are untrusted; E has no representable enabled state. */
export function parseSettings(value: unknown): Settings {
  const parsed = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    playbackMode: parsed.playbackMode === 'mock' ? 'mock' : 'manual',
    djEnabled: typeof parsed.djEnabled === 'boolean' ? parsed.djEnabled : true,
    djLength: parsed.djLength === 'standard' ? 'standard' : 'short',
  };
}
