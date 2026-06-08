import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { isActive, now, readDb, writeDb } from "@/lib/db";
import { failTaskRun, recoverStaleRunningTasks, runTask } from "@/lib/generation";
import { fail, ok } from "@/lib/http";
import { clearGeneratedArticlesForTask, resetTaskItemsForFreshRun } from "@/lib/task-run";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    await readStartRequest(request);
    const db = readDb();
    recoverStaleRunningTasks(db);
    const task = db.generationTasks.find((entry) => entry.id === id && entry.status !== "cancelled");
    if (!task) return fail("任务不存在", 404);
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === task.customerId && isActive(customer)));
    if (task.status === "running") return fail("任务正在执行中，请稍后再试");

    const resetAt = now();
    task.status = "running";
    task.updatedAt = resetAt;
    const taskItems = db.generationTaskItems.filter((item) => item.taskId === id);
    const resetItems = resetTaskItemsForFreshRun(taskItems, resetAt);
    taskItems.forEach((item, index) => {
      Object.assign(item, resetItems[index]);
    });
    db.generatedArticles = clearGeneratedArticlesForTask(db.generatedArticles, id);
    if (!taskItems.length) {
      task.status = "completed";
      task.updatedAt = resetAt;
      writeDb(db);
      return ok(readDb().generationTasks.find((entry) => entry.id === id));
    }
    writeDb(db);

    void runTask(id).catch((error) => {
      failTaskRun(id, error instanceof Error ? error.message : "任务执行失败");
    });
    return ok(readDb().generationTasks.find((entry) => entry.id === id));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("启动任务失败", 500);
  }
}

async function readStartRequest(request: Request): Promise<void> {
  try {
    await request.json();
  } catch {
  }
}
