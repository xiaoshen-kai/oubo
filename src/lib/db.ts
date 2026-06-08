import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AppDb,
  BaseEntity,
  Customer,
  Keyword,
  KnowledgeChunk,
  KnowledgeFact,
  KnowledgeFile,
  ModelConfig,
  Prompt,
  User
} from "./types";
import { hashPassword } from "./passwords";

const root = process.cwd();
export const dataDir = join(root, "data");
export const uploadDir = join(dataDir, "uploads");
const dbPath = join(dataDir, "db.json");
export const seedAdminId = "user_seed_admin";
export const seedAdminPassword = "admin123456";

function seedAdmin(now: string): User {
  return {
    id: seedAdminId,
    username: "admin",
    displayName: "管理员",
    role: "admin",
    passwordHash: hashPassword(seedAdminPassword),
    status: "active",
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function emptyDb(): AppDb {
  const now = new Date().toISOString();
  const globalPrompt: Prompt = {
    id: "prompt_seed_global",
    customerId: null,
    name: "GEO 基础写作规则",
    scope: "global",
    content:
      "文章要专业可信，适合 GEO / SEO / AI 搜索曝光场景。不得虚构案例、数据、客户承诺，不得夸大效果。标题和正文需要自然覆盖关键词。",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const model: ModelConfig = {
    id: "model_seed_local",
    provider: "custom",
    name: "本地草稿生成器",
    baseUrl: "",
    modelName: "local-draft",
    apiKeyEncrypted: "",
    temperature: 0.6,
    maxTokens: 3000,
    topP: 0.9,
    timeoutSeconds: 300,
    maxRetries: 1,
    isDefault: true,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  return {
    users: [seedAdmin(now)],
    sessions: [],
    customers: [],
    keywords: [],
    knowledgeFiles: [],
    knowledgeChunks: [],
    knowledgeFacts: [],
    prompts: [globalPrompt],
    modelConfigs: [model],
    generationTasks: [],
    generationTaskItems: [],
    generatedArticles: [],
    operationLogs: []
  };
}

function migrateDb(input: Partial<AppDb>): { db: AppDb; changed: boolean } {
  let changed = false;
  const now = new Date().toISOString();
  const db = input as AppDb;

  if (!Array.isArray(db.users)) {
    db.users = [seedAdmin(now)];
    changed = true;
  }
  if (!db.users.some((user) => user.id === seedAdminId)) {
    db.users.unshift(seedAdmin(now));
    changed = true;
  }
  if (!Array.isArray(db.sessions)) {
    db.sessions = [];
    changed = true;
  }

  const collections: Array<keyof AppDb> = [
    "customers",
    "keywords",
    "knowledgeFiles",
    "knowledgeChunks",
    "knowledgeFacts",
    "prompts",
    "modelConfigs",
    "generationTasks",
    "generationTaskItems",
    "generatedArticles",
    "operationLogs"
  ];
  for (const key of collections) {
    if (!Array.isArray(db[key])) {
      (db[key] as unknown[]) = [];
      changed = true;
    }
  }

  for (const customer of db.customers) {
    if (!customer.ownerUserId) {
      customer.ownerUserId = seedAdminId;
      changed = true;
    }
  }

  return { db, changed };
}

function ensureStorage() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  if (!existsSync(dbPath)) writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2), "utf8");
}

export function readDb(): AppDb {
  ensureStorage();
  const migrated = migrateDb(JSON.parse(readFileSync(dbPath, "utf8")) as Partial<AppDb>);
  if (migrated.changed) writeFileSync(dbPath, JSON.stringify(migrated.db, null, 2), "utf8");
  return migrated.db;
}

export function writeDb(db: AppDb) {
  ensureStorage();
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
}

export function withDb<T>(mutator: (db: AppDb) => T): T {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}

export function now() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function touch<T extends BaseEntity>(entity: T): T {
  entity.updatedAt = now();
  return entity;
}

export function base<T extends Omit<BaseEntity, "id" | "createdAt" | "updatedAt">>(
  prefix: string,
  input: T
): T & BaseEntity {
  const at = now();
  return {
    ...input,
    id: id(prefix),
    createdAt: at,
    updatedAt: at
  };
}

export function softDelete<T extends { id: string; status: string; updatedAt: string }>(
  collection: T[],
  itemId: string
) {
  const item = collection.find((entry) => entry.id === itemId);
  if (item) {
    item.status = "disabled";
    item.updatedAt = now();
  }
  return item;
}

export function isActive<T extends { status: string }>(item: T) {
  return item.status === "active";
}

export function activeIds<T extends { id: string; status: string }>(collection: T[]) {
  return new Set(collection.filter(isActive).map((item) => item.id));
}

export function log(db: AppDb, action: string, targetType: string, targetId: string, detail = "") {
  db.operationLogs.unshift(
    base("log", {
      action,
      targetType,
      targetId,
      detail
    })
  );
}

export function customerCounts(db: AppDb, customer: Customer) {
  const keywordIds = activeIds(db.keywords.filter((item) => item.customerId === customer.id));
  return {
    keywords: db.keywords.filter((item) => item.customerId === customer.id && item.status === "active").length,
    files: db.knowledgeFiles.filter((item) => item.customerId === customer.id && item.status === "active").length,
    articles: db.generatedArticles.filter((item) => item.customerId === customer.id && keywordIds.has(item.keywordId)).length
  };
}

export function knowledgeFileSize(file: KnowledgeFile) {
  if (typeof file.fileSize === "number" && Number.isFinite(file.fileSize)) return file.fileSize;
  try {
    return statSync(file.filePath).size;
  } catch {
    return 0;
  }
}

export function customerKnowledgeUsage(db: AppDb, customerId: string) {
  return db.knowledgeFiles
    .filter((file) => file.customerId === customerId && file.status === "active")
    .reduce((total, file) => total + knowledgeFileSize(file), 0);
}

export function withKnowledgeFileSize(file: KnowledgeFile): KnowledgeFile {
  return {
    ...file,
    fileSize: knowledgeFileSize(file)
  };
}

export function nextChunkCode(chunks: KnowledgeChunk[]) {
  return `KB${String(chunks.length + 1).padStart(3, "0")}`;
}

export function nextFactCode(facts: KnowledgeFact[]) {
  return `FACT${String(facts.length + 1).padStart(3, "0")}`;
}

export function activeCustomerRows(db: AppDb) {
  return db.customers.map((customer) => ({
    ...customer,
    counts: customerCounts(db, customer)
  }));
}

export function fileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

export function selectedKeywords(db: AppDb, ids: string[]): Keyword[] {
  return ids
    .map((keywordId) => db.keywords.find((keyword) => keyword.id === keywordId))
    .filter((keyword): keyword is Keyword => Boolean(keyword));
}

export function selectedFiles(db: AppDb, ids: string[]): KnowledgeFile[] {
  return ids
    .map((fileId) => db.knowledgeFiles.find((file) => file.id === fileId))
    .filter((file): file is KnowledgeFile => Boolean(file));
}
