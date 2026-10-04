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
```

## 專案結構

```text
apps/server        Express + TS：session／CSRF、capabilities gate、mock plan job
apps/web           React + Vite + TS：手機 UI、播放引擎
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
