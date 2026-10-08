import { readFileSync, writeFileSync } from "node:fs";
const p = "d:/program-ai/mcp-zentao-bugs/src/cli.mjs";
let s = readFileSync(p, "utf8");
const oldBlock = `  // low -> high priority (existing keys not overwritten)
  loadEnvFile(join(PACKAGE_ROOT, '.env'));
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(process.cwd(), 'scripts', 'zentao', '.env'));
  loadEnvFile(GLOBAL_ENV_PATH);`;
const newBlock = `  // only set missing keys; load higher-priority files first so they win
  // priority: process.env > ~/.zentao/.env > cwd/scripts/zentao/.env > cwd/.env > package/.env
  loadEnvFile(GLOBAL_ENV_PATH);
  loadEnvFile(join(process.cwd(), 'scripts', 'zentao', '.env'));
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(PACKAGE_ROOT, '.env'));`;
if (!s.includes(oldBlock)) {
  console.error("block not found");
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);
writeFileSync(p, s, "utf8");
console.log("priority fixed");