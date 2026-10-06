# BRA-129：旅程精選集分享＋繼續旅程（內部、可回滾）

集滿五顆寶石的「旅程精選集」（五首）可以存成圖片、複製內部連結；分享頁的「繼續旅程」直接用這五首當種子開下一趟，也可以「先改一句」再開台。公開連結屬 L2，**本票未開啟、未部署**：按鈕停用並寫「公開分享尚未開放」，公開唯讀路由在 feature flag 後面且預設 404。畫面依 BRA-163 幀 06；決策見 decision log D-48～D-54（合併時若與其他 PR 撞號需重新編號）。

## 範圍

| 做 | 不做（後續票） |
| --- | --- |
| 分享頁（底部面板）：夜色分享卡、五首＋Spotify 單曲連結、存成圖片、複製內部連結、停用的公開連結 | 寶石牆「滿五精選集」→ 分享頁的入口（等 BRA-169／PR #25 合併） |
| 內部短碼 `/?share=<12 字元>`，只在已登入的同一個 app 內解析 | 公開落地頁、短連結對外啟用（L2，需曄當次同意） |
| 繼續旅程（直接開台）＋先改一句（預填、可送出） | 系統分享（Web Share）、複製文字歌單、人生 7 大曲分享 |
| 分享 → 開啟 → 新開台 計數（本機分享檔） | 社交廣場、自動發文 |

## 流程

```
精選集五首 ──POST /api/share──▶ 分享紀錄（本機 JSON，shared+1）──▶ 分享頁
                                            │
  /?share=<code>（同 app、已登入）──GET /api/share/:code──▶ 分享頁 ──POST events {opened}
                                                              │
                         繼續旅程／先改一句 ──▶ generation.start（現有 POST /api/plan）──POST events {continued}
```

- 分享頁的輸入就是五首 `{ trackKey, title, artist, palette }`（對齊 BRA-169 `Gem` 的欄位），不依賴 #25 的程式。目前沒有 UI 入口建立分享；`shares.share({ selectionNo, tracks })` 留給寶石牆接入。E2E 以 API 種一本精選集再用內部連結進入。
- 「繼續旅程」組出的請求：`seed = { kind: 'song', text: 五首曲名以「／」串接, artist: 藝人去重以「／」串接 }`、`requestedCount: 5`、DJ 依設定、`tuning: null`。超過種子字數上限時依序保留放得下的曲目（至少一首）。「先改一句」只替換 `seed.text`，藝人保留。
- 不改 session 驗證邏輯（`security/sessions.ts`）；分享路由沿用 `requireSession`＋`requireCsrf`。

## API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| POST | `/api/share` | session＋CSRF | `{ selectionNo, tracks: [5] }` → 201 `ShareView`；同編號同五首沿用原短碼、`shared+1` |
| GET | `/api/share/:code` | session | `ShareView`（五首＋`spotifyUrl`、計數、`publicLinkEnabled`）；未知／格式不符 404 |
| POST | `/api/share/:code/events` | session＋CSRF | `{ kind: 'opened' \| 'continued' }` → 計數 |
| GET | `/api/public/share/:code` | 無 | **預設關閉**：整個 `/api/public` 回 404（在 session 檢查之前，不會回 401）；只有 `SHARE_PUBLIC_ENABLED=true` 才回不含計數的五首 |

## 資料

`SHARE_STORE_PATH`（預設 `./data/share-links.json`，啟動時轉絕對路徑；NODE_ENV=test 未設定時只在記憶體）。寫入沿用品味帳本的 `filePersistence`：同目錄私有 tmp（mode 600、`wx`）＋ rename，新目錄 mode 700；每次操作重新讀檔驗證，損毀時回 500 且不覆寫。最多保留 200 筆。

```json
{
  "version": 1,
  "shares": [
    {
      "code": "Ab3_-Zx9Qw2k",
      "selectionNo": 2,
      "tracks": [{ "trackKey": "mono lune — 晚安練習曲", "title": "晚安練習曲", "artist": "Mono Lune", "palette": 0 }],
      "createdAt": "2026-10-06T08:00:00.000Z",
      "counts": { "shared": 1, "opened": 2, "continued": 1 }
    }
  ]
}
```

（`tracks` 實際上剛好 5 首；範例只列 1 首。）不存種子原文、不存 Spotify 回傳欄位；Spotify 連結由曲名＋藝人即時推導成 `https://open.spotify.com/search/…`。

## 設定

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `SHARE_STORE_PATH` | `./data/share-links.json` | 分享紀錄檔 |
| `SHARE_PUBLIC_ENABLED` | 未設＝關 | 只有字面 `true` 才開（`TRUE`、`1`、空字串都是關）。**L2：需曄當次同意，本票不得設定。** |

設定讀在 `apps/server/src/share/config.ts`，由 `index.ts` 傳給 `createApp`（不動 `config/env.ts`）；`createApp` 沒拿到時 fail closed（記憶體、公開關）。

## 程式

| 檔案 | 內容 |
| --- | --- |
| `packages/contracts/src/share.ts` | schema、`SHARE_CODE`、`spotifySearchUrl`、`continuationSeed` |
| `apps/server/src/share/{config,shareStore,routes}.ts` | 設定、本機檔 store、session 路由與公開路由 |
| `apps/web/src/features/share/*` | `shareController`（狀態）、`shareApi`（沿用 `ApiClient.ensureSession` 的 CSRF）、`shareLink`、`shareCard`（canvas PNG）、`ShareContent`／`ShareSheet`、`share.module.css`（夜色變數只在模組內） |
| 接線（最小、純新增） | `app.ts`（掛兩個 router）、`index.ts`（傳設定）、`App.tsx`（掛 `ShareSheet`）、`contracts/index.ts`（export）、`playwright.config.ts`（E2E 用暫存分享檔） |

## 回滾

revert 本 PR。舊版本不認得 `share-links.json`，不會讀也不會改；不需要刪資料（要清也只是刪那一個檔）。公開路由從未開啟，沒有對外連結需要收回。
