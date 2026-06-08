import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { Keyword } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<Keyword>;
    const updated = withDb((db) => {
      const keyword = db.keywords.find((entry) => entry.id === id);
      if (!keyword) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === keyword.customerId && isActive(customer)));
      keyword.keyword = input.keyword?.trim() || keyword.keyword;
      keyword.keywordType = input.keywordType ?? keyword.keywordType;
      keyword.remark = input.remark ?? keyword.remark;
      keyword.status = input.status || keyword.status;
      keyword.updatedAt = now();
      return keyword;
    });
    if (!updated) return fail("关键词不存在", 404);
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新关键词失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const keyword = db.keywords.find((entry) => entry.id === id);
      if (!keyword) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === keyword.customerId && isActive(customer)));
      return softDelete(db.keywords, id);
    });
    if (!deleted) return fail("关键词不存在", 404);
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除关键词失败", 500);
  }
}
