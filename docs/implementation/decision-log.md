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
| D-23 | （BRA-127）選歌多樣化：模型提名 8–12 首成為候選池 → 排除同種子（種類＋文字＋藝人）最近 `PLAN_RECENT_RUNS`（預設 3）輪已選 → 依 `PLAN_EXPLORATION_PCT`（預設 50）加權不放回抽樣 → 逐首對應、不可播就補抽，最多試 `MAX_CANDIDATES_PER_PLAN`（預設 12）首；可播的依模型原順序排回 | 同一個種子每次都開出同樣 5 首；只靠模型不夠穩，伺服器端排除＋抽樣才可重現、可測 | 近期已選只存在記憶體（每 session、登出即清），只記 LLM 提名的曲名／藝人，不含 Spotify 回傳欄位；新曲不夠 5 首時才把最早那輪的拿回來補（寧可重複也不少於 5 首）。同種子每多一輪紀錄探索度＋0.15；`PLAN_EXPLORATION_PCT=0` 完全關閉抽樣。MOCK 虛構曲目不抽樣、不排除（E2E／截圖依賴固定順序） |
| D-24 | （BRA-127）向模型要的候選數依 `OPENAI_MAX_OUTPUT_TOKENS` 調整：(上限−600)÷450 取整，夾在 8–12；預設 4096 → 8 首、8192 以上 → 12 首。prompt 要求 transitionBridge 整份最多 2 個 | 12 首加厚台詞約需 5–6k 輸出 token，超過預設 4096 會被截斷成無效 JSON（兩次都無效即改用 MOCK）；抽樣後相鄰兩首常不會同時入選，transitionBridge 多半用不到 | 想要滿 12 首候選需自行把 `OPENAI_MAX_OUTPUT_TOKENS` 調到 ≥ 6000（預扣金額隨之提高，仍受日額 10% 單次上限）；本 PR 不改預設值 |
| D-25 | （BRA-134）品味帳本是本機 JSON 檔（`TASTE_LEDGER_PATH`），開台前必讀；BRA-98 的 `FeedbackLedger`（可接 Notion）維持原樣當單向備份與 `history` | 「開台不得只靠爬 Notion」；本機檔不需新服務、可原子寫入，沿用預算帳本的寫檔方式 | 回饋先寫品味帳本，成功才寫備份；見 docs/taste-ledger.md |
| D-26 | （BRA-134）近 N＝10、pinned 每輪最多 2 首、愛往前 1.5 位、不對往後 4 位；pinned 不受近 N 限制；近 N 擋到不足 5 首時依最久以前播放回並明示 | 票面要求「上限明確」與「失敗明確降級」；放回比讓節目變成 partial 更符合開台體驗，且 warning 讓使用者知道 | 常數集中在 `services/tasteRules.ts`，未開 env |
| D-27 | （BRA-134）MOCK 草稿不記播出紀錄；評價／標記仍照記 | MOCK 曲目是虛構示意，記成已播會讓示範模式每輪都被近 N 擋光 | 只有真實提名會影響近 N |
| D-28 | （BRA-134）品味提示（`tasteHints`）放在 planner 的 user 訊息並附 `tasteGuide` 說明，不改系統 prompt | 系統 prompt 必須與唯讀 handoff 檔完全一致（openai.test 鎖定） | 屬 EditorialInput 白名單欄位，只含曲名／藝人／短評 |
| D-29 | （BRA-134）`/api/taste/marks` 與回饋相同：任一 session＋CSRF 即可編輯（單人自用、本站沒有帳號） | 與 BRA-98 回饋權限一致 | 若日後多人使用，需改為擁有者限定 |
| D-30 | （BRA-135）釘選同時最多 `PINNED_LIMIT`＝2 首，等於每輪帶上的釘選曲數（`MAX_PINNED_PER_SHOW` 改引用它）；伺服器對新增釘選回 409 `PIN_LIMIT_REACHED`，前端在送出前就提示 | 「達上限要提示」需要明確上限；釘了卻不一定每輪出現會違背「釘選」的意思 | 舊帳本已超過上限仍照 D-26 輪流排；只擋新增 |
| D-31 | （BRA-135）「收藏」＝評價「愛」，取消收藏寫「還行」；不新增 mark 種類或可清空的評價 | 帳本只有 pinned／blocked 兩種 mark 且一首只能一個；「愛」已是品味規則裡的輕推訊號；「還行」在選歌規則不加權，效果等同清除 | 紀錄會留下「改評價：還行」，展開帳本紀錄看得到 |
| D-32 | （BRA-135）底部導覽改為 4 格（開台／收聽／我的／設定）；「我的」只有「我的歌」一頁 | 票面「我的」→「我的歌」；不做獨立帳本儀表板 | E2E 的導覽斷言同步更新；每格寬度在 320px 仍可點 |
