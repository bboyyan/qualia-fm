# 契約使用

OpenAPI 3.1 與 JSON Schema 是靜態契約；domain.ts 提供參考型別。需在工程版加入 Zod／runtime validator 與 contract test，不是只靠 TS。

Schema 的 text maxLength 是防濫用上限；使用者 500 字及 DJ 80 字規格以 Unicode grapheme clusters 另驗證，不能直接用 JS string.length。Provider 與 audioLocator 的合法組合、scope、owner、capability、前曲關係、唯一候選 ID 與 budget 都需語意驗證。

模型初始 schema 最多7候選；獨立補位請求上限3，驗證後合併最多10，再解析取5。不把合併10首重新塞回只有7上限的初始 PlanDraft。

案例均為虛構測試資料，不能當成真實歌曲。
