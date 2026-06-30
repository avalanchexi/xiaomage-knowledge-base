import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const BODY_LIMIT = 1024 * 1024;
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_FLASH_MODEL = "deepseek-v4-flash";
const DEFAULT_PRO_MODEL = "deepseek-v4-pro";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST_DIR = path.resolve(__dirname, "dist");

const SYSTEM_PROMPT = `你是“小马哥知识库”知识图谱的查询意图解析器。你只能输出 JSON，不输出 Markdown，不解释。

你不生成图谱内容。节点、边、文章内容只能来自本地 wiki 索引。你的任务只是把用户输入转成查询计划。

实体类型：person 人物、org 组织、country 国家、event 事件、take 观点、source 原文。
关系枚举：mentions、participates-in、about、opposes、caused、part-of、derived-from、supports、contradicts。

输出 JSON 结构：
{
  "entity_mentions": ["用户原文中的实体或别名"],
  "mode": "neighborhood" 或 "path",
  "depth": 1、2、3 或 4,
  "relations": "all" 或 ["关系枚举值"],
  "includeSources": true 或 false
}

规则：
1. entity_mentions 只抽取用户输入中出现的词，不编造新实体 ID。
2. 两个实体并询问“关系、怎么连、之间、影响、关联、路径”时，mode 使用 "path"。
3. 单实体或“相关、周边、展开、图谱”时，mode 使用 "neighborhood"。
4. 用户提到“因果、导致、推动、造成、支撑、参与”时，relations 优先收窄到 caused、supports、participates-in。
5. 用户明确要求文章、原文、出处、来源时，includeSources 使用 true；否则 false。
6. depth 默认 2；允许 1、2、3 或 4。用户明确要求更深层级、第三层、第四层时，可输出 3 或 4。
7. 常见别名按原词抽取：懂王、川普、特朗普、前总统、前班长可指向同一人物；漂亮国、山姆大叔、老美、美国可指向同一国家；我国、东方大国、咱们国家、中国可指向同一国家。仍然输出用户原词，不输出规范化 ID。
8. 只输出合法 JSON 对象。`;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendPlain(request, response, statusCode, body, headers = {}) {
  const payload = request.method === "HEAD" ? "" : body;
  response.writeHead(statusCode, {
    ...headers,
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function createServerConfig(options = {}) {
  const distDir = path.resolve(options.distDir || DEFAULT_DIST_DIR);
  return {
    distDir,
    indexHtml: path.join(distDir, "index.html"),
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || fetch,
  };
}

function isUnderDist(filePath, distDir) {
  const relative = path.relative(distDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseRequestUrl(request, response) {
  try {
    return new URL(request.url || "/", "http://localhost");
  } catch {
    sendPlain(request, response, 400, "Bad request");
    return null;
  }
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleIntent(request, response, config) {
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    sendJson(response, statusCode, { error: statusCode === 413 ? "body_too_large" : "bad_json", degrade: true });
    return;
  }

  if (!payload || typeof payload !== "object") {
    sendJson(response, 400, { error: "bad_json", degrade: true });
    return;
  }

  const query = typeof payload.query === "string"
    ? payload.query.trim()
    : typeof payload.message === "string"
      ? payload.message.trim()
      : typeof payload.prompt === "string"
        ? payload.prompt.trim()
        : "";

  if (!query) {
    sendJson(response, 400, { error: "empty_query", degrade: true });
    return;
  }

  if (!config.env.DEEPSEEK_API_KEY) {
    sendJson(response, 503, { error: "no_key", degrade: true });
    return;
  }

  const model = payload.model === "pro"
    ? config.env.DEEPSEEK_MODEL_PRO || DEFAULT_PRO_MODEL
    : config.env.DEEPSEEK_MODEL_FLASH || DEFAULT_FLASH_MODEL;
  const baseUrl = config.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = Number(config.env.DEEPSEEK_TIMEOUT_MS || 30000);

  try {
    const upstream = await config.fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
      }),
    });

    if (!upstream.ok) {
      sendJson(response, 502, { error: "upstream_error", degrade: true });
      return;
    }

    const completion = await upstream.json();
    const content = completion?.choices?.[0]?.message?.content;
    const plan = JSON.parse(content);
    sendJson(response, 200, { plan });
  } catch {
    sendJson(response, 502, { error: "intent_failed", degrade: true });
  }
}

async function serveStatic(request, response, url, config) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendPlain(request, response, 405, "Method not allowed", { allow: "GET, HEAD" });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendPlain(request, response, 400, "Bad request");
    return;
  }

  const hasFileExtension = Boolean(path.extname(pathname));
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let filePath = path.resolve(config.distDir, `.${requestedPath}`);

  if (!isUnderDist(filePath, config.distDir)) {
    sendPlain(request, response, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    if (hasFileExtension) {
      sendPlain(request, response, 404, "Not found");
      return;
    }
    filePath = config.indexHtml;
  }

  if (!isUnderDist(filePath, config.distDir)) {
    sendPlain(request, response, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendPlain(request, response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "content-length": fileStat.size,
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) {
        sendPlain(request, response, 500, "Internal server error");
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  } catch {
    sendPlain(request, response, 404, "Not found");
  }
}

export function createGraphServer(options = {}) {
  const config = createServerConfig(options);

  return createServer(async (request, response) => {
    const url = parseRequestUrl(request, response);
    if (!url) {
      return;
    }

    try {
      if (url.pathname === "/api/intent") {
        await handleIntent(request, response, config);
        return;
      }

      await serveStatic(request, response, url, config);
    } catch {
      if (!response.headersSent) {
        sendPlain(request, response, 500, "Internal server error");
      } else {
        response.destroy();
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createGraphServer();
  server.listen(PORT, () => {
    console.log(`graph-web server listening on http://localhost:${PORT}`);
  });
}
