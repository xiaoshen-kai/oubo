import { decryptSecret } from "./crypto";
import { activeIds, base, isActive, log, now, readDb, writeDb } from "./db";
import { selectRelevantChunks } from "./knowledge";
import { modelHttpErrorMessage } from "./model-errors";
import { buildTaskVariablePrompt } from "./prompt-variables";
import type {
  AppDb,
  CheckResult,
  Citation,
  GeneratedArticle,
  GenerationContext,
  GenerationTaskItem,
  KnowledgeChunk,
  KnowledgeFact,
  PromptSnapshot
} from "./types";

const staleTaskBufferMs = 30_000;
const minStaleTaskMs = 120_000;

export async function runTask(taskId: string) {
  const db = readDb();
  const task = db.generationTasks.find((entry) => entry.id === taskId && entry.status !== "cancelled");
  if (!task) throw new Error("任务不存在");

  const customer = db.customers.find((entry) => entry.id === task.customerId && isActive(entry));
  if (!customer) throw new Error("任务不存在");

  task.status = "running";
  task.updatedAt = now();
  writeDb(db);

  try {
    const maxAttempts = taskRunAttempts(db, task.modelConfigId, task.maxRetries);
    const items = db.generationTaskItems
      .filter((item) => item.taskId === task.id && item.status !== "passed")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    await Promise.all(items.map((item) => processTaskItemWithRetries(task.id, item.id, maxAttempts)));
  } finally {
    finalizeTaskRun(task.id);
  }
}

export function finalizeTaskRun(taskId: string) {
  const latest = readDb();
  const latestTask = latest.generationTasks.find((entry) => entry.id === taskId && entry.status !== "cancelled");
  const latestItems = latest.generationTaskItems.filter((item) => item.taskId === taskId);
  if (latestTask) {
    latestTask.status = latestItems.every((item) => item.status === "passed") ? "completed" : "failed";
    latestTask.updatedAt = now();
    log(latest, "run_task", "generation_task", latestTask.id, latestTask.status);
  }
  writeDb(latest);
}

export function failTaskRun(taskId: string, detail: string) {
  const db = readDb();
  const task = db.generationTasks.find((entry) => entry.id === taskId && entry.status !== "cancelled");
  if (!task) return;
  const at = now();
  db.generationTaskItems
    .filter((item) => item.taskId === taskId && ["pending", "generating", "checking"].includes(item.status))
    .forEach((item) => {
      item.status = "failed";
      item.errorMessage = detail;
      item.finishedAt = item.finishedAt || at;
      item.updatedAt = at;
    });
  task.status = "failed";
  task.updatedAt = at;
  log(db, "run_task_failed", "generation_task", task.id, detail);
  writeDb(db);
}

export function recoverStaleRunningTasks(db: AppDb) {
  const currentTime = Date.now();
  const at = now();
  let changed = false;

  for (const task of db.generationTasks.filter((entry) => entry.status === "running")) {
    const model = db.modelConfigs.find((entry) => entry.id === task.modelConfigId);
    const staleAfterMs = Math.max((model?.timeoutSeconds || 90) * 1000 + staleTaskBufferMs, minStaleTaskMs);
    const taskItems = db.generationTaskItems.filter((item) => item.taskId === task.id);

    for (const item of taskItems) {
      if (!["generating", "checking"].includes(item.status)) continue;
      const itemUpdatedAt = new Date(item.updatedAt || item.startedAt || task.updatedAt).getTime();
      if (!Number.isFinite(itemUpdatedAt) || currentTime - itemUpdatedAt < staleAfterMs) continue;
      item.status = "failed";
      item.retryCount += 1;
      item.errorMessage = `模型响应超过 ${Math.round(staleAfterMs / 1000)} 秒仍未完成，已自动标记失败。建议调高模型 Timeout，或降低单篇字数 / Max Tokens 后重试。`;
      item.finishedAt = at;
      item.updatedAt = at;
      log(db, "recover_stale_item", "generation_task", task.id, `item ${item.sortOrder}: ${item.errorMessage}`);
      changed = true;
    }

    const activeItems = taskItems.filter((item) => ["generating", "checking"].includes(item.status));
    const taskUpdatedAt = new Date(task.updatedAt).getTime();
    const taskIsStale = !Number.isFinite(taskUpdatedAt) || currentTime - taskUpdatedAt >= staleAfterMs;
    if (!activeItems.length && taskIsStale) {
      for (const item of taskItems.filter((entry) => entry.status === "pending")) {
        item.status = "failed";
        item.errorMessage = "任务执行中断，前置子任务超时后未继续生成。";
        item.finishedAt = at;
        item.updatedAt = at;
        changed = true;
      }
      task.status = taskItems.every((item) => item.status === "passed") ? "completed" : "failed";
      task.updatedAt = at;
      log(db, "recover_stale_task", "generation_task", task.id, task.status);
      changed = true;
    }
  }

  return changed;
}

export async function processTaskItem(taskId: string, itemId: string) {
  const db = readDb();
  const item = db.generationTaskItems.find((entry) => entry.id === itemId);
  const task = db.generationTasks.find((entry) => entry.id === taskId && entry.status !== "cancelled");
  if (!task || !item) throw new Error("子任务不存在");

  db.generatedArticles = db.generatedArticles.filter((article) => article.taskItemId !== itemId);
  item.status = "generating";
  item.startedAt = now();
  item.finishedAt = null;
  item.articleId = null;
  item.errorMessage = "";
  item.updatedAt = now();
  log(db, "task_item_started", "generation_task", taskId, `item ${item.sortOrder}`);
  writeDb(db);

  try {
    const context = buildGenerationContext(taskId, itemId);
    const output = await generateArticle(context);
    const checkResult = passCheck();

    const latest = readDb();
    const latestItem = latest.generationTaskItems.find((entry) => entry.id === itemId);
    if (!latestItem) throw new Error("子任务不存在");
    latestItem.status = "checking";
    latestItem.updatedAt = now();

    const article = base("article", {
      taskId: context.task.id,
      taskItemId: context.item.id,
      customerId: context.customer.id,
      keywordId: context.keyword.id,
      modelConfigId: context.modelConfig.id,
      title: output.title,
      summary: output.summary,
      content: output.content,
      rawResponse: output.rawResponse,
      promptSnapshot: output.promptSnapshot,
      citations: output.citations,
      checkResult,
      status: checkResult.passed ? "passed" : "failed",
      promptTokens: output.promptTokens,
      completionTokens: output.completionTokens,
      totalTokens: output.totalTokens
    }) satisfies GeneratedArticle;

    latest.generatedArticles = latest.generatedArticles.filter((entry) => entry.taskItemId !== itemId);
    latest.generatedArticles.unshift(article);
    latestItem.articleId = article.id;
    latestItem.status = checkResult.passed ? "passed" : "failed";
    latestItem.errorMessage = checkResult.issues.join("；");
    latestItem.finishedAt = now();
    latestItem.updatedAt = now();
    log(
      latest,
      checkResult.passed ? "task_item_passed" : "task_item_failed",
      "generation_task",
      taskId,
      checkResult.issues.join("; ") || `item ${latestItem.sortOrder}`
    );
    writeDb(latest);
  } catch (error) {
    const latest = readDb();
    const failedItem = latest.generationTaskItems.find((entry) => entry.id === itemId);
    if (failedItem) {
      failedItem.status = "failed";
      failedItem.retryCount += 1;
      failedItem.errorMessage = modelErrorMessage(error);
      failedItem.finishedAt = now();
      failedItem.updatedAt = now();
      log(latest, "task_item_failed", "generation_task", taskId, `item ${failedItem.sortOrder}: ${failedItem.errorMessage}`);
    }
    writeDb(latest);
  }
}

export async function processTaskItemWithRetries(taskId: string, itemId: string, maxAttempts?: number) {
  const attempts = maxAttempts ?? taskRunAttemptsForItem(taskId);
  let latestItem: GenerationTaskItem | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await processTaskItem(taskId, itemId);
    const latest = readDb();
    latestItem = latest.generationTaskItems.find((entry) => entry.id === itemId) || null;
    if (!latestItem || latestItem.status === "passed") return latestItem;
    if (attempt >= attempts) return latestItem;

    latest.generatedArticles = latest.generatedArticles.filter((article) => article.taskItemId !== itemId);
    latestItem.status = "pending";
    latestItem.retryCount = Math.max(latestItem.retryCount, attempt);
    latestItem.errorMessage = "";
    latestItem.articleId = null;
    latestItem.startedAt = null;
    latestItem.finishedAt = null;
    latestItem.updatedAt = now();
    log(latest, "task_item_retry", "generation_task", taskId, `item ${latestItem.sortOrder}: attempt ${attempt + 1}/${attempts}`);
    writeDb(latest);
  }

  return latestItem;
}

function taskRunAttemptsForItem(taskId: string) {
  const db = readDb();
  const task = db.generationTasks.find((entry) => entry.id === taskId);
  return taskRunAttempts(db, task?.modelConfigId || "", task?.maxRetries || 0);
}

function taskRunAttempts(db: AppDb, modelConfigId: string, taskMaxRetries: number) {
  const model = db.modelConfigs.find((entry) => entry.id === modelConfigId);
  const taskRetryBudget = Number(taskMaxRetries);
  const retryBudget = Number.isFinite(taskRetryBudget) ? taskRetryBudget : Number(model?.maxRetries || 0);
  return Math.min(Math.max(retryBudget + 1, 1), 4);
}

function modelErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "生成失败";
  if (error.message !== "fetch failed") return error.message;
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? cause.message : "";
  return causeText ? `模型连接失败：${causeText}` : "模型连接失败：fetch failed";
}

export function buildGenerationContext(taskId: string, itemId: string): GenerationContext {
  const db = readDb();
  const task = db.generationTasks.find((entry) => entry.id === taskId && entry.status !== "cancelled");
  const item = db.generationTaskItems.find((entry) => entry.id === itemId);
  if (!task || !item) throw new Error("任务不存在");

  const customer = db.customers.find((entry) => entry.id === task.customerId && isActive(entry));
  const keyword = db.keywords.find((entry) => entry.id === item.keywordId && isActive(entry));
  const modelConfig = db.modelConfigs.find((entry) => entry.id === task.modelConfigId && isActive(entry));
  if (!customer || !keyword || !modelConfig) throw new Error("任务上下文不完整");

  const activeFileIds = activeIds(db.knowledgeFiles.filter((file) => file.customerId === customer.id));
  const selectedFileIds = task.knowledgeFileIds.filter((fileId) => activeFileIds.has(fileId));
  const factFileIds = selectedFileIds.length ? new Set(selectedFileIds) : activeFileIds;
  const prompts = db.prompts.filter(
    (prompt) =>
      task.promptIds.includes(prompt.id) &&
      isActive(prompt) &&
      (prompt.scope === "global" || prompt.customerId === customer.id)
  );
  const facts = db.knowledgeFacts
    .filter(
      (fact) =>
        fact.customerId === customer.id &&
        isActive(fact) &&
        (!fact.fileId || factFileIds.has(fact.fileId)) &&
        ["must_use", "prefer_use", "forbidden"].includes(fact.usageRule)
    )
    .sort((a, b) => b.priority - a.priority);
  const chunks = selectRelevantChunks(
    db.knowledgeChunks.filter((chunk) => chunk.customerId === customer.id && activeFileIds.has(chunk.fileId)),
    keyword.keyword,
    selectedFileIds
  );

  return { task, item, customer, keyword, prompts, modelConfig, facts, chunks };
}

async function generateArticle(context: GenerationContext) {
  const prompt = buildPrompt(context);
  const promptSnapshot = buildPromptSnapshot(context, prompt);
  const apiKey = decryptSecret(context.modelConfig.apiKeyEncrypted);
  if (apiKey && context.modelConfig.baseUrl && context.modelConfig.modelName !== "local-draft") {
    const llmResult = await callModel(context, prompt, apiKey);
    const parsed = parseArticleJson(llmResult.content);
    return {
      ...parsed,
      rawResponse: llmResult.rawResponse,
      promptSnapshot,
      promptTokens: llmResult.promptTokens,
      completionTokens: llmResult.completionTokens,
      totalTokens: llmResult.totalTokens
    };
  }
  return localDraft(context, promptSnapshot);
}

function buildPromptSnapshot(context: GenerationContext, promptText: string): PromptSnapshot {
  return {
    promptText,
    promptTemplates: context.prompts.map((prompt) => ({
      id: prompt.id,
      name: prompt.name,
      scope: prompt.scope,
      content: prompt.content
    })),
    customerName: context.customer.name,
    keyword: context.keyword.keyword,
    recommendationObject: context.customer.name,
    comparisonObjects: context.task.comparisonObjects || "",
    modelThinking: context.task.modelThinking || "",
    modelName: context.modelConfig.name || context.modelConfig.modelName,
    generatedAt: new Date().toISOString()
  };
}

function buildPrompt(context: GenerationContext) {
  const facts = context.facts.map((fact) => `${fact.factCode}（${fact.usageRule}）：${fact.factText}`).join("\n");
  const chunks = context.chunks.map((chunk) => `${chunk.chunkCode}（${chunk.title}）\n${chunk.content}`).join("\n\n");
  const prompts = context.prompts.map((prompt) => `《${prompt.name}》\n${prompt.content}`).join("\n\n");
  const taskVariables = buildTaskVariablePrompt({
    customerName: context.customer.name,
    keyword: context.keyword.keyword,
    articleType: context.task.articleType,
    wordCount: context.task.wordCount,
    comparisonObjects: context.task.comparisonObjects,
    modelThinking: context.task.modelThinking
  });

  return `你是一个专业的 GEO / SEO 内容生成助手。
必须严格基于客户知识库和核心事实写作，不得编造客户没有提供的信息，不得虚构案例、数据、服务承诺，不得夸大效果。
正文中不要显示 FACT 或 KB 编号，但 citations 字段必须标明每段内容引用了哪些 FACT 或 KB。

【客户】
${context.customer.name}

【提示词】
${prompts || "无"}

【核心事实】
${facts || "无"}

【知识片段】
${chunks || "无"}

【任务变量】
${taskVariables}

【文章要求】
请输出 JSON：{"title":"","summary":"","content":"","citations":[{"paragraph":1,"source_codes":["FACT001","KB001"]}]}`;
}

async function callModel(context: GenerationContext, prompt: string, apiKey: string) {
  if (usesAnthropicMessagesApi(context.modelConfig)) return callAnthropicMessagesModel(context, prompt, apiKey);
  return callOpenAiCompatibleModel(context, prompt, apiKey);
}

function usesAnthropicMessagesApi(modelConfig: GenerationContext["modelConfig"]) {
  const baseUrl = modelConfig.baseUrl.toLowerCase();
  const modelName = modelConfig.modelName.toLowerCase();
  return modelConfig.provider === "anthropic" || baseUrl.includes("claudecode") || baseUrl.includes("anthropic") || modelName.startsWith("claude-");
}

async function callOpenAiCompatibleModel(context: GenerationContext, prompt: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.modelConfig.timeoutSeconds * 1000);
  const baseUrl = context.modelConfig.baseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: context.modelConfig.modelName,
        messages: [{ role: "user", content: prompt }],
        temperature: context.modelConfig.temperature,
        max_tokens: context.modelConfig.maxTokens,
        top_p: context.modelConfig.topP
      }),
      signal: controller.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(modelHttpErrorMessage("模型调用", response.status, responseText));
    }
    let parsedResponse: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      throw new Error(`模型接口没有返回 JSON，请检查 Base URL。返回内容：${responseText.slice(0, 120)}`);
    }
    const modelContent = parsedResponse.choices?.[0]?.message?.content || "";
    if (!modelContent) throw new Error("模型响应中没有可用内容");
    return {
      content: modelContent,
      rawResponse: parsedResponse,
      promptTokens: parsedResponse.usage?.prompt_tokens || 0,
      completionTokens: parsedResponse.usage?.completion_tokens || 0,
      totalTokens: parsedResponse.usage?.total_tokens || 0
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`模型响应超时（超过 ${context.modelConfig.timeoutSeconds} 秒）。请调高模型 Timeout，或降低单篇字数 / Max Tokens 后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callAnthropicMessagesModel(context: GenerationContext, prompt: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.modelConfig.timeoutSeconds * 1000);
  try {
    const response = await fetch(anthropicMessagesUrl(context.modelConfig.baseUrl), {
      method: "POST",
      headers: anthropicHeaders(context.modelConfig.baseUrl, apiKey),
      body: JSON.stringify({
        model: context.modelConfig.modelName,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        temperature: context.modelConfig.temperature,
        max_tokens: context.modelConfig.maxTokens,
        top_p: context.modelConfig.topP
      }),
      signal: controller.signal
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(modelHttpErrorMessage("Claude Code/Anthropic 调用", response.status, responseText));
    }
    let parsedResponse: {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      throw new Error(`Claude Code/Anthropic 接口没有返回 JSON，请检查 Base URL。返回内容：${responseText.slice(0, 120)}`);
    }
    const modelContent = (parsedResponse.content || [])
      .filter((part) => part.type === "text" || part.text)
      .map((part) => part.text || "")
      .join("\n")
      .trim();
    if (!modelContent) throw new Error("Claude Code/Anthropic 响应中没有可用文本内容");
    return {
      content: modelContent,
      rawResponse: parsedResponse,
      promptTokens: parsedResponse.usage?.input_tokens || 0,
      completionTokens: parsedResponse.usage?.output_tokens || 0,
      totalTokens: (parsedResponse.usage?.input_tokens || 0) + (parsedResponse.usage?.output_tokens || 0)
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Claude Code/Anthropic 响应超时（超过 ${context.modelConfig.timeoutSeconds} 秒）。请调高模型 Timeout，或降低单篇字数 / Max Tokens 后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function anthropicMessagesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized;
  if (normalized.endsWith("/messages")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function anthropicHeaders(baseUrl: string, apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01"
  };
  if (isClaudeCodeRelay(baseUrl)) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function isClaudeCodeRelay(baseUrl: string) {
  const value = baseUrl.toLowerCase();
  return value.includes("claudecode") || value.includes("aicodemirror");
}

function parseArticleJson(content: string) {
  const trimmed = stripCodeFence(content.trim());
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] || "";
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      return {
        title: String(parsed.title || ""),
        summary: String(parsed.summary || ""),
        content: String(parsed.content || ""),
        citations: normalizeCitations(parsed.citations)
      };
    } catch {
      const tolerant = parseLooseArticleJson(jsonText);
      if (tolerant) return tolerant;
    }
  }
  return fallbackArticleFromModelText(content);
}

function parseLooseArticleJson(jsonText: string) {
  const title = extractLooseStringField(jsonText, "title", "summary");
  const summary = extractLooseStringField(jsonText, "summary", "content");
  const articleContent = extractLooseStringField(jsonText, "content", "citations");
  const citations = extractLooseCitations(jsonText);
  if (!title && !summary && !articleContent && !citations.length) return null;
  return {
    title: title || firstReadableLine(articleContent) || "模型返回内容需人工复核",
    summary: summary || articleContent.replace(/\s+/g, " ").slice(0, 180),
    content: articleContent || jsonText,
    citations
  };
}

function extractLooseStringField(jsonText: string, field: string, nextField: string) {
  const startMatch = new RegExp(`"${field}"\\s*:\\s*"`).exec(jsonText);
  if (!startMatch) return "";
  const start = startMatch.index + startMatch[0].length;
  const rest = jsonText.slice(start);
  const endMatch = new RegExp(`"\\s*,\\s*"${nextField}"\\s*:`).exec(rest);
  const raw = endMatch ? rest.slice(0, endMatch.index) : rest.replace(/"\s*}\s*$/, "");
  return decodeLooseJsonString(raw).trim();
}

function extractLooseCitations(jsonText: string) {
  const startMatch = /"citations"\s*:\s*\[/.exec(jsonText);
  if (!startMatch) return [] as Citation[];
  const start = startMatch.index + startMatch[0].lastIndexOf("[");
  const end = findMatchingBracket(jsonText, start);
  const arrayText = end >= 0 ? jsonText.slice(start, end + 1) : "";
  if (arrayText) {
    try {
      return normalizeCitations(JSON.parse(arrayText));
    } catch {
      return parseCitationObjects(arrayText);
    }
  }
  return [];
}

function findMatchingBracket(value: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCitationObjects(arrayText: string) {
  return Array.from(arrayText.matchAll(/\{[\s\S]*?\}/g)).map((match, index) => {
    const row = match[0];
    const paragraph = Number(row.match(/"paragraph"\s*:\s*(\d+)/)?.[1] || index + 1);
    const sourceCodesText = row.match(/"source_codes"\s*:\s*\[([\s\S]*?)\]/)?.[1] || row.match(/"sourceCodes"\s*:\s*\[([\s\S]*?)\]/)?.[1] || "";
    const sourceCodes = Array.from(sourceCodesText.matchAll(/"([^"]+)"/g)).map((codeMatch) => codeMatch[1]);
    return { paragraph, sourceCodes, confidence: 0.75 };
  });
}

function decodeLooseJsonString(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function fallbackArticleFromModelText(content: string) {
  const cleaned = stripCodeFence(content).trim();
  const firstHeading = cleaned.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const firstLine = firstReadableLine(cleaned) || "模型返回内容需人工复核";
  const title = (firstHeading || firstLine).slice(0, 80);
  return {
    title,
    summary: cleaned.replace(/\s+/g, " ").slice(0, 180),
    content: cleaned,
    citations: [] as Citation[]
  };
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function firstReadableLine(value: string) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}


function localDraft(context: GenerationContext, promptSnapshot: PromptSnapshot) {
  const factLines = context.facts.filter((fact) => fact.usageRule !== "forbidden").slice(0, 4);
  const chunkLines = context.chunks.slice(0, 4);
  const customerName = context.customer.shortName || context.customer.name;
  const title = `${context.keyword.keyword}怎么做？基于${customerName}知识库的内容建议`;
  const intro = `围绕“${context.keyword.keyword}”，企业更需要把客户资料、服务能力和可验证事实组织成容易被搜索和问答系统理解的内容。`;
  const body: string[] = [intro];

  for (const fact of factLines) {
    body.push(
      `${customerName}的资料显示：${fact.factText}。这类信息适合放在文章的核心说明位置，用来提高内容可信度。`
    );
  }

  for (const chunk of chunkLines) {
    body.push(
      `${chunk.title}方面，可以围绕知识库中的内容展开：${chunk.content.slice(
        0,
        180
      )}。实际发布时建议保留原始表述中的关键信息，避免额外添加未经确认的数据。`
    );
  }

  body.push(
    `小结来看，围绕“${context.keyword.keyword}”生成内容时，重点不是堆砌关键词，而是让每一个观点都能回到客户知识库中的事实依据。`
  );

  const citations: Citation[] = body.map((paragraph, index) => {
    const fact = factLines[index - 1];
    const chunk = chunkLines[index - factLines.length - 1];
    const sourceCodes =
      index === 0
        ? [
            ...factLines.slice(0, 1).map((item) => item.factCode),
            ...chunkLines.slice(0, 1).map((item) => item.chunkCode)
          ]
        : fact
          ? [fact.factCode]
          : chunk
            ? [chunk.chunkCode]
            : factLines.slice(0, 1).map((item) => item.factCode);
    return {
      paragraph: index + 1,
      sourceCodes,
      sourceType: citationSourceType(sourceCodes),
      sourceIds: sourceIds(sourceCodes, factLines, chunkLines),
      quotedText: paragraph.slice(0, 80),
      confidence: 0.78
    };
  });

  return {
    title,
    summary: `围绕 ${context.keyword.keyword} 的 GEO 内容草稿，已附带知识库引用映射。`,
    content: body.join("\n\n"),
    citations,
    promptSnapshot,
    rawResponse: { mode: "local-draft" },
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };
}

function normalizeCitations(input: unknown): Citation[] {
  if (!Array.isArray(input)) return [];
  return input.map((item, index) => {
    const row = item as Record<string, unknown>;
    const codes = row.source_codes || row.sourceCodes;
    return {
      paragraph: Number(row.paragraph || index + 1),
      sourceCodes: Array.isArray(codes) ? codes.map(String) : [],
      confidence: 0.75
    };
  });
}

function citationSourceType(sourceCodes: string[]) {
  const hasFacts = sourceCodes.some((code) => code.startsWith("FACT"));
  const hasChunks = sourceCodes.some((code) => code.startsWith("KB"));
  if (hasFacts && hasChunks) return "mixed";
  if (hasFacts) return "fact";
  if (hasChunks) return "chunk";
  return undefined;
}

function sourceIds(sourceCodes: string[], facts: KnowledgeFact[], chunks: KnowledgeChunk[]) {
  return sourceCodes
    .map((code) => {
      if (code.startsWith("FACT")) return facts.find((fact) => fact.factCode === code)?.id;
      return chunks.find((chunk) => chunk.chunkCode === code)?.id;
    })
    .filter((item): item is string => Boolean(item));
}

function passCheck(): CheckResult {
  return { passed: true, score: 100, issues: [], suggestions: [] };
}
