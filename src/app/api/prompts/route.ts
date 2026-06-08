import { AuthError, assertCustomerAccess, requireUser, visibleCustomerIdsForUser } from "@/lib/auth";
import { base, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { Prompt, Status } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");
    const status = (url.searchParams.get("status") as Status | "all" | null) || "active";
    const db = readDb();
    const visibleCustomerIds = visibleCustomerIdsForUser(user, db);
    return ok(
      db.prompts
        .filter(
          (prompt) =>
            (status === "all" || prompt.status === status) &&
            (prompt.scope === "global" || Boolean(prompt.customerId && visibleCustomerIds.has(prompt.customerId))) &&
            (!customerId || prompt.scope === "global" || prompt.customerId === customerId)
        )
        .map((prompt) => ({
          ...prompt,
          customer: prompt.customerId ? db.customers.find((customer) => customer.id === prompt.customerId) : undefined
        }))
    );
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取提示词失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = (await request.json()) as Partial<Prompt>;
    const scope = input.scope || "global";
    if (scope === "global" && user.role !== "admin") return fail("只有管理员可以创建全局提示词", 403);
    if (scope === "customer" && !input.customerId) return fail("客户提示词需要选择客户");
    const created = withDb((db) => {
      if (scope === "customer") {
        assertCustomerAccess(user, db.customers.find((customer) => customer.id === input.customerId));
      }
      const row = base("prompt", {
        customerId: scope === "global" ? null : input.customerId || null,
        name: input.name?.trim() || "未命名提示词",
        scope,
        content: input.content?.trim() || "",
        status: input.status || "active"
      });
      db.prompts.unshift(row);
      return row;
    });
    return ok(created);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建提示词失败", 500);
  }
}
