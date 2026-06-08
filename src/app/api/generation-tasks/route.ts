import {
  AuthError,
  assertCustomerAccess,
  defaultModelForUser,
  requireUser,
  visibleCustomersForUser
} from "@/lib/auth";
import { activeIds, base, isActive, log, selectedFiles, selectedKeywords, withDb } from "@/lib/db";
import { failTaskRun, recoverStaleRunningTasks, runTask } from "@/lib/generation";
import { fail, ok } from "@/lib/http";
import type { GenerationTask, GenerationTaskItem } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "open";
    const db = withDb((currentDb) => {
      recoverStaleRunningTasks(currentDb);
      return currentDb;
    });
    const visibleCustomerIds = new Set(visibleCustomersForUser(user, db.customers).filter(isActive).map((customer) => customer.id));
    const activeKeywordIds = activeIds(db.keywords);
    return ok(
      db.generationTasks
        .filter((task) => visibleCustomerIds.has(task.customerId))
        .filter((task) => task.keywordIds.some((keywordId) => activeKeywordIds.has(keywordId)))
        .filter((task) => status === "all" || task.status !== "cancelled")
        .map((task) => ({
          ...task,
          customer: db.customers.find((customer) => customer.id === task.customerId && isActive(customer)),
          items: db.generationTaskItems.filter((item) => item.taskId === task.id && activeKeywordIds.has(item.keywordId)),
          articles: db.generatedArticles.filter((article) => article.taskId === task.id && activeKeywordIds.has(article.keywordId))
        }))
    );
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取任务失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = (await request.json()) as Partial<GenerationTask> & {
      autoRun?: boolean;
    };
    if (!input.customerId) return fail("请选择客户");
    if (!input.keywordIds?.length) return fail("请选择关键词");

    const created = withDb((db) => {
      const customer = assertCustomerAccess(
        user,
        db.customers.find((entry) => entry.id === input.customerId && isActive(entry))
      );
      const keywords = selectedKeywords(db, input.keywordIds || []).filter(
        (keyword) => keyword.customerId === customer.id && isActive(keyword)
      );
      if (!keywords.length) return null;
      const model = defaultModelForUser(db, user, input.modelConfigId);
      if (!model) return null;
      const files = selectedFiles(db, input.knowledgeFileIds || []).filter(
        (file) => file.customerId === customer.id && isActive(file) && file.parseStatus === "parsed" && !file.errorMessage.trim()
      );
      const selectedPromptIds = new Set(input.promptIds || []);
      const promptIds = db.prompts
        .filter((prompt) => selectedPromptIds.has(prompt.id))
        .filter((prompt) => isActive(prompt) && (prompt.scope === "global" || prompt.customerId === customer.id))
        .slice(0, 1)
        .map((prompt) => prompt.id);
      const taskName = input.name?.trim() || "未命名生成任务";
      const keywordIds = keywords.map((keyword) => keyword.id);
      const knowledgeFileIds = files.map((file) => file.id);
      const articleCount = Number(input.articleCount || 1);
      const wordCount = Number(input.wordCount || 800);
      const articleType = input.articleType || "GEO文章";
      const comparisonObjects = normalizeText(input.comparisonObjects);
      const modelThinking = normalizeText(input.modelThinking);
      const duplicate = db.generationTasks.find(
        (entry) =>
          entry.status !== "cancelled" &&
          entry.customerId === customer.id &&
          entry.modelConfigId === model.id &&
          entry.name === taskName &&
          entry.articleCount === articleCount &&
          entry.wordCount === wordCount &&
          entry.articleType === articleType &&
          (entry.comparisonObjects || "") === comparisonObjects &&
          (entry.modelThinking || "") === modelThinking &&
          sameIds(entry.keywordIds, keywordIds) &&
          sameIds(entry.knowledgeFileIds, knowledgeFileIds) &&
          sameIds(entry.promptIds, promptIds) &&
          Date.now() - new Date(entry.createdAt).getTime() < 15_000
      );
      if (duplicate) return { task: duplicate, duplicate: true };

      const task = base("task", {
        name: taskName,
        customerId: customer.id,
        modelConfigId: model.id,
        keywordIds,
        knowledgeFileIds,
        promptIds,
        articleCount,
        wordCount,
        articleType,
        comparisonObjects,
        modelThinking,
        status: "pending",
        enableCheck: false,
        maxRetries: Number(input.maxRetries ?? 0),
        remark: input.remark || ""
      }) satisfies GenerationTask;
      db.generationTasks.unshift(task);

      for (let index = 0; index < task.articleCount; index += 1) {
        const keyword = keywords[index % keywords.length];
        const item = base("task_item", {
          taskId: task.id,
          customerId: task.customerId,
          keywordId: keyword.id,
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
      log(db, "create_task", "generation_task", task.id, task.name);
      return { task, duplicate: false };
    });
    if (!created) return fail("关键词为空、模型不可用或无权访问");
    if (!created.duplicate && (input.autoRun ?? true)) {
      void runTask(created.task.id).catch((error) => {
        failTaskRun(created.task.id, error instanceof Error ? error.message : "任务执行失败");
      });
    }
    return ok(created.task);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建任务失败", 500);
  }
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
