import assert from "node:assert/strict";
import { clearGeneratedArticlesForTask, resetTaskRowForFreshRun } from "../src/lib/task-run";

const resetAt = "2026-06-05T12:00:00.000Z";

const task = {
  id: "task_1",
  status: "failed",
  updatedAt: "2026-06-05T11:00:00.000Z",
  articles: [
    { id: "article_1", taskId: "task_1", taskItemId: "item_1" },
    { id: "article_2", taskId: "task_1", taskItemId: "item_2" }
  ],
  items: [
    {
      id: "item_1",
      taskId: "task_1",
      status: "passed",
      retryCount: 1,
      errorMessage: "",
      articleId: "article_1",
      startedAt: "2026-06-05T10:00:00.000Z",
      finishedAt: "2026-06-05T10:01:00.000Z",
      updatedAt: "2026-06-05T10:01:00.000Z"
    },
    {
      id: "item_2",
      taskId: "task_1",
      status: "failed",
      retryCount: 2,
      errorMessage: "old failure",
      articleId: "article_2",
      startedAt: "2026-06-05T10:02:00.000Z",
      finishedAt: "2026-06-05T10:03:00.000Z",
      updatedAt: "2026-06-05T10:03:00.000Z"
    },
    {
      id: "item_3",
      taskId: "task_1",
      status: "pending",
      retryCount: 0,
      errorMessage: "",
      articleId: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: "2026-06-05T10:04:00.000Z"
    }
  ]
};

const resetTask = resetTaskRowForFreshRun(task, resetAt);

assert.equal(resetTask.status, "running");
assert.equal(resetTask.updatedAt, resetAt);
assert.deepEqual(resetTask.articles, []);
assert.deepEqual(
  resetTask.items.map((item) => ({
    status: item.status,
    retryCount: item.retryCount,
    errorMessage: item.errorMessage,
    articleId: item.articleId,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    updatedAt: item.updatedAt
  })),
  [
    {
      status: "pending",
      retryCount: 0,
      errorMessage: "",
      articleId: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: resetAt
    },
    {
      status: "pending",
      retryCount: 0,
      errorMessage: "",
      articleId: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: resetAt
    },
    {
      status: "pending",
      retryCount: 0,
      errorMessage: "",
      articleId: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: resetAt
    }
  ]
);

assert.deepEqual(
  clearGeneratedArticlesForTask(
    [
      { id: "article_1", taskId: "task_1", taskItemId: "item_1" },
      { id: "article_2", taskId: "task_2", taskItemId: "item_9" }
    ],
    "task_1"
  ),
  [{ id: "article_2", taskId: "task_2", taskItemId: "item_9" }]
);
