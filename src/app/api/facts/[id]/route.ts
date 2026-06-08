import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { KnowledgeFact } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<KnowledgeFact>;
    const updated = withDb((db) => {
      const fact = db.knowledgeFacts.find((entry) => entry.id === id);
      if (!fact) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === fact.customerId && isActive(customer)));
      fact.factText = input.factText ?? fact.factText;
      fact.usageRule = input.usageRule || fact.usageRule;
      fact.priority = Number(input.priority ?? fact.priority);
      fact.status = input.status || fact.status;
      fact.updatedAt = now();
      return fact;
    });
    if (!updated) return fail("核心事实不存在", 404);
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新核心事实失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const fact = db.knowledgeFacts.find((entry) => entry.id === id);
      if (!fact) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === fact.customerId && isActive(customer)));
      return softDelete(db.knowledgeFacts, id);
    });
    if (!deleted) return fail("核心事实不存在", 404);
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除核心事实失败", 500);
  }
}
