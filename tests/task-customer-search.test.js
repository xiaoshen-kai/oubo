const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("src/app/page.tsx", "utf8");
const css = fs.readFileSync("src/app/globals.css", "utf8");

assert.match(page, /function taskMatchesCustomerQuery\(task: TaskRow, query: string\)/);
assert.match(page, /customer\?\.name,\s*customer\?\.shortName,\s*customer\?\.industry/s);
assert.match(page, /const \[taskCustomerQuery, setTaskCustomerQuery\] = useState\(""\)/);
assert.match(page, /id="task-customer-query"/);
assert.match(page, /placeholder="输入客户名称、简称或行业"/);
assert.match(page, /baseVisibleTasks\.filter\(\(task\) => taskMatchesCustomerQuery\(task, taskCustomerQuery\)\)/);
assert.match(page, /显示 \{visibleTasks\.length\} \/ \{baseVisibleTasks\.length\} 个任务/);
assert.match(page, /没有匹配任务/);
assert.match(page, /清空检索/);

assert.match(css, /\.task-filterbar/);
assert.match(css, /\.task-search-field/);
assert.match(css, /\.task-filter-summary/);
