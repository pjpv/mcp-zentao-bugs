# Changelog

本檔記錄 `mcp-zentao-bugs-v12` 各版本變更。

格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/)，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [0.2.0] - 2026-08-04

### 🔴 破壞性變更（Breaking）

**Bug 列表工具改為永久精簡模式 + 返回結構變更**

`getMyBugs` / `browseBugs` 不再返回含大量 HTML 的全量對象（舊版 20 條 Bug 的 `steps` 欄位實測 ~228KB，遠超 MCP 工具輸出上限 ~50KB，會被 client 截斷 `[Tool output truncated...]` 導致 JSON 損壞）。

- **永久精簡**：只回 `id / title / severity / status / assignedTo` 五欄，不含 `steps` HTML。看重現步驟請改用 `getBugDetail(bugId)`
- **返回結構**：由陣列改為物件
  ```js
  // 舊版
  [{ id, title, severity, status, assignedTo, steps, ... }, ...]

  // 新版
  { bugs: [{ id, title, severity, status, assignedTo }, ...],
    total,      // number | null，伺服器總數（客戶端過濾時為 null）
    hasMore }   // boolean，是否還有後續
  ```

### ✨ 新功能

- **`offset` 翻頁參數**：`getMyBugs` / `browseBugs` 新增 `offset`（預設 0）。當 `hasMore: true` 時，下次調用傳 `offset + 本次 count` 即可取下一頁，避免條數多時單次讀不全造成的漏條

### 🐛 Bug 修復

- **修正 `hasMore` 邊界錯誤**：客戶端過濾情境（`assigntome + moduleId`）下，當 `filteredCount` 精確命中目標數時 `hasMore` 會錯誤回 `false`（拉到 server 盡頭的死變數 `reachedEnd` 未接進判斷）
- **修正關鍵詞過濾 under-fetch**：`keyword` 客戶端過濾時，迴圈停止條件用了過濾前計數，導致實際返回數量不足 `limit`

### 🔒 安全修復

- **`api-docs/` 範例數據脫敏**：`bug.json` 與 `searchbugs.http` 原含真實公司內網資訊（明文帳密、內網域名、有效 session token、真實員工姓名、業務 ID），隨套件發布至公開 npm registry 會造成洩漏。全部替換為佔位符：
  - `platform.onecode.cmict.cloud` → `your-zentao.example.com`
  - 真實帳密 → `demo-user` / `your-password`
  - 有效 token → `your-token-here`
  - 真實姓名 → `示例用户`

### 📚 文檔

- README 工具表 `getMyBugs` 參數列新增 `offset`
- 新增「列表 vs 詳情」段，說明 `getMyBugs`（列表精簡）/ `getBugDetail`（單條 steps）/ `getBugStats`（統計）三工具分工
- 補 offset 翻頁 + `hasMore` 判讀說明與 `total=null` 情境註記

### 📦 其他

- 單元測試 32 → 36 項（新增 3 個 `hasMore` 邊界回歸測試，修復 4 個既有測試適配新返回結構）
- 版本號 `0.1.0` → `0.2.0`（0.x 期 breaking 變更 → minor bump）

## [0.1.0] - 2026-08-03

首個穩定版本。

## [0.0.x] - 2026-04-09 ~ 2026-04-10

早期迭代版本。
