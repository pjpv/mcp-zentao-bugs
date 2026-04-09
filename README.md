# ZenTao Bugs MCP Server

基於 FastMCP 的禪道 Bug 管理 MCP 伺服器，相容禪道 12.x 舊版 JSON API（Session 認證），提供產品搜索、Bug 查詢、圖片查看和解決功能。

> Fork 自 [evlon/mcp-zentao-bugs](https://github.com/evlon/mcp-zentao-bugs)，原項目使用禪道 REST API v1（Token 認證）。本 fork 改為 Session API 以相容禪道 12.x 舊版，並新增伺服器端篩選、圖片查看、歷史記錄、多種解決方案等功能。

## 快速開始

### 方式一：npm 直接使用（推薦，無需 clone）

```json
// Claude Desktop / Cursor 配置文件
{
  "mcpServers": {
    "zentao-bugs": {
      "command": "npx",
      "args": ["-y", "mcp-zentao-bugs-v12@latest"],
      "env": {
        "ZENTAO_BASE_URL": "https://your-zentao.com/zentao",
        "ZENTAO_ACCOUNT": "your-username",
        "ZENTAO_PASSWORD": "your-password",
        "PORT": "3000"
      }
    }
  }
}
```

> **無需 .env 文件**：生產環境直接在客戶端配置中傳入環境變量即可。

### 方式二：本地開發

```bash
git clone https://github.com/pjpv/mcp-zentao-bugs.git
cd mcp-zentao-bugs
pnpm install
```

複製 `.env.example` 為 `.env` 並填入禪道連線資訊：

```env
ZENTAO_BASE_URL=https://your-zentao.com/zentao
ZENTAO_ACCOUNT=your-username
ZENTAO_PASSWORD=your-password
```

> `ZENTAO_BASE_URL` 應指向禪道入口目錄（如 `http://192.168.88.12/zentao`），而非 `api.php`。

啟動伺服器：

```bash
pnpm start
```

## 功能特性

- **Session 認證** — 使用禪道 12.x 舊版 Session API 登入，相容性更佳
- **伺服器端篩選** — 透過 `browseType` 直接在伺服器端篩選 Bug（指派給我、未關閉、由我建立……）
- **圖片查看** — 自動解析 Bug 步驟中的圖片引用，透過 `getFileImage` 抓取私有伺服器上的截圖
- **歷史記錄** — Bug 詳情包含操作日誌、備註、欄位變更等完整流轉記錄
- **多種解決方案** — 支援 14 種解決方案（代碼錯誤、設計如此、無法重現、延期……）
- **SSE 流式傳輸** — 透過 Server-Sent Events 即時推送日誌和結果
- **串行處理** — 單程序佇列處理，確保工具調用有序執行

## 工具列表

| 工具名 | 主要參數 | 描述 |
|--------|----------|------|
| `searchProducts` | `keyword?`, `limit?` | 搜索產品列表 |
| `getMyBug` | `productName`, `keyword?` | 取得指定產品中指派給我的一個 Bug 詳情（透過產品名稱） |
| `getMyBugs` | `productId`, `browseType?`, `keyword?`, `limit?` | 瀏覽 Bug 列表，支援多種伺服器端篩選 |
| `getNextBug` | `productId`, `keyword?` | 以 generator 模式取得下一個待處理的激活 Bug |
| `getBugDetail` | `bugId` | 取得 Bug 全欄位 + HTML 步驟 + 圖片 URL + 歷史記錄 |
| `getBugStats` | `productId`, `browseType?` | 取得 Bug 統計（總數及前幾筆預覽） |
| `markBugResolved` | `bugId`, `resolution?`, `comment?`, ... | 解決 Bug，支援多種解決方案及完整欄位 |
| `getFileImage` | `url` | 透過禪道 Session 抓取圖片，回傳 base64 |

### browseType 篩選類型

`getMyBugs` 和 `getBugStats` 支援以下 `browseType`（預設 `assigntome`）：

| 值 | 含義 |
|----|------|
| `assigntome` | 指派給我（預設） |
| `all` | 所有 Bug |
| `unclosed` | 未關閉 |
| `openedbyme` | 由我建立 |
| `resolvedbyme` | 由我解決 |
| `toclosed` | 待關閉 |
| `unresolved` | 未解決 |
| `unconfirmed` | 未確認 |
| `assigntonull` | 未指派 |
| `longlifebugs` | 久未處理 |
| `postponedbugs` | 被延期 |
| `overduebugs` | 過期 Bug |
| `needconfirm` | 需求變動 |

### resolution 解決方案

`markBugResolved` 支援以下 `resolution`（預設 `fixedcodeerror`）：

| 值 | 含義 |
|----|------|
| `fixedcodeerror` | 代碼欠缺或錯誤（預設） |
| `fixeddesigndefect` | 文檔設計缺失 |
| `fixeduierror` | UI 樣式問題 |
| `fixedwrongdata` | 早期錯誤數據 |
| `fixedsettingerror` | 設置錯誤或配置問題 |
| `fixedcognitiveerror` | 認知錯誤 |
| `fixednew` | 新需求 |
| `fixedbetteruse` | 優化 |
| `bydesign` | 設計如此 |
| `duplicate` | 重複 Bug（需提供 `duplicateBug`） |
| `external` | 外部原因 |
| `notrepro` | 無法重現 |
| `postponed` | 延期處理 |
| `willnotfix` | 不予解決 |

## 圖片查看流程

Bug 詳情中的 `stepsImages` 包含從步驟 HTML 提取的圖片 URL。這些圖片位於私有禪道伺服器，需透過 `getFileImage` 取得：

1. 呼叫 `getBugDetail(bugId)` → 取得 `stepsImages` 陣列
2. 對每個 URL 呼叫 `getFileImage(url)` → 回傳 base64 圖片
3. 使用截圖理解 Bug 重現步驟

## 典型工作流程

**1. 查看可用產品**
```
searchProducts({ keyword: "電商" })
```

**2. 取得我的 Bug 詳情**
```
getMyBug({ productName: "電商平台" })
```

**3. 查看 Bug 截圖**
```
getFileImage({ url: "http://host/zentao/file-read-39735.png" })
```

**4. 解決 Bug**
```
markBugResolved({ bugId: 123, resolution: "fixedcodeerror", comment: "已修復" })
```

**5. 繼續下一個**
```
getNextBug({ productId: 1 })
```

## MCP 客戶端配置

### Trae / Claude Code

```json
{
  "mcpServers": {
    "zentao-server": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

### Claude Desktop

```json
{
  "mcpServers": {
    "zentao-server": {
      "command": "node",
      "args": ["src/mcp-server.mjs"],
      "env": {
        "ZENTAO_BASE_URL": "https://your-zentao.com/zentao",
        "ZENTAO_ACCOUNT": "your-username",
        "ZENTAO_PASSWORD": "your-password",
        "PORT": "3000"
      }
    }
  }
}
```

## 開發

### 項目結構

```
├── src/
│   ├── mcp-server.mjs     # FastMCP 伺服器主檔案
│   ├── zentao-api.mjs     # 禪道 API 封裝模組（Session 認證）
│   └── server.mjs         # 原始 SSE 伺服器（備用）
├── scripts/               # 發佈和工具腳本
├── .env.example           # 環境變數範本
├── package.json
└── README.md
```

### 環境變數

| 變數名 | 必填 | 說明 |
|--------|------|------|
| `ZENTAO_BASE_URL` | 是 | 禪道入口目錄（如 `http://host/zentao`） |
| `ZENTAO_ACCOUNT` | 是 | 禪道登入帳號 |
| `ZENTAO_PASSWORD` | 是 | 禪道登入密碼 |
| `PORT` | 否 | 伺服器端口（預設 3000） |

### 腳本命令

```bash
pnpm install    # 安裝依賴
pnpm start      # 啟動伺服器
pnpm dev        # 開發模式（監聽檔案變化）
```

## API 端點

- **HTTP Streaming**: `http://localhost:3000/mcp`
- **SSE**: `http://localhost:3000/sse`
- **健康檢查**: `http://localhost:3000/health`

## 技術棧

- **FastMCP** — MCP 伺服器框架
- **Node.js 20+** — 執行環境
- **Zod** — 參數驗證
- **dotenv** — 環境變數管理

## 許可證

ISC License
