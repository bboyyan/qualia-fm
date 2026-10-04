# 08｜API、Domain 與錯誤契約

機器可讀規格：`contracts/openapi.yaml`；LLM schema：`contracts/plan-draft.schema.json`；型別：`contracts/domain.ts`。這些是開工契約，並非既有 server 已提供。

## 通則

同源 HTTPS、JSON、session owner 驗證；POST/DELETE 需 CSRF header。除了 health、auth callback／start，其餘 API 都需有效 session（mock 也有匿名 demo session）。`POST /api/plan`、`POST /api/tts` 用 `Idempotency-Key`；同 key＋同 payload 回同 job；同 key 不同 payload 回409。

`POST /api/session` 建立匿名個人測試 session 並設 HttpOnly cookie；使用者無需產品帳密。mock 首版不代表服務可公開無限制使用。

## 端點

| 方法與路徑 | 用途 | 成功 |
|---|---|---|
| GET `/api/health` | 服務存活，不返回 secret | 200 |
| POST `/api/session` | 建立或恢復單使用者測試 session | 200 SessionInfo |
| GET `/api/capabilities` | mode／playback／DJ gate 真實能力 | 200 Capabilities |
| POST `/api/plan` | 開始可取消編排，非同步 | 202 JobInfo |
| GET `/api/jobs/{jobId}` | 真實 phase／結果／錯誤 | 200 JobInfo |
| DELETE `/api/jobs/{jobId}` | 取消 job，重複取消冪等 | 200 JobInfo |
| GET `/api/shows/{showId}` | 不可變 ShowPlan | 200 ShowPlan |
| POST `/api/tts` | 對 server 已有 segment 文本請求音訊 | 200 ready／202 queued TtsInfo |
| GET `/api/tts/{ttsId}` | TTS job 狀態 | 200 TtsInfo |
| GET `/api/media/tts/{ttsId}` | 私有音檔，檢查 session owner | 200 audio/mpeg |
| GET `/api/auth/spotify/start` | PKCE＋state | 302；gate 未開為403 |
| GET `/api/auth/spotify/callback` | 驗證 state 並換 token | 303 回 app；錯誤不露 code/token |
| GET `/api/auth/spotify/token` | SDK 必要短期 token，no-store | 200；不返回 refresh token |
| POST `/api/auth/logout` | abort、清 tokens、session 與私有暫存 | 204 |

Spotify Web API 代理若 gate 通過後需要，新增白名單 endpoint，不提供任意 URL proxy。播放 engine 在瀏覽器，首版不照搬 Claudio 的 server `/api/player/*` 控 HTMLAudioElement。

## 核心請求

`examples/plan-request.json` 是精確範例。Seed.kind 為 feeling / song / sound；song 必填 title（存在 seed.text）與 artist（不知道可以 null，但 planner 要說明歧義）。requestedCount 固定5；`tuning` 為可選短句（nullable），僅來自用戶自主輸入。

`POST /api/tts` 不接受客戶端任意 text；接受 showId、segmentId、variant（seed / transition）與 voiceId。server 取已校驗的文本與其 hash。Spotify mode 不允許 speech 時直接 `FEATURE_RESTRICTED`，不是合成好偷偷在 client 播。

## JobInfo

status = queued / running / completed / partial / failed / cancelled；phase = queued / understanding / matching / resolving / preparing / done。showId、error 可為 null。單次 job 的 `generationId` 一致；poll client 還需比對自己的 activeGenerationId。

poll 初始1.2秒，可逐步到3秒；hidden 停止 polling，回前景讀最新。完成或失敗就停止，不依照 poll 次數推假進度。request timeout 與整個 job deadline 分開。

## ErrorEnvelope

```json
{"error":{"code":"AUTOPLAY_BLOCKED","message":"手機需要一次點擊才能繼續播放。","retryable":true,"requestId":"req_demo","retryAfterMs":null}}
```

| code | HTTP（若來自 API） | 使用者處理 |
|---|---|---|
| INVALID_INPUT | 400 | 明確標記欄位 |
| SESSION_EXPIRED | 401 | 保留輸入，重新建立／登入 |
| CSRF_REJECTED | 403 | 重新載入 session，不洩露細節 |
| FEATURE_RESTRICTED | 403 | 顯示模式限制與允許替代 |
| SPOTIFY_NOT_ALLOWLISTED | 403（可確定時） | 查看播放環境；不把所有403都猜成allowlist |
| SPOTIFY_ACCOUNT_ERROR | 403 | SDK帳號錯誤與 Premium 提示 |
| NOT_FOUND | 404 | 檢查 session／內容到期 |
| IDEMPOTENCY_CONFLICT | 409 | 新的合法 request key |
| RATE_LIMITED | 429 | 依 Retry-After，不狂重試 |
| QUOTA_EXCEEDED | 429 | 明示配額；停止自動退避風暴 |
| MODEL_REFUSED | 422 | 修改輸入，不顯示原始內部訊息 |
| PLAN_INVALID | 502 | 有 budget 才 repair |
| PLAN_TIMEOUT | 504 | 保留 Seed；手動重試 |
| NO_RESOLVED_TRACKS | 422 | 修改 Seed／看外連與解說 |
| TTS_FAILED | 502 | 文字備援、直接進歌 |
| DEVICE_UNAVAILABLE | 409 | 重新連線 |
| AUTOPLAY_BLOCKED | client-side | 顯式手勢恢復 |
| AUDIO_SOURCE_FAILED | client-side/502 | 最多有限略過 |

未知 Spotify 403 先保留 providerErrorCategory=unknown，不編造確切原因；記錄已遮罩 requestId，導向環境檢查。

## 版本與相容

契約帶 schemaVersion=1。server ShowPlan 不可變；client Session queueRevision 獨立。nullable 欄位不可用空字串冒充。runtime schema 拒絕額外欄位；模型不能插入 provider IDs／URLs／工具指令。OpenAPI／TS／範例變動需一起提交並通過 contract tests。
