# Qualia FM｜播放與 Spotify 條款說明（BRA-101，給曄決定）

查證日期：**2026-10-04**（本機 `date '+%Y-%m-%d %H:%M:%S %Z'`：2026-10-04 20:05:12 CST）。本頁是工程風險說明，**不是法律意見，也不是 Spotify 核可或啟用授權**。標記「官方文件明文」「我們的推論」「待曄決定」分別代表來源事實、產品判讀與尚未授權的選項。

現況依 [README](../README.md)、[Provider gates](../handoff/docs/05_PROVIDER_GATES.md)、[播放引擎](../handoff/docs/06_PLAYBACK_ENGINE.md)、[T04](implementation/reports/T04.md)、[T05](implementation/reports/T05.md) 與 [decision log](implementation/decision-log.md)：main 的 B 手動播放模式與回饋閉環已實作：介紹文字與 MOCK 提示音後，由使用者自行在 Spotify app 點歌，再於本站選「愛／還行／不對」與原因，送出或略過後進下一首；目前只寫 TEST 假帳本。MOCK 另可播放合成測試音，沒有真實歌曲、LLM 或 TTS。E 模式仍停用，`SPOTIFY_ENABLED` 與 `SPOTIFY_DJ_APPROVED` 維持 `false`，本版設成 `true` 會拒絕啟動；設定頁 DJ 開關只控制 MOCK，不能開啟 Spotify。

本票只新增文件，不花錢、不放金鑰、不接真實 API、不要求任何登入。唯一已確認的偏好是種子曲 **Evan Call〈Time Flows Ever Onward〉**（不推定其他偏好，也不宣稱已聽音分析）。本頁所有 Spotify／平台路徑均**依官方文件，未實測**；MOCK 的既有自動化證據也不是 iPhone 真機證據。

## 1. 目前各平台的播放能力表

**官方文件明文與票面差異：**票面「Web Playback SDK 不支援 iPhone／手機瀏覽器，僅電腦可用」與今日官方文件不符。官方列出桌面及 Android／iOS 的主要瀏覽器支援，並指出 iOS 轉移播放後不會自動啟播，需要使用者互動。[SDK overview](https://developer.spotify.com/documentation/web-playback-sdk)（查證：2026-10-04，依官方文件，未實測）。**我們的推論：**手機採外部播放仍是合理的產品選項，但不能把產品選擇寫成 SDK 全面不支援。

| 平台／路徑 | 官方能力（依官方文件，未實測） | Qualia FM 本版實際交付與邊界 |
|---|---|---|
| 電腦瀏覽器 | SDK 可在瀏覽器建立 Connect 播放裝置；需 Premium 使用者 token。[SDK](https://developer.spotify.com/documentation/web-playback-sdk)、[Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)（2026-10-04） | 只播 MOCK 測試音；SDK adapter 停用。純音樂整合與 DJ 都未交付。 |
| iPhone 瀏覽器 | 官方列 mobile iOS 支援，但轉移後需互動；iOS 音量不可用 JavaScript 設定。[SDK](https://developer.spotify.com/documentation/web-playback-sdk)、[Reference／setVolume](https://developer.spotify.com/documentation/web-playback-sdk/reference)（2026-10-04） | 已提供 B 手動播放、MOCK 提示音／文字與回饋閉環。真實語音尚未完成；不承諾背景串接。 |
| iPhone Spotify app／Connect | Connect 是以一個裝置遙控另一裝置；app 可選播放裝置。API 的 Start/Resume 可控制 active device，需 Premium 及 OAuth 權限。[Connect](https://support.spotify.com/us/article/spotify-connect/)、[Start/Resume](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)（2026-10-04） | app 與網頁是不同音訊來源；本站沒有 Connect 控制、裝置轉移或同步。若曄自行操作既有 app，本站不讀取狀態。 |
| 曄手動點歌單 | 由 Spotify app 自行播放／選裝置。[Connect 操作說明](https://support.spotify.com/us/article/spotify-connect/)（2026-10-04） | 不使用本站 Spotify API／授權；曄自行找歌單、選曲與播放，本站不知道進度或是否出聲。指定歌曲能否按需播放，依帳號／地區／app 狀態待確認，不把 SDK Premium 規則直接套到所有手動 app 行為。 |

**已知限制的精確範圍：**票面提到「iPhone 暫停後休眠」，本次未實測；上述官方 SDK／Reference 沒有載明 iPhone 暫停後必然休眠的時間或恢復保證，故寫為**官方文件未載明／待確認**。Connect 官方僅說暫停超過 10 分鐘可能需要重新連線，不能等同證明所有 iPhone 瀏覽器會休眠。[Connect](https://support.spotify.com/us/article/spotify-connect/)、[SDK](https://developer.spotify.com/documentation/web-playback-sdk)、[Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)（查證：2026-10-04，依官方文件，未實測）。

## 2. 「語音介紹先播完再放歌」在各路徑的實際流程

以下把現行 MOCK 與未交付的真實流程分開；流程設計屬**我們的推論**，不是 Spotify 合規背書。

| 路徑 | 現況／將來流程與限制 |
|---|---|
| 本版電腦／iPhone 網頁 MOCK | 使用者按「開始收聽」→ DJ 提示音＋串詞文字 → 提示音結束或「跳過介紹」→ 同段合成測試音；非人聲、非真實歌曲。介紹失敗保留文字且不阻塞測試音，遭 autoplay 阻擋顯示「點一下繼續」（依 T04／T05，真機未測）。 |
| 電腦 SDK 純音樂（未實作） | 未來若核可，只由明確播放操作進歌曲；DJ gate 關閉時不執行介紹音訊。若另取得 DJ 許可，才可評估「介紹 ended → 確認停止 → 啟歌 → 確認播放事件」；不能只看連線成功就宣稱出聲。[Reference／ready、state、autoplay_failed](https://developer.spotify.com/documentation/web-playback-sdk/reference)（2026-10-04，依官方文件，未實測）。 |
| iPhone 網頁 SDK（未實作） | 即使完成介紹，轉移後仍可能需要新的使用者互動；不能承諾單次點擊可跨整段自動播放。SDK 的 activateElement 用於互動路徑；鎖屏／背景接續待確認。[SDK](https://developer.spotify.com/documentation/web-playback-sdk)、[Reference／activateElement](https://developer.spotify.com/documentation/web-playback-sdk/reference)（2026-10-04，依官方文件，未實測）。 |
| iPhone app／Connect（未實作） | 現在只能由曄自行停歌 → 回網頁讀文字（未來才有真實語音）→ 結束後自行回 app 選曲／播放。未來自動控制 app 必須另走 L2／G0；Player API 與其他 Player 端點的執行順序不保證，不能假設送出 pause 就能安全開始語音。[Start/Resume](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)（2026-10-04，依官方文件，未實測）。 |
| 曄手動點歌單 | 曄自行停歌 → 讀介紹文字（或日後經核可的獨立語音）→ 自己回 app 點歌單；每曲想先讀介紹就重複操作。本站不協調、不中斷外部播放，無法保證無雙播或曲間自動接續。本站已提供「愛／還行／不對」與原因回饋，寫入 TEST 假帳本；送出或略過後進下一首。 |

**我們的推論：**「不重疊」是必要的工程邊界，仍不能推導「先暫停再念」必然合規；Policy III.5／III.7 包含其他服務整合及 segue，不只禁止疊音。[Developer Policy](https://developer.spotify.com/policy)（查證：2026-10-04）。

## 3. 開啟 SPOTIFY_ENABLED／SPOTIFY_DJ_APPROVED 的條款風險

以下條款查證於 **2026-10-04**；Terms 頁顯示 Version 10、2025-05-15 生效，Policy 顯示 2025-05-15 生效。查證日不是生效日。[Developer Terms](https://developer.spotify.com/terms)、[Developer Policy](https://developer.spotify.com/policy)。

| 議題 | 官方文件明文 | 我們的推論／待確認 |
|---|---|---|
| AI 分析 Spotify 內容 | Terms IV.2.1.1／Policy III.14 禁止訓練或將 Spotify Content 輸入 ML／AI；Policy III.13 禁止分析 Spotify Content／Service，包括建立使用者畫像。[Terms](https://developer.spotify.com/terms)、[Policy](https://developer.spotify.com/policy)（2026-10-04） | 不把 Spotify 音訊、API metadata、封面、歌詞、收藏或歷史送入模型。使用者輸入也不能當作洗去 Spotify 資料來源限制的捷徑；未來獨立資料與權利須核對。 |
| DJ 語音疊歌／串接 | Policy III.5 禁止與其他服務串流／內容整合；III.7 禁止 segue、mix、remix、overlap Spotify Content 與其他音訊。[Policy](https://developer.spotify.com/policy)（2026-10-04） | ducking／crossfade／疊音不做；改成依序播放仍待用途審查。官方未針對 Qualia FM 的「先介紹再播放」提供個案核可，不能自行宣稱豁免。 |
| Premium 與費用 | SDK Reference 要求 Premium user token；Start/Resume API 只適用 Premium；開發模式 app owner 也需 Premium。[Reference](https://developer.spotify.com/documentation/web-playback-sdk/reference)、[Start/Resume](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)、[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)（2026-10-04） | 未查帳號，也不要求購買／登入；若沒有既有資格，與今天不花錢條件不相容。Premium 不代表 DJ／AI 用途取得許可。 |
| 開發者模式 | 最多 5 位 allowlisted authenticated users；未列入者可能登入成功但 API 回 403。quota 按 developer account 共用；超額回 429。2026/07 上限為 25 Client IDs。[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)、[July 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/july-2026)（2026-10-04） | allowlist／帳號／端點皆未驗證；不能以更多 Client IDs 迴避共用配額，也不能把 development mode 當用途豁免。 |
| 商業用途 | SDK overview 要求商業專案先取得 Spotify 書面核可。[SDK](https://developer.spotify.com/documentation/web-playback-sdk)（2026-10-04） | 本票不商業化／部署；私人使用亦不自動排除上述限制。 |

**待曄決定：**`SPOTIFY_ENABLED` 是整合 gate；`SPOTIFY_DJ_APPROVED` 是獨立的 DJ gate。任何開啟或本站 Spotify 授權登入都是 **L2，需曄當次明確同意**；同意也不能取代 Spotify 權利／政策核可。本版沒有可用真實 adapter，光改環境變數會拒絕啟動。後續須另票通過 G0-A 用途／資料流、G0-B 帳號／API、G0-C 真機播放，並留可追溯證據；本頁不是已完成 G0 的證明。

## 4. 替代方案與各自取捨

以下保留**我們的推論／提案**與取捨；B 手動播放與本站回饋已在 main 實作，其餘整合仍未交付，所有選項都維持兩個 Spotify 開關 `false`。

| 方案 | 得到什麼 | 取捨／邊界 |
|---|---|---|
| 不開本站 Spotify：曄手動點歌單＋自行回饋 | 用既有 app 聽歌，依本站文字理由自行判斷 | 需切 app／手動選曲；本站回饋按鈕已實作，目前寫入 TEST 假帳本；不讀 Spotify 歷史、不建立真實偏好檔案、不保證同步。 |
| 只出推薦與理由 | 先核對 Seed／Bridge 是否有用，無播放整合 | 現在只有 MOCK 虛構推薦；真實推薦須另核對獨立資料來源，標示推測，不能聲稱聽過或分析 Spotify 音訊。[Terms／AI 限制](https://developer.spotify.com/terms)（2026-10-04） |
| 繼續 MOCK，日後用自有／明確授權的其他來源 | MOCK 可驗流程；權利允許時才可能在本站做完整介紹→歌曲 | MOCK 不是音樂體驗；其他音源須逐項確認串流、語音串接與分析權利，曲庫／費用／手機背景表現都待確認。本票不挑付費供應商、不抓平台音檔，也不承諾其他服務沒有條款限制。 |

## 5. 請曄決定：選項與建議

**建議（我們的推論）：**今天先保留 MOCK，或由曄自行手動點歌單／使用本站 TEST 回饋；這最符合不花錢、不登入、不接 API 的限制。先確認文字理由與手動流程是否值得繼續，再另票研究已授權音源。這是建議，**不替曄決定，也不把任何選項視為已同意**。

未驗證：iPhone／電腦 SDK、Spotify app／Connect、Premium／allowlist／端點、iPhone 暫停休眠與鎖屏／背景恢復、真實語音與無雙播、個案用途核可。本頁可用 git revert 回滾。

### 待曄決定

- [ ] A｜維持 MOCK／只評估文字推薦與理由，兩開關 `false`：**L1**（僅文件與 mock 評估；真實服務另票）。
- [ ] B｜本站不接 Spotify，曄自行用既有 app 手動點歌單＋本站 TEST 回饋，兩開關 `false`：**L1**（本站無登入／控制；B 手動播放與回饋閉環已實作）。
- [ ] C｜先研究自有／明確授權的其他音源，兩開關 `false`：**L1**（只做文件研究；任何購買、金鑰、真實服務接入須另行授權，不在今天範圍）。
- [ ] D｜另票評估 Spotify 純音樂整合：**L2**（本站授權登入／開啟 `SPOTIFY_ENABLED` 前需曄當次明確同意及 G0 證據；DJ gate 維持關閉）。
- [ ] E｜另票評估 Spotify＋DJ 依序串接：**L2**（兩開關各需曄當次明確同意；還需獨立用途／權利核可與真機驗證；不代表准許疊歌或 AI ingestion）。
