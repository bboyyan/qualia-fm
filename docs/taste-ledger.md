# 品味帳本（BRA-134）

本機、機器可讀的「品味帳本」，開台前必讀；Notion 只是可選的單向備份（沿用 BRA-98 的 `FeedbackLedger`），開台不靠爬 Notion。

## 資料

檔案：`TASTE_LEDGER_PATH`（空值＝`./data/taste-ledger.json`，啟動時轉成絕對路徑；權限 600，tmp＋rename 原子寫入）。
`NODE_ENV=test` 且未設定時只存在記憶體。
`pnpm dev` 的工作目錄是 `apps/server`，預設檔案落在 `apps/server/data/taste-ledger.json`；根目錄的 `data/` 與 `apps/server/data/` 均由 `.gitignore` 排除（包含寫入暫存檔）。

```json
{
  "version": 1,
  "entries": [
    { "kind": "feedback", "entryId": "fb_…", "at": "2026-10-05T12:00:00.000Z", "trackKey": "artist — title", "title": "…", "artist": "…", "showId": "show_…", "rating": "愛", "note": "短評" },
    { "kind": "rating",   "entryId": "man_…", "at": "…", "trackKey": "…", "title": "…", "artist": "…", "rating": "不對", "note": "" },
    { "kind": "mark",     "entryId": "man_…", "at": "…", "trackKey": "…", "title": "…", "artist": "…", "mark": "pinned" },
    { "kind": "aired",    "entryId": "air_…", "at": "…", "trackKey": "…", "title": "…", "artist": "…", "showId": "show_…" }
  ],
  "marks": [
    { "trackKey": "…", "title": "…", "artist": "…", "mark": "pinned | blocked | null", "rating": "愛 | 還行 | 不對 | null", "note": "… | null", "lastAiredAt": "… | null", "updatedAt": "…" }
  ]
}
```

- `LedgerEntry`（`entries`）只增不改，是事實來源；`entryId` 冪等（重送不重複記）。
- `TrackMark`（`marks`）的評價／標記依 entries 重算：後到的評價／標記覆蓋先前的；`mark: null` 代表清除標記。`lastAiredAt` 同時保留已修剪播出事件的摘要，讀回及後續寫入都取較新的播出時間。
- 曲目只用 LLM 當時提名的曲名／藝人（`trackKey`＝NFKC＋小寫＋壓空白），永遠不存 Spotify 回傳欄位（Policy III.13／III.14）。
- 播出紀錄只保留最近 500 筆；評價與標記永遠保留，其 `lastAiredAt` 不隨播出紀錄修剪而清空，確保釘選排序不變。

## 開台前選歌管線（固定順序）

`apps/server/src/services/tasteRules.ts`：

1. **blocked 硬排除**：任何情況都不放回。
2. **近 N 已播排除**：N＝10（最近播出的 10 首不重複曲目）。只有候選不足 5 首時，才依「最久以前播」放回，並在節目 warnings 明示。
3. **pinned 置前**：每輪最多 2 首；不受近 N 限制；超過上限時最久沒播（從未播最優先）的先排。草稿沒有的釘選曲會補成候選（`evidenceLevel: user_description`）；其餘釘選曲即使已在草稿，也不能經一般候選或近期補回繞過上限。
4. **「愛」輕推／「不對」降權**：只調順序（愛往前 1.5 位、不對往後 4 位），不排除。

短評（note）由 `editorialInput.tasteHints` 交給 planner 當軟約束：`avoid`（封鎖＋近 N）、`loved`、`disliked`（各最多 15 首，含短評）。

只有真實提名（非 MOCK 草稿）會記播出紀錄，示範模式不會被近 N 擋光。

## 寫入時機

| 事件 | 寫入 |
|---|---|
| 聽完回饋 `POST /api/feedback`（BRA-98） | 先寫品味帳本 `feedback`，成功後才寫 `FeedbackLedger`（Notion 備份） |
| 手動改評價／標記 `POST /api/taste/marks` | `rating` 及／或 `mark` |
| 節目排定（真實提名） | 每首 `aired` |

`GET /api/taste/marks` 回傳 `{ marks: TrackMark[] }`（最近更新在前）。
`GET /api/taste/history?trackKey=…` 回傳 `{ entries: LedgerEntry[] }`：這首最近 5 筆（新到舊）；帳本沒有這首回 404（BRA-135）。
釘選同時最多 2 首（`PINNED_LIMIT`，與每輪帶上的釘選曲數相同）：已滿再釘回 409 `PIN_LIMIT_REACHED`；已釘選的再送一次、改封鎖或取消都不受限。上限前就超過的舊帳本照常讀，只擋新增。手動編輯的對象只能是自己節目裡的段落（`{showId, segmentId}`）或帳本裡已有的 `trackKey`，不接受用戶端自填曲名。
同一伺服器的手動編輯依序執行，讀取名額、檢查及寫入都在同一臨界區內；失敗後仍可繼續編輯。這不提供跨程序鎖。

## 失敗時明確降級

| 狀況 | 行為 |
|---|---|
| 開台時帳本讀不到／損毀 | 照常開台，但本輪不套任何規則；節目 warning：「品味帳本讀取失敗：本輪未套用封鎖、近期已播、釘選與評價規則。」；伺服器記 `taste_ledger_read_failed` |
| 播出紀錄寫入失敗 | 節目照常完成；warning：「品味帳本寫入失敗：本輪播出紀錄沒有存下，之後可能重播。」 |
| 回饋或手動編輯寫入失敗 | API 回 500（`INTERNAL`、可重試、說明品味帳本寫入失敗）；回饋不會寫 Notion 備份 |
| 損毀檔 | 讀寫都拒絕、**絕不覆寫**；人工修好檔案後下次呼叫自動恢復，不必重啟 |

每次帳本操作均重新讀取並驗證檔案，因此啟動後才發生的損毀也會被拒絕。這不是跨實例鎖；跨程序的讀寫競爭仍由後續票處理。

## UI「我的歌」（BRA-135）

底部導覽「我的」→「我的歌」一頁：清單＋搜尋（曲名／藝人，不分全半形與大小寫）＋濾鏡（全部／收藏／封鎖／最近）。資料直接讀寫上面的 API，沒有另一份清單。

| 動作 | 寫入帳本 |
|---|---|
| 收藏／取消收藏 | `rating: 愛`／`rating: 還行`（帳本沒有獨立的收藏標記；「還行」不加權） |
| 釘選／取消釘選 | `mark: pinned`／`mark: null`；滿 2 首時前端直接提示、不送出，伺服器也會擋 |
| 封鎖／解除封鎖 | `mark: blocked`／`mark: null`；封鎖的列只留「封鎖」鈕與紀錄 |
| 當種子開台 | 不寫帳本；以這首（曲名＋藝人）當唯一歌曲種子送出開台請求，開台頁草稿不動 |

- 「收藏」濾鏡＝評價「愛」或已釘選（封鎖優先）；「最近」＝14 天內有評價／標記或播出。排序：釘選在前、封鎖沉底，其餘依最近動到的先。
- 收藏按鈕只看評價是否為「愛」，與釘選獨立；釘選歌取消收藏後仍留在收藏濾鏡，但按鈕會回到未收藏。
- 每列顯示最近評價（含短評）；「帳本紀錄」展開最近 5 筆。
- 讀不到帳本時明示錯誤並可重試，不顯示任何替代清單。
- 重讀失敗保留上次成功的清單，持續顯示「可能已過期」與重新讀取入口，成功後才清除錯誤。
- 寫入失敗保留曲目、原動作與錯誤說明，以頁面上的 InlineRecovery 提供重試；搜尋、切換濾鏡或 toast 消失都不會隱藏它。

## 不在範圍

自訂清單、Spotify 歌單同步、公開部署。

## 開台種子同步（BRA-156）

每次重開或重整開台頁，種子清單讀取 `GET /api/taste/marks`，將釘選與評價「愛」合併為可選種子。封鎖優先排除，手動再次輸入已知封鎖同曲會保留輸入並提示解除封鎖；最近播過不會自動加入；同曲依帳本的 NFKC／大小寫／空白規則與預設、手動種子去重。只送勾選曲目的曲名／藝人文字，不送帳本識別碼或 Spotify 資料。

純帳本候選收合在「我的歌」入口，新候選預設不勾選。開台鈕的 X／N 只計可見列，收合帳本列不計入，展開才計入；可見列全勾時顯示「全選・快速開台」，部分勾選顯示「快速開台（已選 X／N）」，按全選後恢復全選文案。取消勾選只影響本輪草稿，不修改帳本；帳本來源不能在開台頁移除，要到我的歌取消釘選／收藏。若仍釘選或仍收藏，候選繼續保留；兩者皆解除後重讀即消失。已有預設／手動來源的交集則保留原來源；對帳本候選按「加入清單並勾選」只勾選，不建立第二個來源。

讀取期間暫停送出，避免用尚未同步的草稿開台；失敗時保留草稿、提示清單可能尚未更新，提供重新讀取。切頁後晚到的結果不套用。詳見決策 D-41；回滾只需 revert BRA-156 PR，帳本格式與資料不變。

## BRA-173：我的歌展示資料（D-55）

封面與正式曲名／歌手／專輯由 `POST /api/spotify/song-display` 按需取得，與 `/taste/marks`、`/taste/history` 分離。請求只接受帳本既有 `trackKey`（每批 1–10 個、不重複），由伺服器查可信任的提名曲名／藝人；不存在的 key 回 `unavailable`。不接受客戶端提供提名或 Spotify ID。

展示物件只留在目前畫面生命週期，不寫入 LedgerEntry／TrackMark、不遷移帳本、不送 AI、不下載或持久化圖片。收藏／釘選／封鎖／當種子繼續使用原始 trackKey 與帳本提名；BRA-156 種子清單規則不變。清單切換或卸載取消展示請求；展示失敗不擋帳本操作。
