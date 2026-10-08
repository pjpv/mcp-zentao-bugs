import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ZenTaoAPI } from '../src/zentao-api.mjs';
import { assertExplicitComment } from '../src/cli.mjs';

const realFetch = global.fetch;

/**
 * 安裝按序消費的 mock fetch。
 * login() 依序消費前兩個回應（getsessionid / user-login），
 * editComment 的 POST 為第三個。
 */
function installMockFetch(responses) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    };
    calls.push(call);
    const response = responses[calls.length - 1];
    if (!response) {
      throw new Error(`未預期的第 ${calls.length} 個請求：${call.method} ${call.url}`);
    }
    const body = response.body ?? '';
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      headers: new Headers({ 'content-type': response.contentType ?? 'application/json' }),
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  return calls;
}

/** login 所需的前兩個 mock 回應 */
const LOGIN_RESPONSES = [
  {
    body: JSON.stringify({
      status: 'success',
      data: JSON.stringify({ sessionID: 'sid-1', sessionName: 'zentaosid' }),
    }),
  },
  { body: JSON.stringify({ status: 'success' }) },
];

async function createLoggedInApi() {
  const api = new ZenTaoAPI('http://zentao.example', 'user1', 'pass');
  await api.login();
  return api;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe('editComment 參數驗證', () => {
  it('actionId 非正整數時拋錯（字串 ID）', async () => {
    const api = new ZenTaoAPI('http://zentao.example', 'user1', 'pass');
    await assert.rejects(() => api.editComment('183350', 'x'), /actionId 必須為正整數/);
  });

  it('actionId 非正整數時拋錯（小數 / 零）', async () => {
    const api = new ZenTaoAPI('http://zentao.example', 'user1', 'pass');
    await assert.rejects(() => api.editComment(1.5, 'x'), /actionId 必須為正整數/);
    await assert.rejects(() => api.editComment(0, 'x'), /actionId 必須為正整數/);
  });

  it('comment 非字串時拋錯', async () => {
    const api = new ZenTaoAPI('http://zentao.example', 'user1', 'pass');
    await assert.rejects(() => api.editComment(183350, null), /comment 必須為字串/);
  });
});

describe('editComment CLI 來源守衛（assertExplicitComment）', () => {
  it('無任何 comment 來源時拒絕', async () => {
    assert.throws(() => assertExplicitComment({}), /必須顯式提供/);
  });

  it('--comment 無值（parseArgs 設 true）時拒絕，不得落入空字串清空', async () => {
    assert.throws(() => assertExplicitComment({ comment: true }), /必須顯式提供/);
  });

  it('--comment-file 無值（true）時拒絕', async () => {
    assert.throws(() => assertExplicitComment({ 'comment-file': true }), /必須顯式提供/);
    assert.throws(() => assertExplicitComment({ commentFile: true }), /必須顯式提供/);
  });

  it('--comment-file 無值時即使 --comment 有值也拒絕（來源不明確）', async () => {
    assert.throws(() => assertExplicitComment({ 'comment-file': true, comment: 'x' }), /必須顯式提供/);
  });

  it('顯式 --comment ""（空字串）放行，允許有意清空', async () => {
    assert.doesNotThrow(() => assertExplicitComment({ comment: '' }));
  });

  it('正常來源放行', async () => {
    assert.doesNotThrow(() => assertExplicitComment({ comment: '內容' }));
    assert.doesNotThrow(() => assertExplicitComment({ 'comment-file': 'C:/tmp/c.txt' }));
    assert.doesNotThrow(() => assertExplicitComment({ commentFile: 'C:/tmp/c.txt' }));
  });
});

describe('editComment 請求契約', () => {
  it('POST action-editComment-{id}.html，body 為 lastComment，帶 ajax 標頭與 session cookie', async () => {
    const calls = installMockFetch([
      ...LOGIN_RESPONSES,
      { body: JSON.stringify({ result: 'success', locate: 'reload' }) },
    ]);
    const api = await createLoggedInApi();

    const comment = '【狀態】已確認\nCommit: 16e615cf';
    const result = await api.editComment(183350, comment);

    assert.deepEqual(result, { success: true });

    const editCall = calls[2];
    assert.equal(editCall.method, 'POST');
    assert.equal(editCall.url, 'http://zentao.example/action-editComment-183350.html');
    assert.equal(editCall.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(editCall.headers['Cookie'], 'zentaosid=sid-1');
    // 鎖定表單欄位集合：僅 lastComment（uid 經查禪道源碼不被消費，刻意省略）
    assert.deepEqual([...new URLSearchParams(editCall.body).keys()], ['lastComment']);
    assert.equal(new URLSearchParams(editCall.body).get('lastComment'), comment);
  });

  it('禪道回 result=fail 時拋錯並帶出 message', async () => {
    installMockFetch([
      ...LOGIN_RESPONSES,
      { body: JSON.stringify({ result: 'fail', message: { lastComment: ['備註不能為空'] } }) },
    ]);
    const api = await createLoggedInApi();

    await assert.rejects(
      () => api.editComment(183350, 'x'),
      /編輯備註失敗（action 183350）：.*備註不能為空/
    );
  });

  it('禪道回 HTML 重導（parent.location）時視為成功', async () => {
    installMockFetch([
      ...LOGIN_RESPONSES,
      { contentType: 'text/html', body: `<html><script>parent.location='/zentao/bug-view-1.html'</script></html>` },
    ]);
    const api = await createLoggedInApi();

    const result = await api.editComment(183350, '內容');
    assert.deepEqual(result, { success: true });
  });
});
