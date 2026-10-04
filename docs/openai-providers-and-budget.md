# OpenAI 供應商、預算帳本與 PWA

本 PR 未啟用真實呼叫；未對真實 OpenAI 做任何測試。預設 LLM_PROVIDER=mock、TTS_PROVIDER=mock，Spotify 兩個開關維持 false，env 仍拒絕 true；E 模式仍停用。所有測試於開始時封鎖 globalThis.fetch，需要 HTTP 的測試注入 fetchImpl；沒有新增依賴、金鑰或 service worker。PWA 未經 iPhone Safari／主畫面真機驗證，Playwright 留給沙箱外執行者。

## 架構與信任邊界

`config/env.ts` 接受 openai，但缺 key、未簽收、模型／voice／單價不完整時回傳安全原因。`createApp` 建立共用 `RealProviderRuntime`，啟動時記錄一行 `openai_disabled`，不印設定值或金鑰。缺少設定不阻止 server 啟動。`/api/capabilities.providers` 與 web 設定頁呈現目前供應商及原因；原有 capabilities 欄位保留，新欄位 optional，舊回應仍可解析。

LLM 與 TTS 建構子都必須收到 fetchImpl；只有正式 app 組裝會傳入平台 fetch，預設 mock 不會發出 OpenAI 請求。請求固定為 `https://api.openai.com/v1/responses` 或 `/audio/speech`，禁止 redirect，不接受模型／使用者提供的端點。金鑰只放 Authorization，供應商本文與原始錯誤不回傳或寫入日誌。

`OpenAIEditorialPlanner` 使用 Responses 的 `text.format` JSON Schema／strict Structured Outputs，永遠提供 max_output_tokens 且 store=false。system prompt 與 schema 複製為 `resources.ts`，測試逐字比對 prompt 與 handoff 原檔（`handoff/prompts/sonic-qualia-system.md`），修改時兩處必須同步。使用者資料只放 user 角色的 JSON，system 角色固定；來源仍是既有 EditorialInput allowlist，不傳 Spotify 回應、解析結果或憑證。回應 JSON 仍是不受信任資料，PlanService 的 PlanDraftSchema、ID 驗證及最多 MAX_LLM_CALLS_PER_PLAN 次呼叫保留；無效 JSON 視為無效草稿，消耗同一個修復額度。

`OpenAITtsProvider` 預設送出 B2 繁中詳細聲線指示（見下節「TTS 聲線：B2 組合」），可用 `OPENAI_TTS_INSTRUCTIONS` 覆寫。模型必須由管理者確認支援 instructions；不支援時保留文字、提示語音無法使用。送出前以 Intl.Segmenter 檢查 1–80 grapheme clusters。每個節目最多合成五段 seed 台詞；成功的 AI 段落退回 seed Bridge（移除可選 transitionBridge），避免相鄰順序變化時播放錯誤台詞，也避免另花五段 transition 費用。mock 的 transition 行為保留。

API 的 `speech.kind=ai_audio` 必須含 `aiVoice: true`，DJ 區塊顯示「AI 合成語音」。語音檔由既有單一 audio adapter 讀取同源 `/api/media/tts/:showId/:segmentId/:hash`，route 驗 session、節目與 segment 所有權，再比對 locator；其他 session 取不到。`POST /api/tts` 可重建已擁有 AI segment 的 seed 台詞，使用伺服器 voice，忽略用戶 voiceId；不能提交任意台詞或 transition。MOCK 仍拒絕此 API。

音樂 resolver 仍為 mock、曲目播放仍是測試音、ShowPlan 的 isDemo 仍為 true；啟用 OpenAI 並不啟用真實音樂、Spotify、Notion 或 E 模式。回饋 clientRequestId 冪等與 JobStore lastAccess 保留邏輯未改動。

降級規則（不靜默）：

- 供應商提示以 contracts 的 `PROVIDER_NOTICES` 固定開頭寫入 ShowPlan.warnings，**一律排在最前面**（模型自己的 warnings 再多也擠不掉），web 的 `ProviderNotices` 在「準備好了」與收聽頁顯示。
- LLM：gate／預算拒絕、HTTP 失敗、逾時、拒答、或初次＋修復兩次輸出都未通過 PlanDraftSchema，皆改用 MOCK 選歌完成本輪並顯示「AI 選歌本輪改用 MOCK 示範：原因」。不增加真實呼叫次數；僅 mock 模式維持原本「兩次無效即 PLAN_INVALID」。
- TTS（伺服器合成）：失敗時該段保留文字介紹＋提示音（mock_chime，介紹區如實標示「MOCK 提示音，非 AI 語音」並可「跳過介紹」），顯示「AI 語音本輪改為文字介紹＋提示音：原因」；本輪第一次失敗後不再嘗試其餘段落，避免逾時連鎖與重複預扣。
- TTS（手機播放）：AI 音檔播放失敗（如快取過期 404、斷網）時不擋音樂（AC17），直接進曲目，同時在收聽頁顯示文字介紹全文與「重試語音」（在使用者點擊內重播介紹）。自動播放被擋則照舊顯示「點一下繼續」，介紹文字仍在。
- iPhone 手勢：「開始收聽」的點擊同步執行 loadShow＋play，第一段 AI 介紹的 `audio.play()` 在同一個點擊內發出；之後同一個 audio 元素連續切換來源。媒體路由用 `sendFile` 回應 Range（206），iOS Safari 播放 `<audio>` 需要此行為。

### TTS 聲線：B2 組合（2026-10-05 曄試聽選定）

iPhone 實測原本的聲線「不像台灣腔」。用同一段文稿比較 voice、instructions 與文字寫法（BRA-99 A/B 樣本，直接呼叫 speech API，費用在服務帳本外，約 US$0.02），曄試聽後選 **B2**：

- **voice=`cedar`**：用 `OPENAI_TTS_VOICE=cedar` 設定（放在 repo 外的 env 檔，改完重啟服務；快取 key 含 voice，會重新合成）。程式不寫死 voice。
- **instructions：繁中詳細版（instr-zh，約 170 字）**，為 `tts.ts` 的 `DEFAULT_INSTRUCTIONS`，內容如下：
  > 請用台灣華語（臺灣國語）的口音朗讀，像台北在地的深夜電台主持人在跟朋友聊天。語氣溫暖、低調、放鬆，語速自然偏慢，句與句之間有輕輕的停頓和呼吸。使用台灣人日常口語的聲調與節奏，輕聲與語尾助詞（啊、喔、吧）要自然，不要捲舌過度。不要大陸普通話的播音腔，不要兒化音，不要過度戲劇化或推銷感。英文歌名用清楚、自然的英語發音念出，念完再回到台灣華語。
- **`OPENAI_TTS_INSTRUCTIONS`（選填）**：不改程式就能調整聲線。空值或只有空白都當成未設，改用上面的預設。上限 1500 個 Unicode code points，超過會讓 env 驗證失敗、服務拒絕啟動，錯誤只列欄位名稱。快取 key 用的是實際送出的 instructions，所以改指示後同一句台詞會重新合成（並重新計費），不會播到舊聲線的檔案。
- **口語台灣用語文稿**：選歌 system prompt 的「語言與 DJ」一節加了一條規則：使用台灣用語，不寫「視頻」「質量」「信息」「質感」等大陸用語；DJ 台詞用口語短句；數字寫中文念法，但曲名原文中的數字照原樣保留；英文歌名前可以用「英文名字是」之類的說法帶出。既有硬規則（30–55 grapheme 目標、上限 80、不得引用歌詞、不模仿特定真人、djLine 可單獨依 Seed 成立）全部保留。AI 語音標示（`aiVoice: true`、「AI 合成語音」）由程式與 UI 保證，與 prompt 無關。

**時長與逾時**：instructions 要求「偏慢」，試聽時 60–70 字約 12–15 秒（舊聲線約 6–8 秒）；30–55 字的台詞預計約 7–11 秒，達到 80 grapheme 上限時約 20 秒以上。speech 請求是非串流的，要等整段音訊產生完畢，因此 `TTS_TIMEOUT_MS` 預設從 15000 放寬到 30000（範圍仍是 1–60000）。注意：整輪的 `PLAN_DEADLINE_MS`（預設 60000）仍包含 LLM 加上最多五段依序合成的時間，deadline 到了整輪會中止。如果實際延遲接近上限，再評估要不要調高 deadline 或縮短台詞。

**費用**：預算估算沒有改。TTS 仍以台詞 Unicode code points × `OPENAI_PRICE_TTS_PER_1M_CHARS`（簽收的保守全費用上界）預扣與結算，instructions 長度不算進預扣。試聽時以每百萬字元 US$60 的保守算法，每段約 US$0.0038；依官方公開價估算的實際費用約 US$0.0031–0.0040，大致都在保守值附近。若要把 instructions 調得比預設長很多，或台詞明顯變短，需重新確認字元單價仍能涵蓋 instructions 的輸入 token 與音訊輸出費用。

官方請求格式依 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 與 [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech) 核對；這不是帳號模型可用性或實際單價的證明。

### API 欄位查證（2026-10-05，PR B）

`openaiApiShape.test.ts` 以完全相等的欄位集合鎖定兩個請求形狀：

- `POST https://api.openai.com/v1/responses`：`model`、`input`（`system`＋`user`，content 為字串）、`max_output_tokens`、`store: false`、`text.format = { type: 'json_schema', name, strict: true, schema }`。來源：[Responses create 參考](https://developers.openai.com/api/reference/resources/responses/methods/create)（role 可為 user／assistant／system／developer；status 為 completed／incomplete；refusal 內容型別為 `{ type: 'refusal', refusal }`）、[Structured Outputs 指南](https://developers.openai.com/api/docs/guides/structured-outputs)（`text.format` 寫法、root 必須 object、全部欄位 required、`additionalProperties: false`、`status === 'incomplete' && incomplete_details.reason === 'max_output_tokens'`）。
- `POST https://api.openai.com/v1/audio/speech`：`model`、`voice`、`input`、`instructions`、`response_format: 'mp3'`。來源：[Speech create 參考](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)：input 上限 4096 字元；model 列 `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`、`gpt-4o-mini-tts-2025-12-15`；instructions「Does not work with `tts-1` or `tts-1-hd`」（因此 env 設這兩者即降級）；內建 voice 13 種（alloy、ash、ballad、coral、echo、fable、onyx、nova、sage、shimmer、verse、marin、cedar）；格式含 mp3。

未能查證（文件頁面被截斷）：strict 模式「支援的 JSON Schema 關鍵字」清單。為避免第一次真實呼叫就因 schema 400，送出的 schema 會移除 `minLength`／`maxLength`（`pattern`、`minItems`／`maxItems`、`enum`、巢狀 `anyOf` 保留；依記憶這些為支援項，但未於本次取得原文）。字串長度仍由 server 端 PlanDraftSchema 驗證，不影響安全。若第一次呼叫仍回 400，先看 `/api/capabilities` 與節目提示，再對照官方「Supported schemas」段落調整。

## 環境設定

`.env.example` 保留原有的非機密範例預設值；新增的 OPENAI_*／預算變數以空值或安全預設列出（`OPENAI_REAL_CALLS_APPROVED=false`、預算為上限值）。金鑰欄位一律留空。空值仍使用下列預設。所有設定僅 server 使用，不能加 VITE_ 前綴。金額與資源 hard ceiling 不能由模型或前端提高。

| env | 預設／範圍 | 意義 |
|---|---|---|
| PROVIDER_MODE | mock，其他值拒絕 | 音樂仍是示範模式 |
| LLM_PROVIDER / TTS_PROVIDER | mock | 各自設 openai 才要求真實供應商 |
| OPENAI_API_KEY | 無 | 僅後端憑證；缺少時明確降級 |
| OPENAI_REAL_CALLS_APPROVED | false | 曄簽收上限數字後才可設 true |
| OPENAI_TEXT_MODEL | 無 | 必須明確填帳號可用的 Structured Outputs 模型 |
| OPENAI_TTS_MODEL / OPENAI_TTS_VOICE | 無 | 必須明確填支援 instructions 的模型（`tts-1`／`tts-1-hd` 不支援，設定即降級）與非真人模仿 voice；B2 選定 `cedar` |
| OPENAI_TTS_INSTRUCTIONS | 無（用內建 B2 instr-zh），≤1500 code points | 覆寫 TTS 聲線指示；空值／空白視為未設，超長拒絕啟動 |
| OPENAI_MAX_OUTPUT_TOKENS | 4096，256–16384 | 每次模型輸出硬上限，含模型回報的輸出用量 |
| OPENAI_PRICE_INPUT_PER_1M_TOKENS | 無，>0 且 ≤100000 | USD／一百萬輸入 tokens，無快取折扣 |
| OPENAI_PRICE_OUTPUT_PER_1M_TOKENS | 無，>0 且 ≤100000 | USD／一百萬輸出 tokens |
| OPENAI_PRICE_TTS_PER_1M_CHARS | 無，>0 且 ≤100000 | USD／一百萬 Unicode code points 的保守全費用上界 |
| PROVIDER_TIMEOUT_MS | 8000，1–60000 | LLM 單次 HTTP／讀取本文 timeout |
| TTS_TIMEOUT_MS | 30000，1–60000 | TTS 單次 HTTP／讀取本文 timeout；B2 慢語速，從 15000 放寬 |
| PLAN_DEADLINE_MS | 60000，1000–120000 | 沿用整輪 deadline |
| MAX_LLM_CALLS_PER_PLAN | 2，1–2 | 初始＋唯一 repair，不能另加補位呼叫 |
| BUDGET_DAILY_USD | 1，>0 且 ≤1 | 每個台北日最多 US$ 1 |
| BUDGET_TOTAL_USD | 10，>0 且 ≤10 | 所有日期累計最多 US$ 10 |
| BUDGET_MAX_PLANS_PER_DAY | 20，1–20 | 每個台北日最多 20 輪真實供應商 plan 嘗試 |
| TTS_GRAPHEME_BUDGET_PER_DAY | 4000，1–4000 | 每個台北日新合成文字額度，快取命中不扣字數 |
| BUDGET_LEDGER_PATH | ./data/budget-ledger.json | 與 Notion 回饋帳本完全獨立 |
| REAL_PROVIDERS_KILL_SWITCH | false | 每次排隊後、發請求前重新讀環境物件 |
| KILL_SWITCH_FILE | ./data/KILL_SWITCH | 存在立即停止新真實呼叫，不需重啟 |
| TTS_CACHE_DIR | ./data/tts | 私有 MP3 快取目錄 |
| TTS_CACHE_TTL_HOURS | 24，1–168 | 自建立時間起算，讀取不延長 TTL |
| TTS_CACHE_MAX_MB | 100，1–100 | 使用 1024² bytes／MB 的磁碟上限，LRU 淘汰 |
| SPOTIFY_ENABLED / SPOTIFY_DJ_APPROVED | false，true 拒絕 | Spotify gate 不因 OpenAI 啟用而改變 |

單價缺少、零、非有限值或超出範圍皆視為設定不完整並降級。僅啟用 LLM 時需要輸入／輸出單價；僅啟用 TTS 時需要 TTS 單價；同時啟用時三者都必須填。沒有寫死模型或費率。TTS 不回報 token usage，因此採送出的字元數乘以簽收的全費用上界結算，不虛構音訊 token 數；對按音訊 token 計價的模型，管理者必須先確認這個字元費率能涵蓋文字、instructions、音訊等所有費用，無法確認上界就保持 mock。

## 預算與持久化

1. 整輪真實 plan 開始前先持久化扣一個 plan 額度，LLM 與「僅 TTS」都適用。修復不再扣第二個 plan，既有 idempotency 不重複計數。被 gate 拒絕的 mock 降級不消耗真實 plan 額度；已取得額度但取消／失敗的嘗試保留計數。
2. LLM 每次發出前，以完整請求 JSON 的 UTF-8 位元組數加 2048 tokens 框架餘裕（`REQUEST_OVERHEAD_TOKENS`），乘輸入單價，加 max_output_tokens 乘輸出單價預扣。依據：BPE token 至少對應 1 個位元組，位元組數本身已是內容 token 上界（中文約 3 位元組／字、約 1 token／字，已高估約 3 倍）；餘裕只需涵蓋訊息框架與 schema 轉換差額。原本的 8192 讓輸入預扣再翻倍（實測 20 筆歷史的請求約 8.6 KB），改 2048 仍保守。單次預扣若超過每日額度的 10%（`MAX_CALL_SHARE_OF_DAILY`）直接拒絕、不發請求，並在設定頁顯示原因——避免選到貴模型或把 OPENAI_MAX_OUTPUT_TOKENS 調太大時一次吃光日額。參考：以 US$0.40／1.60 每百萬 token 的單價，一次呼叫預扣約 US$0.011；US$2／8 約 US$0.05（皆 ≤ 日額 10%）。成功取得可信的 usage 數值後，按 input_tokens／output_tokens 結算並釋放金額差額；被截斷（status=incomplete）的輸出視為無效草稿，仍按 usage 結算；輸出 schema 驗證仍獨立執行。
3. TTS 先以 Unicode code points 乘單價預扣金額，另以 grapheme clusters 扣每日字數；code points 可大於 graphemes，避免組合 emoji 低估費用。成功依送出字元數結算。hash 包含文字＋voice＋model＋實際送出的 instructions（預設或 env 覆寫）；相同內容命中磁碟快取不呼叫也不重複扣費／字數，跨重啟有效。命中仍先檢查停止 gate。過期先刪除，超額用 atime 淘汰，保護剛回傳的音檔；快取可被淘汰，不能承諾永久播放。
4. 日界線固定為 UTC+8（Asia/Taipei），與伺服器時區無關。跨午夜完成的 commit 仍結算在原 reserve 日期。總額不因換日清零。
5. 呼叫與預扣共用 concurrency=1 FIFO，LLM 與 TTS 不會同時進入 provider；每次取得鎖後再次檢查 gate。停止檔／環境停止旗標阻擋新的呼叫，不撤回已送到供應商的請求；取消與 timeout 使用 AbortSignal。
6. **失敗、逾時、abort、拒絕或 usage 不可確認，一律保守保留完整預扣與字數。** 供應商可能已計費，不能憑本地 timeout 免費重試。即使 crash／重啟，檔案已包含預扣，不自動釋放。這可能提早用完額度，需曄對照帳單人工處理。
7. 金額以十億分之一美元精度處理，預扣向上取整。實際 usage 超過估算時記錄實際額度並持久化 halted，停止真實供應商，重啟不解除；需要人工核對估算與單價。
8. 帳本使用私有 tmp 檔（mode 600）＋同目錄 rename 原子替換；新目錄 mode 700。首次啟用且帳本不存在會建立零帳本；已有檔案讀不到／損毀不會覆寫重置。每次 reserve／commit 都再讀取並驗證結構、非負數與每日合計等於總額。
9. 讀取、驗證或寫入失敗都 fail closed，沒有成功持久化的預扣就不發請求；/api/capabilities 呈現安全原因。檔案錯誤本文、金鑰與使用者輸入不出現在回應／日誌。寫入失敗即停用該程序；重啟前須人工確認帳本、未完成請求及權限，不可刪帳本取得新額度。

此設計只支援單一 Node 程序、一個 runtime 寫同一帳本；不要讓多 instance／程序共用路徑。環境變數的動態檢查是讀取程序的 process.env；外部 shell export 不會修改既有程序，運行中緊急停止優先使用停止檔。預算拒絕的安全理由保留至台北換日（或重啟），供設定頁辨認；總額仍受持久帳本限制。

## 本機啟動（真實供應商，外部 env 檔）

金鑰與簽收值放在 **repo 外**、權限 600 的 env 檔，不寫進 `.env`、不進 Vite、不進版本庫。以下路徑與值皆為示意，文件中不含任何真實金鑰。

```bash
# 1. 建立 repo 外的私有設定檔（只做一次）
mkdir -p ~/.config/qualia && chmod 700 ~/.config/qualia
touch ~/.config/qualia/openai.env && chmod 600 ~/.config/qualia/openai.env
# 用編輯器填入（示意，不要把真實值貼進任何 repo 檔案或聊天）：
#   OPENAI_API_KEY=<你的金鑰>
#   OPENAI_REAL_CALLS_APPROVED=true
#   LLM_PROVIDER=openai
#   TTS_PROVIDER=openai
#   OPENAI_TEXT_MODEL=<帳號可用、支援 Structured Outputs 的模型>
#   OPENAI_TTS_MODEL=<支援 instructions 的模型，例如 gpt-4o-mini-tts 系列>
#   OPENAI_TTS_VOICE=cedar   # B2 試聽選定
#   OPENAI_TTS_INSTRUCTIONS=  # 選填，空值用內建 B2 聲線指示
#   OPENAI_PRICE_INPUT_PER_1M_TOKENS=<當期單價>
#   OPENAI_PRICE_OUTPUT_PER_1M_TOKENS=<當期單價>
#   OPENAI_PRICE_TTS_PER_1M_CHARS=<涵蓋文字＋音訊的保守全費用上界>
#   PROVIDER_TIMEOUT_MS=30000
ls -l ~/.config/qualia/openai.env   # 應為 -rw-------

# 2. 建置後，在 repo 根目錄啟動（相對路徑 ./data/... 以目前目錄為準）
pnpm build
node --env-file-if-exists=.env --env-file=$HOME/.config/qualia/openai.env apps/server/dist/index.js
```

- 多個 `--env-file` 時後面的檔案覆寫前面的值；shell 已 export 的變數優先於檔案。不要在 shell export 金鑰，以免留在歷史紀錄。
- 啟動後先打開設定頁或 `GET /api/capabilities`：`providers` 應為 `{ llm: 'openai', tts: 'openai', reason: null }`。若有 reason（未簽收、缺單價、帳本損毀、停止檔……），代表已降級，不會發出任何 OpenAI 請求。
- 逾時建議：真實 LLM 產生 5–7 首中文候選常需 15–30 秒，預設 `PROVIDER_TIMEOUT_MS=8000` 幾乎必定逾時（逾時的預扣會保守保留）。建議 `PROVIDER_TIMEOUT_MS=30000`。前端輪詢上限是 65 秒，所以 `PLAN_DEADLINE_MS` 維持 60000；修復重試加上 5 段 TTS 可能超過，可把 `MOCK_PHASE_MS` 降到 200 以騰出時間。
- 推理型模型（reasoning tokens 也計入 `max_output_tokens`）容易在 4096 內被截斷，第一次實測建議用非推理型模型。
- 緊急停止：`touch ./data/KILL_SWITCH`（執行中立即生效）；恢復時刪除該檔。帳本在 `./data/budget-ledger.json`，不可刪除以取得新額度。
- 服務只綁 127.0.0.1；手機實測需要的 HTTPS 入口不在本 PR 範圍，也不要在這裡變更既有的 launchd／tailscale 設定。

## 曄的啟用檢查表

- 兌換額度並確認帳號／模型可用性與當期費率，填入上述單價；沒有可確認的上界就維持 mock。
- 放金鑰到本機、忽略於版本庫且 mode 600 的設定檔，不能進 Vite 或前端儲存。
- 簽收每日 US$ 1、總額 US$ 10、每日 20 plan、每日 4000 grapheme 與失敗保留預扣規則；上限只可調低。
- 檢查帳本及快取目錄權限、單一程序限制、停止檔操作與 /api/capabilities 降級資訊。
- 完成簽收後由曄設 OPENAI_REAL_CALLS_APPROVED=true，再明確設需要的 LLM_PROVIDER／TTS_PROVIDER=openai；Spotify 仍 false，E 仍停用。
- 首次真實測試、iPhone 主畫面播放與背景行為由曄另行授權並在沙箱外記錄，本次沒有做。

## PWA 與測試證據

`scripts/generate-icons.mjs` 純 Node＋zlib 寫 PNG 簽章、IHDR、IDAT、IEND 與 CRC32，讀 design tokens 產生深色底、品牌色圓及波形。public 包含 192／512 PNG、各尺寸 maskable 與 180 apple-touch-icon；相同環境重跑 bytes 一致。manifest 與 HTML 有 standalone、start_url、設計色及 Apple metadata，不提供離線。server 顯式設定 manifest／PNG MIME，沿用 CSP、nosniff 與其他安全標頭。

| 子項 | 主要變更 | 新增／更新測試與紅→綠證據 |
|---|---|---|
| A1 | providers/openai/planner.ts、http.ts、resources.ts；PlanService 的 gate | openai.test.ts：缺模組 exit 1→通過；openaiIntegration.test.ts：無效 JSON 僅兩次呼叫，原 schema 邊界保留 |
| A2 | providers/openai/tts.ts、contracts domain.ts、API media／tts、PlanService、web DjIntroduction／PlayerControls／audio adapter | tts.test.ts：缺模組 exit 1→通過；同毫秒淘汰 null 失敗→保護新檔通過；providerLabels.test.ts：缺元件→標示通過 |
| A3 | budget/ledger.ts、runtime.ts、env.ts、app.ts、capabilities.ts、contracts api.ts、ProviderStatus／SettingsPage | budget.test.ts：缺模組→通過；合計不一致與超預扣重啟未停用皆先 exit 1→修正通過；env.test.ts：仍 throw 兩項失敗→降級通過；openaiIntegration.test.ts：缺 providers 欄位→通過、TTS-only 日額度未生效→修正通過；providerSafety.test.ts：共用串行、動態停止、HTTP timeout、abort、金額拒絕與權限寫入失敗 |
| A4 | 本文件、README、.env.example | env.test.ts 驗空值與安全預設；文件明列未真實呼叫與簽收步驟 |
| B1 | generate-icons.mjs、public/manifest.webmanifest、五個 PNG | pwa.test.ts：缺資源／腳本 exit 1→PNG 簽章、尺寸、確定性通過 |
| B2 | apps/web/index.html | pwa.test.ts：缺 manifest／Apple metadata→通過 |
| B3 | app.ts 靜態 MIME | pwaStatic.test.ts：取得 text/html 而非 manifest 的紅燈→正確 MIME、CSP、nosniff 通過 |

所有 Vitest 測試使用共用 noNetwork.ts，beforeEach 先將 globalThis.fetch 換成 throw stub。既有測試可注入假 fetch 或覆寫成測試 stub；不允許真實網路。紅燈實際執行後才實作相應功能，沒有執行 Playwright。最後根目錄依序執行 lint、typecheck、test、build，結果見本次交付摘要。

## PR B：獨立審視與補強（2026-10-05）

仍未做任何真實 OpenAI 呼叫；預設 mock、`OPENAI_REAL_CALLS_APPROVED=false`。所有新測試沿用 noNetwork stub（globalThis.fetch 一律 throw），HTTP 只走注入的假 fetch。

| 檢查 | 修正 | 測試 |
|---|---|---|
| 閘門 | `tts-1`／`tts-1-hd` 設定即降級；gate 擋住時 capabilities 不再誤刪「不是 AI 語音」限制 | `openaiGates.test.ts`：16 種原因（未簽收、缺金鑰／模型／voice／單價、單價 0 或非數字、tts-1、帳本損毀／結構不符、環境停止、啟動前／執行中停止檔）皆 0 次 HTTP、capabilities 有原因、節目 warnings 前兩則為 LLM／TTS 降級提示；預設 env 無原因 |
| 預算 | 輸入餘裕 8192→2048；單次預扣 >10% 日額拒絕並顯示原因 | `budgetLimits.test.ts`：預設與上限值、20 plan／日與台北換日、US$1／日與 US$10 總額跨日、4000 grapheme／日與快取不扣、HTTP 前帳本已含完整預扣、估算上界與合理性、單次上限、LLM＋TTS 併發 1 |
| 端到端 | 媒體路由改 `sendFile`（Range／206）；LLM 失敗、拒答、兩次無效改用 MOCK 並明示；提示排最前；TTS 首次失敗即停止並保留文字＋提示音 | `openaiEndToEnd.test.ts`；web `aiVoicePlayback.test.ts`（手勢同步 start、同源 URL 限制、AI 語音播放失敗顯示文字介紹＋重試、供應商提示元件） |
| 金鑰 | 無需修改程式；以測試鎖定 | `openaiSecrets.test.ts`：假金鑰經 throw／401／500／成功四種情境，掃描 API 回應與標頭、job、show、capabilities、/api/tts、日誌、帳本、快取檔名、直接例外與啟動日誌 |
| API 形狀 | 送出的 schema 移除 `minLength`／`maxLength` | `openaiApiShape.test.ts`：欄位集合完全相等、strict schema 規則、reasoning item 與 incomplete 處理 |
| .env.example | 還原原範例值，新增變數以空值／安全預設列出 | `env.test.ts`：直接載入 `.env.example` 得到 mock、未簽收、預算上限、金鑰空白 |

後續（不在本 PR）：service worker 與離線頁、截圖瘦身、iPhone 真機（主畫面、背景、鎖屏）驗證、手機可達的 HTTPS 入口、strict 模式支援關鍵字的原文查證、首次真實呼叫後依帳單校正單價與 TTS 每字元上界。
