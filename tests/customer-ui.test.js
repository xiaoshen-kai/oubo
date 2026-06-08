const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");

assert.match(page, /className="customer-console"/);
assert.match(page, /className="customer-searchbar"/);
assert.match(page, /className="customer-stat-strip"/);
assert.match(page, /className="customer-workspace"/);
assert.match(page, /className=\{`customer-card \$\{selected \? "selected" : ""\}`\}/);
assert.match(page, /className="customer-inspector"/);
assert.match(page, /className="keyword-customer-context"/);

assert.match(css, /\.customer-console/);
assert.match(css, /\.customer-workspace/);
assert.match(css, /\.customer-card-list/);
assert.match(css, /\.customer-card\.selected/);
assert.match(css, /\.customer-inspector/);
assert.match(css, /\.keyword-customer-context/);
