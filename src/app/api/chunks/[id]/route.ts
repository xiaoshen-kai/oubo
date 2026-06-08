import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { KnowledgeChunk } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<KnowledgeChunk> & { tagsText?: string };
    const updated = withDb((db) => {
      const chunk = db.knowledgeChunks.find((entry) => entry.id === id);
      if (!chunk) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === chunk.customerId && isActive(customer)));
      chunk.title = input.title ?? chunk.title;
      chunk.content = input.content ?? chunk.content;
      chunk.tags = input.tagsText ? input.tagsText.split(/[，,\s]+/).filter(Boolean) : input.tags ?? chunk.tags;
      chunk.priority = Number(input.priority ?? chunk.priority);
      chunk.isCore = Boolean(input.isCore ?? chunk.isCore);
      chunk.status = input.status || chunk.status;
      chunk.updatedAt = now();
      return chunk;
    });
    if (!updated) return fail("知识片段不存在", 404);
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新知识片段失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const chunk = db.knowledgeChunks.find((entry) => entry.id === id);
      if (!chunk) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === chunk.customerId && isActive(customer)));
      return softDelete(db.knowledgeChunks, id);
    });
    if (!deleted) return fail("知识片段不存在", 404);
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除知识片段失败", 500);
  }
}
