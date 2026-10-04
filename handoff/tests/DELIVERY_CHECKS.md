# 交付前檢查報告

日期：2026-10-04。以下只涵蓋這份開工包與 HTML 參考原型，不代表正式 App 已完成。

## 實際執行

- Chromium + Playwright：24 項原型互動／版寬檢查通過，詳細結果見 `prototype-results.json`；可重跑 `prototype_smoke.py`。
- 已檢查 320、360、390、430、1440px 收聽頁，未發現水平溢出。小高度視窗允許垂直捲動，不宣稱所有資訊都同時在首屏。
- 驗證空輸入、範例填入、取消保留草稿、ready 不自播、跳過介紹保留曲目、暫停不跑進度、dialog/Escape/返回焦點、移除／復原、微調不打斷當前曲、mini-player、錯誤恢復。
- 原型未發出任何網路請求；未觀察到 JavaScript runtime error。
- JSON 可解析，PlanDraft／PlanRequest／ShowPlan／Capabilities fixture 通過對應 schema 驗證；OpenAPI 內部引用均可解析。
- `tsc --noEmit --strict --target es2022 --lib es2022,dom contracts/domain.ts` 通過。這只驗參考型別，不是工程 App build。
- 兩份使用者原始材料的位元組與上傳檔案完全相同。

## 視覺檢查

已實際渲染並查看開台、收聽與 Bridge 畫面；其他主要畫面截圖收在 `design/screenshots/`。修正了 modal 中無法操作外部 Undo 的問題、截圖動畫未完成造成變淡，以及首屏 artwork 過高問題。

主要文字 token 對比計算（只是選定配對，不是完整 WCAG 稽核）：

| 前景 / 背景 | 對比 |
|---|---|
| ink / background | 12.6:1 |
| muted / background | 5.23:1 |
| accent / background | 5.25:1 |
| onPrimary / primary | 9.16:1 |
| ink / surface | 13.74:1 |
| muted / surfaceSubtle | 4.96:1 |

## 未執行，必須由工程階段補齊

iPhone Safari／加入主畫面的 PWA 真機播放、Android 真機音訊、鎖屏、來電／音訊焦點、藍牙、Spotify OAuth／帳號資格／搜尋／SDK、真實 LLM／TTS、授權音源、VoiceOver／TalkBack、完整 200% 字級與瀏覽器 zoom、完整 WCAG 稽核、後端安全或負載測試、公開部署與任何政策核准。

瀏覽器測試以 `page.set_content()` 載入單檔 HTML。測試環境限制 `file://` 導航，故不聲稱在此環境完成雙擊本機檔案測試；檔案本身不依賴外部資產。原型沒有 Service Worker，因此不是已驗證可安裝／離線的 PWA 成品。

## 重跑

```bash
# 需自行在本機準備 Python Playwright、Chromium、PyYAML、jsonschema、TypeScript。
python tests/verify_contracts.py
CHROMIUM_BIN=/usr/bin/chromium python tests/prototype_smoke.py
tsc --noEmit --strict --target es2022 --lib es2022,dom contracts/domain.ts
```

`CHROMIUM_BIN` 請依使用的作業系統調整；未指定時腳本尋找常見 Chromium，或使用 Playwright 的已安裝瀏覽器。這些是開工包檢查腳本，不是正式工程測試套件的替代品。
