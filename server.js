// 零依賴的小伺服器:提供靜態網頁,並把 /api/chat 轉發給任何 OpenAI 相容的 API。
// API 金鑰只存在後端,不會傳到瀏覽器。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt, GREETING } from "./public/persona.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "";
const MODEL = process.env.MODEL || "gpt-4o-mini";
const TEMPERATURE = Number(process.env.TEMPERATURE || 0.8);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 40);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: "請求格式錯誤" });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
  if (!messages.length) return sendJson(res, 400, { error: "沒有訊息" });

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: TEMPERATURE,
        messages: [{ role: "system", content: buildSystemPrompt(body.identity, typeof body.custom === "string" ? body.custom : "") }, ...messages],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    return sendJson(res, 502, { error: `連不上 API:${err.message}` });
  }

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 500);
    return sendJson(res, upstream.status, { error: `API 回應 ${upstream.status}:${detail}` });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  Readable.fromWeb(upstream.body)
    .on("error", () => res.end())
    .pipe(res);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
    if (req.method === "GET" && req.url === "/api/config") {
      return sendJson(res, 200, { model: MODEL, greeting: GREETING, hasKey: Boolean(API_KEY) });
    }
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405).end();
  })
  .listen(PORT, () => {
    console.log(`海洛塔帝聊天室:http://localhost:${PORT}`);
    console.log(`API:${BASE_URL}  模型:${MODEL}  金鑰:${API_KEY ? "已設定" : "未設定"}`);
  });
