# Qualia FM｜E 模式（Spotify 自動串接）啟用與回滾（BRA-109）

本頁是 BRA-109 落地後的操作說明。**預設全部關閉**：env 未設或照 `.env.example` 時，行為與 BRA-98 相同（B 手動＋MOCK，`/api/auth/spotify/*` 一律 `FEATURE_RESTRICTED`，CSP 不放行任何第三方來源，網頁不載入 Spotify SDK）。開啟屬 **L2**，由 Rudeus 依 L2 流程啟用並回報；實作者不設 `true`。條款風險見 [spotify-playback-and-terms.md](spotify-playback-and-terms.md)。

## 1. 架構一覽

| 部分 | 位置 | 說明 |
|---|---|---|
| 開關閘門 | `apps/server/src/config/env.ts` | `SPOTIFY_ENABLED=true` 需 Client ID、redirect URI、加密金鑰三項有效；`SPOTIFY_DJ_APPROVED=true` 另需 `SPOTIFY_ENABLED=true` 與非空 `SPOTIFY_APPROVAL_REFERENCE`。缺任一即拒絕啟動（fail closed），錯誤只點名變數不回顯值。 |
| 授權 | `apps/server/src/spotify/auth.ts`、`routes/spotify.ts` | Authorization Code + PKCE（S256、無 client secret）。`GET /api/auth/spotify/login` 產生 state＋verifier 綁定 session（一次性、10 分鐘）後轉到 Spotify；回呼由 `GET /callback`（Dashboard 登記的路徑，掛在 SPA fallback 之前）與別名 `GET /api/auth/spotify/callback` 處理；`POST /api/auth/spotify/logout`（session＋CSRF）刪除 token 檔並清掉記憶體中節目的 Spotify 欄位。 |
| token 小檔 | `apps/server/src/spotify/tokenStore.ts` | 只存 refresh token；AES-256-GCM（AAD 固定）、權限 600、原子寫入。缺金鑰或金鑰錯誤：不寫、讀取視為未連結。refresh 被撤銷（invalid_grant）→ 刪檔要求重新連結。access token 只在記憶體。 |
| 短期 token | `POST /api/spotify/token` | session＋CSRF，且需 E 模式核可；只給瀏覽器 Web Playback SDK。`Cache-Control: no-store`，不寫日誌。 |
| 播放代理 | `GET /api/spotify/devices`、`GET /api/spotify/playback`、`POST /api/spotify/play`、`POST /api/spotify/pause` | 需 E 模式核可。指令一律帶 `device_id`；`play` 只接受本 session 節目裡由伺服器對應出的 URI。404 → `DEVICE_UNAVAILABLE`、403 Premium → `SPOTIFY_ACCOUNT_ERROR`、其他 403 → `SPOTIFY_NOT_ALLOWLISTED`、429 → `RATE_LIMITED`（帶 Retry-After）、401 → 換新一次再送。 |
| 曲目對應 | `apps/server/src/spotify/resolver.ts` | Search（`type=track`、`limit=5`、`market=from_token`）**只**把 LLM 提名的曲名／藝人對應成可播放 URI；藝人要對得上、不可播就換下一位候選。MOCK 提名不送 Search。結果只進 `segment.track`（播放與 Loved 用）。 |
| Qualia Loved | `apps/server/src/spotify/loved.ts`、`POST /api/spotify/loved` | 只需 `SPOTIFY_ENABLED`＋已連結。URI 由伺服器依節目查（用戶端只送 showId／segmentId）。先讀 `GET /playlists/{id}/items` 去重，不在才 `POST /playlists/{id}/items`；同一首並行只寫一次；**沒有任何刪除**。 |
| 資料防火牆 | `PlanService.feedback`、`editorialInput.ts` | 帳本只寫日期／種子／LLM 提名的曲名・藝人／評價／原因；LLM 只吃種子、調整文字與帳本列。測試：`apps/server/test/spotifyFirewall.test.ts`。 |
| 網頁播放 | `apps/web/src/audio/adapters/` | `PlaybackRouter`（預設原樣交給單一 `<audio>`）＋`SpotifyWebPlaybackAdapter`（路徑 P）＋`SpotifyConnectAdapter`（路徑 C）。介紹（`<audio>`）停了並確認已停才送 play；Spotify 出聲時要播介紹，先暫停並等確認靜音，確認不了就不播介紹。 |
| 網頁 UI | `apps/web/src/features/spotify/`、`features/player/LoveStep.tsx` | 沿用既有 `--q-*` 配色與 Button／InlineRecovery／BottomSheet／設定頁 group 元件；design-v1 只採旅程、文案與狀態。 |

## 2. 新增 env

| 變數 | 預設 | 說明 |
|---|---|---|
| `SPOTIFY_ENABLED` | `false` | 整合 gate：登入、手動連結、「愛」→ Loved。 |
| `SPOTIFY_DJ_APPROVED` | `false` | E 模式 gate：SDK token、自動串接播放。 |
| `SPOTIFY_APPROVAL_REFERENCE` | 空 | DJ 核可依據（票號＋時間），`SPOTIFY_DJ_APPROVED=true` 時必填。 |
| `SPOTIFY_CLIENT_ID` | 空 | 非秘密，只從 env 讀，程式不寫死。示例：`643a3f074bd74c039161010453a7e56f`。 |
| `SPOTIFY_REDIRECT_URI` | 空 | 必須與 Dashboard 完全一致；HTTPS（或明確 loopback IP 的 http，`localhost` 不行）；路徑只能是 `/callback` 或 `/api/auth/spotify/callback`。曄登記的是 `https://jaxpkmmac-mini.tailaa16c2.ts.net:10000/callback`。 |
| `SPOTIFY_TOKEN_ENC_KEY` | 空 | 32 bytes（base64 或 hex），`openssl rand -base64 32`。放 repo 外、權限 600 的 env 檔。 |
| `SPOTIFY_TOKEN_FILE` | `./data/spotify-token.enc` | 加密 token 小檔；建議設絕對路徑（相對路徑會隨啟動目錄改變，等於未連結）。 |
| `SPOTIFY_LOVED_PLAYLIST_ID` | `0dF9anAJZv0IotD6lo2kl2` | Qualia Loved。若改成公開歌單需另加 `playlist-modify-public`（本版未要求）。 |

Scopes 固定五個：`streaming`、`user-read-playback-state`、`user-modify-playback-state`、`playlist-modify-private`、`playlist-read-private`。

## 3. 啟用 checklist（L2）

1. [ ] 曄確認：Spotify 開發者應用存在、Client ID 與 redirect URI 與 Dashboard 一致、自己的帳號在 Users Management allowlist、Premium 有效。
2. [ ] 在 Mac mini repo 外建立權限 600 的 env 檔（例如 `~/.config/qualia-fm/spotify.env`），只放：`SPOTIFY_CLIENT_ID`、`SPOTIFY_REDIRECT_URI`、`SPOTIFY_TOKEN_ENC_KEY`、`SPOTIFY_TOKEN_FILE`（絕對路徑）。不要放進 repo 或 `.env.example`。
3. [ ] 服務的 `APP_ORIGIN` 是可信 HTTPS（與 redirect 同源），Cookie 才會是 `Secure`，`/callback` 也才回到同一個 session。
4. [ ] 先只開 `SPOTIFY_ENABLED=true`（`SPOTIFY_DJ_APPROVED=false`）重啟；確認啟動成功、`/api/capabilities` 出現 `spotify.linked=false`。
5. [ ] 設定 → E 模式 →「連結 Spotify」→ 同意 sheet → Spotify 授權頁 → 回到 App 顯示「已連結」；確認 token 檔權限 600、內容不是明文。
6. [ ] L2 核可後設 `SPOTIFY_DJ_APPROVED=true` 與 `SPOTIFY_APPROVAL_REFERENCE=BRA-109 <核可時間>`，重啟。
7. [ ] 依第 5 節做 G0-C 真機驗收並回報。

## 4. L2 流程摘要

- 曄 10/05 03:11 當次同意 E 模式（REQUIREMENTS A1-4）＝內部 L2 授權，**不等於** Spotify 官方用途核可（Policy III.5／III.7 灰區仍在）。
- 開關只在伺服器 env；網頁的 E 選項只能在伺服器允許時選，不接受 query、body 或模型輸出。
- 每次寫入使用者 Spotify（Loved）都先跳確認 sheet；可選「只在帳本記愛」。
- 使用者可隨時在設定「中斷 Spotify 連結」：刪除 token 檔、清掉記憶體中的 Spotify 欄位、回到手動。

## 5. 需真機驗證（G0-C，本 PR 未驗）

- iPhone Safari：「開始收聽」那一下能否讓 SDK `activateElement` 生效；SDK 首次載入是非同步的，第一首可能需要「點一下繼續」。
- 一次手勢能否撐過 5 首（介紹 `<audio>` 與 SDK 是兩個音訊來源）。
- 鎖屏／背景／暫停後 `not_ready` 的實際時間；三段提示是否足夠；`spotify:` 深連結能否打開 app。
- 暫停超過 10 分鐘的重新確認流程。
- 播完偵測（`player_state_changed` 暫停在 0／曲目進到上一首）在真實 SDK 上是否可靠；路徑 C 輪詢（2 秒）是否觸發 429。
- 官方 SDK 在本站 CSP（`script-src`／`frame-src https://sdk.scdn.co`、`img-src https://i.scdn.co`）下是否完整可用；EME／Permissions-Policy 是否需要調整。
- Premium／allowlist 錯誤的實際回應與文案。

## 6. 回滾

1. 設 `SPOTIFY_DJ_APPROVED=false`（只關 E 模式，保留登入與 Loved）或兩者都設 `false`，重啟服務 → 回到 B 手動。
2. 刪除 token 小檔（`SPOTIFY_TOKEN_FILE`）；或在 App 設定按「中斷 Spotify 連結」（需 `SPOTIFY_ENABLED=true` 時）。
3. 到 Spotify 帳戶「應用程式」頁撤銷 Qualia FM 授權。
4. 程式層：revert 本 PR；`.env.example` 的 Spotify 值本來就是空／false。

## 7. 已知缺口

- Notion 帳本仍未接線（`app.ts` 預設 `InMemoryLedger`）；UI 模式列如實顯示「TEST 假帳本」。
- 已連結 token 為單一裝置（Mac mini）層級：任何能開這個網址的 session 都會使用同一個 Spotify 連結（僅 Tailscale 私網、單人使用的前提）。
- Spotify 標示目前是文字標籤；正式需換成 Spotify Design Guidelines 的官方 logo 素材。
- 「改用手動播放」後回到該首開頭會重播介紹。
- 封面來自 `i.scdn.co`，只顯示、不快取、不進 AI；E2E 以 data URI 假封面驗證。
