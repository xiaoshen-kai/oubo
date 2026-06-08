import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { AppDb, Prompt, User } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function assertPromptAccess(user: User, db: AppDb, prompt: Prompt | undefined | null): Prompt {
  if (!prompt) throw new AuthError("提示词不存在", 404);
  if (prompt.scope === "global") {
    if (user.role !== "admin") throw new AuthError("只有管理员可以操作全局提示词", 403);
    return prompt;
  }
  assertCustomerAccess(user, db.customers.find((customer) => customer.id === prompt.customerId && isActive(customer)));
  return prompt;
}

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<Prompt>;
    const updated = withDb((db) => {
      const prompt = assertPromptAccess(user, db, db.prompts.find((entry) => entry.id === id));
      const nextScope = input.scope || prompt.scope;
      if (nextScope === "global" && user.role !== "admin") throw new AuthError("只有管理员可以改为全局提示词", 403);
      if (nextScope === "customer" && !input.customerId && !prompt.customerId) throw new AuthError("客户提示词需要选择客户", 400);
      if (nextScope === "customer") {
        const nextCustomerId = input.customerId || prompt.customerId;
        assertCustomerAccess(user, db.customers.find((customer) => customer.id === nextCustomerId && isActive(customer)));
      }
      prompt.name = input.name?.trim() || prompt.name;
      prompt.content = input.content ?? prompt.content;
      prompt.scope = nextScope;
      prompt.customerId = nextScope === "global" ? null : input.customerId || prompt.customerId;
      prompt.status = input.status || prompt.status;
      prompt.updatedAt = now();
      return prompt;
    });
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新提示词失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const prompt = assertPromptAccess(user, db, db.prompts.find((entry) => entry.id === id));
      return softDelete(db.prompts, id);
    });
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除提示词失败", 500);
  }
}
