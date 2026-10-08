import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("d:/program-go/caiauser/scripts/zentao/zentao.mjs", "utf8");
let out = src;

out = out.replace(
  "import { ZenTaoAPI } from './lib/zentao-api.mjs';",
  "import { ZenTaoAPI } from './zentao-api.mjs';\nimport { homedir } from 'node:os';"
);

out = out.replace(
  "const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));\nconst PROJECT_ROOT = resolve(SCRIPT_DIR, '../..');",
  "const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));\nconst PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');\nconst GLOBAL_CONFIG_DIR = join(homedir(), '.zentao');\nconst GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, '.env');"
);

out = out.replace(
  "  loadEnvFile(join(SCRIPT_DIR, '.env'));\n  loadEnvFile(join(PROJECT_ROOT, '.env'));",
  "  // low -> high priority (existing keys not overwritten)\n  loadEnvFile(join(PACKAGE_ROOT, '.env'));\n  loadEnvFile(join(process.cwd(), '.env'));\n  loadEnvFile(join(process.cwd(), 'scripts', 'zentao', '.env'));\n  loadEnvFile(GLOBAL_ENV_PATH);"
);

out = out.replace(
  "`請複製 scripts/zentao/.env.example 為 scripts/zentao/.env 並填入帳密，\n` +\n        `或在呼叫前設定環境變數。`",
  "`請建立全域設定檔：${GLOBAL_ENV_PATH}\n` +\n        `內容需含 ZENTAO_BASE_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD`"
);

out = out.replace("Cursor 無法調用 MCP 時的替代方案", "Cursor 無法調用 MCP 時的全域替代方案");
out = out.replaceAll("node scripts/zentao/zentao.mjs", "zentao");
out = out.replace(
  " *   2. scripts/zentao/.env\n *   3. 專案根 .env（若含上述鍵）",
  " *   2. 全域 ~/.zentao/.env\n *   3. 專案 scripts/zentao/.env\n *   4. 當前目錄/.env\n *   5. 套件 .env"
);

writeFileSync("d:/program-ai/mcp-zentao-bugs/src/cli.mjs", out, "utf8");
console.log("ok", out.length);
console.log("checks", {
  os: out.includes("node:os"),
  global: out.includes("GLOBAL_ENV_PATH"),
  api: out.includes("./zentao-api.mjs"),
  zentaoCmd: out.includes("zentao getBugDetail"),
});