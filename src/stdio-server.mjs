#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

class ZenTaoAPI {
  constructor(baseUrl, account, password) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.account = account;
    this.password = password;
    this.sessionId = '';
    this.sessionName = 'zentaosid';
  }

  async login() {
    const sessionResp = await fetch(`${this.baseUrl}/api-getsessionid.json`);
    const sessionData = await sessionResp.json();
    const session = typeof sessionData.data === 'string' ? JSON.parse(sessionData.data) : sessionData.data;
    this.sessionId = session.sessionID;
    this.sessionName = session.sessionName || 'zentaosid';

    const loginResp = await fetch(`${this.baseUrl}/user-login.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `${this.sessionName}=${this.sessionId}`
      },
      body: `account=${encodeURIComponent(this.account)}&password=${encodeURIComponent(this.password)}&keepLogin=1`,
      redirect: 'manual'
    });

    if (loginResp.status !== 200) {
      const text = await loginResp.text();
      throw new Error(`Login failed: ${text}`);
    }

    return this.sessionId;
  }

  getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      'Cookie': `${this.sessionName}=${this.sessionId}`
    };
  }

  parseOldApiResponse(json) {
    if (json.status === 'success' && typeof json.data === 'string') {
      return JSON.parse(json.data);
    }
    if (json.status === 'success' && typeof json.data === 'object') {
      return json.data;
    }
    return json;
  }

  async fetchOldApi(path) {
    const resp = await fetch(`${this.baseUrl}/${path}`, {
      headers: this.getAuthHeaders()
    });
    if (!resp.ok) {
      throw new Error(`GET /${path} failed: ${resp.status}`);
    }
    const json = await resp.json();
    return this.parseOldApiResponse(json);
  }

  async searchProducts(keyword = '', limit = 20) {
    const data = await this.fetchOldApi('product-all.json');
    const productsMap = data.products || {};
    let list = Object.entries(productsMap).map(([id, name]) => ({
      id: Number(id),
      name
    }));

    if (keyword) {
      list = list.filter(p =>
        String(p.name || '').toLowerCase().includes(keyword.toLowerCase())
      );
    }

    return list.slice(0, limit);
  }

  async getBugDetail(bugId) {
    const data = await this.fetchOldApi(`bug-view-${bugId}.json`);
    const bug = data.bug || data;

    return {
      id: bug.id,
      title: bug.title,
      severity: bug.severity,
      status: bug.status,
      assignedTo: bug.assignedTo,
      openedBy: bug.openedBy,
      resolution: bug.resolution
    };
  }

  async browseBugs(productId, options = {}) {
    const { browseType = 'assigntome', limit = 20 } = options;
    const path = `bug-browse-${productId}-0-${browseType}-0-id_desc-0-${limit}-1.json`;
    const data = await this.fetchOldApi(path);
    return data.bugs || [];
  }

  async markBugResolved(bugId, options = {}) {
    const { resolution = 'fixedcodeerror', comment = '' } = options;
    const params = new URLSearchParams();
    params.set('resolution', resolution);
    if (comment) params.set('comment', comment);

    const resp = await fetch(`${this.baseUrl}/bug-resolve-${bugId}.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `${this.sessionName}=${this.sessionId}`
      },
      body: params.toString()
    });

    if (!resp.ok) {
      throw new Error(`POST /bug-resolve-${bugId}.json failed: ${resp.status}`);
    }

    return { success: true };
  }
}

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
        description: '瀏覽 Bug 列表',
        inputSchema: {
          type: 'object',
          properties: {
            productId: { type: 'number', description: '產品 ID' },
            browseType: { type: 'string', description: '篩選類型', default: 'assigntome' },
            limit: { type: 'number', description: '返回數量限制', default: 20 }
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

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    await zentaoAPI.login();

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

      case 'markBugResolved': {
        const result = await zentaoAPI.markBugResolved(args.bugId, args);
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
