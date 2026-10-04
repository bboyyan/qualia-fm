# 11｜驗收與測試矩陣

下列是必須執行的產品測試，不表示本包已執行真實服務或真機驗證。原型的實際檢查另記於 `tests/PROTOTYPE_REPORT.md`。

## Gate 定義

P0：安全、未授權音訊、雙播、金鑰／資料外洩、假成功；任何一項即不可交付整合版。P1：主要手機流程無法操作、丟失播放／不能恢復、取消無效。P2：非阻塞視覺／文案問題。正式驗收不得留 P0／P1。

## 功能案例

| ID | 測試 | 預期 |
|---|---|---|
| AC01 | 無 key 啟動 | 可使用明示 mock；不假裝真實 Spotify |
| AC02 | 空 Seed／超過500字／IME composing | 正確 validation，保留輸入，不誤送 |
| AC03 | 感覺、歌曲、聲音三種輸入 | 都進相同核心 pipeline |
| AC04 | 生成期間點取消，晚到成功 | 不換頁、不開播，舊結果忽略 |
| AC05 | 快速送A再送B | A不覆蓋B，只有 active generation 生效 |
| AC06 | 模型回錯 JSON／refusal | 有限 repair 或可理解錯誤 |
| AC07 | 找到5首、3首、0首 | 顯示實際結果數與對應 CTA |
| AC08 | 同名不同藝人／live／cover | 不靜默替代 |
| AC09 | 模型不認識歌曲 | 說不確定，不編 BPM／音色事實 |
| AC10 | ready 後尚未點播放 | 不出聲、不移動進度 |
| AC11 | speech pause/resume | 從暫停位置恢復，不跳歌 |
| AC12 | 跳過介紹 | 仍播放當首，不變成下一首 |
| AC13 | 下一首連點／TTS晚到 | 無雙播、無舊串詞返回 |
| AC14 | 曲目暫停後恢復 | 不重念介紹 |
| AC15 | 重播本曲 | 歌曲回0，不重念DJ |
| AC16 | seek clamp／拖動 | 只在track有能力時；放開單次操作 |
| AC17 | TTS失敗／延遲 | 文本保留、音樂不中斷等待 |
| AC18 | 自然完播 event 重複 | 只推進一次 |
| AC19 | 失敗曲目連續2首以上 | 有限略過後停止，無無限循環 |
| AC20 | 移除待播／復原 | 原子queue操作、不移除當前曲 |
| AC21 | 前曲被略過／排序變動 | transitionBridge失效，退seedBridge |
| AC22 | Tune成功／取消／失敗 | 不打斷當前曲；失敗留舊tail |
| AC23 | 切tab／打開Bridge | 音訊實例不重建 |
| AC24 | Autoplay被擋 | 顯式點一下繼續；無silent retry |
| AC25 | 網路斷／裝置不見／外部換歌 | reconcile，理由不誤配、進度不偽造 |
| AC26 | 403／429／quota exceeded | 顯示合適下一步，不推測單一錯誤原因 |
| AC27 | Spotify gate=false | auth/search/stream/DJ各必要路徑不可繞過 |
| AC28 | LLM/TTS payload spy | 無Spotify metadata/歷史/封面/歌詞/tokens |
| AC29 | 同Idempotency-Key重送 | 不重複生成或合成；payload不同409 |
| AC30 | CSRF／跨session存取TTS／任意URL | 拒絕；不洩露私有資料 |
| AC31 | 登出／session expire | 中止工作、清token與快取；可重新開始 |
| AC32 | 手機360/390/430與320、200%文字 | 無水平溢出、主鍵可到達 |
| AC33 | 鍵盤升起／safe area／轉向 | CTA與mini-player不遮蓋 |
| AC34 | VoiceOver／keyboard／reduced-motion | 焦點、label、dialog、動效均正確 |
| AC35 | 真機背景／鎖屏／來電／藍牙 | 有逐項實測與限制，不以viewport代替 |
| AC36 | Service Worker更新／離線 | shell可開但不假裝離線音樂，更新不強制打斷 |

## 測試層

Unit：schema、bridge validity、字數、identity resolver、budget、cache key、reducer、晚到資料與去重。
Contract：OpenAPI與TS與範例一致；所有供應商response經adapter mapping，nullable欄位缺失可處理。
Integration：plan job→resolver→ShowPlan；TTS成功／失敗／cache；session隔離；所有外部服務以fixture測試，真實smoke另標記。
E2E：手機完整 happy path、空／慢／partial／取消／resume／Queue／Tune、不同tabs的音訊owner。
Manual：實體iPhone Safari與加到主畫面、Android Chrome、VoiceOver、藍牙與鎖屏。

## 真機矩陣（尚待實作人填寫）

| 環境 | 冷啟動手勢 | speech→track | 背景 | 鎖屏 | 來電/音訊中斷 | 返回恢復 |
|---|---|---|---|---|---|---|
| iPhone Safari（實際型號/OS） | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 |
| iPhone PWA standalone | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 |
| Android Chrome（實際型號/OS） | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 | 未驗證 |
| Desktop Chromium | 待工程實作 | 待工程實作 | 待工程實作 | 不等同手機 | 待工程實作 | 待工程實作 |

同一裝置不同provider分開紀錄；mock播放動畫不算音訊通過。Spotify核可範圍內才做其相關測試。

## 設計評審腳本

請一位未參與開發者完成：輸入想要的感覺、解釋第一首為什麼匹配、開始／暫停、略過介紹、找出下一首、改成更放鬆、說明這次改動會何時生效。記下卡住處與誤解，不只問「好不好看」。

## Definition of Done

需求→測試ID可追蹤，所有P0/P1清除、真實服務與mock分開、手機真機報告有日期與環境、可用模式與限制寫入README。未完成Spotify gate 時仍能交付G1／G2，但不能宣稱原始Spotify DJ需求全完成。
