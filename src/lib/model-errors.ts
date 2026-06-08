export function modelHttpErrorMessage(action: string, status: number, responseText: string) {
  if (status === 504) {
    return `${action}失败：504 上游模型服务超时。建议稍后重试，或减少单篇字数、知识文件数量后再生成。`;
  }

  if (/^\s*</.test(responseText)) {
    return `${action}失败：${status} 上游返回了 HTML 错误页，请检查 Base URL 或模型服务状态。`;
  }

  return `${action}失败：${status} ${responseText.slice(0, 180)}`;
}
