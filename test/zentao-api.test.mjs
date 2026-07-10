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
