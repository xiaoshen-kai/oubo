const assert = require("node:assert/strict");
const fs = require("node:fs");

const css = fs.readFileSync("src/app/globals.css", "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

assert.match(rule(".article-review-grid"), /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
assert.match(rule(".review-panel"), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
assert.match(rule(".review-panel"), /align-items:\s*start;/);
assert.match(rule(".article-table-wrap"), /overflow-x:\s*auto;/);
assert.match(rule(".article-table"), /table-layout:\s*fixed;/);
assert.doesNotMatch(css, /@media\s*\(min-width:\s*1500px\)[\s\S]*?\.article-review-grid\s*\{[\s\S]*?minmax\(560px,\s*1fr\)\s+minmax\(300px,\s*340px\)/);
assert.doesNotMatch(css, /@media\s*\(min-width:\s*1500px\)[\s\S]*?\.review-panel\s*\{[\s\S]*?position:\s*sticky;/);

const page = fs.readFileSync("src/app/page.tsx", "utf8");
assert.match(page, /kind: "table"/);
assert.match(page, /function splitMarkdownTableRow/);
assert.match(page, /<ArticleContent text=\{selected\.content\} \/>/);
assert.match(page, /className="article-table-wrap"/);
