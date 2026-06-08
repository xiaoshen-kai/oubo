const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");
const logoPath = path.join("public", "oubo-logo.jpg");

assert.ok(fs.existsSync(logoPath), "OUBO logo should be available as a public asset");
assert.match(page, /<img src="\/oubo-logo\.jpg" alt="欧博东方" \/>/);
assert.match(page, /className="login-logo"/);
assert.match(page, /className="brand-logo-button"/);
assert.match(page, /className="brand-system-name"/);
assert.doesNotMatch(page, /<strong>欧博东方<\/strong>/);
assert.match(page, /使用授权账号登录内容运营系统。/);
assert.doesNotMatch(page, /管理员账号可开通员工账号/);

assert.match(css, /\.login-logo/);
assert.match(css, /\.brand-logo-button/);
assert.match(css, /\.brand-system-name/);
assert.match(css, /\.sidebar-collapsed \.brand-logo-button/);
