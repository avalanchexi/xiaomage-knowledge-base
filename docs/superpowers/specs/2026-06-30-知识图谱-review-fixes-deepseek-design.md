# 知识图谱 Review 修复与 DeepSeek 配置设计

## 背景

本设计面向 `graph-web` 在 Claude Code review 后的合并前修复。Review 结论为 NEEDS FIXES，无 Critical，3 个 Important 必修；同时需要补齐 DeepSeek 本地配置，让搜索意图解析实际走 `/api/intent`。

本轮不修改 `raw/` 或 `小马哥知识库/wiki/` 内容。图谱节点与边仍只来自构建后的 `graph-index.json`，DeepSeek 只返回查询计划，不生成图谱内容。

## 目标

1. 清理违反锁定决策的 React 死配置与依赖。
2. 清理未使用的 `fuse.js` 依赖，保留当前确定性的 `resolveMentions`。
3. 修复 `depthOverridden` / `sourcesOverridden` 会话级粘住问题。
4. 顺手处理低风险 Minor：过时 MVP 文案、死代码、Node 版本约束。
5. 补关键测试：截断行为与 server 基础安全/降级路径。
6. 更新本地 DeepSeek 配置，确保 key 只进入 `.env`，不提交、不回显。

## 非目标

1. 不重构整个前端架构。
2. 不把关系筛选改成完整的纯客户端增量过滤；该项可后续单独优化。
3. 不让 DeepSeek 返回或创造图谱节点、边、文章内容。
4. 不提交 `.env`、`dist/`、`public/data/` 或任何真实 API key。

## 方案

采用方案 B：修复 3 个 Important，加低风险 Minor，加 DeepSeek 配置，加关键测试。

### 依赖与构建配置

移除 `@vitejs/plugin-react`：

- 删除 `graph-web/vite.config.ts` 中的 `react` import。
- 从 `plugins` 数组移除 `react()`。
- 从 `graph-web/package.json` 和 `package-lock.json` 移除 `@vitejs/plugin-react`。

移除 `fuse.js`：

- 从 `dependencies` 和 lockfile 移除 `fuse.js`。
- 不改变 `data.ts` 的 `resolveMentions`，因为当前确定性匹配更符合可解释搜索。

收紧 Node 要求：

- 在 `package.json` 增加 `engines.node`，最低版本设为支持 `--env-file-if-exists` 的 Node 20.12 或更高。

### 查询意图状态

`depthOverridden` 和 `sourcesOverridden` 只表示“用户对当前查询手动改过控件”。因此：

- `recordHistory === true` 的新自然语言查询开始时复位两个标志。
- 历史记录点击、模型切换、关系筛选等内部重跑不复位，避免覆盖用户对当前图的操作。
- 复位后，新查询可以重新接受 DeepSeek 返回的 `depth` 和 `includeSources`。

### 文案与死代码

- 移除静态 `index.html` 中与已实现状态冲突的 MVP / 本地回退旧文案。
- 删除 `ui.ts` 中未使用的导出函数 `splitMentions`。
- 保持当前 UI 文案语义：DeepSeek 不可用时才显示本地回退。

### 测试

补 `assemble` 截断测试：

- 构造超过 `MAX_NODES` 的邻域，断言节点数被限制且 `truncated === true`。
- 构造超过 `MAX_EDGES` 的可见边，断言边数被限制且 `truncated === true`。

补 `server.mjs` 基础测试：

- SPA fallback：无扩展名路径返回 `index.html`。
- 路径穿越：越界路径返回 403 或非成功响应。
- `/api/intent` 无 key 时返回可降级 JSON，不调用上游。

### DeepSeek 配置

官方 DeepSeek 文档显示 API 兼容 OpenAI 格式，OpenAI base URL 为 `https://api.deepseek.com`，Chat Completions endpoint 为 `/chat/completions`，模型包含 `deepseek-v4-flash` 和 `deepseek-v4-pro`。

本轮配置策略：

- `graph-web/.env.example` 保留占位 key 与模型名模板。
- 本地 `graph-web/.env` 写入真实配置，但不提交。
- 不在提交、日志、最终报告中输出完整 key。
- 建议后续轮换已暴露在对话里的 key。

## 验收

1. `rg "React|@vitejs/plugin-react|fuse.js|splitMentions" graph-web/src graph-web/package.json graph-web/vite.config.ts graph-web/tsconfig.json` 不再命中不应存在的项。
2. `npm test` 通过。
3. `npx tsc --noEmit` 通过。
4. `npm run build` 通过。
5. `git diff --check` 通过。
6. `rg "sk-[A-Za-z0-9]" .` 不命中真实 key。
7. `git status --short` 不包含 `.env`、`dist/`、`public/data/`。

## 风险与处理

1. Lockfile 清理可能受 npm 版本影响：用 `npm install --package-lock-only` 或 `npm install` 让 lockfile 机械更新。
2. server 测试需要避免真实网络调用：通过无 key路径和测试端口验证基础行为，不访问 DeepSeek。
3. 本地 `.env` 写入涉及 secret：只在工作区本地文件写入，确保 `.gitignore` 覆盖并在提交前做 secret scan。
