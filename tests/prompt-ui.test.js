const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");

assert.match(page, /const \[scopeFilter, setScopeFilter\]/);
assert.match(page, /const promptScopeTabs = \[/);
assert.match(page, /className="prompt-console"/);
assert.match(page, /className="prompt-toolbar"/);
assert.match(page, /className="prompt-summary"/);
assert.match(page, /className="prompt-card-meta"/);
assert.match(page, /scopeFilter === "all" \|\| scopeFilter === "global"/);
assert.match(page, /scopeFilter === "all" \|\| scopeFilter === "customer"/);

assert.match(css, /\.prompt-console/);
assert.match(css, /\.prompt-toolbar/);
assert.match(css, /\.prompt-summary/);
assert.match(css, /\.prompt-library/);
assert.match(css, /\.prompt-card-meta/);
