import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CUSTOMER_KNOWLEDGE_LIMIT_BYTES = 100 * 1024 * 1024;

export const SUPPORTED_KNOWLEDGE_EXTENSIONS = ["txt", "md", "markdown", "pdf", "docx", "csv", "json", "html", "htm", "xlsx"];

export function isSupportedKnowledgeExtension(ext: string) {
  return SUPPORTED_KNOWLEDGE_EXTENSIONS.includes(ext.toLowerCase());
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export async function extractKnowledgeText(buffer: Buffer, ext: string) {
  const normalizedExt = ext.toLowerCase();
  if (["txt", "md", "markdown", "csv"].includes(normalizedExt)) return normalizeText(buffer.toString("utf8"));
  if (normalizedExt === "json") return parseJson(buffer);
  if (normalizedExt === "html" || normalizedExt === "htm") return parseHtml(buffer);
  if (normalizedExt === "docx") return parseDocx(buffer);
  if (normalizedExt === "pdf") return parsePdf(buffer);
  if (normalizedExt === "xlsx") return parseXlsx(buffer);
  throw new Error(`暂不支持解析 .${ext} 文件`);
}

async function parseDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value);
}

async function parsePdf(buffer: Buffer) {
  await ensurePdfCanvasPolyfills();
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(pathToFileURL(join(process.cwd(), "node_modules", "pdf-parse", "dist", "pdf-parse", "cjs", "pdf.worker.mjs")).href);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeText(result.text);
  } finally {
    await parser.destroy();
  }
}

async function ensurePdfCanvasPolyfills() {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals.DOMMatrix && globals.ImageData && globals.Path2D) return;

  const canvas = (eval("require") as NodeRequire)("@napi-rs/canvas") as {
    DOMMatrix: unknown;
    ImageData: unknown;
    Path2D: unknown;
  };
  globals.DOMMatrix ||= canvas.DOMMatrix;
  globals.ImageData ||= canvas.ImageData;
  globals.Path2D ||= canvas.Path2D;
}

async function parseXlsx(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sections: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = values.map(cellToText).filter(Boolean).join("\t");
      if (line) rows.push(line);
    });
    if (rows.length) sections.push([`# ${sheet.name}`, ...rows].join("\n"));
  });
  return normalizeText(sections.join("\n\n"));
}

function parseJson(buffer: Buffer) {
  const text = buffer.toString("utf8");
  try {
    return normalizeText(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    return normalizeText(text);
  }
}

function parseHtml(buffer: Buffer) {
  return normalizeText(
    buffer
      .toString("utf8")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
  );
}

function cellToText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const richText = value as { text?: string; result?: unknown; formula?: string; hyperlink?: string; richText?: Array<{ text?: string }> };
    if (richText.text) return richText.text.trim();
    if (richText.result != null) return cellToText(richText.result);
    if (richText.richText?.length) return richText.richText.map((item) => item.text || "").join("").trim();
    if (richText.hyperlink) return richText.hyperlink.trim();
    if (richText.formula) return richText.formula.trim();
  }
  return String(value).trim();
}

function normalizeText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
