import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { base, isActive, nextFactCode, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import type { KnowledgeFact } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const db = readDb();
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
    return ok(db.knowledgeFacts.filter((entry) => entry.customerId === customerId && isActive(entry)));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取事实失败", 500);
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const input = (await request.json()) as Partial<KnowledgeFact>;
    const created = withDb((db) => {
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
      const row = base("fact", {
        customerId,
        fileId: input.fileId || null,
        sourceChunkId: input.sourceChunkId || null,
        factCode: nextFactCode(db.knowledgeFacts.filter((fact) => fact.customerId === customerId && isActive(fact))),
        factText: input.factText?.trim() || "",
        usageRule: input.usageRule || "prefer_use",
        priority: Number(input.priority ?? 5),
        status: input.status || "active"
      });
      db.knowledgeFacts.unshift(row);
      return row;
    });
    return ok(created);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建事实失败", 500);
  }
}
