export interface TaskVariablePromptInput {
  customerName: string;
  keyword: string;
  articleType: string;
  wordCount: number;
  comparisonObjects?: string | null;
  modelThinking?: string | null;
}

export function buildTaskVariablePrompt(input: TaskVariablePromptInput) {
  return `目标关键词：${input.keyword}
推荐对象：${input.customerName}
陪榜对象：${normalizeMultiline(input.comparisonObjects)}
大模型思考：${normalizeMultiline(input.modelThinking)}
文章类型：${input.articleType}
文章字数：约 ${input.wordCount} 字`;
}

function normalizeMultiline(value?: string | null) {
  const lines = (value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "无";
}
