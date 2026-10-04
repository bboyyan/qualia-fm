# Qualia FM｜Coding Agent 開工包

版本：1.0 · 2026-10-04 · 語系：繁體中文（zh-TW）

> 不是把桌面播放器縮小。這是一個以手機為主要操作介面、依聲音質地選歌，並用 Bridge 說清楚「為什麼是下一首」的私人 AI 電台。

## 先看這三件事

1. **交付性質**：這是產品／設計／工程規格、資料契約與互動參考原型，不是已完成或已部署的正式 App。`prototype/index.html` 不連外、不登入、不播真實音樂；歌名與聲景皆為明確標記的虛構展示。
2. **開工預設**：手機優先 PWA，React + Vite + TypeScript；Node.js + Express + TypeScript。先做單使用者與無資料庫的核心閉環。不是原生 iOS／Android App，也不是桌面管理台。
3. **重要阻擋項**：原始 Spotify「壓低音量＋TTS 串接」不可照抄。Spotify 條款與 iOS 音量控制都有重大限制。完整 DJ 互動先用具明確授權的測試音源實作；Spotify 整合預設關閉，通過 G0 後才按允許範圍開啟。詳見 `docs/05_PROVIDER_GATES.md`。

## 使用方式

將整個資料夾交給 coding agent，貼入 `START_HERE.md` 的開工指令。請先讀 `AGENTS.md`，再按 `docs/10_IMPLEMENTATION_PLAN.md` 的相依順序執行。

| 要做什麼 | 讀哪一份 |
|---|---|
| 掌握產品與此次範圍 | `docs/01_PRODUCT_REQUIREMENTS.md` |
| 查原始需求、衝突、調整原因 | `docs/00_SOURCE_RECONCILIATION.md` |
| 實作手機畫面、導覽、狀態與手勢 | `docs/02_MOBILE_UX.md` |
| 取得色票、字級、間距、元件狀態 | `docs/03_DESIGN_SYSTEM.md`、`design/tokens.css` |
| 建立前後端、資料邊界與部署配置 | `docs/04_ARCHITECTURE.md` |
| 驗證 Spotify／TTS／iOS 可行性 | `docs/05_PROVIDER_GATES.md` |
| 實作可取消、可恢復、無雙播的音訊流程 | `docs/06_PLAYBACK_ENGINE.md` |
| 實作 Sonic Qualia 選歌與 Bridge | `docs/07_AI_ORCHESTRATION.md`、`prompts/` |
| 串接 API、型別、錯誤契約 | `docs/08_API_CONTRACT.md`、`contracts/` |
| 實作私密性、安全與費用上限 | `docs/09_SECURITY_OPERATIONS.md` |
| 排工、驗收、真機測試 | `docs/10_IMPLEMENTATION_PLAN.md`、`docs/11_ACCEPTANCE_TESTS.md` |
| 查看所有官方核對來源 | `docs/12_SOURCE_REGISTER.md` |
| 操作 UI 參考 | `prototype/index.html` |

## 何謂完成

**介面完成 ≠ 整合完成 ≠ 原需求全部完成。**

- G1：手機核心 UI 與可測試的 demo 流程完成。
- G2：授權音源＋真實 LLM／TTS 核心流程完成，並有真機證據。
- G3：Spotify 特定整合經政策審查與實測後完成；未通過時不得把 G1／G2 宣稱為「Spotify AI DJ 已完成」。
- 分享、長期品味、無限接續、商業化等屬後續階段，不偷渡進 MVP。

## 原始材料

兩份使用者 Markdown 原檔保存在 `sources/`，未改寫。使用者貼上的 Sonic Qualia prompt 保存在 `prompts/sonic-qualia-original.md`（只還原貼文跳脫字元，不改語意）。Claudio 文件採架構參考，不代表其第三方播放方式或授權已獲核可；本包不複製該專案原始碼。

所有新增數值門檻與視覺方向都是本次提出的實作規格，不是原文件已證實的結果。核對日期為 2026-10-04，實際開工仍須重新確認供應商文件與帳號權限。
