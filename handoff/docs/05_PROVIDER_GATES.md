# 05｜Provider 與行動音訊 Gate

核對日期：2026-10-04。以下是工程風險判讀，不是取得 Spotify 授權的證明，也不是法律意見。

## 不能直接照原 MVP 做的部分

Spotify 政策限制混音、重疊、segue、與其他服務內容整合；也限制將 Spotify Content 輸入 AI、分析與建構使用者畫像。一般 Premium 與個人開發不自動豁免這些規則。因此**不能認定「先暫停音樂再念 TTS」就一定解決問題**；完整 Spotify＋AI DJ 模式須先確認適用權利／核可。[R1/R2]

SDK 在 iOS 不能透過 JavaScript 設定音量，且轉移播放後有使用者手勢要求。原案 ducking 不列為 iPhone 可交付功能。[R3/R4]

## 三個獨立 Gate

| gate | 檢查內容 | 成功證據 | 未通過時 |
|---|---|---|---|
| G0-A 產品用途 | Spotify streaming、DJ、AI 資料流與商業用途符合適用規定 | 記錄條款版本、用途、審查結論；必要時書面許可 | Spotify integration 關閉；做 mock／授權音源 |
| G0-B 帳號/API | Client ID、Premium、allowlist、redirect、實際端點 | 實際帳號 smoke test 與精確錯誤 | 保留理由／清單，不假裝可播 |
| G0-C 手機播放 | Safari／PWA 的啟動、串接、中斷、恢復 | 真機型號、OS、browser、日期、測試結果 | 明確顯示 tap-to-resume／前景限制 |

`SPOTIFY_ENABLED=false` 與 `SPOTIFY_DJ_APPROVED=false` 為兩個 server-side 設定，後者不是一般 UI 開關。`SPOTIFY_DJ_APPROVED=true` 需要可追溯的審查／許可依據，不是 agent 為通過測試自行打開。兩者皆不授權混音、音訊下載或 AI ingestion。

## 當前官方文件核對摘要

| 項目 | 核對結果 | 工程影響 |
|---|---|---|
| 開發模式 | app owner 需 Premium，最多 5 位 allowlisted authenticated users | 不把登入成功當作 API 已可用；403 單獨處理 [R5] |
| 2026/07 更新 | Client IDs 上限已改為 25；development quota 以 developer account 共用 | 不沿用「只能1個app」舊說法，也不能靠換 Client ID 逃配額 [R6] |
| 搜尋 | 2026/02 文件的 search limit 上限10、預設5 | 明示送 limit=5；不抄舊 limit=50 [R8] |
| `/me` 欄位 | development 變更涉及 country/email/product 等移除 | 不用 `/me.product` 唯一判斷 Premium；SDK 錯誤也要處理 [R8] |
| 2026/03 更新 | external_ids 的移除已撤回 | 有 ISRC 可核對，但仍需 nullable，不假設永遠存在 [R9] |
| 2026/05 更新 | account_id 為官方建議的穩定帳號識別 | 後續有綁定帳號時優先按官方文件；首版使用本機 session ID [R10] |
| OAuth redirect | HTTPS；明確 loopback IP 可 HTTP，localhost 不允許 | 手機不能照抄桌機 loopback URL [R7] |
| SDK 支援 | 官方列 mobile Android/iOS，但 iOS 有限制 | 「支援」不等於本產品任意背景串接都可靠 [R3] |

不要把上述已核對文件等同使用者帳號實測；本包沒有登入或測試使用者 Spotify 帳號。

## Provider capability matrix（首版預設）

| 能力 | mock | licensed | Spotify 未通過 gate | Spotify 已核可的純音樂模式 | external |
|---|---|---|---|---|---|
| 清單／文字 Bridge | 示意 | 是 | 視可合法取得資料 | 是，獨立資料流 | 是 |
| 完整曲目播放 | 否 | 音源授權且可達時 | 否 | SDK／Premium／裝置就緒時 | 不在本站 |
| DJ 插入 | 僅模擬 | 權利允許且實測時 | 否 | 否，除非獨立 DJ gate 也通過 | 不做自動協調 |
| 混音／crossfade | 否 | MVP 也不做 | 否 | 否 | 否 |
| 程式調音量 | 不假裝真實 | 依裝置實測，手機預設無 | 否 | iOS 無 | 無 |
| 鎖屏自動接續 | 不代表真機 | 待驗證 | 無 | 不保證 | 外部 App 自行處理 |

## 首個 capability spike

先只做：可信 HTTPS 開頁 → 點一次明確播放 → 播一首已授權曲目 → 暫停／繼續 → speech 到 track → 切背景 → 鎖屏 → 回到前景校準 → 藍牙中斷 → 恢復。記下成功與失敗，不先堆全部 LLM 功能。

Spotify spike 在用途 gate 通過後：PKCE → ready(device_id) → activateElement（點擊同步路徑）→ 明確裝置轉移 → 播放 → 讀取實際 state。HTTP 204 不代表已出聲，SDK connected 不代表正在播放。[R3/R4]

無法自動開始時顯示「點一下繼續」。不要用無限 silent audio、不必要的 wake lock 或虛假的背景 timers 試圖規避平台行為。

## 備援判準

- 無音樂權限：顯示 Bridge 與外連，或者使用權利清楚的 demo 音源；絕不擷取／代理平台音檔。
- preview URL 缺失／用途不允許：不強制 30 秒備援；預覽用途另受限制。[R1]
- TTS 不可用：保留文字，使用者可以直接進歌；Web Speech 只能是可選且經同意的裝置能力，不能保證聲線／繁中／背景行為一致。
- 真機背景表現不穩：在產品說明標示「完整 DJ 需保持前景」，而不是交付時隱藏。若未來必須長時間背景 DJ，再研究原生架構與可授權音源，不保證換原生就能解除 Spotify 條款。
