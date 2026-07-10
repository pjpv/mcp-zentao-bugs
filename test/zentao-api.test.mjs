import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ZenTaoAPI } from '../src/zentao-api.mjs';

describe('isSessionExpired', () => {
  const api = new ZenTaoAPI('http://localhost', 'user', 'pass');

  it('偵測到過期重導 HTML（含 user-login）', () => {
    const resp = { headers: { get: (k) => k === 'content-type' ? 'text/html; charset=UTF-8' : null } };
    const text = `<script>self.location='/zentao/user-login-L3plbnRhby9wcm9kdWN0LWFsbC5qc29u.json';</script>`;
    assert.equal(api.isSessionExpired(resp, text), true);
  });

  it('正常 JSON 回應不誤判', () => {
    const resp = { headers: { get: (k) => k === 'content-type' ? 'text/html; charset=UTF-8' : null } };
    const text = `{"status":"success","data":"{\\"title\\":\\"test\\"}"}`;
    assert.equal(api.isSessionExpired(resp, text), false);
  });

  it('bug-resolve 成功的 HTML 重導不誤判（parent.location 非 user-login）', () => {
    const resp = { headers: { get: (k) => k === 'content-type' ? 'text/html; charset=UTF-8' : null } };
    const text = `<html><script>parent.location='/zentao/bug-view-123.html'</script></html>`;
    assert.equal(api.isSessionExpired(resp, text), false);
  });

  it('Content-Type 非 text/html 不誤判', () => {
    const resp = { headers: { get: (k) => k === 'content-type' ? 'application/json' : null } };
    const text = `{"error":"something"}`;
    assert.equal(api.isSessionExpired(resp, text), false);
  });
});

describe('_requestWithRelogin', () => {
  // 製造假 resp 物件
  function fakeResp(ct, ok = true, status = 200) {
    return {
      ok,
      status,
      headers: { get: (k) => k === 'content-type' ? ct : null }
    };
  }

  it('正常回應直接回傳，不重登', async () => {
    const api = new ZenTaoAPI('http://localhost', 'user', 'pass');
    api.login = mock.fn(); // 攔截，不應被呼叫

    const fetchFn = async () => ({
      resp: fakeResp('application/json'),
      text: '{"status":"success","data":"{}"}'
    });
    const parseFn = (fr) => JSON.parse(fr.text);

    const result = await api._requestWithRelogin('product-all.json', fetchFn, parseFn);
    assert.deepEqual(result, { status: 'success', data: '{}' });
    assert.equal(api.login.mock.callCount(), 0);
  });

  it('過期回應觸發重登後重試成功', async () => {
    const api = new ZenTaoAPI('http://localhost', 'user', 'pass');
    api.login = mock.fn(async () => 'new-session-id');

    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      if (callCount === 1) {
        // 第一次：過期
        return {
          resp: fakeResp('text/html'),
          text: `<script>self.location='/user-login-xxx.json';</script>`
        };
      }
      // 第二次：正常
      return {
        resp: fakeResp('application/json'),
        text: '{"result":"ok"}'
      };
    };
    const parseFn = (fr) => JSON.parse(fr.text);

    const result = await api._requestWithRelogin('bug-view-1.json', fetchFn, parseFn);
    assert.deepEqual(result, { result: 'ok' });
    assert.equal(api.login.mock.callCount(), 1);   // 重登了一次
    assert.equal(callCount, 2);                     // 請求發了兩次
  });

  it('重登後仍過期則拋錯', async () => {
    const api = new ZenTaoAPI('http://localhost', 'user', 'pass');
    api.login = mock.fn(async () => 'new-session-id');

    const expiredText = `<script>self.location='/user-login-xxx.json';</script>`;
    const fetchFn = async () => ({
      resp: fakeResp('text/html'),
      text: expiredText
    });
    const parseFn = (fr) => fr.text;

    await assert.rejects(
      () => api._requestWithRelogin('bug-view-1.json', fetchFn, parseFn),
      /Session expired after re-login on \/bug-view-1\.json — check credentials/
    );
    assert.equal(api.login.mock.callCount(), 1);
  });

  it('HTTP 非 2xx 直接拋錯，不嘗試重登', async () => {
    const api = new ZenTaoAPI('http://localhost', 'user', 'pass');
    api.login = mock.fn();

    const fetchFn = async () => ({
      resp: fakeResp('text/html', false, 500),
      text: 'Internal Server Error'
    });
    const parseFn = (fr) => fr.text;

    await assert.rejects(
      () => api._requestWithRelogin('bug-view-1.json', fetchFn, parseFn),
      /\/bug-view-1\.json failed: 500/
    );
    assert.equal(api.login.mock.callCount(), 0);
  });

  it('parseFn 接收完整 fetchResult（含額外欄位）', async () => {
    const api = new ZenTaoAPI('http://localhost', 'user', 'pass');
    api.login = mock.fn();

    // 模擬 fetchFile 場景：fetchResult 帶 arrayBuffer
    const fetchFn = async () => ({
      resp: fakeResp('image/png'),
      text: '',
      arrayBuffer: new ArrayBuffer(4),
      ct: 'image/png'
    });
    const parseFn = (fr) => ({ mimeType: fr.ct, size: fr.arrayBuffer.byteLength });

    const result = await api._requestWithRelogin('file-read-1.png', fetchFn, parseFn);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.size, 4);
  });
});

describe('fetchOldApi with relogin', () => {
  it('session 過期時自動重登並重發 GET 請求', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'user', 'pass');
    api.login = mock.fn(async () => 'new-session');

    // mock global fetch
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      callCount++;
      if (callCount === 1) {
        // 模擬過期
        return {
          ok: true,
          status: 200,
          headers: { get: (k) => k === 'content-type' ? 'text/html' : null },
          text: async () => `<script>self.location='/user-login-x.json';</script>`
        };
      }
      // 第二次正常
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
        text: async () => '{"status":"success","data":"{\\"id\\":1}"}'
      };
    };

    try {
      const result = await api.fetchOldApi('product-all.json');
      assert.equal(api.login.mock.callCount(), 1);
      assert.equal(result.id, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('postOldApi with relogin', () => {
  it('bug-resolve 成功的 HTML 重導（parent.location）正確解析為 success', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'user', 'pass');
    api.login = mock.fn();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => ({
      ok: true,
      status: 200,
      headers: { get: (k) => k === 'content-type' ? 'text/html' : null },
      text: async () => `<html><script>parent.location='/zentao/bug-view-123.html'</script></html>`
    });

    try {
      const result = await api.postOldApi('bug-resolve-123.json', 'resolution=fixed');
      assert.equal(result.success, true);
      assert.equal(result.redirect, '/zentao/bug-view-123.html');
      assert.equal(api.login.mock.callCount(), 0); // 不是過期，不重登
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('session 過期時自動重登後重發 POST', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'user', 'pass');
    api.login = mock.fn(async () => 'new-session');

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true, status: 200,
          headers: { get: (k) => k === 'content-type' ? 'text/html' : null },
          text: async () => `<script>self.location='/user-login-x.json';</script>`
        };
      }
      return {
        ok: true, status: 200,
        headers: { get: (k) => k === 'content-type' ? 'text/html' : null },
        text: async () => `<html><script>parent.location='/zentao/bug-view-1.html'</script></html>`
      };
    };

    try {
      const result = await api.postOldApi('bug-resolve-1.json', 'resolution=fixed');
      assert.equal(result.success, true);
      assert.equal(api.login.mock.callCount(), 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('fetchFile with relogin', () => {
  it('正常圖片下載回傳 buffer + mimeType', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'user', 'pass');
    api.login = mock.fn();

    const fakePng = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => ({
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'image/png' : null },
      arrayBuffer: async () => fakePng.buffer
    });

    try {
      const result = await api.fetchFile('file-read-123.png');
      assert.equal(result.mimeType, 'image/png');
      assert.ok(result.buffer.length > 0);
      assert.equal(api.login.mock.callCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('過期時自動重登後重試下載', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'user', 'pass');
    api.login = mock.fn(async () => { api.sessionId = 'new-session'; return 'new-session'; });

    const fakePng = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
    const expiredHtml = `<script>self.location='/user-login-x.json';</script>`;
    const expiredBuf = new TextEncoder().encode(expiredHtml);

    const sentCookies = [];
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url, opts) => {
      callCount++;
      sentCookies.push(opts.headers.Cookie);
      if (callCount === 1) {
        return {
          ok: true, status: 200,
          headers: { get: (k) => k === 'content-type' ? 'text/html' : null },
          arrayBuffer: async () => expiredBuf.buffer
        };
      }
      return {
        ok: true, status: 200,
        headers: { get: (k) => k === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => fakePng.buffer
      };
    };

    try {
      const result = await api.fetchFile('file-read-123.png');
      assert.equal(result.mimeType, 'image/png');
      assert.equal(api.login.mock.callCount(), 1);
      assert.equal(callCount, 2);
      // 重試時應使用重登後的新 session（cookie 在 fetchFn 內部構造，才會拿到刷新的 sessionId）
      assert.equal(sentCookies[1], 'zentaosid=new-session');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
