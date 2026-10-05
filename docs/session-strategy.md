# Session 策略（BRA-161／V3）

採 A＋B，單程序服務。`qfm_sid` 仍為 HttpOnly／SameSite=Lax 的隨機 opaque ID，CSRF token 僅存在前端記憶體；cookie ID 不回傳 JSON、不進日誌。Session 維持建立起算 12 小時期限，重啟不延長期限。

## 磁碟與重載（A）

`SESSION_STORE_PATH` 預設 `./data/sessions.json`，啟動時轉成絕對路徑。`pnpm dev` 工作目錄為 `apps/server`，因此預設落在 `apps/server/data/`；根目錄與 server 的 `data/` 都已忽略。`NODE_ENV=test` 未指定路徑時只用記憶體；E2E 用獨立暫存檔，避免污染測線。

新 session 與登出先原子寫入（同目錄 tmp＋rename、檔案 600、新目錄 700）才成功回應；失敗不提交記憶體變更。啟動只重載未過期的 session。損毀／不可讀檔拒絕啟動，保留原檔且錯誤不帶秘密。此檔含 cookie ID 與 CSRF token，須保持本機私有，不能提交或上傳。

只存 session 並不足以修復：`JobStore` 的節目／owner 也會隨重啟消失。因此同一檔案另存回饋所需的最小上下文：owner、show ID、種子文字／藝人、segment ID 與原始提名曲名／藝人。交付節目前先保存。**不保存 Spotify 回傳 track、token、URI、封面或音訊**；不恢復工作、節目播放 API 或 Spotify owner。回饋／依段落改 taste 可由上下文查曲目，保留 owner／CSRF 檢查。

最多 1,000 sessions、2,000 節目上下文，超過上限移除最舊項目；過期或登出 session 的上下文隨寫入清除，啟動時不載入。回饋仍先寫 taste ledger，再寫可選 FeedbackLedger 備份；既有 show＋segment＋clientRequestId 冪等 ID 確保跨重啟原樣重送不重複新增 taste feedback。Notion／fake 收據快取只在記憶體，跨重啟不保證備份恰好一次。

## 有界恢復（B）

僅 `feedback`、`tasteMarks`、`tasteHistory`、`tasteEdit`：收到 HTTP 401 或 `SESSION_EXPIRED` 後呼叫 `POST /api/session`，以最新 CSRF token 原樣重送 **一次**。並行失效請求共用 session 建立，晚到的舊 401 不另開 session。重送再次失敗或 session 建立失敗，直接交給既有 UI 錯誤入口；回饋保留評價／原因，可手動重試或略過，不自動循環。403／500／網路失敗不觸發此恢復；取消的 taste 查詢不重試。Spotify、plan 與播放 API 未加入此重試。

真正超過 12 小時、登出、遭容量淘汰或遺失 session 檔時，建立的是新 owner，不能接管舊節目；舊回饋明示失敗並保留輸入。首次部署前已交付的節目沒有持久上下文，須重新開台；不能從既有 `aired` 紀錄推測 owner。此方案無跨程序鎖，僅適用同一服務／同一路徑重啟。

## 驗收與回滾

- V1：`apps/server/test/sessionRecovery.test.ts` 重現純記憶體重啟後 401，驗證全新 SessionStore＋JobStore 重載後舊 cookie／CSRF 回 201、taste ledger 僅一筆，以及跨 owner／壞 CSRF／登出／期限／檔案失敗。
- V1 E2E：`e2e/session-recovery.spec.ts` 用獨立 MOCK 子程序與暫存目錄，保持瀏覽器頁面，停止並重啟 server，再送回饋並直接讀磁碟帳本。未操作 launchctl 或 :8737 測線。
- V2：API client 單元測試驗證新 CSRF、原樣 payload、晚到並行 401、session 失敗與取消；E2E 驗證一次恢復成功及連續 401 停止、保留輸入與重試入口。
- V3：本文件。回滾 `revert` 此 PR；舊版忽略新增 session 檔，可原樣保留，不必刪除任何帳本資料。

驗證指令：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`E2E_PORT=18761 pnpm exec playwright test --project=mobile-360 --project=mobile-390 --project=mobile-430`。瀏覽器手機 viewport 為 Chromium 模擬；真機與 iPhone Safari 未驗證。

本輪結果（2026-10-06）：lint／typecheck／build 通過；Vitest 79 個檔案、806 項測試通過；三個手機 viewport 完整 E2E 193 項通過、2 項依既有設定略過（slow 情境僅在 390px 執行）。新增 V1／V2 共 9 個 viewport 案例全數通過。agent-browser 對獨立 MOCK server 載入檢查通過、無 page errors。下一步為 PR 審查與測線驗收；:8737 測線／launchctl、真機未操作或驗證。
