const assert = require("node:assert/strict");
const fs = require("node:fs");

const css = fs.readFileSync("src/app/globals.css", "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

assert.match(rule(".task-card-grid"), /minmax\(min\(100%, 320px\), 1fr\)/);
assert.match(rule(".task-card"), /min-width:\s*0;/);
assert.match(rule(".task-card"), /overflow:\s*hidden;/);
assert.match(rule(".task-card-actions"), /flex-wrap:\s*wrap;/);
assert.match(rule(".task-card-actions"), /gap:\s*8px;/);
assert.match(rule(".task-card-actions .danger"), /margin-left:\s*0;/);
assert.match(rule(".task-card-customer"), /font-size:\s*16px;/);
assert.match(rule(".task-card-customer"), /font-weight:\s*700;/);
assert.match(rule(".task-card-customer"), /color:\s*var\(--ink\);/);
assert.match(rule(".task-card-customer"), /word-break:\s*break-word;/);

const page = fs.readFileSync("src/app/page.tsx", "utf8");
assert.match(page, /className="task-card-customer"/);
