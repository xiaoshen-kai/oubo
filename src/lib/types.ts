export type Status = "active" | "disabled";

export type ParseStatus = "uploaded" | "parsing" | "parsed" | "parse_failed";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type TaskItemStatus = "pending" | "generating" | "checking" | "passed" | "failed";

export type UsageRule = "must_use" | "prefer_use" | "optional" | "forbidden";

export type ModelProvider = "deepseek" | "volcengine_ark" | "dashscope_qwen" | "anthropic" | "custom";

export type UserRole = "admin" | "employee";

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer extends BaseEntity {
  ownerUserId: string;
  name: string;
  shortName: string;
  industry: string;
  website: string;
  contactName: string;
  contactInfo: string;
  remark: string;
  status: Status;
}

export interface User extends BaseEntity {
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  status: Status;
  lastLoginAt?: string | null;
}

export interface Session extends BaseEntity {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  status: Status;
}

export interface Keyword extends BaseEntity {
  customerId: string;
  keyword: string;
  keywordType: string;
  remark: string;
  status: Status;
}

export interface KnowledgeFile extends BaseEntity {
  customerId: string;
  fileName: string;
  fileType: string;
  filePath: string;
  fileSize?: number;
  rawText: string;
  parseStatus: ParseStatus;
  errorMessage: string;
  status: Status;
}

export interface KnowledgeChunk extends BaseEntity {
  customerId: string;
  fileId: string;
  chunkCode: string;
  title: string;
  content: string;
  tags: string[];
  priority: number;
  isCore: boolean;
  status: Status;
}

export interface KnowledgeFact extends BaseEntity {
  customerId: string;
  fileId: string | null;
  sourceChunkId: string | null;
  factCode: string;
  factText: string;
  usageRule: UsageRule;
  priority: number;
  status: Status;
}

export interface Prompt extends BaseEntity {
  customerId: string | null;
  name: string;
  scope: "global" | "customer";
  content: string;
  status: Status;
}

export interface ModelConfig extends BaseEntity {
  provider: ModelProvider;
  name: string;
  baseUrl: string;
  modelName: string;
  apiKeyEncrypted: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  timeoutSeconds: number;
  maxRetries: number;
  isDefault: boolean;
  status: Status;
}

export interface GenerationTask extends BaseEntity {
  name: string;
  customerId: string;
  modelConfigId: string;
  keywordIds: string[];
  knowledgeFileIds: string[];
  promptIds: string[];
  articleCount: number;
  wordCount: number;
  articleType: string;
  comparisonObjects: string;
  modelThinking: string;
  status: TaskStatus;
  enableCheck: boolean;
  maxRetries: number;
  remark: string;
}

export interface GenerationTaskItem extends BaseEntity {
  taskId: string;
  customerId: string;
  keywordId: string;
  sortOrder: number;
  status: TaskItemStatus;
  retryCount: number;
  errorMessage: string;
  articleId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Citation {
  paragraph: number;
  sourceCodes: string[];
  sourceType?: "fact" | "chunk" | "mixed";
  sourceIds?: string[];
  quotedText?: string;
  confidence?: number;
}

export interface CheckResult {
  passed: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
}

export interface PromptSnapshot {
  promptText: string;
  promptTemplates: Array<{
    id: string;
    name: string;
    scope: Prompt["scope"];
    content: string;
  }>;
  customerName: string;
  keyword: string;
  recommendationObject: string;
  comparisonObjects: string;
  modelThinking: string;
  modelName: string;
  generatedAt: string;
}

export interface GeneratedArticle extends BaseEntity {
  taskId: string;
  taskItemId: string;
  customerId: string;
  keywordId: string;
  modelConfigId: string;
  title: string;
  summary: string;
  content: string;
  rawResponse: unknown;
  promptSnapshot?: PromptSnapshot;
  citations: Citation[];
  checkResult: CheckResult;
  status: "draft" | "passed" | "failed";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OperationLog extends BaseEntity {
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
}

export interface AppDb {
  users: User[];
  sessions: Session[];
  customers: Customer[];
  keywords: Keyword[];
  knowledgeFiles: KnowledgeFile[];
  knowledgeChunks: KnowledgeChunk[];
  knowledgeFacts: KnowledgeFact[];
  prompts: Prompt[];
  modelConfigs: ModelConfig[];
  generationTasks: GenerationTask[];
  generationTaskItems: GenerationTaskItem[];
  generatedArticles: GeneratedArticle[];
  operationLogs: OperationLog[];
}

export interface GenerationContext {
  task: GenerationTask;
  item: GenerationTaskItem;
  customer: Customer;
  keyword: Keyword;
  prompts: Prompt[];
  modelConfig: ModelConfig;
  facts: KnowledgeFact[];
  chunks: KnowledgeChunk[];
}
