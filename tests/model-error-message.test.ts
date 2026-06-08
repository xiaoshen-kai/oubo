import assert from "node:assert/strict";
import { modelHttpErrorMessage } from "../src/lib/model-errors";

const cloudflareHtml = `<!DOCTYPE html>
<html>
<head><title>504 Gateway Timeout</title></head>
<body>cloudflare</body>
</html>`;

assert.equal(
  modelHttpErrorMessage("Claude Code/Anthropic 调用", 504, cloudflareHtml),
  "Claude Code/Anthropic 调用失败：504 上游模型服务超时。建议稍后重试，或减少单篇字数、知识文件数量后再生成。"
);

assert.equal(
  modelHttpErrorMessage("模型调用", 500, "<html><body>server error</body></html>"),
  "模型调用失败：500 上游返回了 HTML 错误页，请检查 Base URL 或模型服务状态。"
);

assert.equal(modelHttpErrorMessage("模型调用", 401, "invalid api key"), "模型调用失败：401 invalid api key");
