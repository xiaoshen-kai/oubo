"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { resetTaskRowForFreshRun } from "@/lib/task-run";
import type {
  Customer,
  GeneratedArticle,
  GenerationTask,
  GenerationTaskItem,
  Keyword,
  KnowledgeFact,
  KnowledgeFile,
  ModelConfig,
  OperationLog,
  Prompt,
  User
} from "@/lib/types";

type Tab = "dashboard" | "customers" | "knowledge" | "prompts" | "models" | "tasks" | "articles" | "users";
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Counts = { keywords: number; files: number; articles: number };
type CustomerRow = Customer & { counts: Counts };
type PagedResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
type TaskRow = GenerationTask & { customer?: Customer; items: GenerationTaskItem[]; articles: GeneratedArticle[] };
type ArticleRow = GeneratedArticle & { customer?: Customer; keyword?: Keyword };
type PromptRow = Prompt & { customer?: Customer };
type ModelRow = Omit<ModelConfig, "apiKeyEncrypted"> & { apiKeyMasked?: string };
type PublicUser = Omit<User, "passwordHash">;
type CopyState = { kind: "success" | "error"; message: string } | null;
type ArticleContentBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };
type TaskDetail = { task: TaskRow; items: GenerationTaskItem[]; articles: GeneratedArticle[]; logs: OperationLog[] };
type CustomerDetail = {
  customer: Customer;
  keywords: Keyword[];
  files: KnowledgeFile[];
  facts: KnowledgeFact[];
  articles: GeneratedArticle[];
};

const customerPageSize = 20;
const customerKnowledgeLimitBytes = 100 * 1024 * 1024;

const tabs: Array<{ id: Tab; label: string; description: string; shortcut: string }> = [
  { id: "dashboard", label: "仪表盘", description: "运营总览与产出节奏", shortcut: "01" },
  { id: "customers", label: "客户管理", description: "客户档案、关键词与筛选", shortcut: "02" },
  { id: "knowledge", label: "知识库", description: "上传客户资料文件", shortcut: "03" },
  { id: "prompts", label: "提示词", description: "沉淀可复用生成策略", shortcut: "04" },
  { id: "models", label: "模型配置", description: "模型渠道与生成参数", shortcut: "05" },
  { id: "tasks", label: "生成任务", description: "批量生成内容稿件", shortcut: "06" },
  { id: "articles", label: "内容管理", description: "审稿、编辑与复制发布", shortcut: "07" },
  { id: "users", label: "用户中心", description: "员工账号与权限", shortcut: "08" }
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let json: ApiResult<T>;
  try {
    json = JSON.parse(text) as ApiResult<T>;
  } catch {
    throw new Error(text || response.statusText || `HTTP ${response.status}`);
  }
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form));
}

function articlePlainText(article: ArticleRow) {
  const body = parseArticleContent([article.summary, article.content].filter(Boolean).join("\n\n"))
    .map((block) => {
      if (block.kind === "list") return block.items.join("\n");
      if (block.kind === "table") return [block.headers, ...block.rows].map((row) => row.join("\t")).join("\n");
      return block.text;
    })
    .filter(Boolean)
    .join("\n\n");
  return [cleanMarkdownInline(article.title), body].filter(Boolean).join("\n\n");
}

function articleHtml(article: ArticleRow) {
  const blocks = parseArticleContent([article.summary, article.content].filter(Boolean).join("\n\n"))
    .map((block) => {
      if (block.kind === "heading") {
        const tag = block.level <= 2 ? "h2" : "h3";
        return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
      }
      if (block.kind === "list") {
        return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
      }
      if (block.kind === "table") {
        const head = `<thead><tr>${block.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>`;
        const body = `<tbody>${block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`;
        return `<table>${head}${body}</table>`;
      }
      return `<p>${escapeHtml(block.text).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");
  return `<h1>${escapeHtml(cleanMarkdownInline(article.title))}</h1>${blocks}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanMarkdownInline(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^>\s?/, "")
    .trim();
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(cells: string[]) {
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function normalizeTableRow(cells: string[], width: number) {
  const normalized = cells.slice(0, width).map(cleanMarkdownInline);
  while (normalized.length < width) normalized.push("");
  return normalized;
}

function parseArticleContent(value: string): ArticleContentBlock[] {
  const blocks: ArticleContentBlock[] = [];
  const paragraphLines: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    const text = cleanMarkdownInline(paragraphLines.join("\n"));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphLines.length = 0;
  }

  function flushList() {
    if (listItems.length) blocks.push({ kind: "list", items: listItems });
    listItems = [];
  }

  const lines = value.replace(/\r\n/g, "\n").split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();
    if (!line || /^```/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    const tableHeaders = splitMarkdownTableRow(line);
    const tableSeparator = splitMarkdownTableRow(lines[lineIndex + 1] || "");
    if (tableHeaders.length >= 2 && isMarkdownTableSeparator(tableSeparator)) {
      flushParagraph();
      flushList();
      const headers = tableHeaders.map(cleanMarkdownInline);
      const rows: string[][] = [];
      let rowIndex = lineIndex + 2;
      for (; rowIndex < lines.length; rowIndex += 1) {
        const rowLine = lines[rowIndex].trim();
        const rowCells = splitMarkdownTableRow(rowLine);
        if (!rowLine || /^```/.test(rowLine) || rowCells.length < 2 || isMarkdownTableSeparator(rowCells)) break;
        rows.push(normalizeTableRow(rowCells, headers.length));
      }
      blocks.push({ kind: "table", headers, rows });
      lineIndex = rowIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: cleanMarkdownInline(heading[2]) });
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(cleanMarkdownInline(bullet[1]));
      continue;
    }

    flushList();
    paragraphLines.push(cleanMarkdownInline(line));
  }

  flushParagraph();
  flushList();
  return blocks;
}

function ArticleContent({ text }: { text: string }) {
  const blocks = parseArticleContent(text);
  if (!blocks.length) return <p className="article-paragraph muted">暂无正文</p>;

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return block.level <= 2 ? (
            <h2 key={`${block.kind}-${index}`}>{block.text}</h2>
          ) : (
            <h3 key={`${block.kind}-${index}`}>{block.text}</h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul className="article-list" key={`${block.kind}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="article-table-wrap" key={`${block.kind}-${index}`}>
              <table className="article-table">
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${header}-${headerIndex}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p className="article-paragraph" key={`${block.kind}-${index}`}>
            {block.text}
          </p>
        );
      })}
    </>
  );
}

async function copyText(text: string) {
  if (copyPlainTextFallback(text)) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("Clipboard copy is unavailable.");
}

function saveSelection() {
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return { activeElement, ranges, selection };
}

function restoreSelection(snapshot: ReturnType<typeof saveSelection>) {
  snapshot.selection?.removeAllRanges();
  snapshot.ranges.forEach((range) => snapshot.selection?.addRange(range));
  snapshot.activeElement?.focus({ preventScroll: true });
}

function copyPlainTextFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  const snapshot = saveSelection();
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    restoreSelection(snapshot);
  }
}

function copyHtmlFallback(html: string) {
  const container = document.createElement("div");
  container.setAttribute("contenteditable", "true");
  container.innerHTML = html;
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "1px";
  container.style.height = "1px";
  container.style.overflow = "hidden";
  container.style.opacity = "0";
  container.style.pointerEvents = "none";
  const snapshot = saveSelection();
  document.body.appendChild(container);
  try {
    const range = document.createRange();
    const selection = window.getSelection();
    container.focus({ preventScroll: true });
    range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    container.remove();
    restoreSelection(snapshot);
  }
}

async function copyArticleForPublish(article: ArticleRow) {
  const plain = articlePlainText(article);
  const html = articleHtml(article);
  if (copyHtmlFallback(html)) return;

  if (navigator.clipboard?.write && "ClipboardItem" in window) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" })
        })
      ]);
      return;
    } catch {
      await copyText(plain);
      return;
    }
  }
  await copyText(plain);
}

function customerLabel(customer?: Pick<Customer, "name" | "shortName" | "industry"> | null) {
  if (!customer) return "";
  const meta = [customer.shortName, customer.industry].filter(Boolean).join(" / ");
  return meta ? `${customer.name}（${meta}）` : customer.name;
}

function toCustomerRow(detail: CustomerDetail): CustomerRow {
  return {
    ...detail.customer,
    counts: {
      keywords: detail.keywords.filter((item) => item.status === "active").length,
      files: detail.files.filter((item) => item.status === "active").length,
      articles: detail.articles.length
    }
  };
}

function activeRows<T extends { status: string }>(rows: T[]) {
  return rows.filter((row) => row.status === "active");
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function effectiveParseStatus(file: KnowledgeFile) {
  return file.parseStatus === "parsed" && file.errorMessage.trim() ? "uploaded" : file.parseStatus;
}

function isKnowledgeFileParsed(file: KnowledgeFile) {
  return effectiveParseStatus(file) === "parsed";
}

function knowledgeFileDescription(file: KnowledgeFile) {
  if (effectiveParseStatus(file) !== "parsed") {
    if (file.errorMessage.includes("暂未自动解析")) return "暂未自动解析该格式，请转成 txt/md 后再上传。";
    return file.errorMessage || "未解析，暂不能用于生成任务";
  }
  return file.errorMessage || "已解析，可用于生成任务";
}

function visibleTaskRows(rows: TaskRow[]) {
  return rows.filter((row) => row.status !== "cancelled");
}

function taskMatchesCustomerQuery(task: TaskRow, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const customer = task.customer;
  return [customer?.name, customer?.shortName, customer?.industry]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(needle));
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerTotal, setCustomerTotal] = useState(0);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [facts, setFacts] = useState<KnowledgeFact[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const customerId = selectedCustomerId;

  async function fetchCustomers(page: number, query: string) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(customerPageSize),
      query,
      status: "active"
    });
    return api<PagedResult<CustomerRow>>(`/api/customers?${params.toString()}`);
  }

  function applyCustomerPage(result: PagedResult<CustomerRow>) {
    setCustomers(result.items);
    setCustomerTotal(result.total);
    setCustomerPage(result.page);
  }

  async function loadCustomerPage(page = customerPage, query = customerSearch) {
    const result = await fetchCustomers(page, query);
    applyCustomerPage(result);
    return result;
  }

  async function refresh(nextCustomerId = selectedCustomerId, page = customerPage, query = customerSearch, user = currentUser) {
    if (!user) return;
    const [customerResult, promptRows, modelRows, taskRows, articleRows, userRows] = await Promise.all([
      fetchCustomers(page, query),
      api<PromptRow[]>("/api/prompts"),
      user.role === "admin" ? api<ModelRow[]>("/api/model-configs") : Promise.resolve([]),
      api<TaskRow[]>("/api/generation-tasks"),
      api<ArticleRow[]>("/api/articles"),
      user.role === "admin" ? api<PublicUser[]>("/api/users") : Promise.resolve([])
    ]);

    applyCustomerPage(customerResult);
    setPrompts(activeRows(promptRows));
    setModels(activeRows(modelRows));
    setTasks(visibleTaskRows(taskRows));
    setArticles(articleRows);
    setUsers(userRows);

    const nextId = nextCustomerId || "";
    if (nextId) {
      await refreshCustomer(nextId);
    } else {
      setSelectedCustomerId("");
      setSelectedCustomer(null);
      setKeywords([]);
      setFiles([]);
      setFacts([]);
    }
  }

  async function refreshCustomer(nextCustomerId = customerId) {
    if (!nextCustomerId) {
      setSelectedCustomerId("");
      setSelectedCustomer(null);
      setKeywords([]);
      setFiles([]);
      setFacts([]);
      return;
    }
    const detail = await api<CustomerDetail>(`/api/customers/${nextCustomerId}`);
    setSelectedCustomerId(nextCustomerId);
    setSelectedCustomer(toCustomerRow(detail));
    setKeywords(activeRows(detail.keywords));
    setFiles(activeRows(detail.files));
    setFacts(activeRows(detail.facts));
  }

  async function selectCustomer(id: string, customer?: CustomerRow) {
    setSelectedCustomerId(id);
    if (customer) setSelectedCustomer(customer);
    await refreshCustomer(id);
  }

  async function handleCustomerDeleted(deletedCustomerId: string) {
    if (deletedCustomerId === selectedCustomerId) {
      await refresh("", 1, customerSearch);
      return;
    }
    await loadCustomerPage(customerPage, customerSearch);
  }

  function markTaskStarted(taskId: string) {
    const at = new Date().toISOString();
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? resetTaskRowForFreshRun(task, at) : task
      )
    );
  }

  async function run(action: () => Promise<void>, message: string, options?: { refresh?: boolean }) {
    try {
      setBusy(true);
      await action();
      if (options?.refresh !== false) await refresh();
      setToast(message);
      window.setTimeout(() => setToast(""), 2600);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const hasLiveTasks = tasks.some((task) => task.status === "running" || task.status === "pending");

  useEffect(() => {
    async function bootstrapAuth() {
      try {
        const user = await api<PublicUser>("/api/auth/me");
        setCurrentUser(user);
        await refresh("", 1, "", user);
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthChecked(true);
      }
    }
    bootstrapAuth().catch((error) => setToast(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!currentUser || !hasLiveTasks) return;
    const timer = window.setInterval(() => {
      refresh().catch((error) => setToast(error.message));
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveTasks]);

  const availableTabs = useMemo(
    () => tabs.filter((tab) => currentUser?.role === "admin" || (tab.id !== "models" && tab.id !== "users")),
    [currentUser]
  );

  useEffect(() => {
    if (!currentUser) return;
    if (!availableTabs.some((tab) => tab.id === activeTab)) setActiveTab("dashboard");
  }, [activeTab, availableTabs, currentUser]);

  const metrics = useMemo<Array<[string, number]>>(
    () => [
      ["客户", customerTotal],
      ["已载入关键词", keywords.length],
      ["已载入文件", files.length],
      ["任务", tasks.length],
      ["文章", articles.length]
    ],
    [customerTotal, keywords, files, tasks, articles]
  );
  const activeTabMeta = availableTabs.find((tab) => tab.id === activeTab) || availableTabs[0] || tabs[0];

  async function handleLogin(user: PublicUser) {
    setCurrentUser(user);
    setAuthChecked(true);
    setActiveTab("dashboard");
    await refresh("", 1, "", user);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    setUsers([]);
    setCustomers([]);
    setCustomerTotal(0);
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setKeywords([]);
    setFiles([]);
    setFacts([]);
    setPrompts([]);
    setModels([]);
    setTasks([]);
    setArticles([]);
  }

  if (!authChecked) return <div className="login-screen"><p>正在进入系统...</p></div>;
  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <button
            className="brand-logo-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            type="button"
          >
            <img src="/oubo-logo.jpg" alt="欧博东方" />
          </button>
          <span className="brand-system-name">GEO Content Ops</span>
        </div>
        <div className="sidebar-label">Operations</div>
        <nav className="nav">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              type="button"
            >
              <span className="nav-index">{tab.shortcut}</span>
              <span>
                <b>{tab.label}</b>
                <small>{tab.description}</small>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="page-title">
            <span className="eyebrow">GEO CONTENT OPERATIONS</span>
            <h1>{activeTabMeta.label}</h1>
            <p>{activeTabMeta.description}</p>
          </div>
          <div className="topbar-actions">
            <div className="user-chip" aria-label="当前账号">
              <span>{currentUser.role === "admin" ? "AD" : "EM"}</span>
              <b>{currentUser.displayName || currentUser.username}</b>
            </div>
            <button className="btn" onClick={logout} disabled={busy} type="button">
              退出
            </button>
            <button className="btn" onClick={() => refresh()} disabled={busy} type="button">
              刷新
            </button>
          </div>
        </div>

        {activeTab === "dashboard" && <Dashboard metrics={metrics} tasks={tasks} articles={articles} onNavigate={setActiveTab} />}
        {activeTab === "customers" && (
          <Customers
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            selectedCustomer={selectedCustomer}
            keywords={keywords}
            total={customerTotal}
            page={customerPage}
            pageSize={customerPageSize}
            search={customerSearch}
            busy={busy}
            run={run}
            onSearch={async (query) => {
              setCustomerSearch(query);
              await loadCustomerPage(1, query);
            }}
            onPageChange={async (page) => {
              await loadCustomerPage(page, customerSearch);
            }}
            onCustomerSaved={async (customer) => {
              setCustomerSearch("");
              await refresh(customer.id, 1, "");
            }}
            onCustomerSelected={selectCustomer}
            onKeywordsSaved={async (customerId) => {
              await refresh(customerId, customerPage, customerSearch);
            }}
            onCustomerDeleted={handleCustomerDeleted}
          />
        )}
        {activeTab === "knowledge" && (
          <Knowledge
            customerId={customerId}
            selectedCustomer={selectedCustomer}
            setCustomerId={selectCustomer}
            keywords={keywords}
            files={files}
            facts={facts}
            run={run}
          />
        )}
        {activeTab === "prompts" && (
          <Prompts selectedCustomer={selectedCustomer} customerId={customerId} prompts={prompts} run={run} />
        )}
        {activeTab === "models" && currentUser.role === "admin" && <Models models={models} run={run} />}
        {activeTab === "tasks" && (
          <Tasks
            customerId={customerId}
            selectedCustomer={selectedCustomer}
            keywords={keywords}
            files={files}
            prompts={prompts}
            models={models}
            tasks={tasks}
            canManageModels={currentUser.role === "admin"}
            onTaskStarted={markTaskStarted}
            run={run}
          />
        )}
        {activeTab === "articles" && <ArticleWorkbench articles={articles} run={run} onNavigate={setActiveTab} />}
        {activeTab === "users" && currentUser.role === "admin" && <UserCenter users={users} run={run} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: PublicUser) => Promise<void> }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const data = formObject(event.currentTarget);
      const user = await api<PublicUser>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      await onLogin(user);
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-logo">
          <img src="/oubo-logo.jpg" alt="欧博东方" />
        </div>
        <h1>登录用户中心</h1>
        <p className="muted">使用授权账号登录内容运营系统。</p>
        <form className="form one" onSubmit={submit}>
          <Field name="username" label="账号" placeholder="请输入账号" required />
          <Field name="password" label="密码" type="password" placeholder="请输入密码" required />
          {error && <p className="form-error">{error}</p>}
          <button className="btn primary" disabled={submitting} type="submit">
            登录
          </button>
        </form>
      </section>
    </main>
  );
}

function UserCenter({
  users,
  run
}: {
  users: PublicUser[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [resettingPasswordUser, setResettingPasswordUser] = useState<PublicUser | null>(null);
  const [passwordError, setPasswordError] = useState("");

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    await run(
      async () => {
        await api("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        form.reset();
      },
      "员工账号已创建"
    );
  }

  function updateUser(user: PublicUser, input: Partial<PublicUser> & { password?: string }, message: string) {
    run(
      () =>
        api(`/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input)
        }),
      message
    );
  }

  function deleteUser(user: PublicUser) {
    if (!window.confirm(`删除员工 ${user.username}？该账号将不能再登录，客户、任务和稿件不会被删除。`)) return;
    run(
      () =>
        api(`/api/users/${user.id}`, {
          method: "DELETE"
        }),
      "员工已删除"
    );
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resettingPasswordUser) return;
    const form = event.currentTarget;
    const data = formObject(form);
    const newPassword = String(data.newPassword || "").trim();
    const confirmPassword = String(data.confirmPassword || "").trim();
    if (newPassword.length < 6) {
      setPasswordError("密码至少需要 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的密码不一致");
      return;
    }
    setPasswordError("");
    await run(
      async () => {
        await api(`/api/users/${resettingPasswordUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: newPassword })
        });
        form.reset();
        setResettingPasswordUser(null);
      },
      "密码已重置"
    );
  }

  return (
    <>
      <div className="user-center">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>员工账号</h2>
            <p className="muted">管理员可以开通员工账号。员工只访问自己创建的客户、任务和稿件。</p>
          </div>
          <span className="panel-count">{users.length} 个账号</span>
        </div>
        <form className="user-create-form" onSubmit={createUser}>
          <Field name="username" label="登录账号" placeholder="writer01" required />
          <Field name="displayName" label="员工名称" placeholder="内容编辑 A" />
          <Field name="password" label="初始密码" type="password" placeholder="至少 6 位" required />
          <button className="btn primary" type="submit">
            创建员工
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>名称</th>
                <th>角色</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{user.role === "admin" ? "管理员" : "员工"}</td>
                  <td>
                    <StatusBadge value={user.status} />
                  </td>
                  <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "-"}</td>
                  <td>
                    <div className="actions">
                      {user.role === "employee" && (
                        <button
                          className="btn small"
                          onClick={() => updateUser(user, { status: user.status === "active" ? "disabled" : "active" }, "账号状态已更新")}
                          type="button"
                        >
                          {user.status === "active" ? "停用" : "启用"}
                        </button>
                      )}
                      {user.role === "employee" && (
                        <button
                          className="btn small"
                          onClick={() => {
                            setPasswordError("");
                            setResettingPasswordUser(user);
                          }}
                          type="button"
                        >
                          重置密码
                        </button>
                      )}
                      {user.role === "employee" && (
                        <button className="btn small danger" onClick={() => deleteUser(user)} type="button">
                          删除员工
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      <Modal
        description={resettingPasswordUser ? `为 ${resettingPasswordUser.username} 设置新的登录密码。保存后，该员工需要用新密码重新登录。` : ""}
        onClose={() => {
          setPasswordError("");
          setResettingPasswordUser(null);
        }}
        open={Boolean(resettingPasswordUser)}
        title="重置员工密码"
      >
        <form className="form one" onSubmit={resetPassword}>
          <Field name="newPassword" label="新密码" type="password" placeholder="至少 6 位" required />
          <Field name="confirmPassword" label="确认密码" type="password" placeholder="再次输入新密码" required />
          {passwordError && <p className="form-error">{passwordError}</p>}
          <button className="btn primary" type="submit">
            保存新密码
          </button>
        </form>
      </Modal>
    </>
  );
}

function Dashboard({
  metrics,
  tasks,
  articles,
  onNavigate
}: {
  metrics: Array<[string, number]>;
  tasks: TaskRow[];
  articles: ArticleRow[];
  onNavigate: (tab: Tab) => void;
}) {
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const runningTasks = tasks.filter((task) => task.status === "running" || task.status === "pending").length;
  const passedArticles = articles.filter((article) => article.status === "passed").length;
  const failedArticles = articles.filter((article) => article.status === "failed").length;
  const latestArticle = articles[0];

  return (
    <div className="dashboard-page">
      <section className="ai-workbench">
        <div className="history-rail glass-panel">
          <div className="rail-head">
            <span className="eyebrow">HISTORY</span>
            <b>最近产出</b>
          </div>
          <div className="history-list">
            {articles.slice(0, 4).map((article) => (
              <button className="history-item" key={article.id} onClick={() => onNavigate("articles")} type="button">
                <span>{article.customer?.name || "未关联客户"}</span>
                <b>{article.title}</b>
              </button>
            ))}
            {!articles.length && <p className="muted empty-state">暂无历史稿件。</p>}
          </div>
          <button className="btn ghost" onClick={() => onNavigate("prompts")} type="button">
            打开模板库
          </button>
        </div>

        <div className="prompt-studio glass-panel">
          <div className="studio-head">
            <span className="eyebrow">AI ARTICLE GENERATOR</span>
            <h2>把客户资料转成可发布文章</h2>
            <p>输入主题，选择客户知识库和提示词模板，然后进入生成任务批量产出。</p>
          </div>
          <div className="prompt-input-shell">
            <textarea
              className="prompt-input"
              readOnly
              value={"围绕客户知识库中的事实，生成一篇可直接发布的 GEO 内容稿。要求引用客户资料，结构清晰，避免堆砌关键词。"}
            />
            <span className="char-counter">76 / 2000</span>
          </div>
          <div className="smart-suggestions">
            <button type="button">客户痛点</button>
            <button type="button">产品对比</button>
            <button type="button">搜索问答</button>
            <button type="button">行业趋势</button>
          </div>
          <div className="parameter-grid">
            <label>
              <span>文章篇数</span>
              <input className="input" readOnly value="3 篇" />
            </label>
            <label>
              <span>内容强度</span>
              <input className="input" readOnly value="严谨 / 可验证" />
            </label>
          </div>
          <div className="generate-bar">
            <button className="btn primary generate-btn" onClick={() => onNavigate("tasks")} type="button">
              进入生成任务
            </button>
            <div className="progress-line" aria-hidden="true">
              <i />
            </div>
          </div>
        </div>

        <aside className="preview-panel glass-panel">
          <div className="preview-head">
            <span className="eyebrow">LIVE PREVIEW</span>
            <StatusBadge value={latestArticle?.status || "draft"} />
          </div>
          <article className="preview-doc">
            <h3>{latestArticle?.title || "生成结果预览"}</h3>
            <p>{latestArticle?.summary || "生成完成后，这里会展示文章摘要、正文结构和可复制的发布稿预览。"}</p>
            <div className="typing-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </article>
          <div className="editor-toolbar" aria-label="富文本工具栏">
            <button type="button">B</button>
            <button type="button">I</button>
            <button type="button">H2</button>
            <button type="button">列表</button>
            <button type="button">链接</button>
          </div>
        </aside>
      </section>

      <section className="metric-strip" aria-label="关键指标">
        {metrics.map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <section className="panel task-panel">
          <div className="section-head">
            <div>
              <h2>任务流</h2>
              <p className="muted">最近执行的生成任务和当前进度。</p>
            </div>
            <span className="panel-count">{tasks.length} 项</span>
          </div>
          <TaskTable tasks={tasks.slice(0, 6)} />
        </section>
        <section className="panel publishing-panel">
          <div className="section-head">
            <div>
              <h2>发布队列</h2>
              <p className="muted">优先查看可以复制到平台的稿件。</p>
            </div>
            <span className="panel-count">{articles.length} 篇</span>
          </div>
          {latestArticle && (
            <article className="featured-article">
              <StatusBadge value={latestArticle.status} />
              <h3>{latestArticle.title}</h3>
              <p>{latestArticle.summary || latestArticle.content.slice(0, 140)}</p>
            </article>
          )}
          <div className="compact-feed">
            {articles.slice(0, 5).map((article) => (
              <div className="feed-row" key={article.id}>
                <div>
                  <b>{article.title}</b>
                  <span>{article.customer?.name || "-"} / {article.keyword?.keyword || "-"}</span>
                </div>
                <StatusBadge value={article.status} />
              </div>
            ))}
            {!articles.length && <p className="muted empty-state">还没有生成文章。</p>}
          </div>
        </section>
      </section>
    </div>
  );
}

function Customers({
  customers,
  selectedCustomerId,
  selectedCustomer,
  keywords,
  total,
  page,
  pageSize,
  search,
  busy,
  run,
  onSearch,
  onPageChange,
  onCustomerSaved,
  onCustomerSelected,
  onKeywordsSaved,
  onCustomerDeleted
}: {
  customers: CustomerRow[];
  selectedCustomerId: string;
  selectedCustomer: CustomerRow | null;
  keywords: Keyword[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  busy: boolean;
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
  onSearch: (query: string) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
  onCustomerSaved: (customer: Customer) => Promise<void>;
  onCustomerSelected: (id: string, customer?: CustomerRow) => Promise<void>;
  onKeywordsSaved: (customerId: string) => Promise<void>;
  onCustomerDeleted: (id: string) => Promise<void>;
}) {
  const [draftSearch, setDraftSearch] = useState(search);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedCustomerStats = selectedCustomer?.counts || { keywords: 0, files: 0, articles: 0 };

  function openCustomerModal(customer?: CustomerRow) {
    setEditingCustomer(customer || null);
    setCustomerModalOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const editing = editingCustomer;
    await run(
      async () => {
        const customer = await api<Customer>(editing ? `/api/customers/${editing.id}` : "/api/customers", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        form.reset();
        setEditingCustomer(null);
        setCustomerModalOpen(false);
        setDraftSearch("");
        await onCustomerSaved(customer);
      },
      editing ? "客户信息已更新" : "客户已添加，关键词已录入",
      { refresh: false }
    );
  }

  async function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSearch(draftSearch.trim());
  }

  return (
    <div className="customers-page">
      <section className="customer-console">
        <div className="customer-console-head">
          <div>
          <span className="eyebrow">CLIENT DIRECTORY</span>
            <h2>客户工作台</h2>
            <p className="muted">管理客户档案、关键词、知识库和内容产出。选中客户后，右侧会显示可维护的上下文。</p>
          </div>
          <button className="btn primary" onClick={() => openCustomerModal()} type="button">
            新增客户
          </button>
        </div>
        <form className="customer-searchbar" onSubmit={searchSubmit}>
          <input
            className="input toolbar-input"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="搜索客户名、简称、行业、官网"
          />
          <button className="btn primary" disabled={busy} type="submit">
            搜索
          </button>
          <button
            className="btn"
            disabled={busy || (!draftSearch && !search)}
            onClick={() => {
              setDraftSearch("");
              onSearch("").catch((error) => console.error(error));
            }}
            type="button"
          >
            重置
          </button>
        </form>
        <div className="customer-stat-strip" aria-label="客户概览">
          <span><b>{total}</b>客户总数</span>
          <span><b>{customers.length}</b>当前页</span>
          <span><b>{selectedCustomerStats.keywords}</b>当前关键词</span>
          <span><b>{selectedCustomerStats.files}</b>知识库文件</span>
          <span><b>{selectedCustomerStats.articles}</b>文章</span>
        </div>
      </section>

      <section className="customer-workspace">
        <div className="panel customer-directory">
          <div className="section-head">
            <div>
              <h2>客户目录</h2>
              <p className="muted">点击客户即可切换右侧上下文。</p>
            </div>
            <span className="panel-count">第 {page} 页</span>
          </div>
          {customers.length ? (
            <>
              <div className="customer-card-list">
                {customers.map((customer) => {
                  const selected = customer.id === selectedCustomerId;
                  return (
                    <article className={`customer-card ${selected ? "selected" : ""}`} key={customer.id}>
                      <button className="customer-card-main" onClick={() => onCustomerSelected(customer.id, customer)} type="button">
                        <span className="customer-avatar">{customer.name.slice(0, 1)}</span>
                        <span>
                          <b>{customer.name}</b>
                          <small>{customer.shortName || customer.website || customer.industry || "暂无补充信息"}</small>
                        </span>
                      </button>
                      <div className="customer-card-meta">
                        <span>词 {customer.counts.keywords}</span>
                        <span>库 {customer.counts.files}</span>
                        <span>文 {customer.counts.articles}</span>
                        <StatusBadge value={customer.status} />
                      </div>
                      <div className="customer-card-actions">
                        <button className="btn small" onClick={() => openCustomerModal(customer)} type="button">
                          编辑
                        </button>
                        <button
                          className="btn small danger"
                          onClick={() => {
                            if (window.confirm(`确定删除客户“${customer.name}”吗？`)) {
                              run(
                                async () => {
                                  await api(`/api/customers/${customer.id}`, { method: "DELETE" });
                                  await onCustomerDeleted(customer.id);
                                },
                                "客户已删除",
                                { refresh: false }
                              );
                            }
                          }}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <Pager page={page} totalPages={totalPages} busy={busy} onPageChange={onPageChange} />
            </>
          ) : (
            <div className="empty-directory">
              <div>
                <h3>{search ? "没有匹配客户" : "暂无客户"}</h3>
                <p className="muted">{search ? "换一个关键词试试，或重置筛选条件。" : "添加客户后，就可以上传知识库文件并批量生成内容。"}</p>
              </div>
              <button className="btn primary" onClick={() => openCustomerModal()} type="button">
                新增第一个客户
              </button>
            </div>
          )}
        </div>

        <aside className="customer-inspector">
          <section className="panel customer-profile-panel">
            <div className="section-head">
              <div>
                <h2>{selectedCustomer?.name || "未选择客户"}</h2>
                <p className="muted">{selectedCustomer ? selectedCustomer.industry || selectedCustomer.website || "客户档案已载入" : "从左侧客户目录选择一个客户。"}</p>
              </div>
              {selectedCustomer && <StatusBadge value={selectedCustomer.status} />}
            </div>
            <div className="customer-profile-grid">
              <span><b>{selectedCustomerStats.keywords}</b>关键词</span>
              <span><b>{selectedCustomerStats.files}</b>知识库</span>
              <span><b>{selectedCustomerStats.articles}</b>文章</span>
            </div>
            <div className="customer-profile-actions">
              <button className="btn" disabled={!selectedCustomer} onClick={() => selectedCustomer && openCustomerModal(selectedCustomer)} type="button">
                编辑档案
              </button>
            </div>
          </section>

          <CustomerKeywordManager
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            selectedCustomer={selectedCustomer}
            keywords={keywords}
            busy={busy}
            run={run}
            onCustomerSelected={onCustomerSelected}
            onKeywordsSaved={onKeywordsSaved}
          />
        </aside>
      </section>
      <Modal
        description="新增客户时可以顺手录入首批关键词，后续知识库只需要上传文件。"
        onClose={() => {
          setCustomerModalOpen(false);
          setEditingCustomer(null);
        }}
        open={customerModalOpen}
        title={editingCustomer ? "编辑客户" : "新增客户"}
      >
        <CustomerForm customer={editingCustomer} busy={busy} onSubmit={submit} />
      </Modal>
    </div>
  );
}

function CustomerKeywordManager({
  customers,
  selectedCustomerId,
  selectedCustomer,
  keywords,
  busy,
  run,
  onCustomerSelected,
  onKeywordsSaved
}: {
  customers: CustomerRow[];
  selectedCustomerId: string;
  selectedCustomer: CustomerRow | null;
  keywords: Keyword[];
  busy: boolean;
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
  onCustomerSelected: (id: string, customer?: CustomerRow) => Promise<void>;
  onKeywordsSaved: (customerId: string) => Promise<void>;
}) {
  const [keywordFormKey, setKeywordFormKey] = useState(0);
  const [selectedKeywordCustomerId, setSelectedKeywordCustomerId] = useState(selectedCustomerId);
  const [selectedKeywordCustomer, setSelectedKeywordCustomer] = useState<CustomerRow | null>(selectedCustomer);

  useEffect(() => {
    setSelectedKeywordCustomerId(selectedCustomerId);
    setSelectedKeywordCustomer(selectedCustomer);
  }, [selectedCustomerId, selectedCustomer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const customerId = selectedKeywordCustomerId || selectedCustomerId;
    if (!customerId) throw new Error("请先选择客户");

    await run(
      async () => {
        await api(`/api/customers/${customerId}/keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        form.reset();
        setKeywordFormKey((value) => value + 1);
        await onKeywordsSaved(customerId);
      },
      "关键词已添加",
      { refresh: false }
    );
  }

  async function deleteKeyword(keyword: Keyword) {
    if (!window.confirm(`确定删除关键词“${keyword.keyword}”吗？`)) return;
    await run(
      async () => {
        await api(`/api/keywords/${keyword.id}`, { method: "DELETE" });
        await onKeywordsSaved(keyword.customerId);
      },
      "关键词已删除",
      { refresh: false }
    );
  }

  const activeKeywords = keywords.filter((keyword) => keyword.status === "active");

  return (
    <section className="panel keyword-manager">
      <div className="section-head">
        <div>
          <h2>关键词管理</h2>
          <p className="muted">给已有客户继续追加关键词，后续创建生成任务时就能直接选择。</p>
        </div>
        <span className="panel-count">{activeKeywords.length} 个关键词</span>
      </div>

      <form className="keyword-manager-form" key={keywordFormKey} onSubmit={submit}>
        <div className="keyword-customer-context">
          <span>当前客户</span>
          <b>{selectedKeywordCustomer?.name || "请先从左侧选择客户"}</b>
        </div>
        <Field name="keywordType" label="关键词类型" defaultValue="核心词" placeholder="核心词、业务词、场景词" />
        <TextArea name="keywordBatchText" label="新增关键词" placeholder="每行一个关键词，也可以用逗号分隔" required />
        <button className="btn primary" disabled={busy || !selectedKeywordCustomerId || customers.length === 0} type="submit">
          保存关键词
        </button>
      </form>

      <div className="keyword-list" aria-label="当前客户关键词">
        {activeKeywords.slice(0, 24).map((keyword) => (
          <span className="keyword-pill" key={keyword.id}>
            <span>{keyword.keyword}</span>
            <small>{keyword.keywordType || "未分类"}</small>
            <button
              aria-label={`删除关键词 ${keyword.keyword}`}
              className="keyword-delete"
              disabled={busy}
              onClick={() => deleteKeyword(keyword)}
              title="删除关键词"
              type="button"
            >
              ×
            </button>
          </span>
        ))}
        {!activeKeywords.length && <p className="muted empty-state">选择客户后，这里会显示它已有的关键词。</p>}
      </div>
    </section>
  );
}

function CustomerForm({
  customer,
  busy,
  onSubmit
}: {
  customer: CustomerRow | null;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <form className="form customer-form" key={customer?.id || "new-customer"} onSubmit={onSubmit}>
      <Field name="name" label="客户名称" defaultValue={customer?.name} required />
      <Field name="shortName" label="客户简称" defaultValue={customer?.shortName} />
      <Field name="industry" label="行业" defaultValue={customer?.industry} />
      <Field name="website" label="官网" defaultValue={customer?.website} />
      <Field name="contactName" label="联系人" defaultValue={customer?.contactName} />
      <Field name="contactInfo" label="联系方式" defaultValue={customer?.contactInfo} />
      {!customer && <TextArea name="keywordBatchText" label="首批关键词" placeholder="品牌词、业务词、产品词" />}
      <TextArea name="remark" label="备注" defaultValue={customer?.remark} />
      <StatusSelect defaultValue={customer?.status || "active"} />
      <button className="btn primary" disabled={busy} type="submit">
        {customer ? "保存修改" : "保存客户"}
      </button>
    </form>
  );
}

function Knowledge({
  customerId,
  selectedCustomer,
  setCustomerId,
  facts,
  files,
  run
}: {
  customerId: string;
  selectedCustomer: CustomerRow | null;
  setCustomerId: (id: string, customer?: CustomerRow) => Promise<void>;
  keywords: Keyword[];
  files: KnowledgeFile[];
  facts: KnowledgeFact[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatus, setFileStatus] = useState<"all" | "parsed" | "needs_action">("all");
  const [selectedUploadFile, setSelectedUploadFile] = useState("");
  const visibleFiles = useMemo(() => activeRows(files), [files]);
  const usedKnowledgeBytes = visibleFiles.reduce((total, file) => total + (file.fileSize || 0), 0);
  const parsedFileCount = visibleFiles.filter(isKnowledgeFileParsed).length;
  const needsActionCount = visibleFiles.length - parsedFileCount;
  const parsedFactCount = facts.filter((fact) => fact.status === "active").length;
  const usagePercent = Math.min(100, Math.round((usedKnowledgeBytes / customerKnowledgeLimitBytes) * 100));
  const query = fileQuery.trim().toLowerCase();
  const statusTabs = [
    { id: "all" as const, label: "全部", count: visibleFiles.length },
    { id: "parsed" as const, label: "可用于生成", count: parsedFileCount },
    { id: "needs_action" as const, label: "需要处理", count: needsActionCount }
  ];
  const filteredFiles = visibleFiles.filter((file) => {
    const parsed = isKnowledgeFileParsed(file);
    const matchesStatus = fileStatus === "all" || (fileStatus === "parsed" ? parsed : !parsed);
    const matchesQuery = [file.fileName, file.fileType, file.errorMessage, effectiveParseStatus(file)]
      .join(" ")
      .toLowerCase()
      .includes(query);
    return matchesStatus && matchesQuery;
  });

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    await run(
      async () => {
        if (!customerId) throw new Error("请先选择客户");
        if (!selectedUploadFile) throw new Error("请选择要上传的文件");
        await api(`/api/customers/${customerId}/knowledge-files`, { method: "POST", body: formData });
        form.reset();
        setSelectedUploadFile("");
      },
      "知识库文件已上传，解析结果已更新"
    );
  }

  return (
    <div className="knowledge-page">
      <section className="knowledge-console">
        <div className="knowledge-console-head">
          <div>
            <span className="eyebrow">KNOWLEDGE INGESTION</span>
            <h2>客户知识库工作台</h2>
            <p className="muted">先选择客户，再上传资料；解析成功的文件会自动进入生成任务的可选知识范围。</p>
          </div>
          <div className="knowledge-customer-chip">
            <span>当前客户</span>
            <b>{selectedCustomer?.name || "未选择"}</b>
          </div>
        </div>

        <div className="knowledge-workflow">
          <div className="knowledge-context">
            <CustomerSearchSelect label="选择客户" value={customerId} selectedCustomer={selectedCustomer} onChange={setCustomerId} />
            <div className="knowledge-usage">
              <div>
                <span>容量</span>
                <b>{formatBytes(usedKnowledgeBytes)} / {formatBytes(customerKnowledgeLimitBytes)}</b>
              </div>
              <div className="usage-bar" aria-label="知识库容量使用率">
                <span style={{ width: `${usagePercent}%` }} />
              </div>
            </div>
            <div className="knowledge-mini-metrics">
              <span><b>{visibleFiles.length}</b> 文件</span>
              <span><b>{parsedFileCount}</b> 可用</span>
              <span><b>{parsedFactCount}</b> 事实</span>
            </div>
          </div>

          <form className="knowledge-upload-card" onSubmit={upload}>
            <label className="upload-dropzone" htmlFor="knowledge-file">
              <span>{selectedUploadFile || "选择或拖入知识库文件"}</span>
              <small>txt、md、pdf、docx、csv、json、html、xlsx；单客户最多 100MB</small>
              <input
                id="knowledge-file"
                name="file"
                type="file"
                accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.html,.htm,.xlsx"
                required
                onChange={(event) => setSelectedUploadFile(event.currentTarget.files?.[0]?.name || "")}
              />
            </label>
            <button className="btn primary" type="submit" disabled={!customerId || !selectedUploadFile}>
              上传并解析
            </button>
            <p className="muted upload-hint">
              {customerId ? "上传后会立即解析，解析失败的文件可以在队列中重新解析。" : "请先选择客户，避免资料上传到错误客户。"}
            </p>
          </form>
        </div>
      </section>

      <section className="panel knowledge-files">
        <div className="section-head">
          <div>
            <h2>文件队列</h2>
            <p className="muted">
              {selectedCustomer ? `${selectedCustomer.name} 的资料解析状态` : "选择客户后查看对应资料"}
            </p>
          </div>
          <span className="muted">显示 {filteredFiles.length} / {visibleFiles.length}</span>
        </div>
        <div className="knowledge-toolbar">
          <input
            className="input toolbar-input"
            value={fileQuery}
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="筛选文件名、类型、解析状态"
          />
          <div className="segmented-tabs" aria-label="知识库文件状态筛选">
            {statusTabs.map((tab) => (
              <button
                className={fileStatus === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setFileStatus(tab.id)}
                type="button"
              >
                {tab.label} <b>{tab.count}</b>
              </button>
            ))}
          </div>
        </div>
        <div className="file-list">
          {filteredFiles.map((file) => (
            <div className="file-card" key={file.id}>
              <div className="file-card-main">
                <div className="file-type-mark">{file.fileType.toUpperCase().slice(0, 4)}</div>
                <div>
                  <h3>{file.fileName}</h3>
                  <p className="muted">{knowledgeFileDescription(file)}</p>
                  <div className="file-meta">
                    <span>{formatBytes(file.fileSize || 0)}</span>
                    <span>{new Date(file.updatedAt).toLocaleString("zh-CN")}</span>
                  </div>
                </div>
              </div>
              <div className="actions">
                <StatusBadge value={effectiveParseStatus(file)} />
                {!isKnowledgeFileParsed(file) && (
                  <button
                    className="btn small"
                    onClick={() => run(() => api(`/api/knowledge-files/${file.id}/reparse`, { method: "POST" }), "文件已重新解析")}
                    type="button"
                  >
                    重新解析
                  </button>
                )}
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(`确定删除知识库文件“${file.fileName}”吗？`)) {
                      run(() => api(`/api/knowledge-files/${file.id}`, { method: "DELETE" }), "知识库文件已删除");
                    }
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {!visibleFiles.length && <p className="muted empty-state">所选客户暂无知识库文件，上传后会显示在这里。</p>}
          {Boolean(visibleFiles.length) && !filteredFiles.length && <p className="muted empty-state">没有匹配知识库文件。</p>}
        </div>
      </section>
    </div>
  );
}
function Prompts({
  selectedCustomer,
  customerId,
  prompts,
  run
}: {
  selectedCustomer: CustomerRow | null;
  customerId: string;
  prompts: PromptRow[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [scope, setScope] = useState<Prompt["scope"]>("global");
  const [promptCustomer, setPromptCustomer] = useState<CustomerRow | null>(selectedCustomer);
  const [promptCustomerId, setPromptCustomerId] = useState(customerId);
  const [editingPrompt, setEditingPrompt] = useState<PromptRow | null>(null);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | Prompt["scope"]>("all");
  const visiblePrompts = useMemo(() => prompts.filter((prompt) => prompt.status === "active"), [prompts]);
  const globalPrompts = useMemo(() => visiblePrompts.filter((prompt) => prompt.scope === "global"), [visiblePrompts]);
  const customerPromptGroups = useMemo(() => {
    const groups = new Map<string, { customerId: string; customerName: string; prompts: PromptRow[] }>();
    for (const prompt of visiblePrompts) {
      if (prompt.scope !== "customer" || !prompt.customerId) continue;
      const customerName = prompt.customer?.name || "未关联客户";
      const group = groups.get(prompt.customerId) || { customerId: prompt.customerId, customerName, prompts: [] };
      group.prompts.push(prompt);
      groups.set(prompt.customerId, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.customerName.localeCompare(b.customerName, "zh-CN"));
  }, [visiblePrompts]);
  const customerPrompts = useMemo(
    () => customerPromptGroups.flatMap((group) => group.prompts),
    [customerPromptGroups]
  );
  const filteredPrompts = useMemo(
    () =>
      [...globalPrompts, ...customerPrompts].filter((prompt) => promptMatchesQuery(prompt) && promptMatchesScope(prompt)),
    [customerPrompts, globalPrompts, promptQuery, scopeFilter]
  );
  useEffect(() => {
    setPromptCustomer(selectedCustomer);
    setPromptCustomerId(customerId);
  }, [selectedCustomer, customerId]);

  useEffect(() => {
    if (editingPrompt) setScope(editingPrompt.scope);
  }, [editingPrompt]);

  function openPromptModal(prompt?: PromptRow) {
    setEditingPrompt(prompt || null);
    setScope(prompt?.scope || "global");
    setPromptCustomerId(prompt?.customerId || customerId);
    if (prompt && "customer" in prompt && prompt.customer) {
      setPromptCustomer({ ...prompt.customer, counts: { keywords: 0, files: 0, articles: 0 } });
    } else if (!prompt) {
      setPromptCustomer(selectedCustomer);
    }
    setPromptModalOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const editing = editingPrompt;
    await run(
      async () => {
        await api(editing ? `/api/prompts/${editing.id}` : "/api/prompts", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            scope,
            customerId: scope === "customer" ? promptCustomerId : ""
          })
        });
        form.reset();
        setEditingPrompt(null);
        setPromptModalOpen(false);
        setScope("global");
      },
      editing ? "提示词已更新" : "提示词已保存"
    );
  }

  function promptMatchesQuery(prompt: Prompt) {
    return [prompt.name, prompt.content, prompt.scope, prompt.scope === "global" ? "全局提示词" : "客户提示词"]
      .join(" ")
      .toLowerCase()
      .includes(promptQuery.trim().toLowerCase());
  }

  function promptMatchesScope(prompt: Prompt) {
    return scopeFilter === "all" || prompt.scope === scopeFilter;
  }

  const promptScopeTabs = [
    { id: "all" as const, label: "全部", count: globalPrompts.length + customerPrompts.length },
    { id: "global" as const, label: "全局", count: globalPrompts.length },
    { id: "customer" as const, label: "客户专属", count: customerPrompts.length }
  ];

  function renderPromptGroup(title: string, description: string, rows: PromptRow[], emptyText: string, groupKey = title) {
    const filteredRows = rows.filter((prompt) => promptMatchesQuery(prompt) && promptMatchesScope(prompt));
    return (
      <section className="prompt-group" key={groupKey}>
        <div className="prompt-group-head">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <span>{filteredRows.length} 条</span>
        </div>
        <div className="prompt-card-grid">
          {filteredRows.map((prompt) => (
            <div className="card prompt-card" key={prompt.id}>
              <div className="prompt-card-main">
                <div className="prompt-card-top">
                  <h3>{prompt.name}</h3>
                  <span className={`prompt-scope ${prompt.scope}`}>{prompt.scope === "global" ? "全局" : "客户"}</span>
                </div>
                <div className="prompt-card-meta">
                  <span>{prompt.scope === "global" ? "所有客户可用" : `${prompt.customer?.name || "客户专属"}专属`}</span>
                  <span>{prompt.content.length} 字</span>
                  <span>{new Date(prompt.updatedAt).toLocaleString("zh-CN")}</span>
                </div>
                <p className="prompt-preview">{prompt.content || "暂无内容"}</p>
              </div>
              <div className="actions">
                <button className="btn small" onClick={() => openPromptModal(prompt)} type="button">
                  编辑
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(`确定删除提示词“${prompt.name}”吗？`)) {
                      run(() => api(`/api/prompts/${prompt.id}`, { method: "DELETE" }), "提示词已删除");
                    }
                  }}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          {!filteredRows.length && <p className="muted empty-state">{emptyText}</p>}
        </div>
      </section>
    );
  }

  return (
    <div className="prompts-page">
      <section className="prompt-console">
        <div className="prompt-console-head">
          <div>
            <span className="eyebrow">PROMPT LIBRARY</span>
            <h2>提示词工作台</h2>
            <p className="muted">集中管理全局模板和客户专属策略，创建任务时可直接复用。</p>
          </div>
          <div className="prompt-summary">
            <span>当前显示</span>
            <b>{filteredPrompts.length} / {globalPrompts.length + customerPrompts.length}</b>
            <button className="btn primary small" onClick={() => openPromptModal()} type="button">
              新建提示词
            </button>
          </div>
        </div>
        <div className="prompt-toolbar">
          <input
            className="input toolbar-input"
            value={promptQuery}
            onChange={(event) => setPromptQuery(event.target.value)}
            placeholder="搜索提示词名称或内容"
          />
          <div className="segmented-tabs" aria-label="提示词范围筛选">
            {promptScopeTabs.map((tab) => (
              <button
                className={scopeFilter === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setScopeFilter(tab.id)}
                type="button"
              >
                {tab.label} <b>{tab.count}</b>
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="panel prompt-library">
        <div className="prompt-groups">
          {(scopeFilter === "all" || scopeFilter === "global") && renderPromptGroup(
            "全局提示词",
            "所有客户创建生成任务时都可以选择。",
            globalPrompts,
            promptQuery ? "没有匹配的全局提示词。" : "暂无全局提示词。",
            "global-prompts"
          )}
          {(scopeFilter === "all" || scopeFilter === "customer") && <section className="prompt-group">
            <div className="prompt-group-head">
              <div>
                <h3>客户提示词</h3>
                <p>按真实绑定客户分组展示；只有对应客户的生成任务能关联。</p>
              </div>
              <span>{customerPrompts.filter((prompt) => promptMatchesQuery(prompt) && promptMatchesScope(prompt)).length} 条</span>
            </div>
            <div className="prompt-groups nested">
              {customerPromptGroups.map((group) =>
                renderPromptGroup(
                  group.customerName,
                  "该组提示词只会出现在这个客户自己的生成任务中。",
                  group.prompts,
                  promptQuery ? "没有匹配的客户提示词。" : "该客户暂无专属提示词。",
                  group.customerId
                )
              )}
              {!customerPromptGroups.length && <p className="muted empty-state">暂无客户专属提示词。</p>}
            </div>
          </section>}
        </div>
      </section>
      <Modal
        description="提示词会作为生成策略保存，后续生成任务可以复用。"
        onClose={() => {
          setPromptModalOpen(false);
          setEditingPrompt(null);
          setScope("global");
        }}
        open={promptModalOpen}
        title={editingPrompt ? "编辑提示词" : "新建提示词"}
      >
        <form className="form one" key={editingPrompt?.id || "new-prompt"} onSubmit={submit}>
          <Field name="name" label="名称" defaultValue={editingPrompt?.name} required />
          <div className="field">
            <label htmlFor="scope">范围</label>
            <select
              className="select"
              id="scope"
              name="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as Prompt["scope"])}
            >
              <option value="global">全局</option>
              <option value="customer">客户专属</option>
            </select>
          </div>
          {scope === "customer" && (
            <CustomerSearchSelect
              label="客户"
              value={promptCustomerId}
              selectedCustomer={promptCustomer}
              onChange={async (id, customer) => {
                setPromptCustomerId(id);
                if (customer) setPromptCustomer(customer);
              }}
            />
          )}
          <TextArea name="content" label="提示词内容" defaultValue={editingPrompt?.content} required />
          {editingPrompt && <StatusSelect defaultValue={editingPrompt.status} />}
          <button className="btn primary" type="submit">
            {editingPrompt ? "保存修改" : "保存提示词"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Models({
  models,
  run
}: {
  models: ModelRow[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [editingModel, setEditingModel] = useState<ModelRow | null>(null);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const visibleModels = useMemo(() => activeRows(models), [models]);

  function openModelModal(model?: ModelRow) {
    setEditingModel(model || null);
    setModelModalOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const editing = editingModel;
    await run(
      async () => {
        await api(editing ? `/api/model-configs/${editing.id}` : "/api/model-configs", {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, isDefault: data.isDefault === "on" })
        });
        form.reset();
        setEditingModel(null);
        setModelModalOpen(false);
      },
      editing ? "模型配置已更新" : "模型配置已保存"
    );
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>模型配置</h2>
            <p className="muted">管理模型渠道、密钥和默认生成参数。</p>
          </div>
          <button className="btn primary small" onClick={() => openModelModal()} type="button">
            添加模型
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Provider</th>
                <th>模型</th>
                <th>Key</th>
                <th>默认</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((model) => (
                <tr key={model.id}>
                  <td>{model.name}</td>
                  <td>{model.provider}</td>
                  <td>{model.modelName || "-"}</td>
                  <td>{model.apiKeyMasked || "-"}</td>
                  <td>{model.isDefault ? "是" : "否"}</td>
                  <td>
                    <StatusBadge value={model.status} />
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        className="btn small"
                        onClick={() => run(() => api(`/api/model-configs/${model.id}/test`, { method: "POST" }), "模型测试完成")}
                        type="button"
                      >
                        测试
                      </button>
                      <button className="btn small" onClick={() => openModelModal(model)} type="button">
                        编辑
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (window.confirm(`确定删除模型配置“${model.name}”吗？`)) {
                            run(() => api(`/api/model-configs/${model.id}`, { method: "DELETE" }), "模型配置已删除");
                          }
                        }}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Modal
        description="模型配置用于生成任务。API Key 留空时不会覆盖已有密钥。"
        onClose={() => {
          setModelModalOpen(false);
          setEditingModel(null);
        }}
        open={modelModalOpen}
        title={editingModel ? "编辑模型" : "添加模型"}
      >
        <form className="form one" key={editingModel?.id || "new-model"} onSubmit={submit}>
          <Field name="name" label="配置名称" defaultValue={editingModel?.name} required />
          <div className="field">
            <label htmlFor="provider">Provider</label>
            <select className="select" id="provider" name="provider" defaultValue={editingModel?.provider || "deepseek"}>
              <option value="deepseek">DeepSeek</option>
              <option value="volcengine_ark">豆包 / 火山方舟</option>
              <option value="dashscope_qwen">千问 / 百炼</option>
              <option value="anthropic">Claude / Anthropic / Claude Code</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <Field name="baseUrl" label="Base URL" defaultValue={editingModel?.baseUrl} placeholder="https://api.deepseek.com" />
          <Field name="modelName" label="模型名称" defaultValue={editingModel?.modelName} placeholder="deepseek-chat / qwen-plus" />
          <Field name="apiKey" label="API Key" type="password" placeholder={editingModel?.apiKeyMasked ? "留空则不修改" : ""} />
          {editingModel?.apiKeyMasked && (
            <p className="field-hint strong">当前 API Key 已保存。留空保存不会覆盖；只有输入新 Key 才会替换。</p>
          )}
          <label className="check">
            <input name="isDefault" type="checkbox" defaultChecked={Boolean(editingModel?.isDefault)} />
            <span>设为默认模型</span>
          </label>
          <details className="advanced">
            <summary>高级参数</summary>
            <div className="advanced-body">
              <Field name="temperature" label="Temperature" type="number" step="0.1" defaultValue={String(editingModel?.temperature ?? 0.7)} />
              <Field name="maxTokens" label="Max Tokens" type="number" defaultValue={String(editingModel?.maxTokens ?? 3000)} />
              <Field name="timeoutSeconds" label="Timeout 秒" type="number" defaultValue={String(editingModel?.timeoutSeconds ?? 300)} />
              {editingModel && <StatusSelect defaultValue={editingModel.status} />}
            </div>
          </details>
          <button className="btn primary" type="submit">
            {editingModel ? "保存修改" : "保存模型"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Tasks({
  customerId,
  selectedCustomer,
  keywords,
  files,
  prompts,
  models,
  tasks,
  canManageModels,
  onTaskStarted,
  run
}: {
  customerId: string;
  selectedCustomer: CustomerRow | null;
  keywords: Keyword[];
  files: KnowledgeFile[];
  prompts: PromptRow[];
  models: ModelRow[];
  tasks: TaskRow[];
  canManageModels: boolean;
  onTaskStarted: (taskId: string) => void;
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [taskFormKey, setTaskFormKey] = useState(0);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [formCustomerId, setFormCustomerId] = useState(customerId);
  const [formCustomer, setFormCustomer] = useState<CustomerRow | null>(selectedCustomer);
  const [formKeywords, setFormKeywords] = useState<Keyword[]>(keywords);
  const [formFiles, setFormFiles] = useState<KnowledgeFile[]>(files);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editKeywords, setEditKeywords] = useState<Keyword[]>([]);
  const [editFiles, setEditFiles] = useState<KnowledgeFile[]>([]);
  const [editChoicesLoading, setEditChoicesLoading] = useState(false);
  const [editTaskSubmitting, setEditTaskSubmitting] = useState(false);
  const [taskCustomerQuery, setTaskCustomerQuery] = useState("");
  const taskSubmitRef = useRef(false);
  const editTaskSubmitRef = useRef(false);

  useEffect(() => {
    if (!taskModalOpen) return;
    setFormCustomerId(customerId);
    setFormCustomer(selectedCustomer);
    setFormKeywords(keywords);
    setFormFiles(files);
  }, [customerId, files, keywords, selectedCustomer, taskModalOpen]);

  async function changeTaskCustomer(nextCustomerId: string, customer?: CustomerRow) {
    setFormCustomerId(nextCustomerId);
    setFormCustomer(customer || null);
    if (!nextCustomerId) {
      setFormKeywords([]);
      setFormFiles([]);
      return;
    }
    const detail = await api<CustomerDetail>(`/api/customers/${nextCustomerId}`);
    setFormCustomer(toCustomerRow(detail));
    setFormKeywords(activeRows(detail.keywords));
    setFormFiles(activeRows(detail.files));
  }

  useEffect(() => {
    if (!editingTask) {
      setEditCustomerName("");
      setEditKeywords([]);
      setEditFiles([]);
      setEditChoicesLoading(false);
      return;
    }

    let cancelled = false;
    setEditCustomerName(editingTask.customer?.name || "");
    setEditKeywords([]);
    setEditFiles([]);
    setEditChoicesLoading(true);

    api<CustomerDetail>(`/api/customers/${editingTask.customerId}`)
      .then((detail) => {
        if (cancelled) return;
        setEditCustomerName(detail.customer.name);
        setEditKeywords(activeRows(detail.keywords));
        setEditFiles(activeRows(detail.files));
      })
      .catch(() => {
        if (cancelled) return;
        if (editingTask.customerId === customerId) {
          setEditCustomerName(selectedCustomer?.name || editingTask.customer?.name || "");
          setEditKeywords(keywords);
          setEditFiles(files);
        }
      })
      .finally(() => {
        if (!cancelled) setEditChoicesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, editingTask, files, keywords, selectedCustomer]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taskSubmitRef.current) return;
    taskSubmitRef.current = true;
    setTaskSubmitting(true);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const data = Object.fromEntries(form);
    const keywordIds = form.getAll("keywordIds").map(String);
    const knowledgeFileIds = form.getAll("knowledgeFileIds").map(String);
    const promptIds = form.getAll("promptIds").map(String);
    try {
      await run(
      async () => {
        await api("/api/generation-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...data,
            customerId: formCustomerId,
            keywordIds,
            knowledgeFileIds,
            promptIds,
            comparisonObjects: data.comparisonObjects,
            modelThinking: data.modelThinking
          })
        });
        formEl.reset();
        setTaskFormKey((key) => key + 1);
        setTaskModalOpen(false);
      },
      "任务已创建并执行"
      );
    } finally {
      taskSubmitRef.current = false;
      setTaskSubmitting(false);
    }
  }

  async function submitTaskEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask || editTaskSubmitRef.current) return;
    editTaskSubmitRef.current = true;
    setEditTaskSubmitting(true);
    const task = editingTask;
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form);
    const keywordIds = form.getAll("keywordIds").map(String);
    const knowledgeFileIds = form.getAll("knowledgeFileIds").map(String);
    const promptIds = form.getAll("promptIds").map(String);
    try {
      await run(
        async () => {
          await api(`/api/generation-tasks/${task.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: data.name,
              articleCount: data.articleCount,
              wordCount: data.wordCount,
              articleType: data.articleType,
              modelConfigId: data.modelConfigId,
              keywordIds,
              knowledgeFileIds,
              promptIds,
              comparisonObjects: data.comparisonObjects,
              modelThinking: data.modelThinking,
              maxRetries: data.maxRetries,
              remark: data.remark
            })
          });
          setEditingTask(null);
        },
        "任务已更新"
      );
    } finally {
      editTaskSubmitRef.current = false;
      setEditTaskSubmitting(false);
    }
  }

  const activeGlobalPrompts = prompts.filter((prompt) => prompt.status === "active" && prompt.scope === "global");
  const activeCustomerPrompts = formCustomerId
    ? prompts.filter((prompt) => prompt.status === "active" && prompt.scope === "customer" && prompt.customerId === formCustomerId)
    : [];
  const activeModels = models.filter((model) => model.status === "active");
  const activeKeywords = formKeywords.filter((keyword) => keyword.status === "active");
  const activeFiles = formFiles.filter((file) => file.status === "active" && isKnowledgeFileParsed(file));
  const activeEditKeywords = editKeywords.filter((keyword) => keyword.status === "active");
  const activeEditFiles = editFiles.filter((file) => file.status === "active" && isKnowledgeFileParsed(file));
  const activeEditGlobalPrompts = prompts.filter((prompt) => prompt.status === "active" && prompt.scope === "global");
  const activeEditCustomerPrompts = editingTask
    ? prompts.filter((prompt) => prompt.status === "active" && prompt.scope === "customer" && prompt.customerId === editingTask.customerId)
    : [];
  const baseVisibleTasks = visibleTaskRows(tasks);
  const visibleTasks = baseVisibleTasks.filter((task) => taskMatchesCustomerQuery(task, taskCustomerQuery));
  const completedCount = visibleTasks.filter((task) => task.status === "completed").length;
  const runningCount = visibleTasks.filter((task) => task.status === "running" || task.status === "pending").length;

  return (
    <div className="tasks-page">
      <section className="task-command">
        <div>
          <span className="eyebrow">GENERATION QUEUE</span>
          <h2>生成任务看板</h2>
          <p className="muted">用卡片查看任务状态、进度和产出。创建任务通过弹窗完成，避免页面拥挤。</p>
        </div>
        <div className="task-command-actions">
          <div className="mini-stat">
            <span>全部任务</span>
            <b>{visibleTasks.length}</b>
          </div>
          <div className="mini-stat">
            <span>进行中</span>
            <b>{runningCount}</b>
          </div>
          <div className="mini-stat">
            <span>已完成</span>
            <b>{completedCount}</b>
          </div>
          <button className="btn primary" onClick={() => setTaskModalOpen(true)} type="button">
            新建生成任务
          </button>
        </div>
      </section>

      <section className="task-filterbar" aria-label="任务筛选">
        <div className="field task-search-field">
          <label htmlFor="task-customer-query">按客户名称检索任务</label>
          <input
            className="input"
            id="task-customer-query"
            placeholder="输入客户名称、简称或行业"
            value={taskCustomerQuery}
            onChange={(event) => setTaskCustomerQuery(event.target.value)}
          />
        </div>
        <span className="task-filter-summary">
          显示 {visibleTasks.length} / {baseVisibleTasks.length} 个任务
        </span>
        {taskCustomerQuery.trim() && (
          <button className="btn ghost" onClick={() => setTaskCustomerQuery("")} type="button">
            清空检索
          </button>
        )}
      </section>

      <TaskCards
        tasks={visibleTasks}
        emptyTitle={taskCustomerQuery.trim() ? "没有匹配任务" : "暂无生成任务"}
        emptyDescription={
          taskCustomerQuery.trim()
            ? "换一个客户名称、简称或行业关键词试试。"
            : "点击右上角的新建生成任务，选择客户资料后开始批量产出内容。"
        }
        onEdit={setEditingTask}
        onDelete={(task) => {
          if (window.confirm(`确定删除任务“${task.name}”吗？删除后任务会从看板移除。`)) {
            run(() => api(`/api/generation-tasks/${task.id}`, { method: "DELETE" }), "任务已删除");
          }
        }}
        onRun={(task) => {
          const hasPreviousResults = task.status === "completed" || task.items.some((item) => item.status === "passed") || task.articles.length > 0;
          const message = hasPreviousResults
            ? `确定重新生成任务“${task.name}”吗？这会删除该任务旧文章并重新生成 ${task.articleCount} 篇。`
            : `确定执行任务“${task.name}”吗？`;
          if (window.confirm(message)) {
            onTaskStarted(task.id);
            run(
              () =>
                api(`/api/generation-tasks/${task.id}/start`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: "rerun" })
                }),
              hasPreviousResults ? "任务已重新生成" : "任务已执行"
            );
          }
        }}
      />

      <Modal
        description="选择客户、关键词、知识库文件、提示词和模型后立即创建并执行生成任务。"
        onClose={() => setTaskModalOpen(false)}
        open={taskModalOpen}
        title="创建生成任务"
      >
        <form className="form one" key={taskFormKey} onSubmit={submit}>
          <CustomerSearchSelect label="客户" value={formCustomerId} selectedCustomer={formCustomer} onChange={changeTaskCustomer} />
          <Field name="name" label="任务名称" required />
          <div className="field">
            <label>关键词</label>
            <SelectablePicker
              name="keywordIds"
              items={activeKeywords}
              getId={(keyword) => keyword.id}
              getLabel={(keyword) => keyword.keyword}
              getMeta={(keyword) => keyword.keywordType}
              emptyText="所选客户暂无关键词。"
              helperText="点击下方关键词即可选择或取消。"
            />
          </div>
          <div className="field">
            <label>知识库文件</label>
            <SelectablePicker
              name="knowledgeFileIds"
              items={activeFiles}
              getId={(file) => file.id}
              getLabel={(file) => file.fileName}
              getMeta={(file) => file.fileType}
              emptyText="所选客户暂无知识库文件。"
              helperText="点击下方文件即可选择或取消，可同时选择多个文件。"
            />
          </div>
          <div className="field">
            <label>提示词</label>
            <PromptSinglePicker
              customerName={formCustomer?.name || ""}
              customerPrompts={activeCustomerPrompts}
              globalPrompts={activeGlobalPrompts}
            />
          </div>
          <TextArea
            name="comparisonObjects"
            label="陪榜对象（可选）"
            placeholder="有参照对象时填写，每行一个；没有就留空。"
          />
          <TextArea
            name="modelThinking"
            label="大模型思考（可选）"
            placeholder="粘贴模型对用户痛点、选型标准、推荐理由和避坑方向的判断。"
          />
          {canManageModels && (
            <div className="field">
              <label htmlFor="modelConfigId">模型</label>
              <select className="select" id="modelConfigId" name="modelConfigId" defaultValue={activeModels.find((model) => model.isDefault)?.id}>
                {activeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <details className="advanced">
            <summary>生成设置</summary>
            <div className="advanced-body">
              <Field name="articleCount" label="生成篇数" type="number" defaultValue="1" />
              <Field name="wordCount" label="每篇字数" type="number" defaultValue="800" />
              <Field name="articleType" label="文章类型" defaultValue="GEO文章" />
            </div>
          </details>
          <button className="btn primary" type="submit" disabled={!formCustomerId || taskSubmitting}>
            创建并生成
          </button>
        </form>
      </Modal>

      <Modal
        description="修改生成设置后，已有结果会清空，任务会回到待执行状态。客户、关键词、知识库文件和提示词保持原选择。"
        onClose={() => setEditingTask(null)}
        open={Boolean(editingTask)}
        title="编辑任务"
      >
        {editingTask && (
          <form className="form one" key={editingTask.id} onSubmit={submitTaskEdit}>
            <Field name="name" label="任务名称" defaultValue={editingTask.name} required />
            {canManageModels && (
              <div className="field">
                <label htmlFor="edit-modelConfigId">模型</label>
                <select className="select" id="edit-modelConfigId" name="modelConfigId" defaultValue={editingTask.modelConfigId}>
                  {activeModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>关键词</label>
              <SelectablePicker
                key={`${editingTask.id}-keywords`}
                name="keywordIds"
                items={activeEditKeywords}
                defaultSelectedIds={editingTask.keywordIds}
                getId={(keyword) => keyword.id}
                getLabel={(keyword) => keyword.keyword}
                getMeta={(keyword) => keyword.keywordType}
                emptyText={editChoicesLoading ? "正在加载关键词..." : "该客户暂无可用关键词。"}
                helperText="修改关键词会重置任务结果，保存后可重新执行任务。"
              />
            </div>
            <div className="field">
              <label>知识库文件</label>
              <SelectablePicker
                key={`${editingTask.id}-files`}
                name="knowledgeFileIds"
                items={activeEditFiles}
                defaultSelectedIds={editingTask.knowledgeFileIds}
                getId={(file) => file.id}
                getLabel={(file) => file.fileName}
                getMeta={(file) => file.fileType}
                emptyText={editChoicesLoading ? "正在加载知识库文件..." : "该客户暂无已解析的知识库文件。"}
                helperText="可选择一个或多个已解析文件；修改后会重置任务结果。"
              />
            </div>
            <div className="field">
              <label>提示词</label>
              <PromptSinglePicker
                key={`${editingTask.id}-prompts`}
                customerName={editCustomerName}
                customerPrompts={activeEditCustomerPrompts}
                defaultSelectedId={editingTask.promptIds[0] || ""}
                globalPrompts={activeEditGlobalPrompts}
              />
            </div>
            <TextArea
              name="comparisonObjects"
              label="陪榜对象（可选）"
              defaultValue={editingTask.comparisonObjects || ""}
              placeholder="有参照对象时填写，每行一个；没有就留空。"
            />
            <TextArea
              name="modelThinking"
              label="大模型思考（可选）"
              defaultValue={editingTask.modelThinking || ""}
              placeholder="粘贴模型对用户痛点、选型标准、推荐理由和避坑方向的判断。"
            />
            <div className="form">
              <Field name="articleCount" label="生成篇数" type="number" defaultValue={String(editingTask.articleCount)} />
              <Field name="wordCount" label="每篇字数" type="number" defaultValue={String(editingTask.wordCount)} />
            </div>
            <Field name="articleType" label="文章类型" defaultValue={editingTask.articleType || "GEO文章"} />
            <div className="form">
              <Field name="maxRetries" label="最大重试次数" type="number" defaultValue={String(editingTask.maxRetries)} />
            </div>
            <TextArea name="remark" label="备注" defaultValue={editingTask.remark} />
            <button className="btn primary" type="submit" disabled={editTaskSubmitting || (canManageModels && !activeModels.length)}>
              保存任务
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}

function Articles({
  articles,
  run
}: {
  articles: ArticleRow[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
}) {
  const [openId, setOpenId] = useState("");
  const [editingArticle, setEditingArticle] = useState<ArticleRow | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [copyState, setCopyState] = useState<CopyState>(null);
  const filteredArticles = articles.filter((article) => {
    const matchesStatus = status === "all" || article.status === status;
    const text = [article.title, article.summary, article.content, article.customer?.name, article.keyword?.keyword]
      .join(" ")
      .toLowerCase();
    return matchesStatus && text.includes(query.trim().toLowerCase());
  });
  const selected = articles.find((article) => article.id === openId) || filteredArticles[0] || null;
  const passedCount = articles.filter((article) => article.status === "passed").length;
  const draftCount = articles.filter((article) => article.status === "draft").length;
  const failedCount = articles.filter((article) => article.status === "failed").length;

  async function copyWithToast(action: () => Promise<void>, message: string) {
    try {
      await action();
      setCopyState({ kind: "success", message });
      window.setTimeout(() => setCopyState(null), 1800);
    } catch (error) {
      console.warn("Copy failed", error);
      setCopyState({ kind: "error", message: "复制失败。请手动选中正文后复制。" });
      window.setTimeout(() => setCopyState(null), 2600);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingArticle) return;
    const form = event.currentTarget;
    const data = formObject(form);
    await run(
      async () => {
        await api(`/api/articles/${editingArticle.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        setEditingArticle(null);
      },
      "文章已更新"
    );
  }

  return (
    <div className="articles-page">
      <section className="articles-command">
        <div>
          <span className="eyebrow">Publishing Desk</span>
          <h2>内容发布工作台</h2>
          <p>筛选稿件、审阅正文、编辑并复制到发布平台。</p>
        </div>
        <div className="article-stats">
          <span>
            <b>{articles.length}</b>
            全部
          </span>
          <span>
            <b>{passedCount}</b>
            通过
          </span>
          <span>
            <b>{draftCount}</b>
            草稿
          </span>
          <span>
            <b>{failedCount}</b>
            失败
          </span>
        </div>
      </section>

      <section className="articles-workspace">
        <aside className="article-inbox">
          <div className="article-inbox-head">
            <div>
              <h2>稿件</h2>
              <p>显示 {filteredArticles.length} / {articles.length}</p>
            </div>
          </div>
          <div className="article-filters">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、正文、客户、关键词"
            />
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="passed">通过</option>
              <option value="failed">失败</option>
            </select>
          </div>
          <div className="article-inbox-list">
            {filteredArticles.map((article) => (
              <div
                className={`article-row ${selected?.id === article.id ? "selected" : ""}`}
                key={article.id}
                onClick={() => {
                  setOpenId(article.id);
                  setEditingArticle(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    setOpenId(article.id);
                    setEditingArticle(null);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="article-row-top">
                  <b>{article.title}</b>
                  <StatusBadge value={article.status} />
                </div>
                <p>{article.summary || article.content.slice(0, 110)}</p>
                <span>{article.customer?.name || "-"} / {article.keyword?.keyword || "-"}</span>
              </div>
            ))}
            {!articles.length && <p className="muted empty-state">还没有生成文章。</p>}
            {Boolean(articles.length) && !filteredArticles.length && <p className="muted empty-state">没有匹配文章。</p>}
          </div>
        </aside>

        <section className="article-stage">
        {editingArticle ? (
          <>
            <div className="article-stage-head">
              <div>
                <h2>编辑文章</h2>
                <p>修改标题、摘要和正文后保存。</p>
              </div>
              <button className="btn" onClick={() => setEditingArticle(null)} type="button">
                取消编辑
              </button>
            </div>
            <form className="form one article-edit-form" key={editingArticle.id} onSubmit={submit}>
              <Field name="title" label="标题" defaultValue={editingArticle.title} required />
              <TextArea name="summary" label="摘要" defaultValue={editingArticle.summary} />
              <TextArea name="content" label="正文" defaultValue={editingArticle.content} required />
              <div className="field">
                <label htmlFor="article-status">状态</label>
                <select className="select" id="article-status" name="status" defaultValue={editingArticle.status}>
                  <option value="draft">草稿</option>
                  <option value="passed">通过</option>
                  <option value="failed">失败</option>
                </select>
              </div>
              <button className="btn primary" type="submit">
                保存文章
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="article-stage-head">
              <div>
                <h2>{selected ? selected.title : "文章详情"}</h2>
                <p>{selected ? `${selected.customer?.name || "-"} / ${selected.keyword?.keyword || "-"}` : "从左侧列表选择一篇文章。"}</p>
              </div>
              {selected && (
                <div className="actions">
                  <button className="btn" onClick={() => setEditingArticle(selected)} type="button">
                    编辑
                  </button>
                  <button className="btn" onClick={() => copyWithToast(() => copyText(selected.content), "正文已复制")} type="button">
                    复制正文
                  </button>
                  <button className="btn primary" onClick={() => copyWithToast(() => copyArticleForPublish(selected), "发布稿已复制")} type="button">
                    复制发布稿
                  </button>
                </div>
              )}
            </div>
            {copyState && <div className={`inline-toast ${copyState.kind}`}>{copyState.message}</div>}
            {selected ? (
              <div className="article-detail">
                <div className="article-lede">
                  <StatusBadge value={selected.status} />
                  <p>{selected.summary}</p>
                </div>
                <article className="article-body article-body-composed">
                  <ArticleContent text={selected.content} />
                </article>
                <details className="advanced">
                  <summary>生成提示词</summary>
                  <div className="advanced-body">
                    {selected.promptSnapshot ? (
                      <>
                        <div className="prompt-meta">
                          <span>客户：{selected.promptSnapshot.customerName}</span>
                          <span>关键词：{selected.promptSnapshot.keyword}</span>
                          <span>模型：{selected.promptSnapshot.modelName}</span>
                        </div>
                        <div className="pre">{selected.promptSnapshot.promptText}</div>
                      </>
                    ) : (
                      <p className="muted">这篇文章生成时尚未记录提示词快照。</p>
                    )}
                  </div>
                </details>
                <details className="advanced">
                  <summary>引用和校验</summary>
                  <div className="advanced-body">
                    <div className="pre">{JSON.stringify(selected.citations, null, 2)}</div>
                    <div className="pre">{JSON.stringify(selected.checkResult, null, 2)}</div>
                  </div>
                </details>
              </div>
            ) : (
              <p className="muted empty-state">还没有可查看的文章。</p>
            )}
          </>
        )}
        </section>
      </section>
    </div>
  );
}

function workbenchArticleIssues(article: ArticleRow) {
  const issues = article.checkResult?.issues?.filter(Boolean) || [];
  if (issues.length) return issues.slice(0, 3);
  if (article.status === "failed") return ["校验未通过，需要人工复核"];
  if (!article.citations?.length) return ["缺少引用记录"];
  if (article.content.length < 300) return ["正文偏短，建议补充素材"];
  return [];
}

function workbenchArticleQuality(article: ArticleRow) {
  const score = article.checkResult?.score ?? (article.status === "passed" ? 92 : article.status === "failed" ? 48 : 72);
  if (score >= 85) return { score, tone: "good", text: "质量良好" };
  if (score >= 60) return { score, tone: "warn", text: "建议复核" };
  return { score, tone: "bad", text: "需要修改" };
}

function workbenchStatusLabel(status: ArticleRow["status"]) {
  if (status === "passed") return "已通过";
  if (status === "failed") return "需修改";
  return "待审";
}

function workbenchDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function workbenchFullContent(article: ArticleRow) {
  return [article.summary, article.content].filter(Boolean).join("\n\n");
}

function ArticleWorkbench({
  articles,
  run,
  onNavigate
}: {
  articles: ArticleRow[];
  run: (action: () => Promise<void>, message: string, options?: { refresh?: boolean }) => Promise<void>;
  onNavigate: (tab: Tab) => void;
}) {
  const [openId, setOpenId] = useState("");
  const [editingArticle, setEditingArticle] = useState<ArticleRow | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ArticleRow["status"]>("all");
  const [copyState, setCopyState] = useState<CopyState>(null);
  const [copiedArticleIds, setCopiedArticleIds] = useState<Set<string>>(() => new Set());

  const statusTabs = [
    { id: "all" as const, label: "全部", count: articles.length },
    { id: "draft" as const, label: "待审", count: articles.filter((article) => article.status === "draft").length },
    { id: "failed" as const, label: "需修改", count: articles.filter((article) => article.status === "failed").length },
    { id: "passed" as const, label: "已通过", count: articles.filter((article) => article.status === "passed").length }
  ];

  const filteredArticles = articles.filter((article) => {
    const matchesStatus = status === "all" || article.status === status;
    const text = [article.title, article.summary, article.content, article.customer?.name, article.keyword?.keyword]
      .join(" ")
      .toLowerCase();
    return matchesStatus && text.includes(query.trim().toLowerCase());
  });
  const selected = filteredArticles.find((article) => article.id === openId) || filteredArticles[0] || null;
  const selectedQuality = selected ? workbenchArticleQuality(selected) : null;
  const selectedIssues = selected ? workbenchArticleIssues(selected) : [];
  const copiedCount = articles.filter((article) => copiedArticleIds.has(article.id)).length;

  async function copyWithToast(action: () => Promise<void>, message: string) {
    try {
      await action();
      setCopyState({ kind: "success", message });
      window.setTimeout(() => setCopyState(null), 1800);
    } catch (error) {
      console.warn("Copy failed", error);
      setCopyState({ kind: "error", message: "复制失败，请手动选中正文后复制。" });
      window.setTimeout(() => setCopyState(null), 2600);
    }
  }

  async function markArticle(nextStatus: ArticleRow["status"], message: string) {
    if (!selected) return;
    await run(
      async () => {
        await api(`/api/articles/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus })
        });
      },
      message
    );
  }

  async function deleteSelectedArticle() {
    if (!selected) return;
    const deletingId = selected.id;
    if (!window.confirm(`确定删除稿件“${selected.title}”吗？删除后会从稿件队列移除。`)) return;
    await run(
      async () => {
        await api(`/api/articles/${deletingId}`, { method: "DELETE" });
        const nextArticle = filteredArticles.find((article) => article.id !== deletingId);
        setOpenId(nextArticle?.id || "");
        setEditingArticle(null);
        setCopiedArticleIds((current) => {
          const next = new Set(current);
          next.delete(deletingId);
          return next;
        });
      },
      "稿件已删除"
    );
  }

  async function copyPublishPackage(article: ArticleRow) {
    await copyArticleForPublish(article);
    setCopiedArticleIds((current) => new Set(current).add(article.id));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingArticle) return;
    const data = formObject(event.currentTarget);
    const content = String(data.content || "");
    await run(
      async () => {
        await api(`/api/articles/${editingArticle.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            summary: "",
            content,
            status: data.status
          })
        });
        setEditingArticle(null);
      },
      "稿件已保存"
    );
  }

  return (
    <div className="articles-page article-workbench">
      <section className="articles-command workbench-command">
        <div>
          <h2>审稿发布台</h2>
          <p>按队列处理稿件，完成复核、修改、通过和复制发布。</p>
        </div>
        <div className="article-stats workbench-tabs" aria-label="稿件处理概览">
          {statusTabs.map((tab) => (
            <button
              className={status === tab.id ? "active" : ""}
              key={tab.id}
              onClick={() => setStatus(tab.id)}
              type="button"
            >
              <b>{tab.count}</b>
              {tab.label}
            </button>
          ))}
          <span>
            <b>{copiedCount}</b>
            已复制
          </span>
        </div>
      </section>

      <section className="articles-workspace workbench-layout">
        <aside className="article-inbox workbench-inbox">
          <div className="article-inbox-head">
            <div>
              <h2>稿件队列</h2>
              <p>显示 {filteredArticles.length} / {articles.length}</p>
            </div>
          </div>
          <div className="article-filters">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、正文、客户、关键词"
            />
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="all">全部状态</option>
              <option value="draft">待审</option>
              <option value="failed">需修改</option>
              <option value="passed">已通过</option>
            </select>
          </div>
          <div className="article-inbox-list">
            {filteredArticles.map((article) => {
              const quality = workbenchArticleQuality(article);
              return (
                <div
                  className={`article-row workbench-row ${selected?.id === article.id ? "selected" : ""} ${article.status}`}
                  key={article.id}
                  onClick={() => {
                    setOpenId(article.id);
                    setEditingArticle(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      setOpenId(article.id);
                      setEditingArticle(null);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="article-row-top">
                    <b>{article.title}</b>
                    <span className={`mini-status ${article.status}`}>{workbenchStatusLabel(article.status)}</span>
                  </div>
                  <p>{article.summary || article.content.slice(0, 110)}</p>
                  <div className="article-row-meta">
                    <span>{article.customer?.name || "-"}</span>
                    <span>{article.keyword?.keyword || "-"}</span>
                    <span>{workbenchDate(article.updatedAt)}</span>
                  </div>
                  <div className={`quality-chip ${quality.tone}`}>
                    <b>{quality.score}</b>
                    {quality.text}
                  </div>
                </div>
              );
            })}
            {!articles.length && (
              <div className="empty-state article-empty">
                <h3>还没有可审阅的稿件</h3>
                <p>生成任务完成后，文章会出现在这里进入审稿队列。</p>
                <button className="btn primary" onClick={() => onNavigate("tasks")} type="button">
                  去生成任务
                </button>
              </div>
            )}
            {Boolean(articles.length) && !filteredArticles.length && (
              <div className="empty-state article-empty">
                <h3>没有匹配稿件</h3>
                <p>换一个关键词或状态筛选，再继续处理。</p>
              </div>
            )}
          </div>
        </aside>

        <section className="article-stage workbench-stage">
          {editingArticle ? (
            <form className="article-editor-shell" key={editingArticle.id} onSubmit={submit}>
              <div className="article-stage-head article-editor-head">
                <div className="article-title-edit">
                  <label htmlFor="article-title-input">标题</label>
                  <input
                    className="input title-input"
                    defaultValue={editingArticle.title}
                    id="article-title-input"
                    name="title"
                    required
                  />
                  <p>修改标题和内容，保存后继续审稿。</p>
                </div>
                <button className="btn" onClick={() => setEditingArticle(null)} type="button">
                  取消编辑
                </button>
              </div>
              <div className="form one article-edit-form">
                <TextArea name="content" label="内容" defaultValue={workbenchFullContent(editingArticle)} required />
                <div className="field">
                  <label htmlFor="article-status">处理状态</label>
                  <select className="select" id="article-status" name="status" defaultValue={editingArticle.status}>
                    <option value="draft">待审</option>
                    <option value="failed">需修改</option>
                    <option value="passed">已通过</option>
                  </select>
                </div>
                <div className="actions">
                  <button className="btn primary" type="submit">
                    保存稿件
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <>
              <div className="article-stage-head">
                <div>
                  <h2>{selected ? selected.title : "文章详情"}</h2>
                  <p>
                    {selected
                      ? `${selected.customer?.name || "-"} / ${selected.keyword?.keyword || "-"} / ${workbenchDate(selected.updatedAt)}`
                      : "从左侧队列选择一篇文章。"}
                  </p>
                </div>
                {selected && (
                  <div className="actions">
                    <button className="btn" onClick={() => setEditingArticle(selected)} type="button">
                      编辑
                    </button>
                    {selected.status !== "failed" && (
                      <button className="btn" onClick={() => markArticle("failed", "已标记为需修改")} type="button">
                        需修改
                      </button>
                    )}
                    {selected.status !== "passed" && (
                      <button className="btn" onClick={() => markArticle("passed", "稿件已通过")} type="button">
                        通过
                      </button>
                    )}
                    <button className="btn" onClick={() => copyWithToast(() => copyText(workbenchFullContent(selected)), "正文已复制")} type="button">
                      复制正文
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => copyWithToast(() => copyPublishPackage(selected), "发布稿已复制")}
                      type="button"
                    >
                      复制发布稿
                    </button>
                    <button className="btn danger" onClick={deleteSelectedArticle} type="button">
                      删除稿件
                    </button>
                  </div>
                )}
              </div>
              {copyState && <div className={`inline-toast ${copyState.kind}`}>{copyState.message}</div>}
              {selected ? (
                <div className="article-detail workbench-detail">
                  <div className="review-strip">
                    <div className="review-status">
                      <span className={`mini-status ${selected.status}`}>{workbenchStatusLabel(selected.status)}</span>
                      {copiedArticleIds.has(selected.id) && <span className="badge green">已复制发布稿</span>}
                    </div>
                    {selectedQuality && (
                      <div className={`review-score ${selectedQuality.tone}`}>
                        <b>{selectedQuality.score}</b>
                        <span>{selectedQuality.text}</span>
                      </div>
                    )}
                    <div className="review-meta">
                      <span>{selected.content.length} 字符</span>
                      <span>{selected.citations?.length || 0} 条引用</span>
                      <span>{selected.totalTokens || 0} tokens</span>
                    </div>
                  </div>
                  <div className="article-review-grid">
                    <div className="article-reader">
                      <article className="article-body article-body-composed">
                        <h1>{selected.title}</h1>
                        <ArticleContent text={workbenchFullContent(selected)} />
                      </article>
                    </div>
                    <aside className="review-panel">
                      <section>
                        <h3>审稿建议</h3>
                        {selectedIssues.length ? (
                          <ul className="issue-list">
                            {selectedIssues.map((issue) => (
                              <li key={issue}>{issue}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">暂未发现明显问题，可以进入发布前人工复核。</p>
                        )}
                      </section>
                      <section>
                        <h3>发布检查</h3>
                        <div className="publish-checks">
                          <span className={selected.title ? "done" : "todo"}>标题</span>
                          <span className={selected.content ? "done" : "todo"}>内容</span>
                          <span className={selected.citations?.length ? "done" : "todo"}>引用</span>
                          <span className={selected.status === "passed" ? "done" : "todo"}>通过</span>
                        </div>
                      </section>
                      <details className="advanced">
                        <summary>生成提示词</summary>
                        <div className="advanced-body">
                          {selected.promptSnapshot ? (
                            <>
                              <div className="prompt-meta">
                                <span>客户：{selected.promptSnapshot.customerName}</span>
                                <span>关键词：{selected.promptSnapshot.keyword}</span>
                                <span>模型：{selected.promptSnapshot.modelName}</span>
                              </div>
                              <div className="pre">{selected.promptSnapshot.promptText}</div>
                            </>
                          ) : (
                            <p className="muted">这篇文章生成时尚未记录提示词快照。</p>
                          )}
                        </div>
                      </details>
                      <details className="advanced">
                        <summary>引用和校验</summary>
                        <div className="advanced-body">
                          <div className="pre">{JSON.stringify(selected.citations, null, 2)}</div>
                          <div className="pre">{JSON.stringify(selected.checkResult, null, 2)}</div>
                        </div>
                      </details>
                    </aside>
                  </div>
                </div>
              ) : (
                <div className="empty-state article-empty stage-empty">
                  <h3>还没有可查看的文章</h3>
                  <p>先创建并启动生成任务，完成后回到这里审稿发布。</p>
                  <div className="empty-flow" aria-label="审稿发布流程">
                    <span>生成稿件</span>
                    <span>人工复核</span>
                    <span>标记通过</span>
                    <span>复制发布</span>
                  </div>
                  <button className="btn primary" onClick={() => onNavigate("tasks")} type="button">
                    去生成任务
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </section>
    </div>
  );
}

function Modal({
  children,
  description,
  onClose,
  open,
  title
}: {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section aria-modal="true" className="modal-card" role="dialog">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <button className="btn small" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function SelectablePicker<T>({
  name,
  items,
  defaultSelectedIds = [],
  getId,
  getLabel,
  getMeta,
  getGroup,
  emptyText,
  helperText,
  limit = 80
}: {
  name: string;
  items: T[];
  defaultSelectedIds?: string[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  getMeta?: (item: T) => string;
  getGroup?: (item: T) => string;
  emptyText: string;
  helperText?: string;
  limit?: number;
}) {
  const [selected, setSelected] = useState<string[]>(() => defaultSelectedIds);
  const itemIds = useMemo(() => new Set(items.map(getId)), [getId, items]);
  const visibleItems = items.slice(0, limit);
  const defaultSelectedKey = defaultSelectedIds.join("\u0000");

  useEffect(() => {
    setSelected((current) => {
      const defaultNext = defaultSelectedIds.filter((id) => itemIds.has(id));
      const next = current.filter((id) => itemIds.has(id));
      if (!next.length && defaultNext.length) return defaultNext;
      return next.length === current.length ? current : next;
    });
  }, [defaultSelectedKey, itemIds]);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectVisible() {
    const ids = visibleItems.map(getId);
    setSelected((current) => Array.from(new Set([...current, ...ids])));
  }

  function clearSelected() {
    setSelected([]);
  }

  return (
    <div className="picker">
      {selected.map((id) => (
        <input key={id} name={name} type="hidden" value={id} />
      ))}
      <div className="picker-toolbar">
        <button className="btn small" onClick={selectVisible} disabled={!visibleItems.length} type="button">
          全选
        </button>
        <button className="btn small" onClick={clearSelected} disabled={!selected.length} type="button">
          清空
        </button>
      </div>
      <div className="picker-summary">
        <span>已选 {selected.length} 项</span>
        {helperText && <small>{helperText}</small>}
      </div>
      <div className="picker-list">
        {visibleItems.map((item, index) => {
          const id = getId(item);
          const checked = selected.includes(id);
          const group = getGroup?.(item) || "";
          const previousGroup = index > 0 ? getGroup?.(visibleItems[index - 1]) || "" : "";
          return (
            <div key={id}>
              {group && group !== previousGroup && <div className="picker-group">{group}</div>}
              <button className={`picker-row ${checked ? "selected" : ""}`} onClick={() => toggle(id)} type="button">
                <span className="picker-check" aria-hidden="true">
                  {checked ? "✓" : ""}
                </span>
                <span>
                  <span>{getLabel(item)}</span>
                  {getMeta && <small>{getMeta(item)}</small>}
                </span>
              </button>
            </div>
          );
        })}
        {!items.length && <p className="muted">{emptyText}</p>}
      </div>
    </div>
  );
}

function PromptSinglePicker({
  globalPrompts,
  customerPrompts,
  customerName,
  defaultSelectedId = ""
}: {
  globalPrompts: PromptRow[];
  customerPrompts: PromptRow[];
  customerName: string;
  defaultSelectedId?: string;
}) {
  const [selectedId, setSelectedId] = useState(defaultSelectedId);
  const prompts = useMemo(
    () => [
      ...globalPrompts.map((prompt) => ({ ...prompt, groupLabel: "全局提示词", metaLabel: "所有客户都可选" })),
      ...customerPrompts.map((prompt) => ({
        ...prompt,
        groupLabel: "客户专属提示词",
        metaLabel: customerName ? `仅 ${customerName} 可选` : "仅所选客户可选"
      }))
    ],
    [customerName, customerPrompts, globalPrompts]
  );
  const promptIds = useMemo(() => new Set(prompts.map((prompt) => prompt.id)), [prompts]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && promptIds.has(current)) return current;
      return defaultSelectedId && promptIds.has(defaultSelectedId) ? defaultSelectedId : "";
    });
  }, [defaultSelectedId, promptIds]);

  function selectPrompt(id: string) {
    setSelectedId((current) => (current === id ? "" : id));
  }

  return (
    <div className="prompt-single-picker">
      {selectedId && <input name="promptIds" type="hidden" value={selectedId} />}
      <div className="prompt-single-head">
        <div>
          <b>选择一个提示词</b>
          <span>全局和客户专属互斥，只能选其中一个；不选则使用系统默认生成规则。</span>
        </div>
        <button className="btn small" disabled={!selectedId} onClick={() => setSelectedId("")} type="button">
          清空
        </button>
      </div>
      <div className="prompt-single-list">
        {prompts.map((prompt, index) => {
          const previousGroup = index > 0 ? prompts[index - 1].groupLabel : "";
          const selected = selectedId === prompt.id;
          return (
            <div key={prompt.id}>
              {prompt.groupLabel !== previousGroup && <div className="picker-group">{prompt.groupLabel}</div>}
              <button className={`prompt-choice ${selected ? "selected" : ""}`} onClick={() => selectPrompt(prompt.id)} type="button">
                <span className="prompt-choice-radio" aria-hidden="true" />
                <span>
                  <b>{prompt.name}</b>
                  <small>{prompt.metaLabel}</small>
                </span>
              </button>
            </div>
          );
        })}
        {customerName && !customerPrompts.length && (
          <div className="prompt-empty-group">
            <div className="picker-group">客户专属提示词</div>
            <p className="muted empty-state">当前客户暂无启用的专属提示词。可到“提示词”页面为该客户新增。</p>
          </div>
        )}
        {!customerName && (
          <div className="prompt-empty-group">
            <div className="picker-group">客户专属提示词</div>
            <p className="muted empty-state">先选择客户后，才会显示该客户自己的专属提示词。</p>
          </div>
        )}
        {!prompts.length && <p className="muted empty-state">暂无可用提示词。可以先在“提示词”页面创建全局或客户专属提示词。</p>}
      </div>
    </div>
  );
}

function CustomerSearchSelect({
  label,
  value,
  selectedCustomer,
  onChange
}: {
  label: string;
  value: string;
  selectedCustomer?: CustomerRow | null;
  onChange: (id: string, customer?: CustomerRow) => Promise<void>;
}) {
  const [query, setQuery] = useState(customerLabel(selectedCustomer));
  const [options, setOptions] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const selectedLabel = customerLabel(selectedCustomer);

  useEffect(() => {
    if (!open) setQuery(customerLabel(selectedCustomer));
  }, [open, selectedCustomer]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const searchQuery = open && query.trim() === selectedLabel.trim() ? "" : query.trim();
        const params = new URLSearchParams({ page: "1", pageSize: "12", query: searchQuery, status: "active" });
        const result = await api<PagedResult<CustomerRow>>(`/api/customers?${params.toString()}`);
        if (!cancelled) {
          setOptions(result.items);
          setTotal(result.total);
        }
      } catch {
        if (!cancelled) {
          setOptions([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, selectedLabel]);

  return (
    <div className="field search-select">
      <label htmlFor={`${label}-customer-search`}>{label}</label>
      <input
        className="input"
        id={`${label}-customer-search`}
        value={query}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索客户"
      />
      {open && (
        <div className="search-results">
          <div className="search-results-head">
            <span>{query.trim() ? "搜索结果" : "最近客户"}</span>
            <b>{loading ? "加载中" : `${options.length} / ${total}`}</b>
          </div>
          {loading && <div className="search-empty">搜索中...</div>}
          {!loading &&
            options.map((customer) => (
              <button
                className={customer.id === value ? "selected" : ""}
                key={customer.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(customerLabel(customer));
                  setOpen(false);
                  onChange(customer.id, customer).catch((error) => console.error(error));
                }}
                type="button"
              >
                <b>{customer.name}</b>
                <span>{[customer.shortName, customer.industry, customer.website].filter(Boolean).join(" / ")}</span>
              </button>
            ))}
          {!loading && !options.length && <div className="search-empty">没有匹配客户</div>}
          {!loading && total > options.length && (
            <div className="search-empty">显示前 {options.length} / {total} 个客户，输入名称、简称或行业继续筛选</div>
          )}
        </div>
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  busy,
  onPageChange
}: {
  page: number;
  totalPages: number;
  busy: boolean;
  onPageChange: (page: number) => Promise<void>;
}) {
  return (
    <div className="pager">
      <button className="btn small" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)} type="button">
        上一页
      </button>
      <span>
        {page} / {totalPages}
      </span>
      <button className="btn small" disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">
        下一页
      </button>
    </div>
  );
}

function taskRunButtonLabel(task: TaskRow) {
  if (task.status === "running") return "执行中";
  if (task.status === "completed" || task.items.some((item) => item.status === "passed") || task.articles.length > 0) return "重新生成";
  return "执行任务";
}

function TaskCards({
  emptyDescription = "点击右上角的新建生成任务，选择客户资料后开始批量产出内容。",
  emptyTitle = "暂无生成任务",
  tasks,
  onDelete,
  onEdit,
  onRun
}: {
  emptyDescription?: string;
  emptyTitle?: string;
  tasks: TaskRow[];
  onDelete: (task: TaskRow) => void;
  onEdit: (task: TaskRow) => void;
  onRun: (task: TaskRow) => void;
}) {
  if (!tasks.length) {
    return (
      <div className="empty-directory task-empty">
        <div>
          <h3>{emptyTitle}</h3>
          <p className="muted">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <section className="task-card-grid">
      {tasks.map((task) => {
        const orderedItems = [...task.items].sort((a, b) => a.sortOrder - b.sortOrder);
        const passed = orderedItems.filter((item) => item.status === "passed").length;
        const failed = orderedItems.filter((item) => item.status === "failed").length;
        const finished = passed + failed;
        const total = orderedItems.length || task.articleCount;
        const progress = Math.round((finished / Math.max(total, 1)) * 100);
        const running = task.status === "running";
        const runLabel = taskRunButtonLabel(task);
        const errorSummary = taskErrorSummary(task);
        return (
          <article className="task-card" key={task.id}>
            <div className="task-card-head">
              <div>
                <h3>{task.name}</h3>
                <p className="task-card-customer">{task.customer?.name || "未关联客户"}</p>
              </div>
              <StatusBadge value={task.status} />
            </div>

            <div className="task-progress">
              <div>
                <span>生成进度</span>
                <b>{finished} / {total}</b>
              </div>
              <div className="task-progress-track" aria-hidden="true">
                <i style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="task-card-stats">
              <span>
                <b>{task.articles.length}</b>
                文章
              </span>
              <span>
                <b>{task.articleCount}</b>
                计划篇数
              </span>
              <span>
                <b>{task.wordCount}</b>
                字/篇
              </span>
            </div>

            <div className="task-card-meta">
              <span>{task.articleType || "GEO文章"}</span>
              <span>{new Date(task.createdAt).toLocaleString("zh-CN")}</span>
            </div>

            {errorSummary && <div className="task-error-summary">{errorSummary}</div>}

            <div className="task-card-actions">
              <button className="btn small" disabled={running} onClick={() => onRun(task)} type="button">
                {runLabel}
              </button>
              <button className="btn small" disabled={running} onClick={() => onEdit(task)} type="button">
                编辑任务
              </button>
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    const detail = await api<TaskDetail>(`/api/generation-tasks/${task.id}`);
                    window.alert(taskDetailLogText(detail));
                  } catch {
                    window.alert(taskLogText(task));
                  }
                }}
                type="button"
              >
                查看日志
              </button>
              <button className="btn small danger" disabled={running} onClick={() => onDelete(task)} type="button">
                删除任务
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function taskErrorSummary(task: TaskRow) {
  if (task.status !== "failed") return "";
  const itemError = task.items.find((item) => item.errorMessage.trim())?.errorMessage.trim();
  const articleIssues = task.articles.flatMap((article) => article.checkResult?.issues || []).filter(Boolean);
  return itemError || articleIssues[0] || "任务未通过，点击“查看日志”查看子任务状态。";
}

function taskLogText(task: TaskRow) {
  const lines = [
    `任务：${task.name}`,
    `状态：${task.status}`,
    `模型：${task.modelConfigId}`,
    `创建时间：${new Date(task.createdAt).toLocaleString("zh-CN")}`,
    `更新时间：${new Date(task.updatedAt).toLocaleString("zh-CN")}`,
    "",
    "子任务："
  ];

  task.items
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((item) => {
      lines.push(
        `#${item.sortOrder} ${item.status}${item.retryCount ? `，重试 ${item.retryCount} 次` : ""}${item.errorMessage ? `\n  错误：${item.errorMessage}` : ""}`
      );
    });

  if (task.articles.length) {
    lines.push("", "文章：");
    task.articles.forEach((article, index) => {
      const issues = article.checkResult?.issues?.length ? article.checkResult.issues.join("；") : "无";
      const raw = article.rawResponse && typeof article.rawResponse === "object" ? JSON.stringify(article.rawResponse).slice(0, 240) : "";
      lines.push(`#${index + 1} ${article.status} ${article.title || "(无标题)"}`);
      lines.push(`  校验问题：${issues}`);
      if (raw) lines.push(`  原始响应：${raw}`);
    });
  }

  return lines.join("\n");
}

function taskDetailLogText(detail: TaskDetail) {
  const lines = [taskLogText({ ...detail.task, items: detail.items, articles: detail.articles }), "", "操作日志："];
  if (!detail.logs.length) {
    lines.push("暂无操作日志");
  } else {
    detail.logs.forEach((log) => {
      lines.push(`${new Date(log.createdAt).toLocaleString("zh-CN")} ${log.action}: ${log.detail || "-"}`);
    });
  }
  return lines.join("\n");
}

function TaskTable({ tasks, onCancel }: { tasks: TaskRow[]; onCancel?: (task: TaskRow) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>客户</th>
            <th>状态</th>
            <th>进度</th>
            <th>文章</th>
            {onCancel && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const passed = task.items.filter((item) => item.status === "passed").length;
            return (
              <tr key={task.id}>
                <td>{task.name}</td>
                <td>{task.customer?.name || "-"}</td>
                <td>
                  <StatusBadge value={task.status} />
                </td>
                <td>
                  {passed} / {task.items.length}
                </td>
                <td>{task.articles.length}</td>
                {onCancel && (
                  <td>
                    <button className="btn small danger" onClick={() => onCancel(task)} type="button">
                      取消
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {!tasks.length && (
            <tr>
              <td className="muted" colSpan={onCancel ? 6 : 5}>
                暂无任务。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  defaultValue,
  placeholder,
  step
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  step?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        className="input"
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={step}
      />
    </div>
  );
}

function TextArea({
  label,
  name,
  required,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="field full">
      <label htmlFor={name}>{label}</label>
      <textarea className="textarea" id={name} name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} />
    </div>
  );
}

function StatusSelect({ defaultValue = "active" }: { defaultValue?: string }) {
  return (
    <div className="field">
      <label htmlFor="status">状态</label>
      <select className="select" id="status" name="status" defaultValue={defaultValue}>
        <option value="active">启用</option>
        <option value="disabled">停用</option>
      </select>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const kind = ["active", "passed", "completed", "parsed", "must_use", "prefer_use"].includes(value)
    ? "green"
    : ["failed", "disabled", "parse_failed", "forbidden", "cancelled"].includes(value)
      ? "red"
      : "amber";
  const labels: Record<string, string> = {
    active: "启用",
    disabled: "停用",
    pending: "待执行",
    running: "执行中",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
    uploaded: "未解析",
    parsing: "解析中",
    parsed: "已解析",
    parse_failed: "解析失败",
    generating: "生成中",
    checking: "校验中",
    passed: "通过",
    draft: "草稿",
    must_use: "必须引用",
    prefer_use: "优先引用",
    optional: "可选",
    forbidden: "禁止"
  };
  return <span className={`badge ${kind}`}>{labels[value] || value}</span>;
}
