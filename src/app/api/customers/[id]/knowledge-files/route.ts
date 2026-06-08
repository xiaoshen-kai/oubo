import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import {
  base,
  customerKnowledgeUsage,
  fileExtension,
  isActive,
  log,
  readDb,
  uploadDir,
  withDb,
  withKnowledgeFileSize
} from "@/lib/db";
import {
  CUSTOMER_KNOWLEDGE_LIMIT_BYTES,
  SUPPORTED_KNOWLEDGE_EXTENSIONS,
  extractKnowledgeText,
  formatBytes,
  isSupportedKnowledgeExtension
} from "@/lib/file-parsing";
import { fail, ok } from "@/lib/http";
import { extractInitialFacts, splitIntoChunks } from "@/lib/knowledge";
import type { KnowledgeFile } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const db = readDb();
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
    return ok(db.knowledgeFiles.filter((entry) => entry.customerId === customerId && isActive(entry)).map(withKnowledgeFileSize));
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("读取知识库失败", 500);
  }
}

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id: customerId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("请选择文件");
    const ext = fileExtension(file.name);
    if (!isSupportedKnowledgeExtension(ext)) {
      return fail(`仅支持 ${SUPPORTED_KNOWLEDGE_EXTENSIONS.map((item) => `.${item}`).join("、")} 格式`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const db = readDb();
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
    const currentUsage = customerKnowledgeUsage(db, customerId);
    if (currentUsage + buffer.length > CUSTOMER_KNOWLEDGE_LIMIT_BYTES) {
      const remaining = Math.max(CUSTOMER_KNOWLEDGE_LIMIT_BYTES - currentUsage, 0);
      return fail(`该客户知识库最大 100MB，当前还可上传 ${formatBytes(remaining)}。`);
    }

    let rawText = "";
    let parseStatus: KnowledgeFile["parseStatus"] = "parsed";
    let errorMessage = "";
    try {
      rawText = await extractKnowledgeText(buffer, ext);
      if (!rawText) {
        parseStatus = "parse_failed";
        errorMessage = "文件已上传，但没有提取到可用文本。";
      }
    } catch (error) {
      parseStatus = "parse_failed";
      errorMessage = error instanceof Error ? error.message : "文件解析失败。";
    }

    mkdirSync(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")}`;
    const filePath = join(uploadDir, storedName);
    writeFileSync(filePath, buffer);

    const created = withDb((db) => {
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === customerId && isActive(customer)));
      const latestUsage = customerKnowledgeUsage(db, customerId);
      if (latestUsage + buffer.length > CUSTOMER_KNOWLEDGE_LIMIT_BYTES) return "limit_exceeded" as const;
      const row = base("kfile", {
        customerId,
        fileName: file.name,
        fileType: ext,
        filePath,
        fileSize: buffer.length,
        rawText,
        parseStatus,
        errorMessage,
        status: "active"
      }) satisfies KnowledgeFile;
      db.knowledgeFiles.unshift(row);

      const existingChunks = db.knowledgeChunks.filter((chunk) => chunk.customerId === customerId && isActive(chunk));
      const chunks = parseStatus === "parsed" ? splitIntoChunks(rawText, existingChunks.length, row.id, customerId) : [];
      if (chunks.length) db.knowledgeChunks.push(...chunks);

      const existingFacts = db.knowledgeFacts.filter((fact) => fact.customerId === customerId && isActive(fact));
      const facts = extractInitialFacts(chunks, existingFacts.length);
      if (facts.length) db.knowledgeFacts.push(...facts);
      log(db, "upload_knowledge_file", "knowledge_file", row.id, row.fileName);
      return { file: row, chunks, facts };
    });
    if (created === "limit_exceeded") return fail("该客户知识库最大 100MB，当前文件超出剩余额度。");
    return ok(created);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("上传知识库失败", 500);
  }
}
