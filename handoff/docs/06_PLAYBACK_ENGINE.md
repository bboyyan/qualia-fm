# 06｜播放引擎、佇列與恢復

## 設計原則

一個 ShowSession、一個 active segment、一個 active audio owner。UI 只能 dispatch 明確命令，不直接呼叫多個 audio 元件。曲目與串詞在 domain 是一個 Segment；播放時分為 speech 與 track 兩階段。MVP 不混音、不 crossfade。

## 狀態

`empty → ready → starting → speaking / track_playing → paused → completed`

另有 `loading_speech`、`loading_track`、`awaiting_gesture`、`reconciling`、`recoverable_error`。`paused` 保留 `resumePhase`、segmentId、positionMs；不能只用 `isPlaying:boolean` 表達全部狀態。

### Transition table

| 原狀態／事件 | 條件／副作用 | 下一狀態 |
|---|---|---|
| empty + PLAN_READY | 建立 session，尚不播放 | ready |
| ready + USER_PLAY | 同步手勢 activate/unlock；attemptId++ | starting |
| starting | provider 不可播 | recoverable_error／external |
| starting | narration 已關閉或無權利 | loading_track |
| starting | 可播 narration 但 cache 未完成 | loading_speech |
| loading_speech + ready | 檢查 attemptId/segmentId/textHash | speaking |
| loading_speech + fail/deadline | 顯示文字備援，不阻塞 | loading_track |
| speaking + ended／SKIP_INTRO | 只完成一次；清掉 speech owner | loading_track |
| speaking + USER_PAUSE | pause speech，保存 offset | paused(resumePhase=speech) |
| loading_track + provider_playing | 以 provider 事件確認 | track_playing |
| 任意啟播 + NotAllowed／autoplay_failed | 不 retry storm；保留想播的 phase | awaiting_gesture |
| awaiting_gesture + USER_RESUME | 同步手勢重試該 phase | starting／loading_track |
| track_playing + USER_PAUSE | 等 provider state 校正 | paused(resumePhase=track) |
| paused + USER_PLAY | 恢復保存 phase，不重頭念介紹 | speaking／track_playing |
| 任意 + NEXT_SEGMENT | abort 舊 attempt；stop 全部 owner；移至下一 segment | starting／completed |
| track_playing + TRACK_COMPLETED | 已確認是自然結束且未處理過 | 下一段 starting／completed |
| 任意 + DEVICE_LOST | 取消自動換曲、保留 queue | reconciling |
| reconciling + verified paused/playing | provider 是真實來源 | paused／track_playing |
| reconciling + unknown | 顯示「重新連線」 | recoverable_error |
| 任意 + NEW_SHOW_COMMIT | abort 舊 attempt；原子換 session | ready（除非使用者明示立即開始） |

## 核心不變量

1. 音樂與 speech 永不同時 audible。Spotify 未獲 DJ 權限時，不得執行 speech pipeline。
2. 每個 async 結果都帶 `sessionId`、`segmentId`、`attemptId`；不匹配就丟棄。換台、下一首、取消、unmount 或登出令 attemptId 失效。
3. 一次 `ended` 只推進一次。speech ended 不等於整個 Segment ended。
4. 多次快速 NEXT 必須序列化；每次代表一個明確命令，但不能交錯載入造成舊歌回來。`requestId` 重複則去重。
5. 曲目失敗最多自動略過 2 首；再失敗停止並顯示可恢復錯誤，不能無限輪播空佇列。
6. 正在播的 Segment 不能被 queue remove；最後一首結束就 completed，MVP 不擅自生成無限接續。
7. 提前生成的 TTS 永不自行播放。cache ready 是資料事件，不是播放指令。
8. 畫面進度以 provider confirmed position 為基準；本機動畫只是前景短時間內插值，不能用它判斷真正完播。

## 參考命令型別

見 `contracts/domain.ts`。`PLAY / PAUSE / NEXT_SEGMENT / SKIP_INTRO / RESTART_TRACK / SEEK / REMOVE_UPCOMING / RESTORE_REMOVED / COMMIT_TAIL / RECONCILE` 是明確命令。

`RESTART_TRACK` 重新播放當前歌曲，不重念 speech；在 speech phase 時應呈現「跳過介紹」，不混用按鈕語意。`SEEK` 只允許 provider capability=true 且目前 phase=track，值夾在 duration 範圍。

## 有限 TTS 管線

優先產生第一首與緊接一首；後續每首快取 ready 後，再預抓下一首。伺服器合成 concurrency 預設2。cache key 包含 ownerNamespace、normalizedText、model、voice、language、instructionsVersion、speed、format。

前一曲播放時預生成下一段是**網路預備**，不是在背景播放 speech。TTS 到點仍未 ready，最多等本次 UX 規格的 2 秒 grace window（目標，需實測），之後直接進歌並顯示文字。

串詞文字 hash 改變、聲線改變、transition 前曲不符，都不得播舊快取。首版優先用 seedBridge 對應的 djLine；transition 只有實際前曲 id 完全相符才使用。

## Licensed adapter

使用一個長存活 HTMLAudioElement 在 speech／track 間切換，避免 React re-render 產生多個 owner。監聽 playing、pause、ended、error、stalled、waiting；waiting 不立即當作終止。切 source 前清理舊 listener／AbortController，晚到 event 檢查 attemptId。

TTS 雖與 music 共用同一元素，換 source 後仍可能被手機阻擋，不保證一次 unlock 永久有效；處理 rejected play promise。音源須同源或經核准 CORS／來源白名單，並支援播放所需 HTTP 行為。

## Spotify adapter（僅 gate 通過時）

SDK 事件與 Web API 分工：SDK `ready` 提供 device_id；必要的 transfer/play API 由 typed client 經 BFF 代理，token 只在必要之處；SDK `player_state_changed` 校準播放狀態。403、404 無裝置、429、SDK auth/account/autoplay errors 分開處理。[R3/R4/R5]

SDK 並無等價於 HTMLAudioElement 的可靠單一 ended event。實作需保存 previousTrackId／position／duration／paused、比對當前 segment 身分與近尾狀態，並在疑似完播時重新讀 state。不要把任意 pause、position=0、頁面 hidden 或一次 duration 計時器當作自然結束。無法確認就 reconciling，而不是自動略過。

純 Spotify 模式播放連續音樂可使用平台允許的 queue/context 方法；自有 queue 要與平台實際曲目對齊。外部裝置換歌／Spotify autoplay 插入其他曲目時，不套用不相符的 Bridge、不搶回控制；提示「播放內容已在其他地方變更」。

SDK iOS 音量不可由 JS 設定；不提供假 slider，不用 Web Audio 攔截 Spotify stream。Spotify+DJ 即使不重疊也不預設允許。[R1/R4]

## 背景／鎖屏／中斷

`visibilitychange` 回前景、pageshow、網路恢復與裝置 ready 均觸發 reconcile；不依靠 hidden tab 的 setTimeout 來排下一首。頁面隱藏時暫停 UI animation／polling；已開始的合法音訊是否繼續由平台決定。回來時不自動重念已完成 narration。[R14/R15]

電話、Siri、鬧鐘或藍牙拔除後，不保證自動 resume；顯示最近 confirmed state，必要時 user gesture。多頁籤使用 BroadcastChannel／Web Locks 能力偵測協調；不支援時明示只有一個播放頁面。新的頁籤不可偷偷同時開聲或關掉別台裝置。

## 尾段微調的交易

提交 tune 捕捉 sessionId、queueRevision、currentSegmentId；目前音樂繼續。新 ShowPlan 解析完後先驗至少一首可用；提交時只替換當前播放指標之後的 tail。當前曲已進到另一首則以最新指標重新確認，不再使用舊 index。被移除的候選之舊 TTS 可留有限快取但不插回 queue。

未播新 tail 失敗就保留舊 tail；使用者取消則完全無變動。編排成功不代表立刻打斷播放。
