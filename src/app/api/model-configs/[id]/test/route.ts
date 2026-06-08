import { AuthError, requireAdmin } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { isActive, readDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  try {
    requireAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("模型测试失败", 500);
  }
  const { id } = await context.params;
  const model = readDb().modelConfigs.find((entry) => entry.id === id && isActive(entry));
  if (!model) return fail("模型配置不存在", 404);
  if (model.modelName === "local-draft") return ok({ message: "本地草稿生成器可用" });

  const apiKey = decryptSecret(model.apiKeyEncrypted);
  if (!apiKey || !model.baseUrl || !model.modelName) return fail("请先填写 Base URL、模型名称和 API Key");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), model.timeoutSeconds * 1000);

  try {
    if (usesAnthropicMessagesApi(model)) {
      const response = await fetch(anthropicMessagesUrl(model.baseUrl), {
        method: "POST",
        headers: anthropicHeaders(model.baseUrl, apiKey),
        body: JSON.stringify({
          model: model.modelName,
          messages: [{ role: "user", content: [{ type: "text", text: "请只返回 JSON：{\"ok\":true}" }] }],
          max_tokens: 32,
          temperature: 0
        }),
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) return fail(`模型测试失败：${response.status} ${text.slice(0, 180)}`, 502);

      let json: { content?: Array<{ text?: string }> };
      try {
        json = JSON.parse(text);
      } catch {
        return fail(`Claude Code/Anthropic 接口没有返回 JSON，请检查 Base URL。返回内容：${text.slice(0, 120)}`, 502);
      }

      const content = (json.content || []).map((part) => part.text || "").join("\n").trim();
      if (!content) return fail("Claude Code/Anthropic 响应中没有可用文本内容", 502);

      return ok({ message: "模型测试通过", sample: content.slice(0, 120) });
    }

    const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model.modelName,
        messages: [{ role: "user", content: "请只返回 JSON：{\"ok\":true}" }],
        max_tokens: 32,
        temperature: 0
      }),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) return fail(`模型测试失败：${response.status} ${text.slice(0, 180)}`, 502);

    let json: { choices?: Array<{ message?: { content?: string } }> };
    try {
      json = JSON.parse(text);
    } catch {
      return fail(`模型接口没有返回 JSON，请检查 Base URL。返回内容：${text.slice(0, 120)}`, 502);
    }

    const content = json.choices?.[0]?.message?.content || "";
    if (!content) return fail("模型响应中没有 choices[0].message.content", 502);

    return ok({ message: "模型测试通过", sample: content.slice(0, 120) });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return fail(`模型测试超时（超过 ${model.timeoutSeconds} 秒）`, 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function usesAnthropicMessagesApi(model: { provider: string; baseUrl: string; modelName: string }) {
  const baseUrl = model.baseUrl.toLowerCase();
  const modelName = model.modelName.toLowerCase();
  return model.provider === "anthropic" || baseUrl.includes("claudecode") || baseUrl.includes("anthropic") || modelName.startsWith("claude-");
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
