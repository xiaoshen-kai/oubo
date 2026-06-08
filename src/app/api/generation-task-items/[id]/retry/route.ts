import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, readDb, writeDb } from "@/lib/db";
import { finalizeTaskRun, processTaskItemWithRetries } from "@/lib/generation";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = readDb();
    const item = db.generationTaskItems.find((entry) => entry.id === id);
    if (!item) return fail("子任务不存在", 404);
    const task = db.generationTasks.find((entry) => entry.id === item.taskId && entry.status !== "cancelled");
    if (
      !task ||
      !db.keywords.some((keyword) => keyword.id === item.keywordId && isActive(keyword))
    ) {
      return fail("子任务不存在", 404);
    }
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === item.customerId && isActive(customer)));
    item.status = "pending";
    item.retryCount = 0;
    item.errorMessage = "";
    item.articleId = null;
    item.startedAt = null;
    item.finishedAt = null;
    item.updatedAt = now();
    db.generatedArticles = db.generatedArticles.filter((article) => article.taskItemId !== item.id);
    task.status = "running";
    task.updatedAt = item.updatedAt;
    writeDb(db);
    await processTaskItemWithRetries(item.taskId, item.id);
    finalizeTaskRun(item.taskId);
    return ok(readDb().generationTaskItems.find((entry) => entry.id === id));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("重试子任务失败", 500);
  }
}
