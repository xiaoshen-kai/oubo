import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { base, isActive, log, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { parseKeywordText } from "@/lib/keywords";
import type { Keyword } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const db = readDb();
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
    return ok(db.keywords.filter((entry) => entry.customerId === customerId && isActive(entry)));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取关键词失败", 500);
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const input = (await request.json()) as Partial<Keyword> & { batchText?: string; keywordBatchText?: string };
    const created = withDb((db) => {
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
      const existing = new Set(
        db.keywords
          .filter((keyword) => keyword.customerId === customerId && isActive(keyword))
          .map((keyword) => keyword.keyword.trim().toLowerCase())
      );
      const keywordText = input.batchText ?? input.keywordBatchText ?? input.keyword;
      const values = parseKeywordText(keywordText).filter(
        (keyword) => !existing.has(keyword.toLowerCase())
      );
      if (!values.length) return [];
      const rows: Keyword[] = [];

      for (const value of values) {
        const row = base("keyword", {
          customerId,
          keyword: value,
          keywordType: input.keywordType || "核心词",
          remark: input.remark || "",
          status: input.status || "active"
        });
        db.keywords.unshift(row);
        rows.push(row);
      }

      log(db, "create_keywords", "customer", customerId, `${rows.length}`);
      return rows;
    });
    if (!created.length) return fail("没有新增关键词：请检查输入是否为空，或关键词是否已存在", 400);
    return ok(created);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建关键词失败", 500);
  }
}
