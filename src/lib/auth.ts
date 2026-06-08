import { randomBytes } from "node:crypto";
import { base, isActive, log, now, readDb, touch, withDb } from "./db";
import { hashPassword, hashToken, verifyPassword } from "./passwords";
import type { AppDb, Customer, ModelConfig, Session, User } from "./types";

export const sessionCookieName = "geo_session";
const sessionDays = 7;

export type PublicUser = Omit<User, "passwordHash">;

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function publicUser(user: User): PublicUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function canManageUsers(user: User) {
  return user.role === "admin" && isActive(user);
}

export function canManageModels(user: User) {
  return user.role === "admin" && isActive(user);
}

export function canUseCustomer(user: User, customer?: Customer | null) {
  if (!customer || !isActive(customer) || !isActive(user)) return false;
  return user.role === "admin" || customer.ownerUserId === user.id;
}

export function visibleCustomersForUser<T extends Customer>(user: User, customers: T[]) {
  if (user.role === "admin") return customers;
  return customers.filter((customer) => customer.ownerUserId === user.id);
}

export function visibleCustomerIdsForUser(user: User, db: AppDb) {
  return new Set(visibleCustomersForUser(user, db.customers).filter(isActive).map((customer) => customer.id));
}

export function assertCustomerAccess(user: User, customer?: Customer | null): Customer {
  if (!customer || !canUseCustomer(user, customer)) throw new AuthError("无权访问该客户", 403);
  return customer;
}

export function defaultModelForUser(db: AppDb, user: User, requestedModelId?: string | null): ModelConfig | undefined {
  if (user.role === "admin" && requestedModelId) {
    const requested = db.modelConfigs.find((model) => model.id === requestedModelId && isActive(model));
    if (requested) return requested;
  }
  return db.modelConfigs.find((model) => model.isDefault && isActive(model)) || db.modelConfigs.find(isActive);
}

export function parseCookieHeader(header: string | null) {
  const values = new Map<string, string>();
  for (const part of (header || "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    values.set(rawKey, decodeURIComponent(rawValue.join("=")));
  }
  return values;
}

export function tokenFromRequest(request: Request) {
  return parseCookieHeader(request.headers.get("cookie")).get(sessionCookieName) || "";
}

export function currentUserFromRequest(request: Request): User | null {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const db = readDb();
  const session = db.sessions.find(
    (entry) => entry.tokenHash === tokenHash && isActive(entry) && new Date(entry.expiresAt).getTime() > Date.now()
  );
  if (!session) return null;
  const user = db.users.find((entry) => entry.id === session.userId && isActive(entry));
  return user || null;
}

export function requireUser(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) throw new AuthError("请先登录", 401);
  return user;
}

export function requireAdmin(request: Request) {
  const user = requireUser(request);
  if (!canManageUsers(user)) throw new AuthError("只有管理员可以操作", 403);
  return user;
}

export function loginUser(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  if (!normalized || !password) throw new AuthError("请输入账号和密码", 400);

  return withDb((db) => {
    const user = db.users.find((entry) => entry.username.toLowerCase() === normalized && isActive(entry));
    if (!user || !verifyPassword(password, user.passwordHash)) throw new AuthError("账号或密码错误", 401);

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
    const session = base("session", {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      status: "active"
    }) satisfies Session;
    db.sessions.unshift(session);
    user.lastLoginAt = now();
    touch(user);
    return { token, user: publicUser(user) };
  });
}

export function logoutRequest(request: Request) {
  const token = tokenFromRequest(request);
  if (!token) return;
  const tokenHash = hashToken(token);
  withDb((db) => {
    db.sessions
      .filter((session) => session.tokenHash === tokenHash)
      .forEach((session) => {
        session.status = "disabled";
        touch(session);
      });
  });
}

export function listPublicUsers() {
  return readDb().users.map(publicUser);
}

export function createEmployeeUser(input: { username?: string; displayName?: string; password?: string }) {
  const username = input.username?.trim().toLowerCase() || "";
  const displayName = input.displayName?.trim() || input.username?.trim() || "";
  const password = input.password || "";
  if (!username || username.length < 3) throw new AuthError("账号至少需要 3 个字符", 400);
  if (!password || password.length < 6) throw new AuthError("密码至少需要 6 个字符", 400);

  return withDb((db) => {
    if (db.users.some((user) => user.username.toLowerCase() === username)) {
      throw new AuthError("账号已存在", 409);
    }
    const user = base("user", {
      username,
      displayName,
      role: "employee" as const,
      passwordHash: hashPassword(password),
      status: "active" as const,
      lastLoginAt: null
    }) satisfies User;
    db.users.unshift(user);
    return publicUser(user);
  });
}

export function updateUserByAdmin(
  userId: string,
  input: { displayName?: string; status?: User["status"]; password?: string }
) {
  return withDb((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) throw new AuthError("账号不存在", 404);
    if (user.role === "admin" && input.status === "disabled") throw new AuthError("不能停用管理员账号", 400);
    if (typeof input.displayName === "string") user.displayName = input.displayName.trim() || user.displayName;
    if (input.status) user.status = input.status;
    if (input.password) {
      if (input.password.length < 6) throw new AuthError("密码至少需要 6 个字符", 400);
      user.passwordHash = hashPassword(input.password);
      db.sessions
        .filter((session) => session.userId === user.id)
        .forEach((session) => {
          session.status = "disabled";
          touch(session);
        });
    }
    touch(user);
    return publicUser(user);
  });
}

export function deleteEmployeeUserByAdmin(userId: string) {
  return withDb((db) => {
    const userIndex = db.users.findIndex((entry) => entry.id === userId);
    if (userIndex < 0) throw new AuthError("账号不存在", 404);
    const user = db.users[userIndex];
    if (user.role === "admin") throw new AuthError("不能删除管理员账号", 400);

    db.sessions
      .filter((session) => session.userId === user.id)
      .forEach((session) => {
        session.status = "disabled";
        touch(session);
      });
    db.users.splice(userIndex, 1);
    log(db, "delete_user", "user", user.id, user.username);
    return publicUser(user);
  });
}

export function changeOwnPassword(userId: string, oldPassword: string, newPassword: string) {
  if (!newPassword || newPassword.length < 6) throw new AuthError("新密码至少需要 6 个字符", 400);
  withDb((db) => {
    const user = db.users.find((entry) => entry.id === userId && isActive(entry));
    if (!user) throw new AuthError("账号不存在", 404);
    if (!verifyPassword(oldPassword, user.passwordHash)) throw new AuthError("原密码错误", 400);
    user.passwordHash = hashPassword(newPassword);
    db.sessions
      .filter((session) => session.userId === user.id)
      .forEach((session) => {
        session.status = "disabled";
        touch(session);
      });
    touch(user);
  });
}
