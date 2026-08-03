#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { ZenTaoAPI } from './zentao-api.mjs';

// Create MCP server
const server = new Server(
  {
    name: 'zentao-bugs',
    version: '0.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'searchProducts',
        description: '搜索禪道產品列表',
        inputSchema: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '產品名稱關鍵詞' },
            limit: { type: 'number', description: '返回數量限制', default: 20 }
          }
        }
      },
      {
        name: 'getBugDetail',
        description: '獲取 Bug 詳情',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' }
          },
          required: ['bugId']
        }
      },
      {
        name: 'browseBugs',
        description: '瀏覽 Bug 列表（精簡模式，回傳 id/title/severity/status/assignedTo，不含 steps HTML）。需要 steps 請用 getBugDetail。hasMore=true 時可用 offset 翻頁。',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'number', description: '產品 ID' },
            browseType: { type: 'string', description: '篩選類型', default: 'assigntome' },
            moduleId: { type: 'number', description: '模塊 ID，限定 Bug 範圍至該模塊（父子模塊自動遞迴）。assigntome + moduleId 時走 byModule 並客戶端過濾指派人' },
            keyword: { type: 'string', description: 'BUG 標題關鍵詞搜索（客戶端過濾）' },
            limit: { type: 'number', description: '返回數量限制', default: 20 },
            offset: { type: 'number', description: '跳過前 N 條，用於翻頁。hasMore=true 時下次傳 offset + 本次 count 取下一頁', default: 0 }
          },
          required: ['productId']
        }
      },
      {
        name: 'getModules',
        description: '獲取產品的模塊列表（Bug 分類）。模塊 ID 用於 browseBugs 的 moduleId 參數',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'number', description: '產品 ID' }
          },
          required: ['productId']
        }
      },
      {
        name: 'markBugResolved',
        description: '標記 Bug 為已解決',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
            resolution: { type: 'string', description: '解決方案', default: 'fixedcodeerror' },
            comment: { type: 'string', description: '備註說明' }
          },
          required: ['bugId']
        }
      },
      {
        name: 'confirmBug',
        description: '確認 Bug（confirmed 置為 1，但不標記已解決）',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
            assignedTo: { type: 'string', description: '確認後指派給（用戶帳號）' },
            type: { type: 'string', description: 'Bug 類型' },
            pri: { type: 'number', description: '優先級' },
            comment: { type: 'string', description: '備註說明' },
            mailto: { type: 'array', items: { type: 'string' }, description: '抄送帳號陣列' }
          },
          required: ['bugId']
        }
      },
      {
        name: 'assignBug',
        description: '轉交 Bug（指派給另一人接手，不變更解決狀態）',
        inputSchema: {
          type: 'object',
          properties: {
            bugId: { type: 'number', description: 'Bug ID' },
            assignedTo: { type: 'string', description: '轉交目標帳號' },
            comment: { type: 'string', description: '交接備註' },
            mailto: { type: 'array', items: { type: 'string' }, description: '抄送帳號陣列' }
          },
          required: ['bugId', 'assignedTo']
        }
      }
    ]
  };
});

// Initialize API
const BASE_URL = process.env.ZENTAO_BASE_URL;
const ACCOUNT = process.env.ZENTAO_ACCOUNT;
const PASSWORD = process.env.ZENTAO_PASSWORD;

if (!BASE_URL || !ACCOUNT || !PASSWORD) {
  console.error('錯誤：缺少環境變量 ZENTAO_BASE_URL, ZENTAO_ACCOUNT, ZENTAO_PASSWORD');
  process.exit(1);
}

const zentaoAPI = new ZenTaoAPI(BASE_URL, ACCOUNT, PASSWORD);

// 啟動時登入一次，之後靠 _requestWithRelogin 自動處理過期
await zentaoAPI.login().catch(err => {
  console.error('Fatal: login failed:', err?.message || err);
  process.exit(1);
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'searchProducts': {
        const result = await zentaoAPI.searchProducts(args?.keyword, args?.limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'getBugDetail': {
        const result = await zentaoAPI.getBugDetail(args.bugId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'browseBugs': {
        const result = await zentaoAPI.browseBugs(args.productId, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'getModules': {
        const result = await zentaoAPI.getModules(args.productId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'markBugResolved': {
        const result = await zentaoAPI.markBugResolved(args.bugId, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'confirmBug': {
        const result = await zentaoAPI.confirmBug(args.bugId, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      case 'assignBug': {
        const result = await zentaoAPI.assignBug(args.bugId, args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('禪道 MCP 服務器已啟動 (stdio 模式)');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
