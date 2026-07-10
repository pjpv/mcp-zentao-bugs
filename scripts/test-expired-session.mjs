/**
 * 手動整合測試：驗證 ZenTao session 過期行為
 *
 * 使用方式：node scripts/test-expired-session.mjs
 * 前提：需可連線的真實 ZenTao server（.env 中的 ZENTAO_BASE_URL）
 * 不包含在 npm test 中（CI 環境無法連線）
 *
 * 測試場景：
 *   A. 完全無效的 cookie（隨機字串）
 *   B. 正常登錄後立即請求（對照組）
 *   C. 正常登錄取得 cookie 後，篡改 cookie 再請求
 *   D. 完全沒有 Cookie header
 */
import 'dotenv/config';

const baseUrl = process.env.ZENTAO_BASE_URL.replace(/\/$/, '');
const account = process.env.ZENTAO_ACCOUNT;
const password = process.env.ZENTAO_PASSWORD;
const testPath = 'product-all.json';

async function probe(label, cookieHeader) {
  console.log(`\n===== ${label} =====`);
  const resp = await fetch(`${baseUrl}/${testPath}`, {
    headers: { 'Cookie': cookieHeader }
  });
  console.log(`HTTP status:   ${resp.status}`);
  console.log(`Content-Type:  ${resp.headers.get('content-type')}`);
  console.log(`Location:      ${resp.headers.get('location') || '(none)'}`);
  const text = await resp.text();
  console.log(`Body length:   ${text.length}`);
  console.log(`Body head:     ${text.slice(0, 500)}`);
  // 嘗試解析 JSON
  try {
    const json = JSON.parse(text);
    console.log(`JSON parsed:   status=${json.status}, hasData=${'data' in json}`);
    if (json.status === 'failed') console.log(`  reason: ${json.reason}`);
  } catch {
    console.log(`JSON parsed:   FAILED (not JSON)`);
  }
}

async function getSession() {
  const r = await fetch(`${baseUrl}/api-getsessionid.json`);
  const d = await r.json();
  const s = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
  return s;
}

async function login(sessionName, sessionId) {
  const r = await fetch(`${baseUrl}/user-login.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `${sessionName}=${sessionId}`
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}&keepLogin=1`,
    redirect: 'manual'
  });
  return r.text();
}

console.log('Base URL:', baseUrl);

// 場景 A：完全無效的 cookie
await probe('A. 無效 cookie（random=invalid）', 'zentaosid=INVALID_SESSION_12345');

// 場景 B：對照組 — 正常登錄
const session = await getSession();
console.log('\n[Login] sessionName=%s, sessionId=%s', session.sessionName, session.sessionID);
const loginText = await login(session.sessionName || 'zentaosid', session.sessionID);
console.log('[Login] response head:', loginText.slice(0, 200));
await probe('B. 正常 cookie（對照組）', `${session.sessionName}=${session.sessionID}`);

// 場景 C：正確的 sessionName 但篡改 sessionId（模擬過期）
await probe('C. 篡改 sessionId（模擬過期）', `${session.sessionName}=${session.sessionID.slice(0, 8)}_EXPIRED`);

// 場景 D：完全沒有 Cookie header
await probe('D. 無 Cookie header', '');

console.log('\n===== 測試完成 =====');
