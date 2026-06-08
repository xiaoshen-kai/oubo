const assert = require("node:assert/strict");
const fs = require("node:fs");

const protectedRoutes = [
  "src/app/api/customers/route.ts",
  "src/app/api/customers/[id]/route.ts",
  "src/app/api/customers/[id]/keywords/route.ts",
  "src/app/api/customers/[id]/knowledge-files/route.ts",
  "src/app/api/customers/[id]/facts/route.ts",
  "src/app/api/keywords/[id]/route.ts",
  "src/app/api/knowledge-files/[id]/route.ts",
  "src/app/api/knowledge-files/[id]/chunks/route.ts",
  "src/app/api/knowledge-files/[id]/reparse/route.ts",
  "src/app/api/chunks/[id]/route.ts",
  "src/app/api/facts/[id]/route.ts",
  "src/app/api/prompts/route.ts",
  "src/app/api/prompts/[id]/route.ts",
  "src/app/api/generation-tasks/route.ts",
  "src/app/api/generation-tasks/[id]/route.ts",
  "src/app/api/generation-tasks/[id]/start/route.ts",
  "src/app/api/generation-task-items/[id]/retry/route.ts",
  "src/app/api/articles/route.ts",
  "src/app/api/articles/[id]/route.ts"
];

for (const route of protectedRoutes) {
  const source = fs.readFileSync(route, "utf8");
  assert.match(source, /requireUser|requireAdmin/, `${route} should require a logged-in user`);
}

for (const route of [
  "src/app/api/customers/route.ts",
  "src/app/api/generation-tasks/route.ts",
  "src/app/api/articles/route.ts"
]) {
  const source = fs.readFileSync(route, "utf8");
  assert.match(source, /visibleCustomerIdsForUser|visibleCustomersForUser/, `${route} should filter by visible customers`);
}

for (const route of [
  "src/app/api/model-configs/route.ts",
  "src/app/api/model-configs/[id]/route.ts",
  "src/app/api/model-configs/[id]/test/route.ts"
]) {
  const source = fs.readFileSync(route, "utf8");
  assert.match(source, /requireAdmin/, `${route} should be admin-only`);
}
