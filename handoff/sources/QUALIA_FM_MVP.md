# Qualia FM MVP 計劃（下午 5 小時版）

**一句話目標**：輸入一首歌或一種感覺，AI 電台 DJ 依聲音質地排出 5 首歌，每首前面用語音講一段串詞，再用 Spotify 播出來。

## 範圍

**一定要有（MVP）**
- Spotify 登入，並在網頁播放完整歌曲（需 Premium）
- 輸入種子歌或感覺，用 Sonic Qualia prompt 選出 5 首歌
- 用 Spotify 搜尋把歌名轉成曲目，找不到的丟掉並補位
- 把 Bridge 理由改寫成 80 字內的繁中串詞，用 OpenAI TTS 念出來
- 串詞先播，念完再播歌，念的時候歌曲音量壓低
- 畫面顯示正在播的歌、串詞文字、接下來的歌

**有時間才做**
- 舞蹈模式（輸入練習目標，自動排 BPM 由慢到快）
- 品味記憶（存聽過和跳過的歌，下次餵回 prompt）
- 使用者點歌隊列

**明確不做**：資料庫、多使用者、天氣和日曆、手機 App、部署上線。

## 架構

- 前端：Vite 加 TypeScript，Spotify Web Playback SDK 放在這裡。
- 後端：Node.js 加 Express，兩個 API 加靜態檔案服務：
  - `POST /api/plan`：輸入感覺，回傳 5 首歌和串詞。
  - `POST /api/tts`：輸入文字，回傳 mp3。
- 金鑰：`OPENAI_API_KEY` 只放在後端 `.env`。Spotify 用 PKCE 登入，前端只需要 Client ID，不需要 secret。
- 專案資料夾：`qualia-fm`。

## 時間表（12:30 開始算 5 小時）

| 時段 | 目標 | 完成標準 |
|---|---|---|
| 第 1 小時 | 專案骨架、Spotify 登入與播放 | 按一個鈕，網頁播出一首指定歌曲 |
| 第 2 小時 | LLM 選歌加 Spotify 搜尋 | 輸入「深夜獨自開車」，後端回傳可播的 5 個曲目 ID |
| 第 3 小時 | 串詞、OpenAI TTS、播放順序 | 串詞念完自動接歌，歌曲音量會壓低再恢復 |
| 第 4 小時 | 介面整理與錯誤處理 | 有正在播、串詞文字、下一首清單；找不到歌會自動補位 |
| 第 5 小時 | 加分項與排練 demo | 做完舞蹈模式，或把 90 秒的 demo 流程練到順 |

第 3 小時結束時應該已經能完整 demo，後面兩小時是加分，不是救火。

## 資料格式

LLM 選歌回傳（嚴格 JSON）：

```
[{"title": "...", "artist": "...", "bridge": "...", "vibe": ["...", "...", "..."]}]
```

串詞改寫規則：繁體中文、80 字內、像電台主持人、可以提上一首與這一首的關聯。

## 風險與備案

| 風險 | 備案 |
|---|---|
| 沒 Premium，或現場網路讓 SDK 連不上 | 只播 30 秒試聽，或顯示歌單加 Spotify 連結 |
| LLM 編出不存在的歌 | 搜不到就丟掉，要求多回 2 首當候補 |
| TTS 延遲太久 | 播第一首時預先產生後面幾首的串詞 |
| OpenAI 額度或網路出問題 | 瀏覽器內建語音 Web Speech API 當備援 |
| Spotify API 政策變動 | 只用搜尋與播放，不依賴推薦端點 |

## 給 Codex 的第一個指令

```
Build a minimal AI radio DJ web app named "Qualia FM" in 5 hours.

Stack: Node.js + Express backend, Vite + vanilla TS frontend.
Secrets in .env only: OPENAI_API_KEY, SPOTIFY_CLIENT_ID. Never log them.

Flow:
1. User logs in with Spotify (PKCE, no client secret) and plays via Web Playback SDK.
2. User types a seed song or a feeling.
3. Backend calls an LLM with the "Sonic Qualia Architect" system prompt (in prompts/sonic-qualia.md). Ask for JSON: [{title, artist, bridge, vibe}] x5.
4. For each item, search Spotify (/v1/search). Drop items not found.
5. For each kept item, rewrite "bridge" into a <=80-char Traditional Chinese radio DJ line, then call OpenAI TTS and cache the mp3.
6. Frontend plays: DJ line first, then the track via Spotify (duck volume while the DJ talks).
7. Show now-playing, DJ line text, and an up-next list.

Do step 1 first and stop when one track plays. Then continue step by step, committing after each step.
```

## Demo 腳本（90 秒）

1. 打開 Qualia FM，登入 Spotify。
2. 輸入「剛練完 Breaking，累但很爽」。
3. DJ 開口講第一段，歌曲接上，畫面顯示串詞和下一首。
4. 現場換輸入一首歌，展示它跨風格選出的歌和 Bridge 理由。
5. 結尾：「這是我的私人電台，用 5 小時做出來的。」

## 請 GPT 優化時可以請它檢查

- 5 小時是否真的做得完？哪一步最可能超時？
- Sonic Qualia prompt 要不要改成直接輸出 JSON，並把串詞一起生成，減少一次 LLM 呼叫？
- Spotify 現行政策下，Web Playback SDK 和搜尋是否都還能用？
- 串詞預先生成的時機怎麼排最順？

**開工前先備好**：Spotify Premium、開發者後台建好的 Client ID（Redirect URI 填 `http://127.0.0.1:5173/callback`）、OpenAI 金鑰放進 `.env`。
