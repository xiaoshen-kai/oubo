const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const createPayload = page.match(/body: JSON\.stringify\(\{[\s\S]*?customerId: formCustomerId,[\s\S]*?modelThinking:\s*data\.modelThinking[\s\S]*?\}\)/);
const editPayload = page.match(/body: JSON\.stringify\(\{[\s\S]*?remark: data\.remark[\s\S]*?\}\)/);

assert.match(page, /name="comparisonObjects"/);
assert.match(page, /name="modelThinking"/);
assert.ok(createPayload, "Missing create task payload");
assert.ok(editPayload, "Missing edit task payload");
assert.match(createPayload[0], /comparisonObjects:\s*data\.comparisonObjects/);
assert.match(createPayload[0], /modelThinking:\s*data\.modelThinking/);
assert.doesNotMatch(createPayload[0], /enableCheck/);
assert.match(editPayload[0], /comparisonObjects:\s*data\.comparisonObjects/);
assert.match(editPayload[0], /modelThinking:\s*data\.modelThinking/);
assert.doesNotMatch(editPayload[0], /enableCheck/);
