# 12｜來源登錄與核對日期

核對：2026-10-04。官方網頁是當次讀取結果，非永久能力保證；實際帳號／裝置仍需測試。材料來源、外部事實與本包新增設計決策分開。

## 使用者材料

U0：本次訊息，手機主要操作介面與重視UIUX。
U1：`../sources/QUALIA_FM_MVP.md`，原始全文保留。
U2：`../sources/QUALIA_FM_FULL.md`，原始全文保留。
U3：`../prompts/sonic-qualia-original.md`，原prompt僅還原Markdown跳脫。

## 參考專案

R0 Claudio Development Spec：
`https://github.com/hllqkb/Claudio/blob/main/DEVELOPMENT_SPEC_AI_RADIO.md`

透過GitHub連接器讀取完整相關內容。file blob SHA `a26d59fac18a3ca8112099b881eacb0b82fc2412`。採分層、PWA、TTS快取、狀態與錯誤處理；不把其第三方音樂API／授權／工期視為已驗證。本包未複製其程式碼，若後續重用須另讀license。

## 官方文件

| ID | 文件與核對用途 | 原文 |
|---|---|---|
| R1 | Spotify Developer Policy；混音/segue、AI資料、商業與預覽用途 | `https://developer.spotify.com/policy` |
| R2 | Spotify Developer Terms；Spotify Content進入AI之限制 | `https://developer.spotify.com/terms` |
| R3 | Web Playback SDK overview；mobile支援與iOS啟播限制 | `https://developer.spotify.com/documentation/web-playback-sdk` |
| R4 | SDK reference；activateElement、iOS音量、events／state | `https://developer.spotify.com/documentation/web-playback-sdk/reference` |
| R5 | Quota modes；Premium owner、5人allowlist、403與quota | `https://developer.spotify.com/documentation/web-api/concepts/quota-modes` |
| R6 | July 2026 changelog；25個Client ID與per-account quota | `https://developer.spotify.com/documentation/web-api/references/changes/july-2026` |
| R7 | Redirect URIs；HTTPS／loopback／localhost | `https://developer.spotify.com/documentation/web-api/concepts/redirect_uri` |
| R8 | February 2026 changelog；search limit與移除欄位 | `https://developer.spotify.com/documentation/web-api/references/changes/february-2026` |
| R9 | March 2026 changelog；external_ids移除撤回 | `https://developer.spotify.com/documentation/web-api/references/changes/march-2026` |
| R10 | May 2026 changelog；account_id | `https://developer.spotify.com/documentation/web-api/references/changes/may-2026` |
| R11 | Design & Branding；音樂artwork與來源呈現 | `https://developer.spotify.com/documentation/design` |
| R12 | W3C WCAG22 Target Size；24 CSS px AA基準與例外 | `https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html` |
| R13 | W3C WCAG Contrast；正常字4.5:1、大字3:1 | `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html` |
| R14 | MDN Media Session API；metadata/control能力而非背景保證 | `https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API` |
| R15 | MDN Service Worker API；secure context與app shell邊界 | `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API` |
| R16 | OpenAI Structured Outputs；JSON schema與失敗處理 | `https://developers.openai.com/api/docs/guides/structured-outputs` |
| R17 | OpenAI Text to speech；speech endpoint與AI聲音揭露 | `https://developers.openai.com/api/docs/guides/text-to-speech` |
| R18 | Spotify PKCE；S256、state、token flow | `https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow` |

## 原文與判讀分開

- 官方限制屬R1/R2；「先關閉Spotify整合，完整DJ先用授權音源」是本包的保守工程決策，不是官方替本產品背書。
- 「PWA不保證背景DJ」是把瀏覽器能力與本產品多段音訊需求結合後的風險判讀；不能宣稱官方說所有PWA一律不能背景播放。
- 48px點擊區、視覺色票、字級、timeout、預設budget與feature排序是本包設計值，不是引用成已證實最佳值。
- Spotify可搜尋到一首歌，不代表本次模型分析了它，更不代表有把它送入AI或公開播出的權利。
