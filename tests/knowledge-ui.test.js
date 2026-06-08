const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");

assert.match(page, /className="knowledge-console"/);
assert.match(page, /className="knowledge-workflow"/);
assert.match(page, /const \[fileStatus, setFileStatus\]/);
assert.match(page, /const \[selectedUploadFile, setSelectedUploadFile\]/);
assert.match(page, /disabled=\{!customerId \|\| !selectedUploadFile\}/);
assert.match(page, /className="segmented-tabs"/);
assert.match(page, /className="file-type-mark"/);

assert.match(css, /\.knowledge-console/);
assert.match(css, /\.knowledge-workflow/);
assert.match(css, /\.upload-dropzone/);
assert.match(css, /\.segmented-tabs/);
assert.match(css, /\.file-card-main/);
