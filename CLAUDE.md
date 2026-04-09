# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 項目架構

這是一個基於 **FastMCP** 的 MCP 伺服器，用於集成禪道 Bug 管理系統。

**核心分層：**
- `src/mcp-server.mjs` - FastMCP 伺服器主入口，定義 MCP 工具和 SSE 傳輸
- `src/zentao-api.mjs` - 禪道 API 封裝層，處理 Session 認證和舊版 JSON API 格式

**關鍵設計決策：**
- 使用禪道 12.x 舊版 JSON API（Session Cookie 認證），而非 REST API v1（Token）
- 所有工具調用通過 single-flight queue 序列化，確保請求有序執行
- 舊版 API 回應格式為 `{"status":"success","data":"<JSON字串>"}`，需二次解析

## 開發命令

```bash
# 安裝依賴（使用 pnpm）
pnpm install

# 開發模式（監聽檔案變化）
pnpm dev

# 生產模式啟動
pnpm start

# 發佈版本
pnpm release:patch   # 補本版本
pnpm release:minor   # 次版本
pnpm release:major   # 主版本
```

## 環境配置

必需環境變數（在 `.env` 文件或 CLI 中設置）：

```env
ZENTAO_BASE_URL=https://your-zentao.com/zentao  # 指向禪道入口目錄
ZENTAO_ACCOUNT=your-username
ZENTAO_PASSWORD=your-password
PORT=3000  # 可選，默認 3000
```

**重要：** `ZENTAO_BASE_URL` 應指向禪道入口目錄（如 `http://host/zentao`），而非 `api.php`。

## 禪道 API 格式

### 舊版 API 特點

1. **Session 認證流程：**
   - 先調用 `/api-getsessionid.json` 獲取 session ID
   - 再調用 `/user-login.json` 並帶上 session cookie

2. **回應格式解析：**
   - 舊版回應：`{"status":"success","data":"<JSON字串>"}`
   - 需二次解析 `data` 欄位（見 `ZenTaoAPI.parseOldApiResponse()`）

3. **URL 模式：**
   - Bug 瀏覽：`/bug-browse-{productId}-0-{browseType}-0-id_desc-0-{perPage}-{page}.json`
   - Bug 詳情：`/bug-view-{bugId}.json`
   - Bug 解決：`/bug-resolve-{bugId}.json`（POST）

### browseType 篩選類型

`assigntome`（指派給我，預設）、`all`、`unclosed`、`openedbyme`、`resolvedbyme`、`toclosed`、`unresolved`、`unconfirmed`、`assigntonull`、`longlifebugs`、`postponedbugs`、`overduebugs`、`needconfirm`

### resolution 解決方案

`fixedcodeerror`（預設）、`fixeddesigndefect`、`fixeduierror`、`fixedwrongdata`、`fixedsettingerror`、`fixedcognitiveerror`、`fixednew`、`fixedbetteruse`、`bydesign`、`duplicate`、`external`、`notrepro`、`postponed`、`willnotfix`

## 修改指南

### 新增 MCP 工具

在 `src/mcp-server.mjs` 中使用 `server.addTool()` 添加新工具：

```javascript
server.addTool({
  name: 'toolName',
  description: '工具描述',
  parameters: z.object({
    param1: z.string().describe('參數描述')
  }),
  annotations: { title: 'Tool Name', readOnlyHint: true, openWorldHint: true },
  execute: async (args, { log }) => {
    return await new Promise((resolve) => {
      enqueue(async () => {
        try {
          // 調用 zentaoAPI 方法
          const result = await zentaoAPI.someMethod(args);
          resolve({ content: [{ type: 'text', text: JSON.stringify(result) }] });
        } catch (err) {
          resolve({ content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] });
        }
      });
    });
  }
});
```

### 新增 API 方法

在 `src/zentao-api.mjs` 的 `ZenTaoAPI` 類中添加方法：

```javascript
async newApiMethod(param) {
  return await this.fetchOldApi('some-endpoint.json');
}
```

注意使用 `fetchOldApi()` 或 `postOldApi()` 來自動處理 Session 認證和舊版格式解析。

## 調試技巧

1. **查看 API 回應：** 在 `zentao-api.mjs` 的 `fetchOldApi()` 後添加 `console.log(json)`
2. **測試單個工具：** 使用 Trae 或 Claude Desktop 的 MCP 客戶端直接調用
3. **檢查 Session：** 確認登入成功後 `this.sessionId` 和 `this.sessionName` 已正確設置
