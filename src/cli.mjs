#!/usr/bin/env node
/**
 * 禪道 Bug CLI —— Cursor 無法調用 MCP 時的全域替代方案
 *
 * 對齊 mcp-zentao-bugs-v12 工具：
 *   getBugDetail / browseBugs / searchProducts / getModules
 *   markBugResolved / confirmBug / assignBug / editComment / getFileImage
 *
 * 用法：
 *   zentao <command> [args] [options]
 *   zentao getBugDetail 12345
 *   zentao help
 *
 * 認證（優先順序）：
 *   1. 環境變數 ZENTAO_BASE_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD
 *   2. 全域 ~/.zentao/.env
 *   3. 專案 scripts/zentao/.env
 *   4. 當前目錄/.env
 *   5. 套件 .env
 *
 * 輸出：成功結果 JSON 寫入 stdout；日誌/錯誤寫入 stderr。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ZenTaoAPI } from './zentao-api.mjs';
import { homedir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const GLOBAL_CONFIG_DIR = join(homedir(), '.zentao');
const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, '.env');

function stripQuotes(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = stripQuotes(line.slice(equalsIndex + 1));
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadConfig() {
  // only set missing keys; load higher-priority files first so they win
  // priority: process.env > ~/.zentao/.env > cwd/scripts/zentao/.env > cwd/.env > package/.env
  loadEnvFile(GLOBAL_ENV_PATH);
  loadEnvFile(join(process.cwd(), 'scripts', 'zentao', '.env'));
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(PACKAGE_ROOT, '.env'));

  const baseUrl = process.env.ZENTAO_BASE_URL || '';
  const account = process.env.ZENTAO_ACCOUNT || '';
  const password = process.env.ZENTAO_PASSWORD || '';

  if (!baseUrl || !account || !password) {
    const missing = [];
    if (!baseUrl) missing.push('ZENTAO_BASE_URL');
    if (!account) missing.push('ZENTAO_ACCOUNT');
    if (!password) missing.push('ZENTAO_PASSWORD');
    throw new Error(
      `缺少認證設定：${missing.join(', ')}\n` +
        `請建立全域設定檔：${GLOBAL_ENV_PATH}\n` +
        `需含 ZENTAO_BASE_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD`
    );
  }

  return { baseUrl, account, password };
}

/**
 * 解析簡易 CLI 參數。
 * 支援：--key value / --key=value / --flag / 位置參數
 */
function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const withoutPrefix = token.slice(2);
      const equalsIndex = withoutPrefix.indexOf('=');
      if (equalsIndex >= 0) {
        const key = withoutPrefix.slice(0, equalsIndex);
        options[key] = withoutPrefix.slice(equalsIndex + 1);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[withoutPrefix] = next;
        index += 1;
      } else {
        options[withoutPrefix] = true;
      }
      continue;
    }
    positionals.push(token);
  }

  return { positionals, options };
}

function toNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} 必須為數字，收到：${value}`);
  }
  return numberValue;
}

function toOptionalString(value) {
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

/**
 * 去除 UTF-8 BOM（PowerShell Set-Content / Out-File 常見）。
 * @param {string} text
 */
function stripBom(text) {
  return String(text).replace(/^\uFEFF/, '');
}

/**
 * 從 stdin 讀取完整文字（用於 --comment - / --comment-file -）。
 * TTY 下直接失敗，避免 Agent 卡死。
 */
async function readStdinText() {
  if (process.stdin.isTTY) {
    throw new Error(
      '使用 --comment - 或 --comment-file - 時，必須以管線傳入內容（目前 stdin 是 TTY）'
    );
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return stripBom(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 解析 comment 來源，解決 Windows/PowerShell 多行 --comment 易被截斷的問題。
 *
 * 優先序：
 *   1. --comment-file <path>  （或 --commentFile）
 *   2. --comment <text>
 *   3. 空字串
 *
 * 特殊值：
 *   --comment-file -  或  --comment -  → 從 stdin 讀取
 *
 * 長備註／多行備註在 Windows 上應優先使用 --comment-file。
 *
 * @param {Record<string, unknown>} options
 * @returns {Promise<string>}
 */
export async function resolveComment(options = {}) {
  const commentFileRaw =
    toOptionalString(options['comment-file']) ?? toOptionalString(options.commentFile);
  const commentInline = toOptionalString(options.comment);

  if (commentFileRaw !== undefined && commentInline !== undefined) {
    throw new Error('不可同時使用 --comment 與 --comment-file');
  }

  if (commentFileRaw !== undefined) {
    if (commentFileRaw === '-') {
      return await readStdinText();
    }
    const absolutePath = isAbsolute(commentFileRaw)
      ? commentFileRaw
      : resolve(process.cwd(), commentFileRaw);
    if (!existsSync(absolutePath)) {
      throw new Error(`comment 檔案不存在：${absolutePath}`);
    }
    return stripBom(readFileSync(absolutePath, 'utf8'));
  }

  if (commentInline !== undefined) {
    if (commentInline === '-') {
      return await readStdinText();
    }
    return commentInline;
  }

  return '';
}

/**
 * 產出 comment 摘要，方便 Agent 自檢是否寫入完整（避免再被 shell 截斷）。
 * @param {string} comment
 */
export function buildCommentMeta(comment) {
  const text = comment ?? '';
  if (!text) {
    return { length: 0, lines: 0, preview: '' };
  }
  const lines = text.split(/\r?\n/).length;
  const maxPreview = 160;
  const preview =
    text.length <= maxPreview ? text : `${text.slice(0, maxPreview)}…`;
  return { length: text.length, lines, preview };
}

function splitCsv(value) {
  if (value === undefined || value === null || value === true || value === '') return undefined;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printError(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}

const HELP_TEXT = `
禪道 Bug CLI（MCP 替代腳本）

用法：
  zentao <command> [args] [options]

命令：
  getBugDetail <bugId>
      取得 Bug 完整詳情（含 steps / stepsImages / actions）

  browseBugs --productId <id> [options]
      瀏覽精簡 Bug 列表（不含 steps）
      選項：
        --browseType <type>   預設 assigntome
        --moduleId <id>       模塊 ID
        --keyword <text>      標題關鍵詞
        --limit <n>           預設 20
        --offset <n>          預設 0

  searchProducts [--keyword <text>] [--limit <n>]
  getModules --productId <id>
  markBugResolved <bugId> [--resolution fixedcodeerror] [--comment text | --comment-file path]
  confirmBug <bugId> [--comment text | --comment-file path] [--assignedTo user]
  assignBug <bugId> --assignedTo <user> [--comment text | --comment-file path]
  editComment <actionId> --comment text | --comment-file path
      編輯歷史備註（全量覆蓋）。actionId 為 getBugDetail 回傳之 actions[].id（非 Bug ID）
  getFileImage <url> [--out path]
  help

備註（comment）注意：
  Windows / PowerShell 下，多行 --comment 容易被 shell 截成第一行。
  長備註請用檔案：
    zentao confirmBug 12346 --comment-file %TEMP%\\bug-12346-comment.txt
  或從 stdin：
    type comment.txt | zentao confirmBug 12346 --comment -
  成功時 stdout 會附 comment.length / comment.lines / comment.preview 供自檢。

認證：
  scripts/zentao/.env 或環境變數
    ZENTAO_BASE_URL / ZENTAO_ACCOUNT / ZENTAO_PASSWORD

Cursor Agent 範例：
  zentao getBugDetail 12345
  zentao browseBugs --productId 77 --browseType assigntome
  zentao confirmBug 12345 --comment-file %TEMP%\\bug-12345-comment.txt
`.trim();

async function createClient() {
  const { baseUrl, account, password } = loadConfig();
  const client = new ZenTaoAPI(baseUrl, account, password);
  await client.login();
  return client;
}

async function commandGetBugDetail(positionals) {
  const bugId = toNumber(positionals[0], 'bugId');
  if (bugId === undefined) throw new Error('用法：getBugDetail <bugId>');
  const client = await createClient();
  return client.getBugDetail(bugId);
}

async function commandBrowseBugs(options) {
  const productId = toNumber(options.productId, 'productId');
  if (productId === undefined) throw new Error('用法：browseBugs --productId <id>');
  const client = await createClient();
  return client.browseBugs(productId, {
    browseType: toOptionalString(options.browseType) || 'assigntome',
    moduleId: toNumber(options.moduleId, 'moduleId'),
    keyword: toOptionalString(options.keyword) || '',
    limit: toNumber(options.limit, 'limit') ?? 20,
    offset: toNumber(options.offset, 'offset') ?? 0,
  });
}

async function commandSearchProducts(options) {
  const client = await createClient();
  const products = await client.searchProducts(
    toOptionalString(options.keyword) || '',
    toNumber(options.limit, 'limit') ?? 20
  );
  return {
    products,
    count: products.length,
    keyword: toOptionalString(options.keyword) || '',
  };
}

async function commandGetModules(options) {
  const productId = toNumber(options.productId, 'productId');
  if (productId === undefined) throw new Error('用法：getModules --productId <id>');
  const client = await createClient();
  const modules = await client.getModules(productId);
  return { productId, modules, count: modules.length };
}

async function commandMarkBugResolved(positionals, options) {
  const bugId = toNumber(positionals[0], 'bugId');
  if (bugId === undefined) {
    throw new Error(
      '用法：markBugResolved <bugId> [--resolution ...] [--comment text | --comment-file path]'
    );
  }
  const comment = await resolveComment(options);
  const client = await createClient();
  const result = await client.markBugResolved(bugId, {
    resolution: toOptionalString(options.resolution) || 'fixedcodeerror',
    comment,
    resolvedBuild: toOptionalString(options.resolvedBuild) || 'trunk',
    resolvedDate: toOptionalString(options.resolvedDate) || '',
    assignedTo: toOptionalString(options.assignedTo) || '',
    duplicateBug: toNumber(options.duplicateBug, 'duplicateBug'),
  });
  return { bugId, result, comment: buildCommentMeta(comment) };
}

async function commandConfirmBug(positionals, options) {
  const bugId = toNumber(positionals[0], 'bugId');
  if (bugId === undefined) {
    throw new Error('用法：confirmBug <bugId> [--comment text | --comment-file path]');
  }
  const comment = await resolveComment(options);
  const client = await createClient();
  const result = await client.confirmBug(bugId, {
    assignedTo: toOptionalString(options.assignedTo) || '',
    type: toOptionalString(options.type) || '',
    pri: toNumber(options.pri, 'pri'),
    comment,
    mailto: splitCsv(options.mailto) || [],
  });
  return { bugId, result, comment: buildCommentMeta(comment) };
}

async function commandAssignBug(positionals, options) {
  const bugId = toNumber(positionals[0], 'bugId');
  const assignedTo = toOptionalString(options.assignedTo);
  if (bugId === undefined || !assignedTo) {
    throw new Error(
      '用法：assignBug <bugId> --assignedTo <user> [--comment text | --comment-file path]'
    );
  }
  const comment = await resolveComment(options);
  const client = await createClient();
  const result = await client.assignBug(bugId, {
    assignedTo,
    comment,
    mailto: splitCsv(options.mailto) || [],
  });
  return { bugId, assignedTo, result, comment: buildCommentMeta(comment) };
}

/**
 * 編輯備註的來源守衛：要求 --comment / --comment-file 帶有明確值。
 *
 * parseArgs 對無值 flag 設 true（如 `--comment` 後緊接另一 flag 或結尾），
 * 而 resolveComment 會把 true 視為未提供並回空字串——編輯是全量覆蓋，
 * 此組合會靜默清空備註，故須在送出前攔截。顯式 `--comment ""` 可清空。
 *
 * @param {Record<string, unknown>} options
 */
export function assertExplicitComment(options) {
  const commentSource =
    options['comment-file'] ?? options.commentFile ?? options.comment;
  if (commentSource === undefined || commentSource === true) {
    throw new Error(
      'editComment 必須顯式提供 --comment <text> 或 --comment-file <path> 的值（清空備註請傳空字串 --comment ""）'
    );
  }
}

async function commandEditComment(positionals, options) {
  const actionId = toNumber(positionals[0], 'actionId');
  if (actionId === undefined) {
    throw new Error('用法：editComment <actionId> --comment <text> | --comment-file <path>');
  }
  assertExplicitComment(options);
  const comment = await resolveComment(options);
  const client = await createClient();
  const result = await client.editComment(actionId, comment);
  return { actionId, result, comment: buildCommentMeta(comment) };
}

async function commandGetFileImage(positionals, options) {
  const url = positionals[0];
  if (!url) throw new Error('用法：getFileImage <url> [--out <path>]');
  const client = await createClient();
  const { buffer, mimeType } = await client.fetchFile(url);
  const outPath = toOptionalString(options.out);

  if (outPath) {
    const absolutePath = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, buffer);
    return {
      path: absolutePath,
      mimeType,
      bytes: buffer.length,
      url,
    };
  }

  return {
    mimeType,
    bytes: buffer.length,
    base64: buffer.toString('base64'),
    url,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  const command = argv[0];
  const { positionals, options } = parseArgs(argv.slice(1));

  let result;
  switch (command) {
    case 'getBugDetail':
      result = await commandGetBugDetail(positionals);
      break;
    case 'browseBugs':
    case 'getMyBugs':
      result = await commandBrowseBugs(options);
      break;
    case 'searchProducts':
      result = await commandSearchProducts(options);
      break;
    case 'getModules':
      result = await commandGetModules(options);
      break;
    case 'markBugResolved':
      result = await commandMarkBugResolved(positionals, options);
      break;
    case 'confirmBug':
      result = await commandConfirmBug(positionals, options);
      break;
    case 'assignBug':
      result = await commandAssignBug(positionals, options);
      break;
    case 'editComment':
      result = await commandEditComment(positionals, options);
      break;
    case 'getFileImage':
      result = await commandGetFileImage(positionals, options);
      break;
    default:
      throw new Error(`未知命令：${command}\n\n${HELP_TEXT}`);
  }

  printJson(result);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    printError(error);
    process.exit(1);
  });
}
