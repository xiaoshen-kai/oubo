import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, readDb, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = readDb();
    const file = db.knowledgeFiles.find((entry) => entry.id === id && isActive(entry));
    if (!file) return fail("知识库文件不存在", 404);
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === file.customerId && isActive(customer)));
    return ok({
      file,
      chunks: db.knowledgeChunks.filter((entry) => entry.fileId === id && isActive(entry)),
      facts: db.knowledgeFacts.filter((entry) => entry.fileId === id && isActive(entry))
    });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取知识库文件失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const target = db.knowledgeFiles.find((entry) => entry.id === id);
      if (!target) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === target.customerId && isActive(customer)));
      const file = softDelete(db.knowledgeFiles, id);
      if (!file) return null;
      const deletedAt = file.updatedAt;
      const disable = (item: { status: string; updatedAt: string }) => {
        item.status = "disabled";
        item.updatedAt = deletedAt;
      };
      db.knowledgeChunks.filter((entry) => entry.fileId === id).forEach(disable);
      db.knowledgeFacts.filter((entry) => entry.fileId === id).forEach(disable);
      return file;
    });
    if (!deleted) return fail("知识库文件不存在", 404);
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除知识库文件失败", 500);
  }
}
