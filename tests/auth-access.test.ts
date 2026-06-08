import assert from "node:assert/strict";
import {
  canManageModels,
  canManageUsers,
  canUseCustomer,
  visibleCustomersForUser
} from "../src/lib/auth";
import type { Customer, User } from "../src/lib/types";

const admin: User = {
  id: "user_admin",
  username: "admin",
  displayName: "管理员",
  role: "admin",
  passwordHash: "hash",
  status: "active",
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z"
};

const employeeA: User = {
  ...admin,
  id: "user_a",
  username: "writer-a",
  displayName: "员工 A",
  role: "employee"
};

const employeeB: User = {
  ...admin,
  id: "user_b",
  username: "writer-b",
  displayName: "员工 B",
  role: "employee"
};

const customers: Customer[] = [
  {
    id: "customer_a",
    ownerUserId: "user_a",
    name: "客户 A",
    shortName: "",
    industry: "",
    website: "",
    contactName: "",
    contactInfo: "",
    remark: "",
    status: "active",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  },
  {
    id: "customer_b",
    ownerUserId: "user_b",
    name: "客户 B",
    shortName: "",
    industry: "",
    website: "",
    contactName: "",
    contactInfo: "",
    remark: "",
    status: "active",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z"
  }
];

assert.deepEqual(
  visibleCustomersForUser(admin, customers).map((customer) => customer.id),
  ["customer_a", "customer_b"]
);

assert.deepEqual(
  visibleCustomersForUser(employeeA, customers).map((customer) => customer.id),
  ["customer_a"]
);

assert.equal(canUseCustomer(admin, customers[1]), true);
assert.equal(canUseCustomer(employeeA, customers[0]), true);
assert.equal(canUseCustomer(employeeA, customers[1]), false);
assert.equal(canUseCustomer(employeeB, customers[0]), false);

assert.equal(canManageUsers(admin), true);
assert.equal(canManageUsers(employeeA), false);
assert.equal(canManageModels(admin), true);
assert.equal(canManageModels(employeeA), false);
