# 03｜設計系統與元件交付

## 美術方向

暖白私人電台：空氣感、留白、可閱讀的編輯文字，配上有溫度的唱片符號。避免預設 AI 紫色漸層、密集玻璃卡片、霓虹控制台與仿 Spotify 完整視覺。

聲景的抽象圖只代表 Qualia 自有節目／demo，不是歌曲專輯封面。正式播放第三方音樂時，曲目 artwork 另有 provider 規則。[R11]

## Token

詳見 `design/tokens.css` 與 `design/tokens.json`。

| 類型 | 值 | 用途 |
|---|---|---|
| background | `#F6F4ED` | 主背景 |
| surface | `#FFFEFA` | 輸入與 sheet |
| surface-subtle | `#ECEFE7` | 次要區塊 |
| ink | `#1F302A` | 主文字 |
| muted | `#586A60` | 次要文字，需驗對比 |
| primary | `#294F42` | 主控制 |
| on-primary | `#FFFFFF` | 主控制文字 |
| accent | `#985339` | 小標、提醒 |
| border | `#CED5CB` | 裝飾分隔線，非唯一 focus 邊界 |
| focus | `#1E695E` | focus ring |
| danger | `#A63030` | 失敗與需注意訊息 |

Spacing：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48。Card radius 20，input 16，sheet 28（只上角），button 999。適度圓角，不每個文字段都包一張卡。

字體：系統 UI 字體；中文 `PingFang TC`／`Noto Sans TC` 若系統有則使用，不隨包附字型檔；fallback sans-serif。品牌可用系統 Georgia／serif 增加編輯感；正式內文仍以可讀性為先。H1 32/40，H2 24/32，曲名 24/30，body 16/26，meta 13/20；12px 只能用於非必要裝飾小標。

## 元件表

| 元件 | 必備狀態 | 互動／規則 |
|---|---|---|
| PrimaryButton | normal / pressed / focus / loading / disabled | 不因 spinner 改寬；48–56px 高 |
| SeedComposer | empty / focus / filled / error / composing | label、字數提示、草稿保留 |
| SegmentedControl | selected / unselected / focus | 三項等寬，支援鍵盤 |
| MoodChip | idle / selected / focus | 點一下只填入，不自動生成 |
| GenerationTimeline | pending / running / done / failed | 真實 phase，不假百分比 |
| PlayerHero | placeholder / loaded / unavailable | 限制高度、無 layout shift |
| BridgeCard | compact / expanded / uncertain | 2–3 行預覽，完整理由有入口 |
| TransportControls | ready / speech / track / paused / blocked | phase-aware；中間主鍵64px |
| SeekBar | available / dragging / disabled | 不可播時不呈假進度 |
| QueueRow | queued / playing / played / skipped / failed | 狀態文字，主要資訊可兩行 |
| MiniPlayer | track / speech / paused / unavailable | 和底部 nav 不重疊 |
| BottomSheet | open / close / scroll / focus | 最多一層；關閉後返回焦點 |
| InlineRecovery | warning / error / offline | 原因＋下一步；不可只 toast |
| Toast | info / undo | 不阻擋控制；不是唯一錯誤通道 |
| CapabilityBadge | mock / licensed / spotify / external | 必須真實標示來源 |

## 原型用途與落地規則

`prototype/index.html` 呈現主要畫面、Bridge、節目單、微調與錯誤恢復。它使用固定資料與展示狀態，沒有真實音訊或供應商。工程版必須用真實 state machine／API 替換 demo timers，並保留其資訊層級，不把示意資料當生產資料。

需交付的工程截圖：開台、輸入錯誤、生成、ready、speech、track playing、paused、Bridge、Queue、Tune、設定、offline、autoplay blocked、partial、empty。每種至少 390×844；主流程另驗小／大手機與桌面。
