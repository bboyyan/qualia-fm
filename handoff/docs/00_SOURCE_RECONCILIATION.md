# 00｜來源、差異與採用決策

## 材料與權重

- **U0 本次需求**：整理為 coding agent 可開工資料；主要操作介面是手機；UI/UX 必須非常注重。
- **U1 `QUALIA_FM_MVP.md`**：五首歌、Spotify PKCE／Web Playback SDK、繁中 80 字 TTS、現在與下一首；原本限五小時本機 demo、不做資料庫與部署。
- **U2 `QUALIA_FM_FULL.md`**：Seed／Sonic DNA／Bridge／Segment／Show；四階段擴充、Spotify 搜尋播放、OpenAI TTS、SQLite 後加。
- **U3 使用者貼上的完整 prompt**：重質地與情緒、跨曲風、3–5 首 precision matches、每首有 Bridging Insight。
- **R0 Claudio `DEVELOPMENT_SPEC_AI_RADIO.md`**：讀取 main 分支，檔案 blob SHA `a26d59fac18a3ca8112099b881eacb0b82fc2412`。不是 commit SHA。參考 PWA／前後端分層／狀態／TTS 快取／錯誤處理；不直接沿用其供應商或全部功能。
- **R1–R15 官方文件**：本次外部核對，見 12。這些是新增驗證材料，與使用者提供內容分開。

## 差異表

| 主題 | 原材料說法 | 本包採用 | 性質與原因 |
|---|---|---|---|
| 主要介面 | MVP 是網頁；FULL 手機部署在階段 1 | 手機優先 PWA 從首版開始 | U0 明示提高優先，不代表要求原生 App |
| 工期 | 下午五小時 demo | 使用 gate 與驗收，不給完成時間保證 | UIUX＋iOS＋第三方風險不能當作已估完工時 |
| 首版資料庫 | MVP 不要；Claudio 從開始 SQLite | 首版無 DB，後端記憶體＋有限 TTS 檔案快取；階段 1 SQLite | 保留 U1 範圍，避免過度架構 |
| 前端 | U1 vanilla TS；R0 React | React + Vite + TS | 新增工程決策，為複雜播放器／狀態／設計系統服務 |
| 後端 | U1 Express；R0 偏 Fastify | Express + TS | 延續 U1，單一方案不讓 agent 任意選 |
| LLM／TTS | R0 Claude／Fish；U1/U2 OpenAI | OpenAI adapter 為首個真實實作，介面可換 | 以使用者的 Qualia 計劃為主，不強制 Claude |
| 選曲數量 | prompt 3–5；MVP 5 | 目標 5；初始 7 候選，有限補位 | 保留對外五首體驗；不足時允許降級且顯示真實數量 |
| Bridge 來源 | prompt 對 Seed；FULL 前後曲串接 | seedBridge 必備；transitionBridge 可選、檢查前曲 id | 明確區分兩種關係，避免調序後理由失真 |
| 串詞長度 | Claudio 60 中文字；U1 80 字內 | 80 grapheme clusters 硬上限；目標 30–55 | 採 U1 並補字數計算契約 |
| Spotify 音量 | 串詞時壓低歌曲音量 | 不實作 Spotify ducking／混音 | 官方政策與 iOS 技術限制；不是美術取捨 |
| DJ＋Spotify | 自用先做，產品化再查條款 | 政策檢核前移 G0；整合預設關閉 | 不宣稱自用即可豁免條款 |
| 30 秒預覽備援 | 無 Premium 時播 preview | 不把 preview 當保證；顯示外連／授權 demo | 可用性與使用目的受限，非可任意拼接的備用音源 |
| 手機實機環境 | `127.0.0.1:5173/callback` | 桌機可 loopback；手機用可達、可信 HTTPS hostname | 手機 loopback 指手機本身；不是電腦位址 |
| OAuth tokens | U1 前端 PKCE | PKCE＋後端 session；refresh token 留後端 | 新增安全設計；SDK 的短期 token 必須到瀏覽器記憶體 |
| 天氣／日曆／UPnP | Claudio 內含 | 首版不做；FULL 後續視權限再加 | 參考不是照單全收 |
| Spotify 品味記憶 | U2 收藏與長期紀錄餵 LLM | 暫停；先保留使用者自行提供的偏好 | Spotify 資料進 AI／建構畫像需先審查 |
| 舞蹈模式 | 選配／階段 2 | 保留 roadmap；不靠模型猜 BPM | 有可使用的可靠 BPM 資料才做速度編排 |
| 商業化／咖啡店 | U2 後續假設 | 高風險假設，不列可直接部署方案 | 一般 Spotify 個人服務不等於公開場所播放授權 |

## 新增但不是已確認的決策

本次選擇「暖白紙感 × 深松綠 × 唱片式抽象聲景」視覺；三個底部入口「開台／收聽／設定」；次要操作以 sheet 呈現；微調不打斷正在播放。這些是供 agent 開工的預設，應透過原型評審迭代，不是對使用者既有品牌的推定。

## 待決定，不阻塞 UI 開工

A. 是否未來公開發佈／收費；目前預設個人私用測試。B. 是否需要「長時間鎖屏仍有 DJ 串接」成為硬需求；目前不保證。C. 可合法使用的真實音樂／編輯資料來源；目前 mock 起步、授權音源做整合驗收。D. Spotify 是否取得允許本產品特定用途的依據。

這些未決項不能用「先做再說」藏起來，也不能以此取消 U0 的手機 UIUX 工作。
