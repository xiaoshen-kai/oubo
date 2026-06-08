const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");

assert.match(page, /function CustomerKeywordManager/);
assert.match(page, /关键词管理/);
assert.match(page, /name="keywordBatchText"/);
assert.match(page, /name="keywordType"/);
assert.match(page, /api\(`\/api\/customers\/\$\{customerId\}\/keywords`/);
assert.match(page, /api\(`\/api\/keywords\/\$\{keyword\.id\}`,\s*\{\s*method:\s*"DELETE"\s*\}\)/s);
assert.match(page, /className="keyword-delete"/);
assert.match(page, /setKeywordFormKey/);
assert.match(page, /setSelectedKeywordCustomerId/);

const keywordRoute = fs.readFileSync("src/app/api/customers/[id]/keywords/route.ts", "utf8");
assert.match(keywordRoute, /keywordBatchText/);
assert.match(keywordRoute, /input\.batchText \?\? input\.keywordBatchText \?\? input\.keyword/);
assert.match(keywordRoute, /没有新增关键词/);

const generationRoute = fs.readFileSync("src/app/api/generation-tasks/route.ts", "utf8");
assert.match(generationRoute, /const articleCount = Number\(input\.articleCount \|\| 1\)/);
assert.match(generationRoute, /const wordCount = Number\(input\.wordCount \|\| 800\)/);
assert.match(generationRoute, /maxRetries: Number\(input\.maxRetries \?\? 0\)/);

const generationLib = fs.readFileSync("src/lib/generation.ts", "utf8");
assert.match(generationLib, /Number\.isFinite\(taskRetryBudget\) \? taskRetryBudget : Number\(model\?\.maxRetries \|\| 0\)/);
assert.match(generationLib, /Promise\.all\(items\.map\(\(item\) => processTaskItemWithRetries\(task\.id,\s*item\.id,\s*maxAttempts\)\)\)/);

const css = fs.readFileSync("src/app/globals.css", "utf8");
assert.match(css, /\.keyword-manager/);
assert.match(css, /\.keyword-list/);
assert.match(css, /\.keyword-delete/);
