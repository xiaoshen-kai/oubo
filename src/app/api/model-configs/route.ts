import { AuthError, requireAdmin } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { base, isActive, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { ModelConfig, Status } from "@/lib/types";

function expose(config: ModelConfig) {
  return {
    ...config,
    apiKeyEncrypted: undefined,
    apiKeyMasked: maskSecret(config.apiKeyEncrypted)
  };
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") as Status | "all" | null) || "active";
    return ok(
      readDb()
        .modelConfigs.filter((model) => status === "all" || model.status === status)
        .map(expose)
    );
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取模型失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const input = (await request.json()) as Partial<ModelConfig> & { apiKey?: string };
    const created = withDb((db) => {
      if (input.isDefault) {
        db.modelConfigs.filter(isActive).forEach((model) => {
          model.isDefault = false;
        });
      }
      const row = base("model", {
        provider: input.provider || "custom",
        name: input.name?.trim() || "未命名模型",
        baseUrl: input.baseUrl?.trim() || "",
        modelName: input.modelName?.trim() || "",
        apiKeyEncrypted: encryptSecret(input.apiKey || ""),
        temperature: Number(input.temperature ?? 0.7),
        maxTokens: Number(input.maxTokens ?? 3000),
        topP: Number(input.topP ?? 0.9),
        timeoutSeconds: normalizeNumber(input.timeoutSeconds, 300, 30, 900),
        maxRetries: Number(input.maxRetries ?? 2),
        isDefault: Boolean(input.isDefault),
        status: input.status || "active"
      });
      db.modelConfigs.unshift(row);
      return row;
    });
    return ok(expose(created));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建模型失败", 500);
  }
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
