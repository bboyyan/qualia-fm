# Coding Agent 工作規則

## 任務

依這份包實作 Qualia FM。先查看目前 repository、既有分支、變更與套件；有既有系統時做最小整合，不直接初始化覆蓋。沒有專案時才建立 `qualia-fm/`。本包本身不是 application repository。

## 需求優先序

使用者本次明示要求 > 本包已標記的安全／平台限制 > 本包採用決策 > 附件原始 MVP／FULL > Claudio 參考。任何差異要記入 decision log；不能把「推測」寫成使用者已同意的事實。

## 不得變更的產品骨架

- 手機是主要介面。禁止 desktop-first 後補 responsive。
- 保留 Seed、Sonic DNA 四面向、Hook of Feeling、Bridge、Segment、Show。
- 不是聊天機器人 UI，也不是只有卡片的五首歌清單。播放器與下一首理由是核心。
- 目標五首，內部最多七首初始候選；少於五首時明說，不捏造，不把未驗證曲目標為可播。
- 語系繁中；歌名與藝人保留正式原文。DJ 每段最多 80 個 Unicode grapheme clusters，標點、空格與英文均計入。
- 串詞失敗不能卡住歌曲；播放限制不能靠假進度、假波形或假成功掩蓋。

## 工程護欄

1. 先完成 G0 文件與 capability spike，再按任務表走；缺 key 用顯式 mock，不阻止 UI 工作。
2. 不上傳、下載或代理 Spotify 音訊；不分析其音訊；不把其 API 內容、封面、歌詞、收藏與歷史送給模型。
3. Spotify 整合與 Spotify＋DJ 串接有獨立開關，預設全部關閉。不得由前端 query string、模型輸出或測試 fallback 開啟。
4. 不宣稱把重疊改成先暫停就必然合規。政策／授權未確認時，用授權測試音源驗證完整 DJ 行為。
5. 不將任何 secret 放進 Vite 可暴露的環境變數、localStorage、日誌、追蹤服務或版本庫。Spotify SDK 必要的短期 access token 只在前端記憶體。
6. 全 app 只有一個 playback engine；React 頁面不各自建立音訊實例。用 attemptId／generationId 抵擋晚到的結果。
7. 行動裝置自動播放失敗必須出現清楚可按的「點一下繼續」，不可靠隱藏循環重試。
8. 不新增帳號付費、日曆、天氣、UPnP、麥克風權限、分享音訊或原生 App，除非新需求明確授權。
9. 不自行公開部署、不動 production、不建立付費資源、不提交金鑰、不聯絡第三方。提供操作文件；必要的真實服務測試依環境授權執行。
10. 為每個里程碑記錄：變更、測試指令與結果、截圖、真機是否實測、已知限制、下一個任務。commit 僅在工作環境允許時；不得推送未授權 remote。

## 完成判準

- `lint`、`typecheck`、`test`、`build`、核心 E2E 綠燈才完成該任務。
- 截圖至少 360×800、390×844、430×932、桌面 1440×900；320 寬與 200% 文字放大也不得截斷關鍵操作。
- 沒做真機測試就寫「未驗證」，不能拿 Chromium 的 iPhone viewport 當 iPhone Safari 證據。
- `prototype/` 為參考與協作工具，不是可直接上線的安全／效能範本。不要把虛構曲目灌入正式搜尋。
