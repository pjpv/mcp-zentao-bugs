import { readFileSync, writeFileSync } from "node:fs";
const p = "d:/program-go/caiauser/scripts/zentao/zentao.mjs";
let s = readFileSync(p, "utf8");
if (!s.includes("from 'node:os'")) {
  s = s.replace(
    "import { ZenTaoAPI } from './lib/zentao-api.mjs';",
    "import { ZenTaoAPI } from './lib/zentao-api.mjs';\nimport { homedir } from 'node:os';"
  );
}
if (!s.includes("GLOBAL_ENV_PATH")) {
  s = s.replace(
    "const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));\nconst PROJECT_ROOT = resolve(SCRIPT_DIR, '../..');",
    "const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));\nconst PROJECT_ROOT = resolve(SCRIPT_DIR, '../..');\nconst GLOBAL_ENV_PATH = join(homedir(), '.zentao', '.env');"
  );
}
const old = "  loadEnvFile(join(SCRIPT_DIR, '.env'));\n  loadEnvFile(join(PROJECT_ROOT, '.env'));";
const neu = "  // priority: process.env > ~/.zentao/.env > scripts/zentao/.env > project .env\n  loadEnvFile(GLOBAL_ENV_PATH);\n  loadEnvFile(join(SCRIPT_DIR, '.env'));\n  loadEnvFile(join(PROJECT_ROOT, '.env'));";
if (s.includes(old)) s = s.replace(old, neu);
s = s.replaceAll("node scripts/zentao/zentao.mjs", "zentao");
// keep project path in one place of docs if needed - ok to prefer zentao
writeFileSync(p, s, "utf8");
console.log("project cli updated", {
  global: s.includes("GLOBAL_ENV_PATH"),
  os: s.includes("node:os"),
});