const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");

assert.match(page, /type Tab = .*"users"/);
assert.match(page, /LoginScreen/);
assert.match(page, /UserCenter/);
assert.doesNotMatch(page, /window\.prompt/);
assert.match(page, /resettingPasswordUser/);
assert.match(page, /newPassword/);
assert.match(page, /confirmPassword/);
assert.match(page, /user\.role === "employee"/);
assert.match(page, /删除员工/);
assert.match(page, /method: "DELETE"/);
assert.match(page, /\/api\/auth\/me/);
assert.match(page, /\/api\/auth\/login/);
assert.match(page, /\/api\/auth\/logout/);
assert.doesNotMatch(page, /admin123456/);
assert.doesNotMatch(page, /<Field name="username" label="账号" defaultValue="admin"/);
assert.match(page, /<Field name="username" label="账号" placeholder="请输入账号" required \/>/);
assert.match(page, /<Field name="password" label="密码" type="password" placeholder="请输入密码" required \/>/);
assert.match(page, /role === "admin"/);
assert.match(page, /tab\.id !== "models"/);
assert.match(page, /canManageModels && \(\s*<div className="field">\s*<label htmlFor="modelConfigId">模型<\/label>/s);
assert.match(page, /canManageModels && \(\s*<div className="field">\s*<label htmlFor="edit-modelConfigId">模型<\/label>/s);
assert.match(page, /员工账号/);

const css = fs.readFileSync("src/app/globals.css", "utf8");
assert.match(css, /\.login-screen/);
assert.match(css, /\.user-center/);
