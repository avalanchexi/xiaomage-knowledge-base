# 小马哥时政历史知识库

这是一个把“小马哥财道/时政历史”文稿编译成 LLM Wiki 的本地知识库项目。它有三种主要使用方式：

- `graph-web/`：本地知识图谱前端，用浏览器搜索实体、关系、观点和原文出处。
- `小马哥知识库/wiki/`：LLM Wiki 内容层，AI 可以直接读取 Markdown 页面并基于来源回答问题。
- GBrain：命令行检索、建图、反链、综合问答入口。

当前已验证的图谱构建规模：`4296` 个节点、`14586` 条显式关系、`0` 个悬空链接。当前 GBrain 库可见：`4298 pages`、`22620 links`、`Embedded: 0`。

## 目录结构

```text
.
├── graph-web/          # 知识图谱前端和本地 Node 服务
├── 小马哥知识库/
│   ├── raw/            # 原始文稿，只读
│   ├── wiki/           # LLM Wiki 编译产物
│   ├── AGENTS.md       # Codex 侧 schema 规则
│   ├── CLAUDE.md       # Claude 侧 schema 规则
│   ├── AGENT-OPS.md    # Windows/PowerShell/编码操作规约
│   ├── normalize-corpus.ps1
│   └── compile-batch.ps1
├── 知识库设计文档-GBrain编译式RAG.md
└── README.md
```

`brain/`、`graph-web/node_modules/`、`graph-web/dist/`、`graph-web/public/data/` 都是可重建产物。换设备时优先复制源码和 `小马哥知识库/wiki/`，再重新构建前端索引和 GBrain 库，不建议直接搬运本机数据库。

## 依赖

- Windows PowerShell。这个项目的操作规约要求优先使用 PowerShell，避免 Bash。
- Node.js `>=20.12.0` 和 npm。`graph-web/package.json` 已声明该版本要求。
- GBrain `0.42.x`。本机验证版本为 `0.42.44.0`。
- 前端 AI 意图解析配置可选。没有远程模型配置时前端仍会本地回退检索，只是自然语言意图解析能力会弱一些。
- GBrain embedding/model 配置可选。当前库 `Embedded: 0`，关键词、图谱、反链命令可用；语义检索和综合问答需要另行配置 embedding/provider。

## 快速开始

在另一台设备上拿到项目后，先进入项目根目录：

```powershell
cd <项目目录>
```

安装前端依赖：

```powershell
cd graph-web
npm install
```

可选：创建本地 `.env`。`.env` 不提交 Git，只在本机保存。

```powershell
Copy-Item .env.example .env
notepad .env
```

如果只需要改端口，保留或设置：

```env
PORT=4173
```

生成图谱索引：

```powershell
npm run build:graph
```

开发预览：

```powershell
npm run dev
```

浏览器打开：

```text
http://localhost:4173
```

生产本机启动：

```powershell
npm run start
```

`npm run start` 会先执行 `npm run build`，再用 Node 服务托管 `dist` 和 `/api/intent`。

## 使用前端页面

前端入口是 `graph-web`。启动后打开 `http://localhost:4173`，页面会先加载本地索引。索引加载成功后，在顶部搜索框输入实体、别名、多个实体，或一句自然语言问题，例如：

```text
懂王跟俄罗斯怎么扯上的
王安石变法为什么失败
特朗普和美联储有什么关系
金融战有哪些手法
```

点击 `生成图谱` 后，页面会把输入解析成查询计划，再从本地索引组装图谱。单个实体通常生成“邻域模式”，两个或更多实体通常生成“路径模式”，用于查看这些实体之间的连接和中间节点。

顶部参数区：

- `检索深度 1-4`：控制向外展开的层数。深度越大，节点越多；当前图已生成后，切换深度会立即重组图谱。
- `模型 flash/pro`：只影响前端 AI 意图解析；图谱内容仍然来自本地 wiki。
- `因果/层级`：切换更适合因果链和层级关系的布局，当前图会立即重排。
- `显示原文出处`：把 `source` 原文节点加入图谱；关闭时隐藏原文节点，只保留人物、国家、组织、事件、观点等知识节点。
- `生成图谱`：提交当前输入和参数，左侧历史会记录本次查询。

图谱区域：

- 中间画布显示节点和关系边。滚轮缩放，拖拽平移。
- 点击节点会高亮它和相邻节点/边，并在右侧详情面板显示该节点信息。
- 点击画布空白处会清除当前选中。
- 悬停关系边会显示关系标签。
- 左上角状态条显示当前模式、节点数、边数；如果达到节点上限，会提示当前深度下已截断。
- 底部图例可以按类型筛选：人物、国家、事件、观点、组织、原文。图例上的数字是当前图内该类型节点数量。

右侧详情面板：

- 显示选中节点的标题、类型、slug、关系数量。
- `别名` 展示 wiki 中记录的别名。
- `当前图内关系` 展示当前视图里与该节点相连的关系。
- `原文来源` 展示该节点对应的 `sources/N`，点击可打开原文 wiki 预览。
- `打开 wiki 页` 会以弹窗方式只读预览该节点的 Markdown 页面，包含 frontmatter 元数据、正文、关系和来源。

左侧历史和底部状态：

- 左侧“已生成的图谱”保存最近查询，数据存在浏览器本地；可以点击历史项重新运行，也可以删除本地记录。
- 底部状态分为 `空状态`、`本地索引`、`AI`，用于判断当前是等待输入、正在生成、已生成、未命中，还是远程解析不可用并已本地回退。

前端的关键边界：AI 只负责把用户输入解析成查询计划，不生成知识内容。图上的节点、边、出处都来自本地 `小马哥知识库/wiki` 和由它构建出的索引。

## 直接用 AI 问答 LLM Wiki

不启动前端也可以直接让 AI 读取 `小马哥知识库/wiki`。这是最接近 LLM Wiki 的用法：AI 先读结构化 Markdown，再基于页面和原文出处回答。

建议让 AI 优先读取这些文件：

- `小马哥知识库/wiki/index.md`：导航和主题入口。
- `小马哥知识库/wiki/aliases.md`：别名到规范 slug 的词典。
- `小马哥知识库/wiki/people/`：人物。
- `小马哥知识库/wiki/orgs/`：组织。
- `小马哥知识库/wiki/countries/`：国家/政权。
- `小马哥知识库/wiki/events/`：事件。
- `小马哥知识库/wiki/takes/`：马永谙观点或判断。
- `小马哥知识库/wiki/sources/`：原文页。

可复制给 AI 的提示词：

```text
你现在基于本地 LLM Wiki 回答问题。请只使用 `小马哥知识库/wiki` 下的 Markdown 页面作为依据。

工作方式：
1. 先读 `wiki/index.md` 和 `wiki/aliases.md`，把用户提到的别名映射到规范 slug。
2. 再读取相关的 people/orgs/countries/events/takes/sources 页面。
3. 回答时必须区分客观事件和 `type: take` 的观点页；take 是马永谙的观点，不要写成客观事实。
4. 每个关键结论后标注依据路径，例如 `events/xining-reform.md`、`takes/reforms-need-new-forces-or-authority.md`、`sources/121`。
5. 找不到依据就说“wiki 中未找到明确依据”，不要编造。

问题：<在这里写问题>
```

适合的问题：

- `王安石改革为什么失败？请区分事件、人物、观点。`
- `特朗普与美联储冲突在 wiki 里有哪些相关事件和观点？`
- `马永谙提到的金融战有哪些常用手法？分别来自哪些 source？`

这种方式不依赖 GBrain，也不依赖前端的远程意图解析 API；只要 AI 工具能读取本地文件即可。

## 使用 GBrain 命令（进阶）

先进入知识库目录：

```powershell
cd <项目目录>\小马哥知识库
```

### 初始化和导入新设备

如果另一台设备还没有本项目的 GBrain 库，可以按下面顺序重建：

```powershell
gbrain init --pglite --no-embedding --force
gbrain import wiki --no-embed
gbrain extract links --source fs --dir wiki
gbrain stats
```

`--no-embed` 表示先只导入页面和图谱关系，不计算向量。这样对前期检索、反链、图遍历已经够用。

当前本机 `gbrain stats` 验证结果：

```text
Pages:     4298
Chunks:    4396
Embedded:  0
Links:     22620
```

### 当前可用检索

关键词检索：

```powershell
gbrain search "特朗普" --limit 5
```

读取页面：

```powershell
gbrain get people/trump
```

查看某个节点的一跳图谱：

```powershell
gbrain graph people/trump --depth 1
```

查看反向链接：

```powershell
gbrain backlinks people/trump
```

按方向做图查询：

```powershell
gbrain graph-query people/trump --depth 1 --direction in
```

检查 wiki 页面质量：

```powershell
gbrain lint wiki
```

当前 `gbrain lint wiki` 的已知提示是 `aliases.md` 没有 frontmatter 且体积很大。这是预期噪声，因为 `aliases.md` 是冻结别名字典，不是普通知识页。

### 语义检索和综合问答

GBrain 的自然语言入口：

```powershell
gbrain query "特朗普" --limit 5
gbrain ask "特朗普" --limit 5
```

多跳综合问答：

```powershell
gbrain think "马永谙怎么看特朗普的政治路线？" --anchor people/trump --model <model-alias>
```

注意当前库 `Embedded: 0`。这意味着关键词、页面读取、图谱遍历、反链可用，但复杂语义检索效果会受限。要启用语义能力，需要先配置 embedding/provider，然后运行：

```powershell
gbrain embed --stale
```

或者重新导入时不要使用 `--no-embed`。如果使用 `gbrain think`，还需要配置可用的模型别名或通过 `--model` 指定模型。

## 部署

### 静态部署

构建：

```powershell
cd <项目目录>\graph-web
npm run build
```

部署 `graph-web/dist` 目录即可。该目录会包含前端产物和构建时复制进去的 `wiki` 静态内容。

静态部署下，如果没有 Node 服务提供 `/api/intent`，前端 AI 意图解析不可用，页面会自动走本地回退。图谱浏览、节点详情和 wiki 只读预览仍可用。

### Node 部署

Node 部署适合需要 `/api/intent` 的场景：

```powershell
cd <项目目录>\graph-web
npm install
npm run build
node scripts/start-server.mjs
```

也可以直接：

```powershell
npm run start
```

默认端口是 `4173`。可以通过 `.env` 或环境变量覆盖：

```powershell
$env:PORT = "8080"
node scripts/start-server.mjs
```

如果要启用前端 AI 意图解析，请按 `graph-web/.env.example` 配置当前服务端支持的环境变量。

## 维护知识库

内容层的核心纪律：

- `小马哥知识库/raw/` 是原始文稿，只读。
- 所有知识产物写入 `小马哥知识库/wiki/`。
- `wiki/aliases.md` 是冻结别名字典。普通写页时先查它，不要随意改它。
- `type: take` 是马永谙观点，不是客观事实；回答和维护时都要保留这个边界。

修改 `wiki/` 后，同步前端索引：

```powershell
cd <项目目录>\graph-web
npm run build:graph
```

需要重新构建前端：

```powershell
npm run build
```

同步 GBrain：

```powershell
cd <项目目录>\小马哥知识库
gbrain import wiki --no-embed
gbrain extract links --source fs --dir wiki
gbrain stats
```

高级批处理脚本：

- `小马哥知识库/normalize-corpus.ps1`：从根目录编号 Markdown 中抽取有效正文，写入 `raw/`。
- `小马哥知识库/compile-batch.ps1`：用 Codex 分批把 `raw/` 编译为 `wiki/` 页面；脚本会保护 `raw/` 和冻结 `aliases.md`，并用 `.done/` 做断点续跑。

执行批处理前先读：

```powershell
Get-Content -LiteralPath .\AGENT-OPS.md -Encoding UTF8
Get-Content -LiteralPath .\AGENTS.md -Encoding UTF8
```

## 验证

前端测试：

```powershell
cd <项目目录>\graph-web
npm test
```

当前已验证结果：

```text
Test Files  11 passed
Tests       68 passed
```

生产构建：

```powershell
npm run build
```

当前已验证结果：

```text
文件解析: 4296
节点: 4296 (实体 4296 / 占位 0)
边: 14586
悬空链接: 0
```

GBrain 验证：

```powershell
cd <项目目录>\小马哥知识库
gbrain stats
gbrain lint wiki
gbrain search "特朗普" --limit 5
gbrain get people/trump
gbrain graph people/trump --depth 1
```

## 排障

### Node 版本过低

`graph-web` 要求 Node.js `>=20.12.0`。先检查版本：

```powershell
node -v
```

版本不够就升级 Node 后重新 `npm install`。

### 前端 AI 意图解析显示不可用

检查 `graph-web/.env`：

```powershell
Get-Content -LiteralPath .env -Encoding UTF8
```

确认本机已经按 `graph-web/.env.example` 配置远程模型相关变量。没有远程模型配置也可以继续用前端，本地回退会使用关键词/别名解析。

### 图谱数据不存在或加载失败

重新构建图谱索引：

```powershell
cd <项目目录>\graph-web
npm run build:graph
```

### GBrain 搜不到新页面

重新导入并抽取链接：

```powershell
cd <项目目录>\小马哥知识库
gbrain import wiki --no-embed
gbrain extract links --source fs --dir wiki
gbrain stats
```

### `gbrain lint wiki` 报 `aliases.md`

如果只看到 `aliases.md` 的 `no-frontmatter` 和 `huge-page`，这是预期提示。`aliases.md` 是词典，不是普通知识页。

### 中文文本乱码

PowerShell 读取文本时显式使用 UTF-8：

```powershell
Get-Content -LiteralPath <文件路径> -Encoding UTF8
```

写中文脚本和文档时也保持 UTF-8。项目内 `.ps1` 注释尽量用 ASCII，避免 PowerShell 5.1 和 GBK 默认编码造成换行或中文解析问题。
