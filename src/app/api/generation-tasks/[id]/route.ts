import { AuthError, assertCustomerAccess, defaultModelForUser, requireUser } from "@/lib/auth";
import { activeIds, base, isActive, log, now, selectedFiles, selectedKeywords, withDb } from "@/lib/db";
import { recoverStaleRunningTasks } from "@/lib/generation";
import { fail, ok } from "@/lib/http";
import type { GenerationTask, GenerationTaskItem } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = withDb((currentDb) => {
      recoverStaleRunningTasks(currentDb);
      return currentDb;
    });
    const task = db.generationTasks.find((entry) => entry.id === id && entry.status !== "cancelled");
    if (!task) return fail("任务不存在", 404);

    const customer = assertCustomerAccess(
      user,
      db.customers.find((entry) => entry.id === task.customerId && isActive(entry))
    );

    const keywordIds = activeIds(db.keywords.filter((entry) => entry.customerId === customer.id));
    return ok({
      task: { ...task, customer },
      items: db.generationTaskItems.filter((entry) => entry.taskId === id && keywordIds.has(entry.keywordId)),
      articles: db.generatedArticles.filter((entry) => entry.taskId === id && keywordIds.has(entry.keywordId)),
      logs: db.operationLogs.filter((entry) => entry.targetId === id || (entry.targetType === "generation_task" && entry.targetId === id))
    });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取任务失败", 500);
  }
}

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<GenerationTask>;

    const updated = withDb((db) => {
      const task = db.generationTasks.find((entry) => entry.id === id && entry.status !== "cancelled");
      if (!task) return null;
      if (task.status === "running") return "running" as const;

      const customer = assertCustomerAccess(
        user,
        db.customers.find((entry) => entry.id === task.customerId && isActive(entry))
      );

      const nextKeywordIds = input.keywordIds
        ? selectedKeywords(db, input.keywordIds)
            .filter((keyword) => keyword.customerId === customer.id && isActive(keyword))
            .map((keyword) => keyword.id)
        : task.keywordIds;
      if (!nextKeywordIds.length) return "no_keywords" as const;

      const nextFileIds = input.knowledgeFileIds
        ? selectedFiles(db, input.knowledgeFileIds)
            .filter((file) => file.customerId === customer.id && isActive(file) && file.parseStatus === "parsed" && !file.errorMessage.trim())
            .map((file) => file.id)
        : task.knowledgeFileIds;

      const selectedPromptIds = new Set(input.promptIds ?? task.promptIds);
      const nextPromptIds = db.prompts
        .filter((prompt) => selectedPromptIds.has(prompt.id))
        .filter((prompt) => isActive(prompt) && (prompt.scope === "global" || prompt.customerId === customer.id))
        .slice(0, 1)
        .map((prompt) => prompt.id);

      const model = defaultModelForUser(db, user, input.modelConfigId || task.modelConfigId);
      if (!model) return "no_model" as const;

      const before = taskSignature(task);
      task.name = input.name?.trim() || task.name;
      task.modelConfigId = model.id;
      task.keywordIds = nextKeywordIds;
      task.knowledgeFileIds = nextFileIds;
      task.promptIds = nextPromptIds;
      task.articleCount = normalizeInt(input.articleCount, task.articleCount, 1, 100);
      task.wordCount = normalizeInt(input.wordCount, task.wordCount, 100, 20_000);
      task.articleType = input.articleType?.trim() || task.articleType;
      task.comparisonObjects = normalizeText(input.comparisonObjects, task.comparisonObjects || "");
      task.modelThinking = normalizeText(input.modelThinking, task.modelThinking || "");
      task.enableCheck = false;
      task.maxRetries = normalizeInt(input.maxRetries, task.maxRetries, 0, 10);
      task.remark = input.remark ?? task.remark;
      task.updatedAt = now();

      const configChanged = before !== taskSignature(task);
      if (configChanged) {
        db.generatedArticles = db.generatedArticles.filter((article) => article.taskId !== task.id);
        db.generationTaskItems = db.generationTaskItems.filter((item) => item.taskId !== task.id);
        for (let index = 0; index < task.articleCount; index += 1) {
          const keywordId = task.keywordIds[index % task.keywordIds.length];
          const item = base("task_item", {
            taskId: task.id,
            customerId: task.customerId,
            keywordId,
            sortOrder: index + 1,
            status: "pending",
            retryCount: 0,
            errorMessage: "",
            articleId: null,
            startedAt: null,
            finishedAt: null
          }) satisfies GenerationTaskItem;
          db.generationTaskItems.push(item);
        }
        task.status = "pending";
      }

      log(db, "edit_task", "generation_task", task.id, configChanged ? "task reset after edit" : "task updated");
      return task;
    });

    if (!updated) return fail("任务不存在", 404);
    if (updated === "running") return fail("任务正在执行中，不能编辑");
    if (updated === "no_keywords") return fail("请选择可用关键词");
    if (updated === "no_model") return fail("模型配置不可用");
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新任务失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const cancelled = withDb((db) => {
      const task = db.generationTasks.find((entry) => entry.id === id);
      if (!task) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === task.customerId && isActive(customer)));
      task.status = "cancelled";
      task.updatedAt = now();
      log(db, "delete_task", "generation_task", task.id, task.name);
      return task;
    });
    if (!cancelled) return fail("任务不存在", 404);
    return ok(cancelled);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除任务失败", 500);
  }
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function taskSignature(task: GenerationTask) {
  return JSON.stringify({
    modelConfigId: task.modelConfigId,
    keywordIds: [...task.keywordIds].sort(),
    knowledgeFileIds: [...task.knowledgeFileIds].sort(),
    promptIds: [...task.promptIds].sort(),
    articleCount: task.articleCount,
    wordCount: task.wordCount,
    articleType: task.articleType,
    comparisonObjects: task.comparisonObjects || "",
    modelThinking: task.modelThinking || "",
    maxRetries: task.maxRetries
  });
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}
