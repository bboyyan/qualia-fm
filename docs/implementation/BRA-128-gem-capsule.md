# BRA-128：寶石遊戲＋旅程膠囊

用寶石把收聽串起來：開台的種子＝1 顆寶石；一首歌聽完或留下回饋再鑲 1 顆；滿 5 顆開出「旅程膠囊」——封面卡列出曲目（含評價）與情緒標籤，下方是比單段 DJ 串詞更長的結語。規則與取捨見 decision log D-33～D-35。

## 呈現（對齊 BRA-125 清雜）

- 收聽頁首屏只多一個 48px 點按區：計數膠囊左側的 5 格小菱形＋「n/5」。不新增卡片，不推擠播放鍵。
- 滿 5 顆時寶石盤改成赭色「膠囊」並短暫發光三次（減少動態時不發光），朗讀區念「五顆寶石到齊，旅程膠囊開好了」。不跳 toast：toast 會被緊接著的回饋提示蓋掉。
- 點寶石盤開「旅程」底部面板：有膠囊就顯示封面卡＋DJ 結語，並在下方顯示下一段旅程的進度與規則。

## 程式

| 檔案 | 內容 |
| --- | --- |
| `apps/web/src/features/journey/journey.ts` | 純函式模型：`addSeedGem`、`inlayTrack`、`markCapsuleOpened`、`moodTags`、`composeOutro` |
| `apps/web/src/features/journey/journeyTracker.ts` | 訂閱播放引擎（新 session＝種子、`played`＝鑲嵌）與回饋送出 |
| `GemTray.tsx`／`CapsuleCard.tsx`／`CapsuleSheet.tsx`／`journey.module.css` | 寶石盤、膠囊封面卡、底部面板 |
| `app/services.ts`、`FeedbackStep.tsx`、`ListenPage.tsx`、`App.tsx`、`appStore.ts` | 接線；SheetKind 新增 `capsule` |

## 驗證

```sh
fnm use 25.5.0
pnpm lint && pnpm typecheck && pnpm test && pnpm build
# lint／typecheck／build 成功；78 個測試檔、788 個單元測試通過
pnpm exec playwright test e2e/journey.spec.ts --project=mobile-360 --project=mobile-390 --project=mobile-430
# 3 passed
pnpm exec playwright test --project=mobile-390
# 62 passed
```

- 單元（`apps/web/test/journey.test.ts`，23 項）：種子＋1、同種子不重複、未聽就換種子取代；聽完鑲嵌、只回饋也鑲嵌、聽完＋回饋只算一顆；滿 5 開膠囊並清空、第二個膠囊編號；後到評價補進膠囊並更新結語；結語 > 180（單段 DJ 上限）且 ≤ 360、極長曲名不超限；情緒標籤排序；tracker 不重複通知；寶石盤與膠囊卡的靜態輸出。
- E2E（`e2e/journey.spec.ts`）：B 手動模式開台 → 第 1 首愛 → 2–4 首略過回饋 → 寶石盤變膠囊 → 打開見 4 首曲目、情緒標籤、結語 → 關閉後寶石盤歸零；三個手機寬度無橫向溢位。
- 截圖：[360 寶石盤](screenshots/bra128-tray-ready-360x800.png)、[390 寶石盤](screenshots/bra128-tray-ready-390x844.png)、[360 膠囊](screenshots/bra128-capsule-360x800.png)、[390 膠囊](screenshots/bra128-capsule-390x844.png)（E2E 走開發者模式的 MOCK 節目，所以會看到 MOCK／TEST 示意字樣；預設網址不會出現）。

## 已知限制

- 未做 iPhone 真機測試；Chromium 手機尺寸模擬不等於 iPhone Safari。
- 結語只以文字呈現，沒有 AI 語音。
- 重新整理頁面後寶石與膠囊歸零（D-34）。

沒有改動 server、SPOTIFY_*、spend、usage credits 或部署設定。回滾方式為 revert 本 PR。
