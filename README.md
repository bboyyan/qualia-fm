# Qualia FM

手機優先的 AI 電台 MVP。規格與設計交接包在 `handoff/`（先讀 `handoff/START_HERE.md`、`handoff/AGENTS.md`），`handoff/` 為唯讀規格。

> **目前狀態：MOCK 模式（BRA-97，T01–T05）。** 只播放程式合成的測試音，曲目與藝人皆為虛構；沒有真實 LLM／TTS，Spotify 預設關閉且本版拒絕啟用。真機（iPhone／Android）未測試。

## 需求

- Node.js ≥ 22（`.nvmrc` 為 24；本機以 v25.5 驗證）
- pnpm 10（`packageManager: pnpm@10.28.2`）

## 安裝

```bash
pnpm install
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
4. 收聽：DJ 介紹（合成提示音＋串詞文字）→ 同一段的合成測試音；可暫停、跳過介紹、重播本曲、下一首。
5. 「完整理由」看 Bridge；「01 / 05」或「接下來」看節目單（移除可 5 秒內復原）；「微調」只替換接下來、不打斷這首。
6. 設定 →「情境預覽 · MOCK」可切換 3 首／0 首／失敗／慢速，以及模擬「點一下繼續」與「播放裝置斷線」。

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
