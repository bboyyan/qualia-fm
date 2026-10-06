# BRA-169：寶石 v2——五首結算翻牌選寶石＋寶石牆

每趟五首聽完 → 結算層五張背面牌 → **全部翻開後**選 1 首成為寶石 → 收進寶石牆（伺服器本機檔，跨 session／重啟保存）→ 每 5 顆解鎖一本「旅程精選集」。設計依據 BRA-163（`design/` 01、03、04、05 幀與 03-copy），規則與取捨見 decision log D-42～D-47。

## 兩層計數

| 層 | 單位 | 位置 | 本票 |
| --- | --- | --- | --- |
| 這趟 N/5（BRA-128 v1） | 種子＋每首聽完／回饋＝1 格，滿 5 格開旅程膠囊 | 收聽頁頂 | 只改文案（含 aria-label），邏輯不動（D-42） |
| 寶石（v2） | 每趟結算翻牌留 1 首＝1 顆 | 結算層、寶石牆、首屏入口條 | 新增 |
| 旅程精選集（v2） | 5 顆寶石＝1 本 | 結算層（第 5 顆時）、寶石牆書架 | 只做解鎖狀態與展示（D-46） |

## 程式

| 檔案 | 內容 |
| --- | --- |
| `packages/contracts/src/gems.ts` | `GemSchema`、`GemWallFileSchema`、`ChooseGemRequest／Response`、`gemWallOf`（每 5 顆切一本）；錯誤碼 `GEM_ALREADY_CHOSEN` |
| `apps/server/src/gems/gemWallStore.ts` | 本機 JSON store：每次讀檔驗證、tmp＋rename 寫入（沿用 `filePersistence`）、一趟一顆、損毀不覆寫 |
| `apps/server/src/routes/api.ts` | `GET /api/gems`、`POST /api/gems`（曲名由伺服器查；需 session＋CSRF） |
| `apps/server/src/config/env.ts`、`app.ts` | `GEM_WALL_PATH`（選填，預設 `./data/gem-wall.json`；test 只用記憶體） |
| `apps/web/src/features/gems/settlement.ts` | 純函式：牌堆、翻牌、`canChoose`（全部翻開才 true）、`chooseCard` |
| `apps/web/src/features/gems/settleController.ts` | 訂閱播放引擎：這趟 `completed` 開牌堆、記「不對」、送出選擇 |
| `apps/web/src/features/gems/gemWallModel.ts`、`gemCopy.ts` | 寶石牆讀取狀態與文案 |
| `SettleOverlay.tsx`／`GemWallPage.tsx`／`GemWallEntry.tsx`／`GemIcon.tsx`／`gems.module.css` | 結算層（原生 modal dialog）、寶石牆頁、首屏入口條、切面寶石 |
| `app/App.tsx`、`appStore.ts`、`services.ts`、`ListenPage.tsx`、`HomePage.tsx`、`FeedbackStep.tsx` | 接線；「我的」tab 加「我的歌／寶石牆」切換 |
| `features/journey/GemTray.tsx`、`CapsuleSheet.tsx`、`journey.ts` | v1 文案改「這趟 N/5」；`capsuleFor` 讓結算層引用這趟的膠囊 |

## 資料檔

```json
{
  "version": 1,
  "gems": [
    { "gemId": "gem_…", "journeyId": "ss_…", "trackKey": "藝人 — 曲名", "title": "曲名", "artist": "藝人", "palette": 3, "chosenAt": "2026-10-06T12:00:00.000Z" }
  ]
}
```

不含種子原文、showId 或 Spotify 回傳欄位。檔案權限 600；與品味帳本一樣是單程序、同一路徑重啟。

## 驗證（2026-10-06，Node 25.5.0）

```sh
pnpm lint && pnpm typecheck && pnpm build   # 全部通過
pnpm test                                   # 83 個檔案、862 項通過（新增 3 檔 35 項）
E2E_PORT=18769 pnpm exec playwright test --project=mobile-360 --project=mobile-390 --project=mobile-430
# 199 passed、2 skipped（既有：slow 情境只在 390 跑）
E2E_PORT=18769 pnpm exec playwright test e2e/gems.spec.ts e2e/journey.spec.ts --project=mobile-390 --project=webkit-390
# 6 passed
```

- V2 單元：`apps/server/test/gemWall.test.ts`（選後寫入、同趟冪等／409、跨趟可重複、滿 5 解鎖 No.1 且下一本 0/5、冪等重送不重複解鎖、損毀檔不覆寫、API 404／400／403）；`apps/web/test/gemSettle.test.ts`（翻四張不可選、全開才可選、「不對」與沒播完不進牌堆、0 張不可選、未全開 confirm 不送出、選完不能再選、第 5 顆帶出精選集、失敗保留選擇）；`apps/web/test/gemWall.test.ts`（文案、讀取狀態、靜態標記）。
- V3：`gemWall.test.ts` 以 `GEM_WALL_PATH` 寫入後建立全新 app（新 SessionStore／JobStore）讀回同一面牆；斷言檔案不含種子原文與 showId、欄位只有 7 個、權限 600；未設路徑的測試環境重啟後是空牆。
- V4：`e2e/gems.spec.ts`：首屏入口條在第一屏 → B 手動聽完五首 → 五張背面牌、確認鈕「還有 5 張沒翻開」→ 翻四張仍不可選 → 全開後選第 3 張 → 「成為你的第 N 顆寶石」→ 收進寶石牆（進度 N/5、已收數、清單含該曲）→ 收聽頁結束卡提示 → 首屏入口條更新；另測 Esc 關掉不遺失翻牌進度。
- 截圖（390×844，開發者模式 MOCK 節目，所以看得到 MOCK／TEST 示意字樣）：[背面牌](screenshots/bra169-settle-hidden-390x844.png)、[全開後選定](screenshots/bra169-settle-picked-390x844.png)、[成為寶石](screenshots/bra169-settle-chosen-390x844.png)、[WebKit 成為寶石](screenshots/bra169-settle-chosen-webkit-390.png)、[寶石牆](screenshots/bra169-gem-wall-390x844.png)、[首屏入口條](screenshots/bra169-home-entry-390x844.png)。

## M1 審查修正（2026-10-06，Node 24）

- 只有 `observe` 可切換旅程；`recordRating` 忽略非目前 session（含尚未 observe），避免 A 晚到回饋清空 B 的評價／結算／翻牌進度；`journey.recordFeedback` 不變。`services` 在引擎 `loadShow` 同步通知時已 observe，早於 `FeedbackStep` 出現。
- 回歸單元先紅後綠：新增 4 項，修正前重現 4→5 張及結算消失，修正後 `gemSettle.test.ts` 17 項通過。E2E 新增受控延遲的 A 回饋，在 B 否決一首、結算並翻牌後才釋放，檢查四張牌、翻牌進度與重新開啟。
- 本輪驗證（沙盒外，Node 24）：`pnpm lint`、`pnpm typecheck`、`pnpm build` 全通過；unit 85 檔／876 項全過（`gemSettle.test.ts` 13→17 項）；`E2E_PORT=18769 pnpm e2e` 三尺寸 208 pass／0 fail／2 skip（mobile-390 70/70）；新 M1 E2E 在修正前的 controller 上會失敗、修正後通過。未做真機測試。

## 已知限制

- 翻牌進度只在前端記憶體：結算出現後重新整理頁面，這趟就選不了寶石（已選的寶石仍在伺服器；後續票 BRA-188，本 PR 不修）。
- `journeyId` 由前端產生，伺服器無法驗證它真的是一趟（單人自用可接受，D-45）。
- 沒有精選集命名／結語／分享／繼續旅程（BRA-129 與後續票），沒有聲景色譜與人生 7 大曲。
- 未做 iPhone 真機測試；Chromium 手機尺寸模擬與 Playwright WebKit 不等於 iPhone Safari。

## 回滾

revert 本 PR。舊版不讀 `gem-wall.json`，檔案可以原樣留著，不必刪除；品味帳本、session 檔不受影響。
