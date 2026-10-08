import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCommentMeta, resolveComment } from '../src/cli.mjs';

describe('buildCommentMeta', () => {
  it('空字串回傳 0', () => {
    assert.deepEqual(buildCommentMeta(''), { length: 0, lines: 0, preview: '' });
    assert.deepEqual(buildCommentMeta(undefined), { length: 0, lines: 0, preview: '' });
  });

  it('正確計算多行長度與行數', () => {
    const text = '第一行\n第二行\n第三行';
    const meta = buildCommentMeta(text);
    assert.equal(meta.length, text.length);
    assert.equal(meta.lines, 3);
    assert.equal(meta.preview, text);
  });

  it('過長內容會截斷 preview', () => {
    const text = 'A'.repeat(200);
    const meta = buildCommentMeta(text);
    assert.equal(meta.length, 200);
    assert.equal(meta.lines, 1);
    assert.equal(meta.preview.endsWith('…'), true);
    assert.equal(meta.preview.length, 161);
  });
});

describe('resolveComment', () => {
  it('無參數回傳空字串', async () => {
    assert.equal(await resolveComment({}), '');
  });

  it('支援 --comment 單行文字', async () => {
    assert.equal(await resolveComment({ comment: '短備註' }), '短備註');
  });

  it('支援 --comment 多行文字（當 argv 已完整傳入時）', async () => {
    const multiline = '【狀態】已確認\n原因：懶加載\n驗證：重進頁面';
    assert.equal(await resolveComment({ comment: multiline }), multiline);
  });

  it('支援 --comment-file 讀取檔案並去除 BOM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zentao-comment-'));
    const filePath = join(dir, 'comment.txt');
    const body = '【狀態】已確認（待部署驗證）\n原因：列表只載入一次\nCommit: abc123';
    writeFileSync(filePath, `\uFEFF${body}`, 'utf8');

    try {
      const resolved = await resolveComment({ 'comment-file': filePath });
      assert.equal(resolved, body);
      assert.equal(resolved.startsWith('\uFEFF'), false);

      const camel = await resolveComment({ commentFile: filePath });
      assert.equal(camel, body);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('檔案不存在時拋錯', async () => {
    await assert.rejects(
      () => resolveComment({ 'comment-file': join(tmpdir(), 'zentao-missing-comment-xyz.txt') }),
      /comment 檔案不存在/
    );
  });

  it('同時指定 --comment 與 --comment-file 時拋錯', async () => {
    await assert.rejects(
      () => resolveComment({ comment: 'a', 'comment-file': 'b.txt' }),
      /不可同時使用/
    );
  });
});
