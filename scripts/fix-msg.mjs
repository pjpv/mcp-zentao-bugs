import { readFileSync, writeFileSync } from "node:fs";
const p = "d:/program-ai/mcp-zentao-bugs/src/cli.mjs";
let s = readFileSync(p, "utf8");
const a = "請複製 scripts/zentao/.env.example 為 scripts/zentao/.env 並填入帳密，";
const b = "或在呼叫前設定環境變數。";
const i = s.indexOf(a);
if (i < 0) {
  console.log("no marker");
  process.exit(0);
}
const j = s.indexOf(b, i);
if (j < 0) {
  console.log("no end");
  process.exit(1);
}
const replacement = "請建立全域設定檔：${GLOBAL_ENV_PATH}\\n` +\n        `需含 ZENTAO_BASE_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD";
s = s.slice(0, i) + replacement + s.slice(j + b.length);
writeFileSync(p, s, "utf8");
console.log("fixed");