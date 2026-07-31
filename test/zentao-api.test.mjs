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

describe('_resolveBrowseStrategy', () => {
  const api = new ZenTaoAPI('http://localhost', 'testuser', 'pass');

  it('無 moduleId 時維持原 browseType，param=0，不過濾', () => {
    const r = api._resolveBrowseStrategy('assigntome', undefined);
    assert.deepEqual(r, { serverBrowseType: 'assigntome', serverParam: 0, needClientAssignedFilter: false });
  });

  it('assigntome + moduleId 走 byModule + 客戶端過濾', () => {
    const r = api._resolveBrowseStrategy('assigntome', 1090);
    assert.deepEqual(r, { serverBrowseType: 'byModule', serverParam: 1090, needClientAssignedFilter: true });
  });

  it('其他類型 + moduleId 走 byModule 但不過濾指派人', () => {
    const r = api._resolveBrowseStrategy('unclosed', 1090);
    assert.deepEqual(r, { serverBrowseType: 'byModule', serverParam: 1090, needClientAssignedFilter: false });
  });
});

describe('browseBugs module 篩選', () => {
  // 構造禪道舊版 API 回應：data 欄位為轉義 JSON 字串
  function makeBugResponse(bugs, extra = {}) {
    const data = JSON.stringify({ bugs, ...extra });
    return {
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ status: 'success', data })
    };
  }

  it('無 moduleId 時 URL param 段為 0（向後相容）', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return makeBugResponse([]); };
    try {
      await api.browseBugs(74, { browseType: 'assigntome', limit: 20 });
      assert.ok(capturedUrl.includes('-assigntome-0-id_desc-'),
        `URL 應含 -assigntome-0-，實際: ${capturedUrl}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('有 moduleId 時走 byModule，param 段為模塊 ID', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return makeBugResponse([]); };
    try {
      await api.browseBugs(74, { browseType: 'unclosed', moduleId: 1090, limit: 20 });
      assert.ok(capturedUrl.includes('-byModule-1090-id_desc-'),
        `URL 應含 -byModule-1090-，實際: ${capturedUrl}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('assigntome + moduleId 客戶端過濾只回傳指派給我的（不區分大小寫）', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    // 模擬禪道實際行為：assignedTo 首字大寫（Testuser），與登入帳號（testuser）不一致
    const bugs = [
      { id: 1, assignedTo: 'Testuser', status: 'active', title: '我的' },
      { id: 2, assignedTo: 'other', status: 'active', title: '別人的' },
      { id: 3, assignedTo: 'testuser', status: 'active', title: '也是我的' },
    ];
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return makeBugResponse(bugs); };
    try {
      const result = await api.browseBugs(74, { browseType: 'assigntome', moduleId: 1090, limit: 20 });
      assert.ok(capturedUrl.includes('-byModule-1090-'), '應走 byModule');
      assert.equal(result.length, 2, '大小寫不一致仍應過濾出我的');
      assert.deepEqual(result.map(b => b.id), [1, 3]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('純 byModule（非 assigntome）不做指派人過濾', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    const bugs = [
      { id: 1, assignedTo: 'testuser', status: 'active', title: 'a' },
      { id: 2, assignedTo: 'other', status: 'active', title: 'b' },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeBugResponse(bugs);
    try {
      const result = await api.browseBugs(74, { browseType: 'unclosed', moduleId: 1090, limit: 20 });
      assert.equal(result.length, 2, 'unclosed+moduleId 不應過濾指派人');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('getModules', () => {
  function mockModulesResponse(modules) {
    const data = JSON.stringify({ bugs: [], modules });
    return {
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ status: 'success', data })
    };
  }

  it('正確解析 modules，排除根節點，名稱取路徑最後一段', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return mockModulesResponse({
        '0': '/', '1090': '/App', '1091': '/Web', '1092': '/Web/Console'
      });
    };
    try {
      const result = await api.getModules(74);
      assert.ok(capturedUrl.includes('bug-browse-74-0-unclosed-0-'),
        `應用 unclosed 端點取模塊表，實際: ${capturedUrl}`);
      assert.equal(result.length, 3, '排除 id=0 根節點');
      assert.deepEqual(result, [
        { id: 1090, path: '/App', name: 'App' },
        { id: 1091, path: '/Web', name: 'Web' },
        { id: 1092, path: '/Web/Console', name: 'Console' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('無 modules 欄位時回傳空陣列', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => mockModulesResponse({});
    try {
      const result = await api.getModules(74);
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('browseBugsWithTotal module 篩選', () => {
  function makeBugResponseWithPager(bugs, recTotal) {
    const data = JSON.stringify({ bugs, pager: { recTotal: String(recTotal) } });
    return {
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ status: 'success', data })
    };
  }

  it('assigntome + moduleId 客戶端過濾，hasMore=true（非精確）', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    // 第一頁含他人與我的 bug，過濾後剩 2 筆，但後續頁面可能還有
    const bugs = [
      { id: 1, assignedTo: 'Testuser', status: 'active', title: 'a' },
      { id: 2, assignedTo: 'other', status: 'active', title: 'b' },
      { id: 3, assignedTo: 'Testuser', status: 'active', title: 'c' },
    ];
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return makeBugResponseWithPager(bugs, 50); };
    try {
      const result = await api.browseBugsWithTotal(74, { browseType: 'assigntome', moduleId: 1090 });
      assert.ok(capturedUrl.includes('-byModule-1090-'), '應走 byModule');
      assert.equal(result.bugs.length, 2, '過濾後剩 2 筆');
      assert.equal(result.total, 2, 'total 為過濾後筆數');
      assert.equal(result.hasMore, true, 'client-filter 情境應回傳 hasMore=true（非精確）');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('searchFirstActiveBugGenerator module 篩選', () => {
  function makeBugResponse(bugs) {
    const data = JSON.stringify({ bugs });
    return {
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ status: 'success', data })
    };
  }

  it('assigntome + moduleId generator 客戶端過濾並 yield 指派給我的激活 bug', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    const bugs = [
      { id: 1, assignedTo: 'other', status: 'active', title: '別人的' },
      { id: 2, assignedTo: 'Testuser', status: 'resolved', title: '我但已解決' },
      { id: 3, assignedTo: 'testuser', status: 'active', title: '我的激活' },
    ];
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrl = url; return makeBugResponse(bugs); };
    try {
      const gen = api.searchFirstActiveBugGenerator(74, { assignedToMe: true, moduleId: 1090 });
      const first = await gen.next();
      assert.ok(capturedUrl.includes('-byModule-1090-'), '應走 byModule');
      assert.equal(first.value.id, 3, '應跳過他人與已解決，取第一個指派給我的激活 bug');
      assert.equal(first.value.status, 'active');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('browseBugs client-filter 多頁收集', () => {
  // 驗證：客戶端過濾情境下，分頁迴圈會持續翻頁直到湊齊 limit 筆「指派給我」
  function makeBugResponse(bugs) {
    const data = JSON.stringify({ bugs });
    return {
      ok: true, status: 200,
      headers: { get: (k) => k === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ status: 'success', data })
    };
  }

  it('第 1 頁僅 1 筆我的，第 2 頁補齊 — 迴圈應翻 2 頁並回傳足量', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    // perPage 在 client-filter 下為 100；模擬第 1 頁 100 筆（僅 1 筆我的），第 2 頁 100 筆（3 筆我的）
    const page1 = Array.from({ length: 99 }, (_, i) => ({ id: 1000 + i, assignedTo: 'other', status: 'active', title: 'x' }))
      .concat([{ id: 1, assignedTo: 'Testuser', status: 'active', title: 'mine1' }]);
    const page2 = Array.from({ length: 97 }, (_, i) => ({ id: 2000 + i, assignedTo: 'other', status: 'active', title: 'x' }))
      .concat([
        { id: 2, assignedTo: 'testuser', status: 'active', title: 'mine2' },
        { id: 3, assignedTo: 'Testuser', status: 'active', title: 'mine3' },
      ]);
    const capturedUrls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrls.push(url);
      return makeBugResponse(url.includes('-1.json') ? page1 : page2);
    };
    try {
      const result = await api.browseBugs(74, { browseType: 'assigntome', moduleId: 1090, limit: 3 });
      assert.equal(capturedUrls.length, 2, '應翻 2 頁（第 1 頁不足 limit 需續翻）');
      assert.ok(capturedUrls[0].includes('-100-1.json'), '第 1 頁 perPage=100');
      assert.ok(capturedUrls[1].includes('-100-2.json'), '第 2 頁');
      assert.equal(result.length, 3, '應湊齊 3 筆指派給我的');
      assert.deepEqual(result.map(b => b.id), [1, 2, 3]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('第 1 頁即湊齊 limit — 不應翻第 2 頁', async () => {
    const api = new ZenTaoAPI('http://zentao.test', 'testuser', 'pass');
    api.login = mock.fn();
    const page1 = [
      { id: 1, assignedTo: 'Testuser', status: 'active', title: 'mine1' },
      { id: 2, assignedTo: 'testuser', status: 'active', title: 'mine2' },
    ];
    const capturedUrls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { capturedUrls.push(url); return makeBugResponse(page1); };
    try {
      const result = await api.browseBugs(74, { browseType: 'assigntome', moduleId: 1090, limit: 2 });
      assert.equal(capturedUrls.length, 1, '第 1 頁即足量，不應翻第 2 頁');
      assert.equal(result.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
