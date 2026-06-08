export type ResettableTaskItem = {
  status: string;
  retryCount: number;
  errorMessage: string;
  articleId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type TaskArticleRef = {
  taskId: string;
};

export function resetTaskItemsForFreshRun<T extends ResettableTaskItem>(items: T[], updatedAt: string): T[] {
  return items.map((item) => ({
    ...item,
    status: "pending",
    retryCount: 0,
    errorMessage: "",
    articleId: null,
    startedAt: null,
    finishedAt: null,
    updatedAt
  }));
}

export function resetTaskRowForFreshRun<
  TItem extends ResettableTaskItem,
  TArticle,
  TTask extends { status: string; updatedAt: string; articles: TArticle[]; items: TItem[] }
>(task: TTask, updatedAt: string): TTask {
  return {
    ...task,
    status: "running",
    articles: [],
    updatedAt,
    items: resetTaskItemsForFreshRun(task.items, updatedAt)
  };
}

export function clearGeneratedArticlesForTask<TArticle extends TaskArticleRef>(articles: TArticle[], taskId: string): TArticle[] {
  return articles.filter((article) => article.taskId !== taskId);
}
