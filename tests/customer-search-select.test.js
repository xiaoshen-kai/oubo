const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");

assert.match(page, /className="search-results-head"/);
assert.match(page, /\$\{options\.length\} \/ \$\{total\}/);

assert.match(css, /\.search-results-head/);
assert.match(css, /\.search-results\s*\{[\s\S]*?max-height:\s*min\(280px,\s*42vh\);/);
assert.match(css, /\.search-select:focus-within\s*\{[\s\S]*?z-index:\s*900;/);
