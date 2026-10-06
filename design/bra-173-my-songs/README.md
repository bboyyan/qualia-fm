# BRA-173｜「我的歌」改版畫面稿

本輪僅交付視覺設計與唯讀查證，**尚未通過曄的 H1，也未實作產品功能**。基底為 `6b2b85364f93b796ad2a0ef2d12e553b557b4a7a`，分支為 `bboyyan/bra-173-my-songs-design`。所有新增檔案均限本目錄；未開 PR、未改產品碼／設定／環境變數，未連 Spotify 帳號，未使用真實金鑰，未碰測線或正式環境。

2026-10-06 以 `orca linear issue BRA-173 --full --json` 唯讀取得[票面](https://linear.app/brainness/issue/BRA-173)：描述引用曄 12:36 的「我的歌介面也太簡陋，沒有專輯封面。」；目前回傳的 comments 為空，因此這段來源是票面描述，不是獨立取得的留言。票面要求先出稿交 H1；本輪依使用者範圍不執行票面後續的實作驗收，也不更新 Linear 狀態或留言。實作須等 BRA-156 的 PR #24 合併後另開分支；本輪沒有查詢或宣稱它已合併。

## 交付與開啟

| 檔案 | 用途 |
| --- | --- |
| [a-my-songs.html](a-my-songs.html) | A 案主畫面；三列分別示範有封面、無封面＋長曲名、封面載入失敗 |
| [a-empty.html](a-empty.html) | 同一 A 案的初次使用空狀態，不是 B 案 |
| `a-my-songs.png` | 預定主畫面截圖，390×844；實際產出狀態見下方驗證紀錄 |
| `a-fallbacks.png` | 預定同頁捲到底的補充截圖，390×844，檢視兩種缺圖狀態 |
| `a-empty.png` | 預定空狀態截圖，390×844 |

兩份 HTML 都可獨立離線開啟：內聯 CSS、內嵌 SVG 封面與 PNG 標誌、系統字型，不需要伺服器或建置。CSP 禁止網路連線及腳本，沒有外連 Spotify CDN。所有曲名、藝人、專輯、帳本紀錄與封面均為虛構示意；Spotify 官方標誌只用來審閱來源標示的位置與比例，並不表示示意曲目真的存在於 Spotify。

```bash
open design/bra-173-my-songs/a-my-songs.html
open design/bra-173-my-songs/a-empty.html
```

畫面寬度上限 390px、最小高度 844px，歌曲清單可向下捲動。首屏優先呈現完整的兩首與下一列入口；補充截圖檢視清單下方。沒有新增搜尋、收藏或播放實作：搜尋為唯讀，篩選、四個操作、底部導覽與「在 Spotify 開啟」均為無副作用的畫面按鈕；唯一能操作的是瀏覽器原生 `details`，點「曲目資訊與紀錄」可展開完整曲名、歌手、專輯與紀錄。

## 唯讀查證：現有「我的歌」

以下皆以本分支基底程式碼為準。

| 來源 | 已確認行為 |
| --- | --- |
| [MySongsPage.tsx](../../apps/web/src/features/songs/MySongsPage.tsx) | 「我的」內的單頁，標題／副標、搜尋、全部／收藏／封鎖／最近四個濾鏡、釘選名額、清單及空／錯誤狀態 |
| [SongRow.tsx](../../apps/web/src/features/songs/SongRow.tsx) | 曲名、藝人、釘選或封鎖標記、最近評價；收藏／釘選／封鎖按鈕、當種子開台、可展開帳本紀錄；**沒有封面元素** |
| [songs.module.css](../../apps/web/src/features/songs/songs.module.css) | 暖白卡片、20px 圓角、陶土色釘選左緣、三顆並列狀態按鈕，底部另放紀錄與當種子；文字可換行，沒有圖片欄 |
| [mySongs.ts](../../apps/web/src/features/songs/mySongs.ts) | 收藏＝評價「愛」，取消收藏＝「還行」；釘選與評價獨立。收藏濾鏡含愛或釘選，封鎖優先排除；最近為 14 天。一般排序釘選優先、封鎖沉底，最近濾鏡依時間 |
| [mySongsModel.ts](../../apps/web/src/features/songs/mySongsModel.ts)、[client.ts](../../apps/web/src/api/client.ts) | 清單、標記變更、最近 5 筆歷史與 pending／失敗重試，直接接品味帳本 API |
| [App.tsx](../../apps/web/src/app/App.tsx)、[seedList.ts](../../apps/web/src/features/seed/seedList.ts) | 當種子只用該首開台；回開台頁看編排，既有播放不中斷 |
| [docs/taste-ledger.md](../../docs/taste-ledger.md) | BRA-135 規則、API 與帳本邊界；釘選上限 2 首 |

已檢視[既有 BRA-135 手機截圖](../../docs/implementation/screenshots/bra135-my-songs-mobile-390.png)：大標題與搜尋後接純文字卡片，第一首含評價與兩層操作，第二首僅部分進入首屏。此檔本身是 2 倍像素截圖，不能誤稱本輪 390×844 的 PNG。

封鎖狀態仍應沿用 BRA-135：只留解除封鎖及紀錄，隱藏收藏／釘選／當種子；本稿三列皆未封鎖，所以每列都有四項操作。釘選額滿與重試狀態留給實作回歸，不借此次改版更動規則。

## 唯讀查證：封面資料在哪裡

**結論：既有 Spotify 曲目物件有封面網址；品味帳本沒有，清單 API 也沒有。現有資料不能直接當作永久的封面資料庫。**

1. [webApi.ts](../../apps/server/src/spotify/webApi.ts) 讀取 `album.images[]`（網址與尺寸）及專輯名稱。
2. [resolver.ts](../../apps/server/src/spotify/resolver.ts) 的 `artworkOf()` 選取 `i.scdn.co` 主機、最接近 300px 的圖片，寫入 `ResolvedTrack.artworkUrl`。同時填入 `canonicalTitle`、`canonicalArtists`、`canonicalAlbum`、`externalUrl`；未對應到曲目則封面為 `null`。
3. [domain.ts](../../packages/contracts/src/domain.ts) 定義 `ResolvedTrackSchema`，上述展示資料位於 `ShowPlan.segments[].track`。
4. [jobStore.ts](../../apps/server/src/stores/jobStore.ts) 以 session owner 隔離，在記憶體保留節目，有 24 小時保留／修剪機制，重啟不保留；`scrubSpotify()` 於中斷連結時清除 Spotify 欄位，`forgetOwner()` 會清除該 owner 的節目。`ownedShows()` 可取得該 owner 尚存在的節目，但目前沒有供「我的歌」使用的封面查詢 API。
5. [taste.ts](../../packages/contracts/src/taste.ts) 的 `LedgerEntry` 與 `TrackMark` 只存提名曲名、藝人、trackKey、評價／標記等，**沒有 `artworkUrl`、Spotify ID、專輯名稱或外連**；strict schema 拒收額外欄位。[tasteService.ts](../../apps/server/src/services/tasteService.ts) 的 `recordAired()` 取 `segment.candidate`，並未把 `segment.track` 搬進帳本。[planService.ts](../../apps/server/src/services/planService.ts) 同樣註明展示資料不進帳本／AI。
6. [routes/api.ts](../../apps/server/src/routes/api.ts) 的 `/taste/marks` 回傳 `TrackMark[]`，`/taste/history` 回傳 `LedgerEntry[]`；無 album image。帳本還會供選歌使用，因此不能只為顯示封面就把 Spotify 回傳值加進此資料流。

### 補存與按需取的取捨

| 方案 | 好處 | 影響與成本 | 預計涉及檔案（尚未修改） |
| --- | --- | --- | --- |
| 將封面補存到 LedgerEntry／TrackMark | 清單讀取時即可取得 | 違反 repo 明訂的帳本資料邊界；需遷移 version 1、調整 reducer 與保留規則，歷史歌曲仍無圖，失效網址／解除連結清除亦要處理。**不建議** | `packages/contracts/src/taste.ts`、`apps/server/src/services/tasteService.ts`、`apps/server/src/ledger/tasteStore.ts`、相關 schema／隱私測試與文件 |
| 另建可清除的展示資料持久層 | 跨重啟較快，與帳本分離 | 需另訂保存期限、撤銷與清除規則、來源及曲目比對；不應快取圖片位元組；舊曲仍需補查。超過本次最小改動範圍 | 新展示 store／contract，及 `services/planService.ts`、`app.ts`、`routes/spotify.ts` 的寫入及清除接點 |
| **按需取得展示資料（建議）** | 保留帳本既有語意；優先重用目前 owner 尚存在的 `ResolvedTrack`，缺失再對應，不需帳本遷移 | 初次取得有延遲、可能遇到找不到或限流；未連結／非 owner 不查 Spotify，維持佔位圖；封面失敗不影響收藏等操作 | 新展示查詢服務與 contract、`routes/spotify.ts`、`app.ts`、`spotify/resolver.ts`／`webApi.ts`、前端 API／model／SongRow |

建議流程：以帳本已有 `trackKey` 請求 → 伺服器從帳本取可信任提名 → 檢查既有 Spotify 啟用與 owner 條件 → 在目前 session 的 `ownedShows()` 尋找相同 candidate key 的已解析曲目 → 若沒有，再透過既有 resolver 比對曲名與藝人 → 回傳**獨立展示物件**。UI 的操作仍綁原始 `trackKey`；Spotify 展示欄位不可反向覆寫帳本或送入 AI。不要把按需展示請求接到本來沒有 Spotify owner 檢查的 `/taste/marks` 直接回傳所有資料。

只查可見列，限制並行與請求數、合併同一列的在途請求、切頁取消；429 遵守既有 Retry-After 行為，不做無限重試。展示狀態限當前生命週期，不下載／持久化圖片；找不到或圖片載入失敗即使用固定尺寸佔位圖。是否新增短期記憶體展示快取，留給實作時依 repo「不快取」約束再決定，本稿不預設新增。**不新增 Spotify 歌單同步，也不以播放／連帳號作為看清單的前提。**

## BRA-111：封面與來源標示

repo 依據為 [BRA-111 報告](../../docs/implementation/reports/BRA-111.md) 第 0／6 節、[spotify-e-mode.md](../../docs/spotify-e-mode.md) 第 8／9 節，以及 [SpotifyTrackCard.tsx](../../apps/web/src/features/spotify/SpotifyTrackCard.tsx)／[spotify.module.css](../../apps/web/src/features/spotify/spotify.module.css)。另外於 2026-10-06 唯讀核對 [Spotify 官方設計規範](https://developer.spotify.com/documentation/design)：來源標示、保留原圖、禁止覆蓋、4／8px 圓角、截斷內容可讀全文、連回 Spotify 的方向與 repo 一致。這是設計對照，沒有改寫 repo 的資料保存決策。

| 規範 | 本稿處理 |
| --- | --- |
| 完整官方 logo，不手刻、不拆字標 | 每列皆內嵌 repo `Spotify_Full_Logo_RGB_Green.png` 原始位元組；80px 寬、等比例高約 21.91px，四周 11px 留白 |
| 官方素材可追溯 | 原檔 3432×940；SHA-256 `691d3c7145702c0533b651efa6c29af57235e2ba7a2f7d54f57e650086d8915c`，符合 BRA-111 報告 |
| 小／中封面 4px、大封面 8px | 本稿均為 64×64、4px 圓角，不套卡片的 20px 圓角；`object-fit: contain` 保留完整封面 |
| 不在封面上疊狀態或操作 | 收藏、釘選在文字下方，四個操作獨立一列；佔位圖同尺寸，不用破圖圖示 |
| 截斷後仍能看完整資訊 | 曲名與藝人單行省略號、附 title；另以至少 48px 高的原生展開列讀完整曲名／歌手／專輯，不能只靠手機上不可用的 hover |
| Spotify 內容連回來源 | 展開內保留「在 Spotify 開啟」44px 入口；本靜態稿不設真實外連，實作才接 resolver 驗證後的 `externalUrl` |

三列模擬的是「已取得曲目展示資訊」下的有圖／無圖／圖片失敗；失敗列保留原曲名與來源，不能因圖片壞掉就消失。若根本未解析到 Spotify 或未連結，實作需顯示帳本曲名與佔位圖，**不顯示 Spotify logo／Spotify 連結**，避免誤標來源。這個分支規則已記錄，未另外增加產品畫面。

## 與寶石 v2 的視覺關係

唯讀設計依據：

- [BRA-163 README](/Users/jaxpkm/orca/workspaces/qualia-fm/bra-163-journey-v2-design/design/README.md)：沿用 Qualia tokens；深綠夜色只用在寶石、結算、精選集等 v2 時刻。
- [03-copy.md](/Users/jaxpkm/orca/workspaces/qualia-fm/bra-163-journey-v2-design/design/03-copy.md)：寶石記住一趟、精選集記住一段日子、人生 7 大曲代表現在的你；本稿不把收藏或釘選叫做寶石。
- [首屏設計稿](/Users/jaxpkm/orca/workspaces/qualia-fm/bra-163-journey-v2-design/design/02-screens/01-home-gem-entry.html)、[寶石牆設計稿](/Users/jaxpkm/orca/workspaces/qualia-fm/bra-163-journey-v2-design/design/02-screens/04-gem-wall.html) 及其 PNG：相同品牌字樣、暖白底、綠色主操作、膠囊與底部四格導覽。
- 本 repo 的 [tokens.css](../../apps/web/src/styles/tokens.css)、[ui.module.css](../../apps/web/src/ui/ui.module.css)、[shell.module.css](../../apps/web/src/app/shell.module.css)、[Icon.tsx](../../apps/web/src/ui/Icon.tsx)。

HTML 完整內聯現有 tokens；主色使用 `--q-bg #F6F4ED`、`--q-surface #FFFEFA`、`--q-primary #294F42`、`--q-ink #1F302A`，釘選沿用 `--q-accent #985339` 與其 wash／line。封面示意圖也只取既有色票，沒有新增品牌色。20px 卡片、16px 搜尋、膠囊按鈕、襯線曲名、原有 SVG 圖示與四個底部導覽延續現有元件。

此頁是平常整理歌曲的暖白面；不額外堆寶石、集數或收藏數儀表板，也不在本票決定 BRA-169 的導覽整合。後續實作應在 PR #24 合併後重新對齊 shell，保留其他票的入口。

## 驗證與截圖

- 已做靜態檢查：兩份 HTML 無腳本、無外部 src／href、具繁中語系與封鎖網路的 CSP；官方標誌位元組雜湊符合 repo。所有操作按鈕 CSS 最小高度 44px、四分欄在 390px 皆大於 44px；搜尋 48px、展開列 48px、空狀態 CTA 52px、底部導覽 64px。
- 純畫面稿不執行產品 lint／typecheck／test／build，不把它們列成通過；亦未安裝 repo 依賴或變更設定。無／壞封面是預先排好的結果態，**不是已實作 `onerror` 的證據**。
- 截圖第一次使用已安裝 agent-browser 所附的 Playwright CLI，但該版本尋找 `chromium_headless_shell-1208`，本機只有 1243，回報 executable 不存在；沒有安裝瀏覽器或修改套件。
- **沙盒限制：既有 Chromium 啟動遭作業系統拒絕。** 第二次使用既有 Chromium 1243 仍無法啟動；連續兩次截圖失敗後已停止。**三張 PNG 均未產出，未完成瀏覽器視覺驗證**；上方 PNG 檔名只是補圖目標，不是已交付檔案。原因見 [STOP.md](STOP.md)，原始診斷見 [screenshot-error.txt](screenshot-error.txt)。由 Rudeus 在沙箱外依下列指令補圖。

若需 Rudeus 在沙箱外補圖，於本 worktree 根目錄、已有相符 Playwright 瀏覽器的環境執行（不啟動產品、不載入 env、不連帳號）：

```bash
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=400 "file://$PWD/design/bra-173-my-songs/a-my-songs.html" design/bra-173-my-songs/a-my-songs.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=400 "file://$PWD/design/bra-173-my-songs/a-my-songs.html#song-3" design/bra-173-my-songs/a-fallbacks.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=400 "file://$PWD/design/bra-173-my-songs/a-empty.html" design/bra-173-my-songs/a-empty.png
```

補圖時確認：PNG 是 390×844（不是 2 倍尺寸）、第一列封面完整不裁切、長曲名有省略號、兩種佔位不移位、底部導覽不遮最後操作；展開完整曲名後可以捲動讀完。稿面是可捲動頁面，不用 `--full-page` 取代指定尺寸。

## 方案重點、建議與後續實作範圍

**A 案一句話：用固定封面、清楚狀態與一列四個操作，讓每首歌有辨識度，也容易再拿來開台。**

本輪只做 A 案，沒有 B 案；`a-empty.html` 為同案狀態補充。相較目前 BRA-135：新增 64px 封面、將狀態集中在曲名下、將四個操作放同一列，完整 metadata 與帳本紀錄改為合併展開區，保留 Spotify 完整來源標誌。好處是操作可見且規則不變；代價是每列仍要保留品牌留白，首屏無法一次放完所有歌曲。**建議選 A 案**，先確認這個密度，再進實作，不另做一套色彩或唱片牆。

預計實作檔案（本輪均未修改，PR #24 合併後另開實作分支再確認）：

| 群組 | 預計檔案與用途 |
| --- | --- |
| UI | `apps/web/src/features/songs/SongRow.tsx`、`songs.module.css`：封面／佔位、截斷與完整 metadata、四操作排列；`MySongsPage.tsx`：展示狀態及空狀態。沿用 `features/spotify/SpotifyTrackCard.tsx` 的官方標誌常數或抽共用展示元件 |
| 前端展示資料 | `apps/web/src/features/songs/mySongsModel.ts`、`apps/web/src/api/client.ts`：獨立按需展示資料與取消、避免封面請求擋標記操作；`mySongs.ts` 的收藏／釘選／種子規則保持既有語意 |
| 合約 | 新 `packages/contracts/src/songDisplay.ts`（暫定）＋ `src/index.ts` 匯出：只供展示的輸入／回應；重用 `domain.ts` 的 metadata 定義，不往 `taste.ts` 加 Spotify 欄位 |
| 伺服器 | 新 `apps/server/src/services/songDisplayService.ts`（暫定）；`app.ts` 接線；`routes/spotify.ts` 加啟用與 owner 檢查的展示端點；重用 `stores/jobStore.ts` 的 `ownedShows()` 及 `spotify/resolver.ts`／`webApi.ts`，按所需調整介面；解除連結清理相關在途展示請求 |
| 驗證與文件 | `apps/web/test/mySongs.test.ts`、`spotifyBrand.test.ts`：有／無／壞圖、長文與 44px 操作；新增展示 API 測試、維持 `apps/server/test/tasteLedgerPrivacy.test.ts` 邊界；既有 mobile-390 E2E 補完整流程與截圖；同步 `docs/taste-ledger.md`、`docs/spotify-e-mode.md` 的展示說明 |

### H1 要曄看的重點

1. 第一眼是否已能用封面認歌，暖白與綠色的整體感是否和寶石 v2 一致？
2. 每列四個直接操作的密度是否合適，「當種子」是否夠清楚？收藏與釘選可同時成立是否一眼能懂？
3. 無封面／失敗佔位是否可接受；長曲名截斷後，展開入口是否容易找到？
4. 是否接受首屏約兩首完整卡片，以保留 ≥44px 觸控目標及 Spotify 官方標示？
5. 空狀態是否能引導去開台？H1 通過的範圍是畫面方向，資料查詢與產品驗收須留待獨立實作分支。

### 2026-10-06 沙箱外補圖（Rudeus）

12:5x（台北時間）由 Rudeus 在沙箱外，用 `qualia-real-test` 既有的 Playwright 1.63.0（對應 Chromium 1243）照上列三行指令補出 `a-my-songs.png`、`a-fallbacks.png`、`a-empty.png`，以 `sips` 確認皆為 390×844。目視檢查：第一列封面完整未裁切、長曲名有省略號、無封面與讀取失敗兩種佔位同尺寸未移位、底部導覽未遮住最後操作。小瑕疵：釘選卡（淡陶土底）上的 Spotify 標誌帶白色底框，留給 H1 判斷。未安裝依賴、未改產品碼或設定。
