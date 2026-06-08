const assert = require("node:assert/strict");
const fs = require("node:fs");

const css = fs.readFileSync("src/app/globals.css", "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

assert.match(rule(".history-list .history-item"), /background:\s*#ffffff;/);
assert.match(rule(".history-list .history-item"), /color:\s*var\(--ink\);/);
assert.match(rule(".history-list .history-item span"), /color:\s*#64748b;/);
assert.match(rule(".history-list .history-item b"), /color:\s*#172033;/);
