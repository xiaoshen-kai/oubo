const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const generation = fs.readFileSync("src/lib/generation.ts", "utf8");
const createRoute = fs.readFileSync("src/app/api/generation-tasks/route.ts", "utf8");
const editRoute = fs.readFileSync("src/app/api/generation-tasks/[id]/route.ts", "utf8");

assert.doesNotMatch(page, /name="enableCheck"/);
assert.doesNotMatch(page, /开启基础校验/);
assert.doesNotMatch(page, /启用基础校验/);
assert.doesNotMatch(page, /enableCheck:\s*data\.enableCheck/);

assert.doesNotMatch(generation, /task\.enableCheck\s*\?/);
assert.doesNotMatch(generation, /checkArticle\(/);
assert.doesNotMatch(generation, /校验要求/);
assert.doesNotMatch(generation, /prompt-guards/);

assert.match(createRoute, /enableCheck:\s*false/);
assert.doesNotMatch(createRoute, /input\.enableCheck/);
assert.doesNotMatch(editRoute, /input\.enableCheck/);
assert.doesNotMatch(editRoute, /enableCheck:\s*task\.enableCheck/);
