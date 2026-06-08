import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { activeIds, isActive, now, readDb, softDelete, withDb, withKnowledgeFileSize } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { Customer } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = readDb();
    const customer = assertCustomerAccess(user, db.customers.find((entry) => entry.id === id && isActive(entry)));
    const fileIds = activeIds(db.knowledgeFiles.filter((entry) => entry.customerId === id));
    const keywordIds = activeIds(db.keywords.filter((entry) => entry.customerId === id));
    return ok({
      customer,
      keywords: db.keywords.filter((entry) => entry.customerId === id && isActive(entry)),
      files: db.knowledgeFiles.filter((entry) => entry.customerId === id && isActive(entry)).map(withKnowledgeFileSize),
      chunks: db.knowledgeChunks.filter((entry) => entry.customerId === id && isActive(entry) && fileIds.has(entry.fileId)),
      facts: db.knowledgeFacts.filter(
        (entry) => entry.customerId === id && isActive(entry) && (!entry.fileId || fileIds.has(entry.fileId))
      ),
      prompts: db.prompts.filter((entry) => entry.customerId === id && isActive(entry)),
      tasks: db.generationTasks.filter(
        (entry) => entry.customerId === id && entry.status !== "cancelled" && entry.keywordIds.some((keywordId) => keywordIds.has(keywordId))
      ),
      articles: db.generatedArticles.filter((entry) => entry.customerId === id && keywordIds.has(entry.keywordId))
    });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取客户失败", 500);
  }
}

export async function PUT(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const input = (await request.json()) as Partial<Customer>;
    const updated = withDb((db) => {
      const customer = assertCustomerAccess(user, db.customers.find((entry) => entry.id === id));
      customer.name = input.name?.trim() || customer.name;
      customer.shortName = input.shortName ?? customer.shortName;
      customer.industry = input.industry ?? customer.industry;
      customer.website = input.website ?? customer.website;
      customer.contactName = input.contactName ?? customer.contactName;
      customer.contactInfo = input.contactInfo ?? customer.contactInfo;
      customer.remark = input.remark ?? customer.remark;
      customer.status = input.status || customer.status;
      customer.updatedAt = now();
      return customer;
    });
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("更新客户失败", 500);
  }
}

export async function DELETE(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const deleted = withDb((db) => {
      const target = db.customers.find((entry) => entry.id === id);
      assertCustomerAccess(user, target);
      const customer = softDelete(db.customers, id);
      if (!customer) return null;
      const deletedAt = customer.updatedAt;
      const disable = (item: { status: string; updatedAt: string }) => {
        item.status = "disabled";
        item.updatedAt = deletedAt;
      };
      db.keywords.filter((entry) => entry.customerId === id).forEach(disable);
      db.knowledgeFiles.filter((entry) => entry.customerId === id).forEach(disable);
      db.knowledgeChunks.filter((entry) => entry.customerId === id).forEach(disable);
      db.knowledgeFacts.filter((entry) => entry.customerId === id).forEach(disable);
      db.prompts.filter((entry) => entry.customerId === id).forEach(disable);
      return customer;
    });
    return ok(deleted);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("删除客户失败", 500);
  }
}
