# 10｜可直接執行的工作拆分

不沿用「5小時一定完成」承諾。每個 milestone 都交付可驗收成果，UI 不是最後一項。

## 相依順序

`T00 → T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09`。Spotify `T10` 在 T00 的政策／帳號 gate 通過後才開啟；可以先完成 T01–T09 的 mock／licensed 工作。

| 任務 | 交付 | 完成條件 | 不允許 |
|---|---|---|---|
| T00 可行性紀錄 | `docs/implementation/00-capabilities.md`、gate 狀態 | 來源、帳號條件、手機環境、unknown 清楚分開 | 猜測已獲授權 |
| T01 工程骨架 | workspace、env schema、health、session、capabilities | lint/typecheck/test/build 可跑；無 key 也能 mock 開頁 | 硬編 secrets |
| T02 手機設計底座 | tokens、AppShell、tab、button、input、sheet、toast | 360/390/430 無遮擋；鍵盤／focus 可用 | desktop 後補手機 |
| T03 開台與生成 UI | Seed、範例、四面向、進度、ready、partial/error | 空／loading／cancel／ready/0首/3首/5首 mock | 假播放成功 |
| T04 播放引擎 | reducer/commands、adapter、queue、audio owner | 暫停/下一首/取消/晚到結果/雙播測試 | 多 audio 元件競爭 |
| T05 收聽與細節 | Bridge、Queue、Tune、mini-player、設定 | 不打斷播放；Bridge adjacency 正確；刪除可復原 | 純顯示無互動 |
| T06 Plan API | Structured Outputs、resolver、有限補位、job polling | schema/timeout/cancel/idempotency/unknown songs 測試 | 搜尋結果回灌模型 |
| T07 TTS | approved text→hash→private cache→audio | 短文/AI揭露/cache/失敗跳過/取消不誤播 | 任意 text proxy |
| T08 真實授權音源閉環 | 5首曲目來源紀錄與真實服務結果 | licensed 確有權利；真實音訊與 LLM/TTS 逐項證據 | mock 冒稱整合完成 |
| T09 手機／穩定性 | 真機矩陣、a11y、重連、背景限制、效能 | 無P0/P1缺陷；所有未驗證列出 | 只用 viewport 冒充真機 |
| T10 Spotify 條件式接入 | 允許範圍的 OAuth/search/SDK adapter | G0-A/B/C 通過且有實測；否則 BLOCKED | 自行開DJ gate |
| T11 交付與操作文件 | 執行指令、Screenshots、known issues、decision log | clean clone 可啟動 mock；保留核對結果 | 沒驗證卻報全完成 |

## 第一輪交付切片

從「手機開台 → 固定五首 demo → 第一首 ready → 點播放狀態 → Bridge → 下一首」切垂直切片。然後加錯誤與取消，再接 LLM/TTS。不先花整輪做 Profile／設定／多 provider 選單。

測試音源缺少時，使用合成測試 tone 或空音訊有明確標記，不冒稱它能檢驗選歌品質；正式聲音閉環仍需有效素材。`prototype/index.html` 不附音樂，因此不能拿它當 T08 證據。

## 角色平行分工（需要多 agent 時）

設計／前端 agent：T02、T03、T05。引擎 agent：T04、T09 音訊面。後端／AI agent：T01、T06、T07。主責 agent：T00、契約整合、T08、T10、T11。先固定 contracts 與 tokens；禁止各自改同一 API 欄位導致最後硬接。

## 每次交付格式

```text
Milestone:
Changed files:
User-visible behavior:
Tests run (exact command + result):
Screenshots:
Real-device evidence (or NOT TESTED):
Provider mode and gate status:
Known limitations / blocking issues:
Next task:
```

## Gate 證據模板

```text
Checked at:
Device / OS / browser / standalone:
Origin and TLS setup (no secrets):
Provider / account capability:
Policy references and permitted scope:
Test steps:
Observed behavior:
Expected behavior:
Pass / Fail / Unverified:
Evidence path:
```

## 交付清單

README、env example、scripts、lockfile、unit/contract/integration/E2E、schema、mobile screenshots、真機報告、授權素材紀錄、privacy boundary tests、cost limits、known issues。功能對照 FR01–FR12 與 AC01–AC36，缺項明確標示。

工作只在被授權的 repository／環境進行；本任務不自動授權公開部署、第三方帳號操作、付費採購或聯絡任何人。
