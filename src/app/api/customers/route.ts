import { AuthError, requireUser, visibleCustomersForUser } from "@/lib/auth";
import { activeCustomerRows, base, log, readDb, withDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { parseKeywordText } from "@/lib/keywords";
import type { Customer, Keyword, Status } from "@/lib/types";

type CustomerInput = Partial<Customer> & {
  keywordBatchText?: string;
};

function toPositiveInt(value: string | null, fallback: number, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(Math.floor(number), max);
}

function includesQuery(row: Customer & { counts: { keywords: number; files: number; articles: number } }, query: string) {
  if (!query) return true;
  const haystack = [
    row.name,
    row.shortName,
    row.industry,
    row.website,
    row.contactName,
    row.contactInfo,
    row.remark
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() || "";
    const status = (url.searchParams.get("status") as Status | "all" | null) || "active";
    const shouldPage =
      url.searchParams.has("query") ||
      url.searchParams.has("page") ||
      url.searchParams.has("pageSize") ||
      url.searchParams.has("status");

    const db = readDb();
    let rows = visibleCustomersForUser(user, activeCustomerRows(db))
      .filter((customer) => (status && status !== "all" ? customer.status === status : true))
      .filter((customer) => includesQuery(customer, query));

    rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!shouldPage) return ok(rows);

    const pageSize = toPositiveInt(url.searchParams.get("pageSize"), 20);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(toPositiveInt(url.searchParams.get("page"), 1, 100000), totalPages);
    const start = (page - 1) * pageSize;

    return ok({
      items: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages
    });
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取客户失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    const input = (await request.json()) as CustomerInput;
    const customer = withDb((db) => {
      const row = base("customer", {
        ownerUserId: user.id,
        name: input.name?.trim() || "未命名客户",
        shortName: input.shortName?.trim() || "",
        industry: input.industry?.trim() || "",
        website: input.website?.trim() || "",
        contactName: input.contactName?.trim() || "",
        contactInfo: input.contactInfo?.trim() || "",
        remark: input.remark?.trim() || "",
        status: input.status || "active"
      });

      db.customers.unshift(row);

      const keywords = parseKeywordText(input.keywordBatchText);
      const keywordRows: Keyword[] = keywords.map((keyword) =>
        base("keyword", {
          customerId: row.id,
          keyword,
          keywordType: "核心词",
          remark: "",
          status: "active"
        })
      );
      db.keywords.unshift(...keywordRows);

      log(db, "create_customer", "customer", row.id, `${row.name}; keywords=${keywordRows.length}`);
      return row;
    });
    return ok(customer);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("创建客户失败", 500);
  }
}
