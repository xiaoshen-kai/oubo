import type { KnowledgeChunk, KnowledgeFact } from "./types";

export function splitIntoChunks(rawText: string, existingCount: number, fileId: string, customerId: string) {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const blocks = text
    .split(/\n{2,}|(?=^#{1,4}\s)/gm)
    .map((block) => block.trim())
    .filter(Boolean);
  const merged: string[] = [];
  let buffer = "";

  for (const block of blocks) {
    const next = buffer ? `${buffer}\n\n${block}` : block;
    if (next.length < 260) {
      buffer = next;
      continue;
    }
    merged.push(next);
    buffer = "";
  }
  if (buffer) merged.push(buffer);

  const now = new Date().toISOString();
  return merged.slice(0, 40).map<KnowledgeChunk>((content, index) => {
    const firstLine = content.split("\n").find(Boolean) ?? `知识片段 ${index + 1}`;
    const title = firstLine.replace(/^#{1,4}\s*/, "").slice(0, 42);
    return {
      id: `chunk_${Date.now().toString(36)}_${existingCount + index + 1}`,
      customerId,
      fileId,
      chunkCode: `KB${String(existingCount + index + 1).padStart(3, "0")}`,
      title,
      content,
      tags: extractTags(content),
      priority: index === 0 ? 10 : 5,
      isCore: index < 3,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
  });
}

export function extractInitialFacts(chunks: KnowledgeChunk[], existingCount: number) {
  const now = new Date().toISOString();
  return chunks.slice(0, 6).map<KnowledgeFact>((chunk, index) => {
    const sentence = chunk.content
      .replace(/\s+/g, " ")
      .split(/[。！？!?]/)
      .map((item) => item.trim())
      .find((item) => item.length >= 16);
    return {
      id: `fact_${Date.now().toString(36)}_${existingCount + index + 1}`,
      customerId: chunk.customerId,
      fileId: chunk.fileId,
      sourceChunkId: chunk.id,
      factCode: `FACT${String(existingCount + index + 1).padStart(3, "0")}`,
      factText: sentence || chunk.content.slice(0, 160),
      usageRule: index === 0 ? "must_use" : "prefer_use",
      priority: index === 0 ? 10 : 6,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
  });
}

export function selectRelevantChunks(
  chunks: KnowledgeChunk[],
  keyword: string,
  fileIds: string[],
  limit = 8
) {
  const key = keyword.toLowerCase();
  return chunks
    .filter((chunk) => chunk.status === "active" && (!fileIds.length || fileIds.includes(chunk.fileId)))
    .map((chunk) => {
      let score = chunk.priority + (chunk.isCore ? 8 : 0);
      const title = chunk.title.toLowerCase();
      const content = chunk.content.toLowerCase();
      const tags = chunk.tags.join(" ").toLowerCase();
      if (title.includes(key)) score += 16;
      if (tags.includes(key)) score += 12;
      if (content.includes(key)) score += 8;
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}

function extractTags(text: string) {
  const tags = ["服务", "优势", "案例", "流程", "产品", "价格", "交付", "客户", "GEO", "SEO"].filter((tag) =>
    text.includes(tag)
  );
  return Array.from(new Set(tags)).slice(0, 5);
}
