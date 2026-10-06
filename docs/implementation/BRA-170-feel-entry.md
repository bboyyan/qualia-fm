# BRA-170：開台入口「從一首歌／從一種感覺」

開台入口只剩兩格：「從一首歌」（預設，同 BRA-117／156 的種子清單，沒有數量徽章）和「從一種感覺」（8 個情境標籤單選＋「再補一句」）。主按鈕上方完整顯示這次真正送出的 `seed.text`。Hero 只留一個主標「從一首歌，或一種感覺，／開始探索你的人生終極曲目。」設計依據 `design/bra-170-feel-entry/`（v3），規則與取捨見下方 D-57～D-62。

## 程式

| 檔案 | 內容 |
| --- | --- |
| `apps/web/src/features/seed/seedList.ts` | `MOOD_PRESETS`（8 個 `{id, label, prompt}`）、`MoodId`；`Draft` 加選填 `mood`、`feelingText`；`composeFeelingText`、`toggleMood`、`applyExample`、`feelingStartLabel`、`draftSeedText`；`draftProblem`／`toPlanRequest` 改用組句 |
| `apps/web/src/features/seed/selection.ts` | `startLabel`：清單只有 1 首時只寫動詞（順便修 A） |
| `apps/web/src/features/seed/SeedComposer.tsx` | 兩格入口（拿掉聲音）；`FeelingFields`（標籤格＋再補一句＋計數）；範例 chips 加小標「常用的一句感受」；「這次開台會用」預覽；主按鈕依狀態表；歌名欄套框線（順便修 B） |
| `apps/web/src/features/seed/HomePage.tsx` | Hero 拿掉 Eyebrow 與舊 h1，引言升為唯一 h1；生成畫面的備用種子文字改用 `draftSeedText` |
| `apps/web/src/features/seed/seed.module.css` | `.hero h1` 改 26px／1.45／-0.02em／650／ink-strong；新增 `.moods`、`.custom`、`.examples*`、`.preview*`、`.songField`；`.seedQuote` 拿掉 4 行截斷 |
| `apps/web/src/app/AppShell.tsx` | 桌面側欄拿掉「不是找同類型，是找到同一種感覺。」 |

## 組句（送去選歌的 `seed.text`）

| 情況 | `seed.text` |
| --- | --- |
| 只有標籤 | 標籤的 `prompt` |
| 標籤＋自訂句 | `` `${prompt}。${自訂句.trim()}` `` |
| 只有自訂句 | `自訂句.trim()` |
| 全空 | 不能送出：「先選一個感覺，或寫一句。」 |

契約不變：`seed.kind = 'feeling'`、`seed.text ≤ 500 字`（算組好的全文）、`seed.artist = null`。

## 決策

| ID | 決策 | 理由 | 影響／回滾 |
| --- | --- | --- | --- |
| D-57 | （BRA-170）情境標籤是前端常數 `MOOD_PRESETS`，`prompt` 一字不改照設計稿 README；送出時只送組好的 `seed.text`，不存 `moodId`、不加 `seed.mood` | 曄定案不改 API 契約；生成畫面、Ready、開台歷史都直接顯示 `seed.text` 全文，不需要從 text 反查標籤 | 後端若要分辨「標籤開台」，再另票在契約加選填 `seed.mood`（之後再做） |
| D-58 | （BRA-170）`Draft` 加 `mood`、`feelingText` 兩個**選填**欄位，和歌名欄 `text` 分開；草稿仍只在記憶體（D-11），沒有持久化資料要遷移；缺欄位一律視為 `null`／空字串 | 切模式時歌名欄與感覺句互不覆蓋；選填型別讓舊形狀的草稿物件（測試、`songSeedRequest` 的展開）也能安全使用 | 單元測試「舊草稿相容」涵蓋；若日後要把草稿寫進 storage，讀入時同樣補預設值 |
| D-59 | （BRA-170 順便修 A）在共用的 `startLabel` 修：選取數＝總數且總數為 1 時只寫動詞（「快速開台」／「建立下一段」）；2 首以上全選維持「全選・…」，部分選維持「…（已選 X／N）」 | 原因是 `startLabel` 只比 `selected === total`，1／1 也算全選；在共用處修，Ready 只剩 1 首時也不會出現「全選・開始收聽」 | e2e `bra117`、`my-songs` 中原本就是 1／1 的 3 個斷言改為「快速開台」；2 首以上的斷言不變 |
| D-60 | （BRA-170 順便修 B）歌名欄維持 `textarea`，加上藝人欄的 `.artistField` 外觀＋`.songField`（block、不可拉伸、行高 1.4） | 兩欄外觀一致，只用既有 tokens；不改元素，e2e 的 `seed-input` 與換行行為不變 | 拿掉 `.songField` 與 class 即回復 |
| D-61 | （BRA-170）桌面側欄只留「手機優先的私人電台。」 | 曄同意拿掉與舊 h1 同義的後半句；側欄還有 h2「Feel the connection.」，只剩一句也不突兀 | — |
| D-62 | （BRA-170）範例 chip 在「從一種感覺」再點同一句會清空「再補一句」；在「從一首歌」點 chip 只切模式＋填入，不選標籤、不開始、歌曲勾選保留。全空時主按鈕停用，`aria-describedby` 指到預覽區說明原因 | 照設計稿 README「範例 chips 與情境標籤」規則 3、「主按鈕狀態表」 | — |

## 測試

- 單元：`apps/web/test/feelEntry.test.ts`（8 個 prompt、組句三種＋全空、500 字邊界、標籤單選／再點取消、chip 取代、按鈕文案、契約、舊草稿相容、1／1 文案）；`seedList.test.ts` 跟著改 1／1 與感覺模式欄位。
- E2E：`e2e/feel-entry.spec.ts`（新主標、兩格入口、1／1、歌名欄框線、點標籤→預覽全文→開台、chip 切模式、全空停用、兩種模式無橫向捲動）；`shell.spec.ts` 新主標與入口名稱。

## 之後再做

- 範例 chips 換成使用者最近用過的自訂句（本機最近 3 句，去重）。
- 契約加選填 `seed.mood`（後端需要分辨標籤開台時）。
