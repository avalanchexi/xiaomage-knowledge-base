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

const SYSTEM_PROMPT = `你是知识图谱查询解析器，只输出 JSON 查询计划。
领域：马永谙时政历史知识库，实体 6 类（人物/组织/国家/事件/观点/原文）。
输出字段：entity_mentions(string[] 用户原词)、mode("neighborhood"|"path")、depth(1-3,默认2)、relations("all"或["caused","supports","participates-in",...])、includeSources(bool,默认false)。
关系动词：mentions/participates-in/about/opposes/caused/part-of/derived-from/supports/contradicts。
俗称→规范示例：懂王/川建国/川总/前班长→特朗普；漂亮国/山姆大叔/老美/米国→美国；我国/东方大国/咱们国家→中国。
规则：两实体且问"关系/怎么连/之间/影响"→mode=path；"相关/周边"→neighborhood；"因果/导致/推动"→relations 收窄到 caused/supports/participates-in。
只抽用户原词，不要编造不存在的实体。只输出 JSON。`;

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
