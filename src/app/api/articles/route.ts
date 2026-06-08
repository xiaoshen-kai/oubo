import { AuthError, requireUser, visibleCustomerIdsForUser } from "@/lib/auth";
import { activeIds, readDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");
    const keywordId = url.searchParams.get("keywordId");
    const taskId = url.searchParams.get("taskId");
    const db = readDb();
    const visibleCustomerIds = visibleCustomerIdsForUser(user, db);
    const activeKeywordIds = activeIds(db.keywords);
    return ok(
      db.generatedArticles
        .filter((article) => visibleCustomerIds.has(article.customerId) && activeKeywordIds.has(article.keywordId))
        .filter((article) => !customerId || article.customerId === customerId)
        .filter((article) => !keywordId || article.keywordId === keywordId)
        .filter((article) => !taskId || article.taskId === taskId)
        .map((article) => ({
          ...article,
          customer: db.customers.find((customer) => customer.id === article.customerId),
          keyword: db.keywords.find((keyword) => keyword.id === article.keywordId)
        }))
    );
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取文章失败", 500);
  }
}
