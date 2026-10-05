export interface Settings {
  playbackMode: 'manual' | 'mock';
  djEnabled: boolean;
  djLength: 'short' | 'standard';
}
/** 串詞預設是標準（加厚）版：曲名、藝人、為什麼接這首、聽的時候注意什麼（BRA-117）。 */
export const DEFAULT_SETTINGS: Settings = { playbackMode: 'manual', djEnabled: true, djLength: 'standard' };

/** Persisted settings are untrusted; E has no representable enabled state. */
export function parseSettings(value: unknown): Settings {
  const parsed = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    playbackMode: parsed.playbackMode === 'mock' ? 'mock' : 'manual',
    djEnabled: typeof parsed.djEnabled === 'boolean' ? parsed.djEnabled : true,
    djLength: parsed.djLength === 'short' ? 'short' : 'standard',
  };
}

/** v1 存的串詞長度是舊預設（短版）：升級時改用加厚版，其他選擇照舊（BRA-117）。 */
export function migrateLegacySettings(value: unknown): Settings {
  return { ...parseSettings(value), djLength: DEFAULT_SETTINGS.djLength };
}
