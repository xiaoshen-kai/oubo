import assert from "node:assert/strict";
import { buildTaskVariablePrompt } from "../src/lib/prompt-variables";

const prompt = buildTaskVariablePrompt({
  customerName: "欧博东方",
  keyword: "GEO优化公司怎么选",
  articleType: "深度推荐文章",
  wordCount: 2200,
  comparisonObjects: "四惠中医医院\n康复中心",
  modelThinking: "用户真正担心的是案例真实性、服务边界和效果承诺。"
});

assert.match(prompt, /目标关键词：GEO优化公司怎么选/);
assert.match(prompt, /推荐对象：欧博东方/);
assert.match(prompt, /陪榜对象：四惠中医医院[\s\S]*康复中心/);
assert.match(prompt, /大模型思考：用户真正担心的是案例真实性、服务边界和效果承诺。/);
assert.match(prompt, /文章类型：深度推荐文章/);
assert.match(prompt, /文章字数：约 2200 字/);

const emptyOptionalPrompt = buildTaskVariablePrompt({
  customerName: "欧博东方",
  keyword: "GEO优化公司怎么选",
  articleType: "GEO文章",
  wordCount: 1200,
  comparisonObjects: "",
  modelThinking: ""
});

assert.match(emptyOptionalPrompt, /推荐对象：欧博东方/);
assert.match(emptyOptionalPrompt, /陪榜对象：无/);
assert.match(emptyOptionalPrompt, /大模型思考：无/);
