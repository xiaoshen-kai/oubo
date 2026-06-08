const assert = require("node:assert/strict");
const fs = require("node:fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const runner = fs.readFileSync("scripts/next-run.mjs", "utf8");
const deployDoc = fs.readFileSync("DEPLOY.md", "utf8");

assert.equal(pkg.scripts.dev, "node scripts/next-run.mjs dev -p 3001");
assert.equal(pkg.scripts["dev:3002"], "node scripts/next-run.mjs dev -p 3002");
assert.equal(pkg.scripts.build, "node scripts/next-run.mjs build");
assert.equal(pkg.scripts.start, "node scripts/next-run.mjs start -p 3001");
assert.equal(pkg.scripts["start:prod"], "node scripts/next-run.mjs start -p 3001");

for (const command of Object.values(pkg.scripts)) {
  assert.doesNotMatch(command, /^set\s/i);
  assert.doesNotMatch(command, /%CD%/);
}

assert.match(runner, /NEXT_TEST_WASM_DIR/);
assert.match(runner, /NEXT_DIST_DIR/);
assert.match(runner, /\.next-build/);
assert.match(runner, /require\.resolve\("next\/dist\/bin\/next"\)/);

assert.match(deployDoc, /DATA_SECRET/);
assert.match(deployDoc, /npm run build/);
assert.match(deployDoc, /pm2 start npm --name geo-tool -- run start/);
assert.match(deployDoc, /data\/db\.json/);
assert.match(deployDoc, /data\/uploads/);
