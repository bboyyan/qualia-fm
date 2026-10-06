# Qualia FM｜E 模式（Spotify 自動串接）啟用與回滾（BRA-109）

本頁是 BRA-109 落地後的操作說明。**預設全部關閉**：env 未設或照 `.env.example` 時，行為與 BRA-98 相同（B 手動＋MOCK，`/api/auth/spotify/*` 一律 `FEATURE_RESTRICTED`，CSP 不放行任何第三方來源，網頁不載入 Spotify SDK）。開啟屬 **L2**，由 Rudeus 依 L2 流程啟用並回報；實作者不設 `true`。條款風險見 [spotify-playback-and-terms.md](spotify-playback-and-terms.md)。

## 1. 架構一覽

| 部分 | 位置 | 說明 |
|---|---|---|
| 開關閘門 | `apps/server/src/config/env.ts` | `SPOTIFY_ENABLED=true` 需 Client ID、redirect URI、加密金鑰三項有效；`SPOTIFY_DJ_APPROVED=true` 另需 `SPOTIFY_ENABLED=true` 與非空 `SPOTIFY_APPROVAL_REFERENCE`。缺任一即拒絕啟動（fail closed），錯誤只點名變數不回顯值。 |
| 授權 | `apps/server/src/spotify/auth.ts`、`routes/spotify.ts` | Authorization Code + PKCE（S256、無 client secret）。`GET /api/auth/spotify/login` 產生 state＋verifier 綁定 session（一次性、10 分鐘）後轉到 Spotify；回呼由 `GET /callback`（Dashboard 登記的路徑，掛在 SPA fallback 之前）與別名 `GET /api/auth/spotify/callback` 處理；`POST /api/auth/spotify/logout`（session＋CSRF）刪除 token 檔並清掉記憶體中節目的 Spotify 欄位。 |
| token 小檔 | `apps/server/src/spotify/tokenStore.ts` | 只存 refresh token＋擁有者憑證的 SHA-256；AES-256-GCM（AAD 固定）、權限 600、原子寫入。缺金鑰或金鑰錯誤：不寫、讀取視為未連結。沒有擁有者雜湊的舊檔視為未連結（BRA-111 前的檔需重新連結）。refresh 被撤銷（invalid_grant）→ 刪檔要求重新連結。access token 只在記憶體。 |
| 擁有者（BRA-111 A1） | `auth.ts` `completeLogin`／`ownerStatus`、`routes/spotify.ts` `ownerServices` | **只有 `SPOTIFY_OWNER_USER_ID` 指定的 Spotify 帳號能成為擁有者。** 換到 token 後呼叫一次 Spotify `/v1/me`、只讀 `id` 並與 env 完全比對（區分大小寫）：不符 → 導回 `?spotify=account`，不寫 token 檔、不快取 access token、不發 cookie；`/v1/me` 失敗 → `?spotify=error`，同樣不留任何東西；未設定 `SPOTIFY_OWNER_USER_ID` → login 直接導回 `?spotify=unconfigured`、不轉去 Spotify（fail closed）。`/me` 的名稱、email 不保存、不寫日誌，日誌也不記帳號 id。通過後，那個瀏覽器拿到擁有者憑證：HttpOnly、SameSite=Lax、Path=/、180 天的 `qfm_spotify_owner` cookie（`APP_ORIGIN` 為 HTTPS 時加 Secure，有測試），伺服器只存雜湊、以常數時間比對；綁裝置憑證而非 session，session 過期或伺服器重啟後仍有效。除了 login 本身，所有 Spotify 端點（token／devices／playback／play／pause／loved／logout）都要擁有者：未連結 →「請重新連結」，已由別人連結 →「只有擁有者能使用」，兩者都是 403 `FEATURE_RESTRICTED`，不呼叫 Spotify。已連結時非擁有者不能開始登入（`?spotify=owner`）；兩人同時登入時後完成者被拒。節目只替擁有者送 Spotify Search。`/api/capabilities` 的 `spotify.linked` 只對擁有者為 true，其他 session 看到 `linkedElsewhere=true`。擁有者重新連結會換新憑證；中斷連結清掉 cookie。**為什麼需要 env**：Spotify 開發者 allowlist 擋不住佔位——不在 allowlist 的帳號在 development mode 仍可能完成 OAuth（之後的 API 才回 403），只靠「先到先得」會讓第一個完成授權的陌生人佔走擁有者。 |
| 短期 token | `POST /api/spotify/token` | session＋CSRF，且需 E 模式核可；只給瀏覽器 Web Playback SDK。`Cache-Control: no-store`，不寫日誌。 |
| 播放代理 | `GET /api/spotify/devices`、`GET /api/spotify/playback`、`POST /api/spotify/play`、`POST /api/spotify/pause` | 需 E 模式核可。指令一律帶 `device_id`；`play` 只接受本 session 節目裡由伺服器對應出的 URI。404 → `DEVICE_UNAVAILABLE`、403 Premium → `SPOTIFY_ACCOUNT_ERROR`、其他 403 → `SPOTIFY_NOT_ALLOWLISTED`、429 → `RATE_LIMITED`（帶 Retry-After）、401 → 換新一次再送。 |
| 曲目對應 | `apps/server/src/spotify/resolver.ts` | Search（`type=track`、`limit=5`、`market=from_token`）**只**把 LLM 提名的曲名／藝人對應成可播放 URI；**曲名與藝人都要在正規化後對上**（NFKC 全半形、大小寫、標點；允許 Spotify 的「 - Remastered」後綴與括號註記；部分重疊不算），不可播或對不上就標 unavailable、換下一位候選，並在節目 warnings 記「已略過 N 首提名」（只有數量，不含 token 或 Spotify 內容）。MOCK 提名不送 Search。結果只進 `segment.track`（播放與 Loved 用）。 |
| Qualia Loved | `apps/server/src/spotify/loved.ts`、`POST /api/spotify/loved` | 只需 `SPOTIFY_ENABLED`＋已連結。URI 由伺服器依節目查（用戶端只送 showId／segmentId）。先讀 `GET /playlists/{id}/items` 去重，不在才 `POST /playlists/{id}/items`；同一首並行只寫一次；**沒有任何刪除**。 |
| 資料防火牆 | `PlanService.feedback`、`editorialInput.ts` | 帳本只寫日期／種子／LLM 提名的曲名・藝人／評價／原因；LLM 只吃種子、調整文字與帳本列。測試：`apps/server/test/spotifyFirewall.test.ts`。 |
| 網頁播放 | `apps/web/src/audio/adapters/` | `PlaybackRouter`（預設原樣交給單一 `<audio>`）＋`SpotifyWebPlaybackAdapter`（路徑 P）＋`SpotifyConnectAdapter`（路徑 C）。介紹（`<audio>`）停了並確認已停才送 play（`<audio>` 停止若非立即，最多等 1 秒，確認不了就不放歌）；Spotify 出聲時要播介紹，先暫停並等確認靜音，確認不了就不播介紹。 |
| 切段競態（B1） | 同上 | 每次切段換「世代」。play 還在路上時被下一首／JUMP／暫停：P 在生效後立刻 `player.pause()`，且我方不要聲音時 SDK 若回報在播一律再暫停；C 的 stop 只要有進行中的一首就送 pause，生效後再送一次並輪詢確認停止。「play 在路上」與「遲到的 play 待確認靜音」都算可能出聲，介紹會等到確認靜音才開始；等待期間若又被切段，那段介紹就不再開始。介紹播放中若 Spotify 遲到回報 started，router 停掉 Spotify、不轉給引擎。介紹前一律檢查 Spotify 輸出是否可能出聲（不只看上一段是否由 Spotify 播放），連按多次下一首也會等。是否被切段一律以請求世代判斷（不比對 current 物件，避免 SDK／輪詢先確認在播時誤把剛開始的歌暫停）。P 的待確認靜音只接受遲到那一首回報的 paused（舊曲目或 null 不算）；C 送出 pause 後主動輪詢（只在頁面可見時），這台還在播就再暫停，連續 1.5 秒沒在播才算安靜（最多輪詢 30 秒）；介紹最多等 6 秒，確認不了就不播介紹。測試：`apps/web/test/spotifyRace.test.ts`。 |
| 疊音修正（BRA-111） | `playbackRouter.ts`、兩個 adapter | 路徑 C：裝置可能在 play 回應約 2 秒後才出聲（靜音確認已結束、介紹已開始）。介紹播放期間 router 請輸出 `holdSilence`：C 每 2 秒查一次（只在頁面可見時；回前景立刻查），這台在播就再暫停、停介紹並把介紹回報失敗（引擎改顯示文字、直接進歌）；介紹已被使用者暫停時只暫停 Spotify。守候最多 60 秒（約 30 次查詢），介紹的 `<audio>` 開始被拒（例如需要點一下）時立刻解除。**這是把疊音限制在上限內，不是消除**：Sylphy 以假裝置模擬（pause 生效延遲 80ms 為假設值），晚出聲時殘餘疊音約 ≤ 2.1 秒（一次輪詢間隔＋pause 生效），真機量測列在 Linear BRA-114。路徑 P：**假設** SDK 可能先回報「載入中／已暫停」、短暫之後才出聲（80ms 是模擬用的假設值，不是 SDK 實測，待 BRA-114 真機確認）。待確認靜音時，那一首的已暫停必須不是載入中、且穩定 500ms 沒再出聲才算安靜；stop 時 play 已生效但還沒確認在播的那首也照此等待；router 在 stop 之後再問一次是否可能出聲。P 的 SDK 若在介紹中回報在播，同樣立刻暫停並停介紹。測試：`apps/web/test/spotifyOverlap.test.ts`。 |
| 網頁 UI | `apps/web/src/features/spotify/`、`features/player/LoveStep.tsx` | 沿用既有 `--q-*` 配色與 Button／InlineRecovery／BottomSheet／設定頁 group 元件；design-v1 只採旅程、文案與狀態。例外（BRA-111 A2）：曲目卡用 **Spotify 完整官方 logo**（圖示＋字標，官方下載原檔，見第 8 節）顯示 80×22（數位最小寬 70px）、四周 11px 留白；封面圓角 4px（手機）／8px（≥600px 放大為 128px）；顯示曲名＋歌手＋專輯（`ResolvedTrack.canonicalAlbum`，只顯示、不進 AI／帳本、中斷連結時清掉）。截斷的曲名／歌手／專輯都帶 `title`，並有「顯示完整曲目資訊」按鈕（`aria-expanded`／`aria-controls`）展開成多行全文。 |

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
| `SPOTIFY_OWNER_USER_ID` | 空 | **唯一能成為擁有者的 Spotify 帳號 id**（`/v1/me` 的 `id`；在 Spotify 帳戶頁「帳戶總覽」的使用者名稱）。非秘密，區分大小寫。未設定＝伺服器可以啟動，但**拒絕任何連結**（fail closed）；`SPOTIFY_ENABLED=true` 時格式明顯錯誤（空白、斜線等）拒絕啟動。 |
| `SPOTIFY_LOVED_PLAYLIST_ID` | `0dF9anAJZv0IotD6lo2kl2` | Qualia Loved。若改成公開歌單需另加 `playlist-modify-public`（本版未要求）。 |

Scopes 固定七個（測試鎖定白名單）：`streaming`、`user-read-email`、`user-read-private`（這兩個是 Web Playback SDK 官方要求）、`user-read-playback-state`、`user-modify-playback-state`、`playlist-modify-private`、`playlist-read-private`。本站只在連結完成時呼叫一次 `/v1/me`、只讀 `id` 比對 `SPOTIFY_OWNER_USER_ID`；名稱、email 等不保存、不寫日誌，也不呼叫其他讀取個人資料的 API。

## 3. 啟用 checklist（L2）

1. [ ] 曄確認：Spotify 開發者應用存在、Client ID 與 redirect URI 與 Dashboard 一致、自己的帳號在 Users Management allowlist、Premium 有效。
2. [ ] 在 Mac mini repo 外建立權限 600 的 env 檔（例如 `~/.config/qualia-fm/spotify.env`），只放：`SPOTIFY_CLIENT_ID`、`SPOTIFY_REDIRECT_URI`、`SPOTIFY_TOKEN_ENC_KEY`、`SPOTIFY_TOKEN_FILE`（絕對路徑）、`SPOTIFY_OWNER_USER_ID`（曄的 Spotify 帳號 id；沒設就不能連結）。不要放進 repo 或 `.env.example`。
3. [ ] 服務的 `APP_ORIGIN` 是可信 HTTPS（與 redirect 同源），Cookie 才會是 `Secure`，`/callback` 也才回到同一個 session。
4. [ ] 先只開 `SPOTIFY_ENABLED=true`（`SPOTIFY_DJ_APPROVED=false`）重啟；確認啟動成功、`/api/capabilities` 出現 `spotify.linked=false`。
5. [ ] 在**要當擁有者的那台裝置**（曄的 iPhone Safari 或加入主畫面的 PWA）：設定 → E 模式 →「連結 Spotify」→ 同意 sheet → Spotify 授權頁 → 回到 App 顯示「已連結」；確認 token 檔權限 600、內容不是明文。用另一個瀏覽器開同一網址，確認設定頁顯示「已由另一台裝置連結」、E 模式不可選。
   - **第一次連結與每次重新連結都只在 Tailscale 內完成，不可經公開 tunnel。** `SPOTIFY_OWNER_USER_ID` 已擋下別的帳號，但仍建議連結入口不對外，降低被拿來嘗試的機會。
   - 用不是擁有者的 Spotify 帳號試一次，確認回到 App 顯示「這個 Spotify 帳號不是這台伺服器設定的擁有者帳號」、token 檔沒有建立。
   - 注意：Safari 與加入主畫面的 PWA 的 cookie 是分開的；在哪裡連結，就只有那裡是擁有者。擁有者 cookie 遺失（清除網站資料）時，刪除 `SPOTIFY_TOKEN_FILE` 後重新連結。
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
- BRA-111 疊音修正的真機量測（Linear BRA-114）：路徑 P 實際「已暫停 → 出聲」間隔（量 `player_state_changed` 時間戳並耳聽；80ms 只是模擬假設）是否都在 500ms 內；路徑 C 裝置晚出聲時的殘餘疊音（模擬上限約 2.1 秒）是否可接受、2 秒守候輪詢是否觸發 429。
- 擁有者 cookie 在 iPhone Safari／PWA 經 Spotify 回呼（跨站頂層導覽的 303）後是否確實寫入。
- Premium／allowlist 錯誤的實際回應與文案。

## 6. 回滾

1. 設 `SPOTIFY_DJ_APPROVED=false`（只關 E 模式，保留登入與 Loved）或兩者都設 `false`，重啟服務 → 回到 B 手動。
2. 刪除 token 小檔（`SPOTIFY_TOKEN_FILE`）；或在 App 設定按「中斷 Spotify 連結」（需 `SPOTIFY_ENABLED=true` 時）。
3. 到 Spotify 帳戶「應用程式」頁撤銷 Qualia FM 授權。
4. 程式層：revert 本 PR；`.env.example` 的 Spotify 值本來就是空／false。

## 7. 啟用前事項

BRA-111 已處理（L1，程式與單元測試；報告見 [implementation/reports/BRA-111.md](implementation/reports/BRA-111.md)）：

- **A1｜擁有者綁定**：已完成，見第 1 節「擁有者」。啟用前必須設定 `SPOTIFY_OWNER_USER_ID`，且連結只在 Tailscale 內完成。
- **A2｜Spotify 標示規範**：已完成完整官方 logo（官方下載原檔，第 8 節）、留白、封面 4／8px、曲名＋歌手＋專輯，且截斷時可展開看全文。
- **Connect 慢反應疊音**：有上限、未消除（模擬約 ≤ 2.1 秒），真機量測在 BRA-114。**Web Playback 短暫疊音**：依假設修正並有單元測試，真機確認在 BRA-114。

仍待處理：

- **真機驗證（G0-C／BRA-114）**：見第 5 節，全部未驗。

## 8. Spotify 標示素材

- 檔案：`apps/web/public/brand/spotify/Spotify_Full_Logo_RGB_Green.png`（3432×940，RGBA，未修改）。網頁以 `/brand/spotify/Spotify_Full_Logo_RGB_Green.png` 靜態引用（同源，不需改 CSP）。
- 來源：Spotify Newsroom 媒體包頁 <https://newsroom.spotify.com/media-kit/logo-and-brand-assets/> 的「2024 Spotify Brand Assets」壓縮檔 <https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/2024-Spotify-Brand-Assets.zip>（壓縮檔 SHA-256 `ff4010d8f5b0527126c1a7db9de97d498eaf2b3b4564f02b90afbf49bc71c215`；內含檔案日期 2024-05-23），取自其中 `2024 Spotify Brand Assets/Spotify_Full_Logo_RGB_Green.png`。下載時間 2026-10-05 07:25 UTC。
- 檔案 SHA-256：`691d3c7145702c0533b651efa6c29af57235e2ba7a2f7d54f57e650086d8915c`（`spotifyBrand.test.ts` 鎖定，換檔會失敗）。
- 授權：Spotify 商標與 logo 屬 Spotify AB，**不是開放授權**；只能依 Spotify Design Guidelines（<https://developer.spotify.com/documentation/design>）與 Spotify Developer Terms 的條件，用於標示內容來自 Spotify。不得修改、變色、變形或拆開圖示與字標。官方包只提供 PNG（沒有 SVG），所以使用 PNG 原檔。
- 選色：卡片底色是接近白的 `--q-surface`，依規範使用綠色版（亦可用黑色版 `Spotify_Full_Logo_RGB_Black.png`）。

## 9. 已知缺口

- **BRA-117 已接受取捨（曄）**：路徑 C 在未知時長且本次曾於正位置播放後，在 Spotify app 內暫停並 seek 到 0，會被當成播完；與自然完播訊號分不出來。接受為已知取捨，不擋合併，保留 `ended` 行為。本頁主動暫停則不應被判為完播（包含在途輪詢回覆）。
- Notion 帳本仍未接線（`app.ts` 預設 `InMemoryLedger`）；UI 模式列如實顯示「TEST 假帳本」。
- 「改用手動播放」後回到該首開頭會重播介紹。
- 封面來自 `i.scdn.co`，只顯示、不快取、不進 AI；E2E 以 data URI 假封面驗證。

## BRA-173：我的歌按需展示 API（D-55、D-56）

`POST /api/spotify/song-display` 受既有 session、同源、CSRF 與 Spotify 路由限流保護。body 為 `{ "trackKeys": ["帳本中的 key"] }`，1–10 筆、不可重複、不接受額外欄位。回應 `{ items: [...] }`；每筆為 `{ trackKey, status: "available", metadata: { artworkUrl, canonicalTitle, canonicalArtists, canonicalAlbum, externalUrl } }` 或 `{ trackKey, status: "unavailable" }`。metadata 重用 domain 的 ResolvedTrack 欄位定義，不包含播放 URI／provider ID；回應標記 `Cache-Control: no-store`。

只有 Spotify 啟用且憑證為目前 owner 才取得展示資料；未連結／非 owner／未啟用均回 unavailable，不查 Spotify、不顯示其標誌與外連。先查帳本提名，再重用 `jobStore.ownedShows(session.id)` 中相同 candidate key 的已解析 Spotify 曲目；缺少時使用既有 resolver，依序解析。429 沿用 Web API 的 Retry-After，服務在冷卻期間不再查 Search；前端不自動重試。

前端以 IntersectionObserver 只請求目前清單中的可見列，每批至多 10 首、同時一批、合併同 key 在途請求；切換清單或卸載時取消並清空展示資料。解除連結同時取消伺服器在途展示、清掉前端展示並沿用既有節目 scrub。結果不得進帳本、AI 或持久層；只將封面網址交由 img 載入，不由伺服器抓圖片。

A 案標誌白框源自稿件 `.spotify { background: var(--q-surface) }`。repo 官方 PNG 原檔具有 alpha 透明背景（3432×940，四角 alpha=0），沿用 `SpotifyTrackCard.tsx` 的 `SPOTIFY_LOGO`，不去背、不修改素材；標誌與容器背景透明，80px 寬、四周 11px 留白。封面 64×64、4px 圓角、object-fit: contain、不疊狀態或操作；無圖與 onError 皆同尺寸佔位。單行省略資訊可展開全文與專輯，來源外連至少 44px 高。
