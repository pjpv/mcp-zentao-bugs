#!/usr/bin/env node

// 禪道 MCP 服務器啟動腳本
// 檢查端口是否被佔用，如果沒有則啟動服務器

import { spawn } from 'child_process';
import { createConnection } from 'net';

const PORT = 3000;

// 檢查端口是否被佔用
function isPortInUse(port) {
  return new Promise((resolve) => {
    const conn = createConnection({ port });
    conn.on('connect', () => {
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => resolve(false));
  });
}

async function startServer() {
  const inUse = await isPortInUse(PORT);

  if (inUse) {
    console.error(`✅ 禪道 MCP 服務器已在運行 (端口 ${PORT})`);
    return;
  }

  console.error(`🚀 啟動禪道 MCP 服務器 (端口 ${PORT})...`);

  const env = {
    ...process.env,
    ZENTAO_BASE_URL: process.env.ZENTAO_BASE_URL || 'http://192.168.88.12/zentao/',
    ZENTAO_ACCOUNT: process.env.ZENTAO_ACCOUNT || 'gapen',
    ZENTAO_PASSWORD: process.env.ZENTAO_PASSWORD || 'gapen',
  };

  const child = spawn('npm', ['exec', '-y', 'mcp-zentao-bugs-v12@latest'], {
    env,
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  // 等待一會確保服務器啟動
  await new Promise(r => setTimeout(r, 2000));

  console.error(`✅ 禪道 MCP 服務器已啟動 (端口 ${PORT})`);
}

startServer().catch(err => {
  console.error(`❌ 啟動失敗:`, err.message);
});
