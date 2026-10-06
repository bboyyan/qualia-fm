import { z } from 'zod';

/** Error codes from handoff docs/08_API_CONTRACT.md. */
export const ERROR_CODES = [
  'INVALID_INPUT',
  'SESSION_EXPIRED',
  'CSRF_REJECTED',
  'ORIGIN_REJECTED',
  'FEATURE_RESTRICTED',
  'SPOTIFY_NOT_ALLOWLISTED',
  'SPOTIFY_ACCOUNT_ERROR',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'PIN_LIMIT_REACHED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'MODEL_REFUSED',
  'PLAN_INVALID',
  'PLAN_TIMEOUT',
  'NO_RESOLVED_TRACKS',
  'TTS_FAILED',
  'DEVICE_UNAVAILABLE',
  'AUTOPLAY_BLOCKED',
  'AUDIO_SOURCE_FAILED',
  'NETWORK_ERROR',
  'HISTORY_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorInfoSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  requestId: z.string().min(1).max(100),
  retryAfterMs: z.number().int().nonnegative().nullable(),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

export const ErrorEnvelopeSchema = z.strictObject({ error: ErrorInfoSchema });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** User-facing zh-TW copy. Never surface raw provider JSON or English engineering codes. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: '輸入內容需要調整，你的文字已保留。',
  SESSION_EXPIRED: '工作階段已過期，請重新建立。輸入已保留。',
  CSRF_REJECTED: '安全驗證未通過，請重新載入工作階段。',
  ORIGIN_REJECTED: '這個來源不被允許存取服務。',
  FEATURE_RESTRICTED: '這項功能在目前模式未啟用。',
  SPOTIFY_NOT_ALLOWLISTED: '這個帳號目前不能在此播放。',
  SPOTIFY_ACCOUNT_ERROR: '帳號目前不能在此播放，請查看播放環境。',
  NOT_FOUND: '找不到這個內容，可能已過期。',
  IDEMPOTENCY_CONFLICT: '這個請求與先前的內容不同，請重新送出。',
  PIN_LIMIT_REACHED: '釘選已滿，先取消一首再釘。',
  RATE_LIMITED: '服務目前達到使用限制，請稍後再試。',
  QUOTA_EXCEEDED: '已達這段時間的使用上限，可以先聽既有節目。',
  MODEL_REFUSED: '這段描述無法處理，請換個說法。',
  PLAN_INVALID: '這次編排沒有成功，可以再試一次。',
  PLAN_TIMEOUT: '這次找歌太久了，輸入已保留，可以手動重試。',
  NO_RESOLVED_TRACKS: '尚無可播曲目，可以修改感覺再試一次。',
  TTS_FAILED: '介紹暫時無法播放，文字仍可看。',
  DEVICE_UNAVAILABLE: '這個播放裝置目前未連線。',
  AUTOPLAY_BLOCKED: '手機需要一次點擊才能繼續播放。',
  AUDIO_SOURCE_FAILED: '這首暫時無法播放。',
  NETWORK_ERROR: '網路連線中斷了，不是你按了暫停。',
  HISTORY_UNAVAILABLE: '開台歷史檔讀不到或已損毀，需要人工修復後才能開台；本次未扣額度。',
  INTERNAL: '服務暫時出了點問題，請稍後再試。',
};
