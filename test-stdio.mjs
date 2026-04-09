#!/usr/bin/env node

// 測試 stdio 模式
import { spawn } from 'child_process';

const env = {
  ZENTAO_BASE_URL: 'http://192.168.88.12/zentao/',
  ZENTAO_ACCOUNT: 'gapen',
  ZENTAO_PASSWORD: 'gapen',
  PATH: process.env.PATH,
  USERPROFILE: process.env.USERPROFILE,
  // 不繼承其他環境變量，特別是 PORT
};

console.error('🧪 啟動 stdio 模式測試...');

const child = spawn('cmd', ['/c', 'npx', '-y', 'mcp-zentao-bugs-v12@latest'], {
  cwd: process.cwd(),
  env: env,
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
  console.log('[STDOUT]', data.toString());
});

child.stderr.on('data', (data) => {
  console.error('[STDERR]', data.toString());
});

child.on('close', (code) => {
  console.error(`\n🔴 進程退出，代碼: ${code}`);
});
