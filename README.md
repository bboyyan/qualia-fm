# Qualia FM

手機優先的 AI 電台 MVP。規格與設計交接包在 `handoff/`（先讀 `handoff/START_HERE.md`、`handoff/AGENTS.md`），`handoff/` 為唯讀規格。

> **目前狀態：BRA-98 回饋閉環，B 手動模式為預設。** 編排、介紹與帳本皆為明示 fake／TEST；曲目與藝人皆為虛構。B 模式由使用者自行在 Spotify app 點歌，本站不知道進度、沒有 Spotify API；介紹僅文字與既有 MOCK 提示音。設定可切換 MOCK 合成測試音，E 自動串接選項停用。OpenAI LLM／TTS 與預算帳本已實作，但預設停用，本次沒有真實呼叫。真機（iPhone／Android）NOT TESTED。

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
# 專用 screenshots project：產生暫存截圖到 test-results/（360／390／430／1440）
pnpm screenshots
```

所有 E2E 截圖（含失敗截圖、BRA-98／125／135 與專用 `screenshots` project）都寫入已忽略的 `test-results/<測試與 project 目錄>/`，由 `testInfo.outputPath()` 分隔不同測試與視窗。Playwright 會在下次執行時清理暫存產物；需要保留時請先複製到另一個位置。`pnpm screenshots` 只跑專用截圖規格，一般 `pnpm e2e` 不包含它。`docs/implementation/screenshots/` 是已提交的歷史證據，不會由上述指令自動更新；如需提交新證據，請人工審閱暫存截圖後，以新檔名選取複製並提交，避免覆寫舊證據。此路徑調整可用 revert 回滾。

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
| LLM／TTS | 預設 mock；openai 必須有 key、模型／voice／單價、簽收、可讀帳本且未停止，否則明示降級 |
| `SPOTIFY_ENABLED` | `false`（嚴格閘門：設為 true 需 Client ID／redirect URI／加密金鑰齊全；見 docs/spotify-e-mode.md） |
| `SPOTIFY_DJ_APPROVED` | `false`（設為 true 拒絕啟動） |

OpenAI 的設定、預扣／結算、fail-closed 行為與曄的啟用檢查表見 [OpenAI 供應商與預算](docs/openai-providers-and-budget.md)。每日 US$ 1、總額 US$ 10、每日 20 plan、TTS 每日 4000 grapheme；失敗可能已計費，保守保留預扣。`.env.example` 保留原範例預設值、金鑰留空、`OPENAI_REAL_CALLS_APPROVED=false`，模型及單價無預設，預設仍為 mock；以外部 env 檔啟動真實供應商的步驟見該文件「本機啟動」一節。本 PR 未啟用真實呼叫；未對真實 OpenAI 做任何測試。

已加入 iPhone 主畫面 PWA manifest／Apple metadata 與 PNG 圖示，沒有 service worker 或離線能力。執行 `node scripts/generate-icons.mjs` 可重生圖示與 manifest。主畫面／背景播放未經真機驗證，Playwright 留給沙箱外執行。

決策紀錄見 `docs/implementation/decision-log.md`。

## BRA-98 帳本與驗收

`FeedbackLedger` 可注入 `InMemoryLedger` 或 `NotionLedger`；目前 `createApp` 預設只用 fake，不會從環境自動啟用真實 Notion。每一輪選歌（含微調）先 await 帳本讀取，再把 history 放入 mock planner 的 allowlist DTO。讀取失敗不讓 job 失敗：只用 Evan Call〈Time Flows Ever Onward〉、空 history 與無 tuning，準備好／收聽畫面明示「未讀到帳本」。mock 保持固定虛構曲目，不宣稱能用回饋真正個人化選歌。

V5 的 `scripts/check-preferences.mjs` 掃描全 repo 程式碼（排除依賴、建置、git 與測試產物），拒絕預設品味／偏好宣告與已知質地推測句型，另核對唯一 confirmed seed；單元測試從 planner 輸出確認沒有硬編碼音色推測。這是可機器驗證的護欄，不能取代人對任意新提示詞的審查。唯讀 `handoff/` 的歷史規格與舊截圖不會被當作執行時偏好。

執行 `pnpm e2e` 時，`e2e/feedback.spec.ts` 會在 `test-results/` 的各測試目錄產生 `bra98-feedback-360x800.png` 與 `bra98-feedback-390x844.png`，以 CSS 像素截圖並檢查每張 <300KB；兩張總計 <600KB。不要跑大量舊截圖重生指令來替代這兩張證據。真機 NOT TESTED。

V6 尚待專案管家外部 L1 授權實寫 TEST 列及補 PR 證據。`node scripts/notion-live-check.mjs` 預設不讀 token、不連線、不寫入。只有明確參數 `--confirm-write-one-test-row` 才會建構真實 adapter（先 `pnpm build`，token 僅從 `NOTION_TOKEN` 環境變數讀取；不要放入指令字串或 repo）。它只向固定帳本頁寫一列，種子與原因都標 TEST，回傳測試列連結；reader 排除 TEST 列，保留標記即符合回滾要求。此 agent 不執行真實檢查。
