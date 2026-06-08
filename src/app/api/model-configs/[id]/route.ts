import { AuthError, requireAdmin } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { isActive, now, softDelete, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { ModelConfig } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function expose(config: ModelConfig) {
  return {
    ...config,
    apiKeyEncrypted: undefined,
    apiKeyMasked: maskSecret(config.apiKeyEncrypted)
  };
}

export async function PUT(request: Request, context: Params) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<ModelConfig> & { apiKey?: string };
    const updated = withDb((db) => {
      const model = db.modelConfigs.find((entry) => entry.id === id);
      if (!model) return null;
      if (input.isDefault) {
        db.modelConfigs.filter(isActive).forEach((entry) => {
          entry.isDefault = false;
        });
      }
      model.provider = input.provider || model.provider;
      model.name = input.name?.trim() || model.name;
      model.baseUrl = input.baseUrl ?? model.baseUrl;
      model.modelName = input.modelName ?? model.modelName;
      if (input.apiKey) model.apiKeyEncrypted = encryptSecret(input.apiKey);
      model.temperature = Number(input.temperature ?? model.temperature);
      model.maxTokens = Number(input.maxTokens ?? model.maxTokens);
      model.topP = Number(input.topP ?? model.topP);
      model.timeoutSeconds = normalizeNumber(input.timeoutSeconds, model.timeoutSeconds, 30, 900);
      model.maxRetries = Number(input.maxRetries ?? model.maxRetries);
      model.isDefault = Boolean(input.isDefault ?? model.isDefault);
      model.status = input.status || model.status;
      model.updatedAt = now();
      return model;
    });
    if (!updated) return fail("模型配置不存在", 404);
    return ok(expose(updated));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新模型失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    requireAdmin(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const model = softDelete(db.modelConfigs, id);
      if (!model) return null;
      const wasDefault = model.isDefault;
      model.isDefault = false;
      if (wasDefault) {
        const fallback = db.modelConfigs.find(isActive);
        if (fallback) {
          fallback.isDefault = true;
          fallback.updatedAt = now();
        }
      }
      return model;
    });
    if (!deleted) return fail("模型配置不存在", 404);
    return ok(expose(deleted));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除模型失败", 500);
  }
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
