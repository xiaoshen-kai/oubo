import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { activeIds, id as makeId, isActive, now, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { GeneratedArticle } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function findVisibleArticle(db: ReturnType<typeof readDb>, user: ReturnType<typeof requireUser>, articleId: string) {
  const activeKeywordIds = activeIds(db.keywords);
  const article = db.generatedArticles.find((entry) => entry.id === articleId && activeKeywordIds.has(entry.keywordId));
  if (!article) return null;
  assertCustomerAccess(user, db.customers.find((customer) => customer.id === article.customerId && isActive(customer)));
  return article;
}

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = readDb();
    const article = findVisibleArticle(db, user, id);
    if (!article) return fail("文章不存在", 404);
    return ok(article);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取文章失败", 500);
  }
}

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<GeneratedArticle>;
    const updated = withDb((db) => {
      const article = findVisibleArticle(db, user, id);
      if (!article) return null;
      article.title = input.title ?? article.title;
      article.summary = input.summary ?? article.summary;
      article.content = input.content ?? article.content;
      article.status = input.status || article.status;
      article.updatedAt = now();
      return article;
    });
    if (!updated) return fail("文章不存在", 404);
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新文章失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const article = findVisibleArticle(db, user, id);
      if (!article) return null;
      const index = db.generatedArticles.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const [removed] = db.generatedArticles.splice(index, 1);
      const deletedAt = now();
      const taskItem = db.generationTaskItems.find((item) => item.id === removed.taskItemId);
      if (taskItem?.articleId === removed.id) {
        taskItem.articleId = null;
        taskItem.updatedAt = deletedAt;
        if (taskItem.status === "passed") {
          taskItem.status = "failed";
          taskItem.errorMessage = "关联稿件已删除，可重新执行任务补生成。";
          taskItem.finishedAt = deletedAt;
        }
      }
      const task = db.generationTasks.find((entry) => entry.id === removed.taskId);
      if (task?.status === "completed" && taskItem?.status === "failed") {
        task.status = "failed";
        task.updatedAt = deletedAt;
      }
      return removed;
    });
    if (!deleted) return fail("文章不存在", 404);
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除文章失败", 500);
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const copied = withDb((db) => {
      const article = findVisibleArticle(db, user, id);
      if (!article) return null;
      const at = now();
      const copy: GeneratedArticle = {
        ...article,
        id: makeId("article"),
        title: `${article.title} - 副本`,
        status: "draft",
        createdAt: at,
        updatedAt: at
      };
      db.generatedArticles.unshift(copy);
      return copy;
    });
    if (!copied) return fail("文章不存在", 404);
    return ok(copied);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("复制文章失败", 500);
  }
}
