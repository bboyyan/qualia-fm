# Qualia FM

手機優先的 AI 電台 MVP。規格與設計交接包在 `handoff/`（先讀 `handoff/START_HERE.md`、`handoff/AGENTS.md`），`handoff/` 為唯讀規格。

> **目前狀態：BRA-98 回饋閉環，B 手動模式為預設。** 編排、介紹與帳本皆為明示 fake／TEST；曲目與藝人皆為虛構。B 模式由使用者自行在 Spotify app 點歌，本站不知道進度、沒有 Spotify API；介紹僅文字與既有 MOCK 提示音。設定可切換 MOCK 合成測試音，E 自動串接選項停用。沒有真實 LLM／TTS。真機（iPhone／Android）NOT TESTED。

## 需求

- Node.js `^22.13.0 || ^24.0.0 || >=26.0.0`（`.nvmrc` 為 24）
- pnpm 10（`packageManager: pnpm@10.28.2`）

## 安裝

```bash
pnpm install --frozen-lockfile
```

不需要任何 API key。`.env` 可省略；要調整時複製 `.env.example` 為 `.env`（僅限 server，**不要**加 `VITE_` 前綴）。

## 啟動 mock

```bash
# 開發模式：Vite（http://127.0.0.1:5173）＋ Express（127.0.0.1:8080，/api 由 Vite proxy）
pnpm dev

# 正式建置後同源啟動：Express 提供 API 與 apps/web/dist（http://127.0.0.1:8080）
pnpm build
pnpm start
```

伺服器只綁定 `127.0.0.1`。

## 檢查指令

```bash
pnpm lint        # ESLint（全 workspace）
pnpm typecheck   # tsc --noEmit（contracts／server／web）
pnpm test        # Vitest 單元＋整合測試
pnpm build       # contracts → server（tsc）→ web（tsc + vite build）
pnpm check:preferences # V5：全 repo 程式碼預設偏好檢查

# E2E（Playwright，手機視窗 360×800／390×844／430×932；會先 build，並自行在 127.0.0.1:4173 啟動 server）
pnpm e2e
# 額外：WebKit 引擎 390×844（仍不是 iPhone Safari 真機）
pnpm e2e:webkit
# 重新產生截圖到 docs/implementation/screenshots/（360／390／430／1440）
pnpm screenshots
```

Playwright 使用本機已快取的瀏覽器（`@playwright/test@1.63.0` 對應 chromium-1243、webkit-2359）。首次在其他機器上執行若沒有快取，需另外執行 `pnpm exec playwright install chromium webkit`（會下載瀏覽器）。

## Mock 流程怎麼走

1. 開台：輸入感覺（或點範例 chip，只會填入）→「為我開台」。
2. 生成中：顯示伺服器實際階段，可「取消，保留我的輸入」。
3. 節目準備好：感覺鉤子＋四面向、實際首數 →「開始收聽」（由這次點擊開始播放）。
4. B 手動（預設）：介紹文字＋MOCK 提示音 → 自行到 Spotify app 點歌 →「我開始播了」→「這首播完了」。本站不偵測／控制外部播放，也不顯示假進度。
5. 完播或跳過後：選「愛／還行／不對」＋一句原因（200 字以內，可留空）→ 送出後進下一首介紹。只填假資料；寫入 TEST 記憶體帳本，重啟即清除。略過整筆回饋不寫入任何列。寫入失敗會保留輸入，提供重試或略過。
6. 設定 → 播放模式可選 B 或 MOCK；E 為停用選項，標示「需曄當次明確同意，預設關閉」。切換會停止本站聲音，保留目前曲目待重新開始；外部播放需自行停止。MOCK 自然結束／下一首也先等待回饋。
7. 「完整理由」看 Bridge；「01 / 05」或「接下來」看節目單（移除可 5 秒內復原）；「微調」只替換接下來、不打斷這首。
8. 設定 →「情境預覽 · MOCK」可切換 3 首／0 首／失敗／慢速，以及模擬「點一下繼續」與「播放裝置斷線」。

## 專案結構

```text
apps/server        Express + TS：session／CSRF、capabilities gate、mock planner／resolver、plan job
apps/web           React + Vite + TS：手機 UI；src/audio 為唯一播放引擎（reducer＋單一 <audio> adapter）
e2e/               Playwright 規格與截圖產生器
packages/contracts Zod schema（domain／API／錯誤碼）、grapheme 計數
docs/implementation decision log、里程碑報告、截圖
handoff/           唯讀規格包
```

## Provider 與 gate

| 項目 | 狀態 |
|---|---|
| PROVIDER_MODE | `mock`（其他值拒絕啟動） |
| LLM／TTS | mock（`openai` 拒絕啟動，T06／T07 未開始） |
| `SPOTIFY_ENABLED` | `false`（設為 true 拒絕啟動；G0 未通過） |
| `SPOTIFY_DJ_APPROVED` | `false`（設為 true 拒絕啟動） |

決策紀錄見 `docs/implementation/decision-log.md`。

## BRA-98 帳本與驗收

`FeedbackLedger` 可注入 `InMemoryLedger` 或 `NotionLedger`；目前 `createApp` 預設只用 fake，不會從環境自動啟用真實 Notion。每一輪選歌（含微調）先 await 帳本讀取，再把 history 放入 mock planner 的 allowlist DTO。讀取失敗不讓 job 失敗：只用 Evan Call〈Time Flows Ever Onward〉、空 history 與無 tuning，準備好／收聽畫面明示「未讀到帳本」。mock 保持固定虛構曲目，不宣稱能用回饋真正個人化選歌。

V5 的 `scripts/check-preferences.mjs` 掃描全 repo 程式碼（排除依賴、建置、git 與測試產物），拒絕預設品味／偏好宣告與已知質地推測句型，另核對唯一 confirmed seed；單元測試從 planner 輸出確認沒有硬編碼音色推測。這是可機器驗證的護欄，不能取代人對任意新提示詞的審查。唯讀 `handoff/` 的歷史規格與舊截圖不會被當作執行時偏好。

E2E spec 已備妥，本輪依指示不執行，交外部執行者跑 `pnpm e2e`。`e2e/feedback.spec.ts` 會只新增 `bra98-feedback-360x800.png` 與 `bra98-feedback-390x844.png`，以 CSS 像素截圖並檢查每張 <300KB；兩張總計 <600KB。不要跑大量舊截圖重生指令來替代這兩張證據。真機 NOT TESTED。

V6 尚待專案管家外部 L1 授權實寫 TEST 列及補 PR 證據。`node scripts/notion-live-check.mjs` 預設不讀 token、不連線、不寫入。只有明確參數 `--confirm-write-one-test-row` 才會建構真實 adapter（先 `pnpm build`，token 僅從 `NOTION_TOKEN` 環境變數讀取；不要放入指令字串或 repo）。它只向固定帳本頁寫一列，種子與原因都標 TEST，回傳測試列連結；reader 排除 TEST 列，保留標記即符合回滾要求。此 agent 不執行真實檢查。
