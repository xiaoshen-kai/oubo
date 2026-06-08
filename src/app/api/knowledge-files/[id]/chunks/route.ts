import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, readDb } from "@/lib/db";
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
    return ok(db.knowledgeChunks.filter((entry) => entry.fileId === id && isActive(entry)));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取知识片段失败", 500);
  }
}
