# Decision log（BRA-97 · T01–T05）

依 handoff `AGENTS.md`：任何與規格的差異都記在這裡。這些是實作者的工程決策，**不是**使用者已同意的事實。

| ID | 決策 | 原因 | 影響／後續 |
|---|---|---|---|
| D-01 | 程式放在 repo 根目錄的 pnpm workspace：`apps/web`、`apps/server`、`packages/contracts`；`handoff/` 保持唯讀 | 根目錄 README 指示「實作程式請放在 repo 根目錄或 app/」；docs/04 的預期目錄 | 無 |
| D-02 | TypeScript 固定 6.0.x（非最新 7.0） | typescript-eslint 8.71 的 peer 範圍為 `<6.1.0`；TS 7 原生版尚無相容 lint | 之後 typescript-eslint 支援 TS 7 再升級 |
| D-03 | `AudioLocator` 新增 `{kind:'mock_tone', palette, durationMs}` | 使用者明示只能用「明確標示 mock／合成」音源；契約原本只有 none／licensed_url／spotify_uri | 前端以程式合成 WAV（正弦和弦＋包絡），**不是音樂**；UI 全程標示 MOCK |
| D-04 | `Segment` 新增 `speech: {kind:'none'} \| {kind:'mock_chime', durationMs}` | 需要在無 TTS 的情況下驗證 speech → track 狀態機（AC11–AC13） | T07 再加入 `tts` 變體；mock chime 明示「不是 AI 語音」 |
| D-05 | `ShowPlan` 新增 `unavailable: Candidate[]` | partial／0 首狀態需要「保留待確認清單」（docs/02 S03） | 只顯示，永遠不可播 |
| D-06 | mock 模式的 `canPlay=true`、`canInsertSpeech=true`，並在 `restrictions` 逐條說明「只播合成測試音／DJ 為提示音」 | 能力矩陣中 mock 的「完整曲目播放＝否」指真實音樂；本版 adapter 確實能播放合成音，故以 restrictions 誠實揭露 | UI 依 restrictions 與 mode=mock 顯示 MOCK 標記，不靠 provider 名稱猜 |
| D-07 | `X-Mock-Scenario` header（five／three／zero／error／slow）只在全 mock 模式生效 | 需要可重現 ready 0／3／5 首、失敗、慢速（>20 秒）狀態供 E2E 與設計評審 | 與 Spotify gate 無關；非 mock 模式忽略 |
| D-08 | `SPOTIFY_ENABLED=true`、`SPOTIFY_DJ_APPROVED=true`、非 mock 的 PROVIDER_MODE／LLM／TTS 一律**拒絕啟動**（fail fast） | 使用者硬性規定不得啟用 Spotify、不得使用真實金鑰；本版也沒有對應 adapter | Spotify adapter 在前端只是一個永遠回 FEATURE_RESTRICTED 的邊界類別 |
| D-09 | 伺服器只綁定 `127.0.0.1` | 不公開部署；手機真機測試需另行設定可信 HTTPS 入口（未在本任務範圍） | 真機測試一律 NOT TESTED |
| D-10 | 正式 `pnpm start` 由 Express 同源提供 `apps/web/dist`；dev 時 Vite proxy `/api` | docs/04、docs/09 拓樸 | 無 |
| D-11 | Seed 草稿只存在記憶體（不寫 localStorage）；設定（DJ 開關、串詞長度）存 localStorage | docs/09：心情描述可能敏感；設定為非敏感偏好 | 「清除本機設定」會清 localStorage |
| D-12 | （BRA-109）D-08 的 Spotify「一律拒絕啟動」改為嚴格閘門：預設全關；`SPOTIFY_ENABLED=true` 需 Client ID、redirect URI、加密金鑰；`SPOTIFY_DJ_APPROVED=true` 另需 ENABLED 與 `SPOTIFY_APPROVAL_REFERENCE` | 曄核准 E 模式落地；開關仍由伺服器 env 決定，實作者不設 true | 見 docs/spotify-e-mode.md；`.env.example` 維持 false |
| D-13 | 網頁引擎的唯一 adapter 改為 `PlaybackRouter`：沒有 Spotify 輸出時原樣交給單一 `<audio>`；E 模式時 Spotify 曲目交給路徑 P／C，介紹確認已停才放歌 | 不疊音（Policy III.7）需要跨兩個音訊來源協調；預設路徑行為不變 | `PlaybackMode` 新增 `spotify`；reducer 對非 manual 一律自動接續 |
| D-14 | 帳本只寫 LLM 提名的原始曲名／藝人；Spotify Search 結果只放在 `segment.track`，MOCK 提名不送 Search | Policy III.13／III.14：Spotify 資料不得輸入 AI 或建立畫像 | 防火牆測試 `spotifyFirewall.test.ts` |
| D-15 | E 模式 UI 沿用既有 `--q-*` 配色與元件，design-v1 只採旅程／文案／狀態 | 曄 10/05 04:47：design-v1 視覺不採用 | 未做全站夜間主題 |
| D-16 | （BRA-111 A1）Spotify 連結綁「裝置憑證」而非登入帳號：完成連結的瀏覽器拿到 HttpOnly cookie，token 檔只存其 SHA-256；先連結者為擁有者，非擁有者不能使用、中斷或覆蓋 | 本站沒有使用者帳號（匿名 session、重啟即失效）；裝置憑證最小、可跨重啟，且不需新增登入系統 | 擁有者 cookie 遺失時以刪除 token 檔復原（已寫入 spotify-e-mode.md）；BRA-111 前的 token 檔沒有擁有者雜湊，會被視為未連結 |
| D-17 | （BRA-111）介紹播放中 Spotify 晚出聲 → 停介紹並回報介紹失敗（引擎顯示文字、直接進歌），不嘗試暫停後續播介紹 | 「出聲就停介紹」最直接保證不疊；續播介紹需要新的引擎狀態與再次確認靜音，風險較高 | 使用者此時會看到文字介紹而非語音；路徑 C 最壞約 2 秒＋一次請求的疊音 |
| D-18 | （BRA-111）路徑 P 的「已暫停」須穩定 500ms 且非載入中才算安靜 | 假設 SDK 可能先報載入中／已暫停、短暫後才出聲（80ms 是審查模擬的假設值，不是 SDK 實測）；500ms 遠大於該假設且只延後被切段時的介紹開始 | 只在被切段（play 在路上或剛生效未確認）時多等最多 0.5 秒；已確認在播的歌正常暫停不受影響 |
| D-19 | （BRA-111 A2）Spotify 官方圖示與封面圓角是 `--q-*` 色票的唯一例外 | Spotify Design Guidelines 要求官方配色與圓角 | 圖示 path 需在啟用前與官方下載素材比對 |
| D-20 | （PR #7 審查必修）擁有者必須是 `SPOTIFY_OWNER_USER_ID` 指定的 Spotify 帳號：連結時呼叫一次 `/v1/me` 比對 id；未設定則拒絕任何連結（fail closed）。取代 D-16 的「先到先得」 | Spotify 開發者 allowlist 擋不住佔位（不在 allowlist 的帳號仍可能完成 OAuth）；先到先得讓第一次設定、logout 後、invalid_grant 刪檔後都可被陌生人佔走 | 多一次 `/v1/me` 呼叫（只讀 id，不保存其他欄位）；啟用前必須設 env；仍建議只在 Tailscale 內連結 |
| D-21 | （PR #7 審查必修）曲目卡改用 Spotify 完整官方 logo（官方媒體包 PNG 原檔，靜態檔引用），取代 D-19 的手刻圖示；metadata 截斷時可展開看全文 | Design Guidelines：partner integration 應使用完整 logo，空間不足才只用圖示；使用者必須能看到完整 metadata | 官方包只有 PNG；檔案雜湊由測試鎖定 |
| D-22 | （PR #7 審查建議）路徑 C 介紹守候最多 60 秒；介紹 `<audio>` 開始被拒時立即解除 | 介紹被暫停或等點擊時，原本在前景會每 2 秒無限輪詢 `/me/player`（10 分鐘 300 次） | 守候 60 秒後才晚出聲的情況不再被偵測；晚出聲多發生在 play 生效後數秒內，真機量測在 BRA-114 |
