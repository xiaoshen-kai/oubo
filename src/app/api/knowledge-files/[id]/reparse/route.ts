import { readFileSync } from "node:fs";
import { AuthError, assertCustomerAccess, requireUser } from "@/lib/auth";
import { extractKnowledgeText } from "@/lib/file-parsing";
import { fail, ok } from "@/lib/http";
import { extractInitialFacts, splitIntoChunks } from "@/lib/knowledge";
import { isActive, now, readDb, withDb, withKnowledgeFileSize } from "@/lib/db";
import type { KnowledgeFile } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  try {
    const user = requireUser(request);
    const { id } = await context.params;
    const db = readDb();
    const current = db.knowledgeFiles.find((entry) => entry.id === id && isActive(entry));
    if (!current) return fail("知识库文件不存在", 404);
    assertCustomerAccess(user, db.customers.find((customer) => customer.id === current.customerId && isActive(customer)));

    let buffer: Buffer;
    try {
      buffer = readFileSync(current.filePath);
    } catch {
      return fail("找不到原始文件，请重新上传。", 404);
    }

    let rawText = "";
    let parseStatus: KnowledgeFile["parseStatus"] = "parsed";
    let errorMessage = "";
    try {
      rawText = await extractKnowledgeText(buffer, current.fileType);
      if (!rawText) {
        parseStatus = "parse_failed";
        errorMessage = "文件已上传，但没有提取到可用文本。";
      }
    } catch (error) {
      parseStatus = "parse_failed";
      errorMessage = error instanceof Error ? error.message : "文件解析失败。";
    }

    const updated = withDb((db) => {
      const file = db.knowledgeFiles.find((entry) => entry.id === id && isActive(entry));
      if (!file) return null;
      assertCustomerAccess(user, db.customers.find((customer) => customer.id === file.customerId && isActive(customer)));
      const updatedAt = now();
      file.fileSize = buffer.length;
      file.rawText = rawText;
      file.parseStatus = parseStatus;
      file.errorMessage = errorMessage;
      file.updatedAt = updatedAt;

      const disable = (item: { status: string; updatedAt: string }) => {
        item.status = "disabled";
        item.updatedAt = updatedAt;
      };
      db.knowledgeChunks.filter((entry) => entry.fileId === id).forEach(disable);
      db.knowledgeFacts.filter((entry) => entry.fileId === id).forEach(disable);

      const existingChunks = db.knowledgeChunks.filter((chunk) => chunk.customerId === file.customerId && isActive(chunk));
      const chunks = parseStatus === "parsed" ? splitIntoChunks(rawText, existingChunks.length, file.id, file.customerId) : [];
      if (chunks.length) db.knowledgeChunks.push(...chunks);

      const existingFacts = db.knowledgeFacts.filter((fact) => fact.customerId === file.customerId && isActive(fact));
      const facts = extractInitialFacts(chunks, existingFacts.length);
      if (facts.length) db.knowledgeFacts.push(...facts);
      return { file: withKnowledgeFileSize(file), chunks, facts };
    });

    if (!updated) return fail("知识库文件不存在", 404);
    return ok(updated);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, error.status);
    return fail("重新解析失败", 500);
  }
}
