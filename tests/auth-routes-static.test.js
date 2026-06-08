const assert = require("node:assert/strict");
const fs = require("node:fs");

const requiredRoutes = [
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/logout/route.ts",
  "src/app/api/auth/me/route.ts",
  "src/app/api/auth/change-password/route.ts",
  "src/app/api/users/route.ts",
  "src/app/api/users/[id]/route.ts"
];

for (const route of requiredRoutes) {
  assert.equal(fs.existsSync(route), true, `${route} should exist`);
}

const usersRoute = fs.readFileSync("src/app/api/users/route.ts", "utf8");
assert.match(usersRoute, /requireAdmin/);
assert.match(usersRoute, /createEmployeeUser/);

const userDetailRoute = fs.readFileSync("src/app/api/users/[id]/route.ts", "utf8");
assert.match(userDetailRoute, /export async function DELETE/);
assert.match(userDetailRoute, /deleteEmployeeUserByAdmin/);

const modelRoute = fs.readFileSync("src/app/api/model-configs/route.ts", "utf8");
assert.match(modelRoute, /requireAdmin/);

const taskRoute = fs.readFileSync("src/app/api/generation-tasks/route.ts", "utf8");
assert.match(taskRoute, /defaultModelForUser/);
assert.match(taskRoute, /visibleCustomersForUser/);
