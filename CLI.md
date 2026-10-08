# 全域禪道 CLI 安裝說明

## 已安裝內容

1. CLI 本體：`d:\program-ai\mcp-zentao-bugs\src\cli.mjs`
2. PATH 快捷：`%USERPROFILE%\.local\bin\zentao.cmd` / `zentao-bugs.cmd`
3. 全域設定：`%USERPROFILE%\.zentao\.env`
4. Cursor 全域規則：`%USERPROFILE%\.cursor\rules\zentao-bugs.mdc`

## 使用

任意目錄：

```bat
zentao getBugDetail 25899
zentao browseBugs --productId 77
zentao help
```

### 長備註（Windows 必看）

多行 `--comment` 在 PowerShell / cmd 下容易被截斷，**請用檔案**：

```bat
zentao confirmBug 25970 --comment-file %TEMP%\bug-25970-comment.txt
```

成功時 stdout 會附 `comment.length` / `comment.lines` / `comment.preview`。

## 更新 CLI

修改 `mcp-zentao-bugs` 後無需重裝（shim 直接指向源碼）。
若 package.json bin 要 npm link：

```bat
cd /d d:\program-ai\mcp-zentao-bugs
npm link
```

## 換帳密

編輯：`C:\Users\Norray\.zentao\.env`
