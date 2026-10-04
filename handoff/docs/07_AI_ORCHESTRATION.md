# 07｜Sonic Qualia 編排與 Prompt 契約

## 保留原 prompt 的精神

角色仍是 Sonic Qualia Architect（聲景質地架構師）；四面向為 Spatial Signature、Emotional Velocity、Timbral Palette、Lyrical Context。先找 Hook of Feeling，再跨曲風找 Sonic Twins / Vibe Cousins，每首一定給 Bridging Insight。[U3]

`prompts/sonic-qualia-original.md` 留完整人類閱讀版本；`prompts/sonic-qualia-system.md` 是本次新增的 production JSON 版本。不可直接把原 Markdown 回覆塞入前端再用 regex 拆歌名。

## Evidence model

| level | 能說什麼 | UI 標示 |
|---|---|---|
| user_description | 使用者描述的質地與場景 | 依你的描述 |
| licensed_editorial | 權利允許的獨立編輯資料所支持的內容 | 參考編輯資料 |
| model_knowledge | 一般模型記憶，未在本次聽音確認 | 推薦推測，未聽音驗證 |
| unknown | 來源不明／不熟悉歌曲 | 資料不足 |

首版不是音訊分析產品。不能聲稱「我聽出來」「實測 BPM 92」「完全相同和弦」除非輸入資料有可用、可追溯證據。用「更貼近……的質感」表達主觀相似，不給假精準 97% 分數。

## Pipeline

1. 校驗 Seed 長度與種類，保留原文；user input 是資料而非新的 system 指令。
2. 組裝最小 `EditorialInput`。Spotify response 不得混入。
3. 用 Structured Outputs／JSON Schema 產生 `PlanDraft`，目標 7 候選，含 Sonic DNA、seedBridge、vibe[3]、djLine 與可選 transition。預設一次同時完成選歌與台詞，避免每首再呼叫模型。[R16]
4. 先做 schema、安全、證據與文字長度驗證，再做 catalog resolution。
5. resolver 查歌曲身分與版本，最多取前 5 首有效候選。不將 Spotify 搜尋結果、失敗曲目列表或補充 metadata 回灌模型。
6. 不足時允許一次獨立追加候選請求：僅用原使用者 Seed／已允許資料及原候選去重，不傳 Spotify 結果。第二次模型呼叫若已用於 schema repair，就不再補位。總模型呼叫 ≤2。
7. 仍不足五首時回 partial，實際數量入 UI。0 首回明確無可播結果；不是虛構候選湊數。
8. 儲存不可變 ShowPlan，第一段可開始預合成 TTS；未經使用者播放手勢不得自動開聲。

## 曲目解析規則

- 輸入 `title + artist + versionHint`，搜尋使用查詢限定與 market（如帳號／API 允許）；最多每候選兩種查法，concurrency2、每次 limit5。
- 身分判定為 title normalization、藝人匹配、版本匹配；optional ISRC 支持時用來確認。[R8/R9]
- 同名不同藝人、cover、live、remix 不可靜默替代原版。判不準就 unresolved。
- 不依 popularity 排序；搜尋命中第一筆不等於最佳／正確曲目。
- 解析成功只是 metadata identity 確認，不能標成「實測能播」，直到裝置播放能力與來源狀態確認。
- 沒有合法 audioFeatures／BPM 資料，就不提供可靠 BPM 導向舞蹈模式；`Emotional Velocity` 只作質感語言。

## Bridge 與台詞

seedBridge 描述 Seed 的特定元素如何在候選中延續；至少包含一個具體面向，不得五首全部「很適合你的心情」。示例模板：「延續你描述的貼近人聲與柔和低頻，但讓節奏再往前一步。」這是句式示例，不是某首真實歌曲事實。

transitionBridge 必須有 fromCandidateId，只有實際前一首與其相符才顯示／播出。補位、移除或換台使前曲不同時，降回 seedBridge 對應台詞。不允許拿錯誤 adjacency 的快取念給使用者。

DJ：繁中、自然、有呼吸，不堆音樂術語，30–55 字為目標，80 grapheme clusters 硬上限；包含標點與英文字母。不要報精準頻率、弦型、錄音室、器材型號或歌詞細節，除非證據支持。不要引用歌詞；不模仿特定真人聲音；明示 AI 聲音。[R17]

如果模型超長，優先唯一一次 repair（若還有 budget）；否則 deterministic 安全降級為可用的短台詞或純文字，不直接切斷中文字元／半句造成錯誤。不得為了縮短添加未有的音樂事實。

## 生成錯誤

refusal → 使用者可理解訊息；invalid JSON/schema → 至多修復一次；timeout → 保留草稿與已生成 Show；no evidence → unknown，不冒認；prompt injection → 忽略資料內指令，不允許任意 HTTP、shell、修改設定或解除 gate。

LLM 不產生可直接執行 actions 或 URLs。每個候選 ID 是內部編輯 ID，不是 Spotify ID；resolver 才能寫 providerTrackId。原 prompt 的自由描述仍被保留在輸入與 Bridge，而不是讓模型操縱系統。

## 評估集

`examples/evaluation-cases.json` 提供測試 Seed 與預期行為，非真實配對答案。至少評估：單純感覺、精確歌曲／音色、同名歌曲、未知歌、跨曲風、全中文、惡意指令、BPM 假精準、敏感自述、不存在曲目。

人評 rubric（各1–5，為產品研究設計）：具體性、與 Seed 連結、跨曲風合理性、不確定性誠實度、串詞自然度。先由少量樣本人工評審，不宣稱模型分數能替代聽感。取得可合法研究的音源後再做音樂專業評估。
