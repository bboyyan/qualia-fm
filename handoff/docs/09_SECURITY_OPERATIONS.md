# 09｜安全、私密性、部署與費用

## OAuth 與 session

採 Authorization Code with PKCE（S256）而非 implicit grant。[R18] Code verifier 與 state 存 backend session；callback 驗證 state、單次使用、TTL。redirect_uri 使用設定的固定值，不從任意 request host 推算。手機 HTTPS 路徑與 Spotify Dashboard allowlist 精確相符。[R7]

session cookie：HttpOnly、Secure（HTTPS）、SameSite=Lax、Path=/、高熵 opaque ID。只在明示 loopback dev 環境允許非 Secure，不從一般 LAN HTTP 關閉安全。每次敏感 mutation 驗 Origin＋CSRF token。session creation 本身驗 Origin／Fetch Metadata 與速率限制；不得接受任意跨來源建立。

refresh token 只在後端記憶體，SDK access token 只送必要 client memory；響應 `Cache-Control:no-store`。不把 Spotify token 當 OpenAI 金鑰，不放 localStorage／URL query／分析服務。續期單飛 lock，失敗回重新登入，不能多個 concurrent refresh 互踩。[R18]

## 資料最小化

首版保存：當前 session 的 Seed、候選、ShowPlan、TTS job、短期 provider metadata；設定只存非敏感偏好。不主動讀 Spotify 收藏、完整播放歷史、日曆、天氣、地理位置、麥克風。使用者手動情緒描述可能敏感，預設不進遙測，日誌不存完整 prompt。

server restart 顯式失去 session；清除／登出會 abort in-flight jobs、清 token、刪 session namespace TTS 和暫存 Show。第三方收到的合法請求資料依其服務政策處理；不能宣稱「所有資料完全本地」而實際呼叫雲端 LLM／TTS。

## 外部請求

Provider endpoint 白名單；固定 base URL；禁止任意模型生成 URL fetch／shell。使用者貼曲目 URL 只解析 allowlisted provider hostname 與 ID，防 SSRF、localhost/private IP、redirect chain 以及 query 注入。不要從用戶輸入直接拼接 server 檔案路徑。

所有回覆經 schema、長度與可顯示文字處理。前端使用 textContent／React 自動 escaping，不用任意 HTML。CSP、HSTS（HTTPS）、Referrer-Policy；Spotify SDK 所需來源以核對最小清單放行，不開 `*`。error log 遮罩 Authorization、cookie、tokens、email、Seed。

## 預設成本／資源 budget（設計值，不是供應商價格）

- 每次 plan LLM 最多2次（初始＋repair或補位擇一），候選最多10（7＋至多3）。
- 搜尋每候選最多2次，concurrency2；HTTP timeout8秒，整個 plan deadline60秒。
- 每次 Show 最多5段 TTS；每段≤80 grapheme clusters；同段同 voice/hash 不重複扣次。
- TTS concurrency2、單次請求 timeout15秒；僅短暫準備緩衝，不為第一段一直等。
- 每 session plan attempts 預設10次／小時；TTS text budget 預設4,000 grapheme clusters／日；另設 server 全域 cap，防不同匿名 session 繞過。
- 快取示範 TTL24小時、磁碟上限100MB、LRU清除；獨立授權資料若規範更嚴以其為先；不設 Spotify 音訊快取。
- 供應商費率不寫死。管理者於啟用真實 key 前填當前單價／用量限制，實際金額由 provider usage response 與帳務確認；無法確認時只記請求／字數，不亂估金額。

以上數值可用 env 調整但有合理 hard ceiling；模型與前端不能提高上限。API 探測失敗時 no-op／mock fallback 必須明示，不能無聲切換到會花錢的另一服務。

## `.env.example`

見根目錄。所有服務預設 mock，Spotify 關閉，DJ 串接未核可。`OPENAI_TEXT_MODEL`／`OPENAI_TTS_MODEL`／voice 於帳號內確認，不把文件例子的 model 當成帳號一定能用。TTS 需清楚標示 AI 聲音。[R17]

## 運行拓樸

單一 Node process，反向代理提供可信 HTTPS，Vite build 靜態檔同源服務。prod 不用 Vite dev server。server 在私人電腦時，電腦與網路可用才有 API；手機不是 backend。沒有配置可信手機入口時只能宣稱桌機／模擬 UI 驗證，不宣稱手機端 OAuth 已完成。

本包不提供多 instance session storage 或 production security audit。公開可達服務至少加 access gate／使用者驗證、全域成本 cap、安全 header、backup／刪除說明與外部依賴核對，再進產品化階段。

## 操作 runbook

健康檢查失敗→服務與設定；LLM 錯誤→僅看遮罩 requestId／schema 類型；Spotify 403→scope/allowlist/policy/帳號檢查，不直接判定單一原因；429→分短期rate與quota，遵守 Retry-After；TTS 延遲→queue與cache命中；手機無聲→gesture、裝置、音訊中斷、實際 provider state。

回滾只用已授權的部署機制，保留可恢復版本；不要遠端動使用者電腦或自動傳送報告到未授權服務。
