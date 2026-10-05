# BRA-125：首屏 UI 清理

預設網址不呈現模式三格、環境徽章、常駐裝置狀態／重新偵測、測試播放選項與情境預覽。開台、介紹、微調、回饋與設定的固定測試文案已清理；不足五首只顯示「先聽這 N 首。」與重新選歌。

診斷入口為 `/?developer=1`，必須精確 opt-in，不依 NODE_ENV、provider 或本機設定自動開啟。既有診斷元件由 `DeveloperOnly` 阻止渲染（不是 CSS 隱藏）；離開此網址後，舊的 mock 播放偏好不會自動啟用。這只是 UI 診斷入口，不是授權或安全邊界，伺服器閘門照舊。

開台與微調共用的顯示入口拒絕 mock 選曲結果／AI 降級成示範曲目；保留輸入與重試入口，不將假曲目改名後當成真音樂。判斷依 provider 與既有降級訊息，沒有使用伺服器目前固定為 true 的 `isDemo`，因此真 AI＋Spotify 的節目仍可呈現。AI 語音降級提示、Spotify 標誌、正式 metadata／外連、授權、播放、Loved 與斷線恢復保留；臨時回饋清楚說明服務重啟後不保留。

## V1：品質指令

```sh
fnm use 25.5.0
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

通過：66 個測試檔、628 個單元測試，lint、typecheck 與 build 均成功。既有 package engines 不含 Node 25，因此 pnpm 有 Unsupported engine 提醒；依工單使用 v25.5.0，未修改 engines。

## V2：使用者旅程

新增 `apps/web/test/developerMode.test.ts`：精確旗標／預設不渲染、合成結果與 AI fallback 隔離、真 Spotify 結果仍通過、0／3／4／5 首提示。

`e2e/spotify-e-mode.spec.ts` 的 BRA-125 測試使用無 query 的 `/`，驗證開台 → 設定 → 準備四首 → 收聽 → 理由 → 微調 → 回饋 → Loved 結果 → 下一首 → 斷線恢復。每站檢查 TEST／MOCK／假帳本／路徑 P／核可徽章未出現在文字中，模式列與常駐裝置卡不存在於 DOM，沒有橫向溢位或 pageerror；另驗證殘留 mock 偏好與假節目不會進入預設路徑。

Spotify／AI 回應由 E2E fixture 提供，不呼叫真 Spotify／OpenAI；保留既有 Spotify 引擎與 AI 語音單元測。Chromium 手機尺寸模擬不等於 iPhone Safari 真機量測。

驗證結果：

```sh
pnpm exec playwright test --project=mobile-390
# 55 passed (2.6m)
pnpm exec playwright test e2e/spotify-e-mode.spec.ts --grep BRA-125 --project=mobile-360 --project=mobile-430
# 4 passed (18.8s)
```

另以 agent-browser 確認首頁載入、設定導覽、互動元件與 console errors（無錯誤）。視覺檢查完成：

- [桌面首頁](screenshots/bra125-home-desktop.png)
- [360px 收聽](screenshots/bra125-listen-mobile-360.png)、[390px 收聽](screenshots/bra125-listen-mobile-390.png)、[430px 收聽](screenshots/bra125-listen-mobile-430.png)
- [360px 準備](screenshots/bra125-ready-mobile-360.png)、[390px 準備](screenshots/bra125-ready-mobile-390.png)、[430px 準備](screenshots/bra125-ready-mobile-430.png)

## V3：字串與邊界檢查

```sh
rg -n -i '假帳本|TEST 假|mock 音|路徑 P|經核可模式|MOCK' apps/web/src packages/contracts/src
```

殘留項目逐一核對：

| 類別 | 使用者路徑 |
| --- | --- |
| CapabilityBadge／EnvironmentSheet／桌面示範說明 | `DeveloperOnly` |
| ModeStrip／modeStrip 與 DeviceStatusView | 僅診斷模式的收聽／設定容器 |
| EnvironmentSettings／ScenarioSettings／MOCK radio | `DeveloperOnly` |
| Ready／Generation 診斷說明、虛構曲目 tag、FeedbackCard 假帳本說明 | `DeveloperOnly` |
| ProviderNotices 原始降級原因 | 預設呈現簡短的使用者提示；診斷模式才顯示原文 |
| API／contracts 的 mock enum、locator、header、降級訊息與 audio adapter | 內部協定，不直接作為 UI 標示；示範節目入口隔離 |
| Spotify 裝置消失時的重新偵測 | 保留故障恢復必要操作；已移除路徑代號 |

沒有改動 server、SPOTIFY_*、spend、usage credits 或部署設定。回滾方式為 revert 本 PR。
