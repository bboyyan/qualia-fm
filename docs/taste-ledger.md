# 品味帳本（BRA-134）

本機、機器可讀的「品味帳本」，開台前必讀；Notion 只是可選的單向備份（沿用 BRA-98 的 `FeedbackLedger`），開台不靠爬 Notion。

## 資料

檔案：`TASTE_LEDGER_PATH`（空值＝`./data/taste-ledger.json`，啟動時轉成絕對路徑；權限 600，tmp＋rename 原子寫入）。
`NODE_ENV=test` 且未設定時只存在記憶體。

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
- `TrackMark`（`marks`）是依 entries 重算的每首歌目前狀態：後到的評價／標記覆蓋先前的；`mark: null` 代表清除標記。
- 曲目只用 LLM 當時提名的曲名／藝人（`trackKey`＝NFKC＋小寫＋壓空白），永遠不存 Spotify 回傳欄位（Policy III.13／III.14）。
- 播出紀錄只保留最近 500 筆；評價與標記永遠保留。

## 開台前選歌管線（固定順序）

`apps/server/src/services/tasteRules.ts`：

1. **blocked 硬排除**：任何情況都不放回。
2. **近 N 已播排除**：N＝10（最近播出的 10 首不重複曲目）。只有候選不足 5 首時，才依「最久以前播」放回，並在節目 warnings 明示。
3. **pinned 置前**：每輪最多 2 首；不受近 N 限制；超過上限時最久沒播（從未播最優先）的先排。草稿沒有的釘選曲會補成候選（`evidenceLevel: user_description`）。
4. **「愛」輕推／「不對」降權**：只調順序（愛往前 1.5 位、不對往後 4 位），不排除。

短評（note）由 `editorialInput.tasteHints` 交給 planner 當軟約束：`avoid`（封鎖＋近 N）、`loved`、`disliked`（各最多 15 首，含短評）。

只有真實提名（非 MOCK 草稿）會記播出紀錄，示範模式不會被近 N 擋光。

## 寫入時機

| 事件 | 寫入 |
|---|---|
| 聽完回饋 `POST /api/feedback`（BRA-98） | 先寫品味帳本 `feedback`，成功後才寫 `FeedbackLedger`（Notion 備份） |
| 手動改評價／標記 `POST /api/taste/marks` | `rating` 及／或 `mark` |
| 節目排定（真實提名） | 每首 `aired` |

`GET /api/taste/marks` 回傳 `{ marks: TrackMark[] }`（最近更新在前）。手動編輯的對象只能是自己節目裡的段落（`{showId, segmentId}`）或帳本裡已有的 `trackKey`，不接受用戶端自填曲名。

## 失敗時明確降級

| 狀況 | 行為 |
|---|---|
| 開台時帳本讀不到／損毀 | 照常開台，但本輪不套任何規則；節目 warning：「品味帳本讀取失敗：本輪未套用封鎖、近期已播、釘選與評價規則。」；伺服器記 `taste_ledger_read_failed` |
| 播出紀錄寫入失敗 | 節目照常完成；warning：「品味帳本寫入失敗：本輪播出紀錄沒有存下，之後可能重播。」 |
| 回饋或手動編輯寫入失敗 | API 回 500（`INTERNAL`、可重試、說明品味帳本寫入失敗）；回饋不會寫 Notion 備份 |
| 損毀檔 | 讀寫都拒絕、**絕不覆寫**；人工修好檔案後下次呼叫自動恢復，不必重啟 |

## 不在範圍

UI「我的歌」、自訂清單、Spotify 歌單同步、公開部署。
