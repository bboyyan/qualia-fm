# 直接交給 Coding Agent

將下列指令與整包資料一起提供。

```text
請依附件 qualia-fm-handoff 實作 Qualia FM，先讀 README.md、AGENTS.md、
docs/00_SOURCE_RECONCILIATION.md、docs/01_PRODUCT_REQUIREMENTS.md、
docs/02_MOBILE_UX.md、docs/05_PROVIDER_GATES.md 與 docs/10_IMPLEMENTATION_PLAN.md。

手機是主要操作介面，UI/UX 是驗收核心，不是最後美化。
請參考 prototype/index.html 的層級與互動，使用 design/tokens.css 作為設計起點。
保留 Seed → Sonic DNA → 5 首歌 → Bridge → DJ 串詞 → 播放 → 微調感覺的流程。

先檢查現有 repo，避免覆蓋既有工作。然後實作 G0、T01～T04：
1. 建立 capability／policy gate 與 mock、licensed、Spotify adapter 邊界。
2. 建立手機 shell、開台輸入、生成狀態、收聽頁、Bridge、節目單與設定。
3. 使用可追溯授權的測試音源驗證播放引擎；沒有素材就清楚標示 mock，不能假裝播放。
4. 加入單元測試與手機尺寸 E2E，提供截圖與執行結果。

缺少 API key 不要停掉整個專案；以明確標示的 mock provider 繼續可完成的部分。
Spotify 與 Spotify+DJ 串接預設禁止啟用；先完成 docs/05 的必要核對。
不要照原始 MVP 做 Spotify ducking，不要抓取 Spotify 音訊，不要把 Spotify 資料送入 LLM。
不要保證 PWA 鎖屏連播，不要把瀏覽器模擬測試當真機測試。

每個里程碑回報：已完成、測試證據、未完成／阻擋項、下一步。
先交可在手機操作、狀態正確、畫面精緻的核心版本，再繼續服務接入。
不要只產生另一份計劃而不實作，也不要擅自公開部署或建立付費資源。
```
