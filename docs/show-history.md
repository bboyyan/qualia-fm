# 開台歷史（BRA-148）

「我的」→「開台歷史」依時間由新到舊列出已準備完成的節目。點開一台可看種子種類、文字／藝人、原始提名曲目及語音狀態；「去我的歌」進既有品味帳本，「用這個種子重開」以目前 DJ 設定開始新編排，不中斷正在播放的節目，也不改開台頁草稿。

## 本機資料

預設 `data/show-history.json`，啟動時轉成絕對路徑。可由 `SHOW_HISTORY_PATH` 指定位置；僅 `NODE_ENV=test` 且未指定路徑時使用記憶體。沿用品味帳本 `filePersistence`：同目錄私有 tmp（600、wx）＋ rename，建立目錄為 700。未修改任何實際 env 檔或服務設定。

檔案版本 1，每筆保存 `showId`、`createdAt`、`seed`、`trackCount`、`tracks`、`ttsDegraded`、`speech`。曲目只取 `segment.candidate` 的原始提名曲名／藝人，不保存 Spotify 回傳 metadata、URI、音訊 URL、token、DJ 台詞。`speech` 區分關閉、提示音、AI 語音、文字；部分語音成功時仍保留 AI 語音標記並另列降級狀態。

`GET /api/show-history` 需要有效 session，回應 `Cache-Control: private, no-store`。沿用單人自用的品味帳本權限範圍，不綁 12 小時 session，所以換 session 或重啟仍可回看；不適用公開多人服務。前端遇 session 失效只恢復一次。

## 紀錄時機與失敗

取消／失敗的 job 不寫入；零首但完成交付的 plan 也留摘要。每筆依 showId 冪等；編排交付前同步存摘要，寫入失敗就讓 job 失敗，畫面沿用可重試的編排錯誤。讀檔或格式損毀時明示錯誤且拒絕覆寫，修復檔案後下一次操作即可恢復。

保留的是完成編排的曲目摘要，並非每首實際播放完成的證明；歷史不重建舊 JobStore 或舊音訊，只提供原種子重新編排。微調產生的新 plan 也各留一筆摘要。既有 session 持久化與回饋上下文沿用 BRA-161。

目前採單程序、每次重讀與整檔 atomic write，沒有自動刪除履歷或雲端同步；若累積量需分頁／容量限制或改為多程序，另票處理。種子可能敏感，保存於本機私有檔，沒有送入品味規則或額外供應商請求。

## 回滾

revert BRA-148 的程式／契約／文件 commit。新檔可留存，舊版不讀它；不刪品味帳本、session 或歷史，不需資料庫遷移。需人工清空歷史時由操作者自行處理檔案，本功能未提供刪除操作。
