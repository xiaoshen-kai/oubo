const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");

assert.match(page, /function renderPromptGroup\([^)]*groupKey = title/);
assert.match(page, /<section className="prompt-group" key=\{groupKey\}>/);
assert.match(page, /group\.prompts,\s*promptQuery \? "没有匹配的客户提示词。" : "该客户暂无专属提示词。",\s*group\.customerId/s);
