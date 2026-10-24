import { IDENTITIES, findIdentity, buildSystemPrompt } from "./persona.js";

const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("reset");
const settingsBtn = document.getElementById("settings");
const modelEl = document.getElementById("model");
const dialog = document.getElementById("dialog");
const baseUrlEl = document.getElementById("baseUrl");
const apiKeyEl = document.getElementById("apiKey");
const modelNameEl = document.getElementById("modelName");
const identityEl = document.getElementById("identity");
const editCustomBtn = document.getElementById("editCustom");
const customDialog = document.getElementById("customDialog");
const customTextEl = document.getElementById("customText");

const HISTORY_KEY = "hroptatyr-chat-history";
const IDENTITY_KEY = "hroptatyr-chat-identity";
const CUSTOM_KEY = "hroptatyr-chat-custom";
const SETTINGS_KEY = "hroptatyr-chat-settings";
const MAX_HISTORY = 40;

let history = [];
let identityId = "visitor";
let customText = "";
let busy = false;
let proxyMode = false; // true:本機伺服器代為呼叫 API;false:瀏覽器直接呼叫(GitHub Pages)
let settings = { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" };

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

const historyKey = () => `${HISTORY_KEY}:${identityId}`;

function render() {
  log.replaceChildren();
  addMsg("bot", findIdentity(identityId).greeting);
  for (const m of history) addMsg(m.role === "user" ? "user" : "bot", m.content);
}

function setBusy(value) {
  busy = value;
  identityEl.disabled = value;
  sendBtn.disabled = value;
  input.disabled = value;
  if (!value) input.focus();
}

function showModel(name) {
  modelEl.textContent = name ? `模型:${name}` : "";
}

// 依模式送出請求,回傳 fetch Response(OpenAI 格式的 SSE 串流)
async function request(messages) {
  if (proxyMode) {
    return fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, identity: identityId, custom: customText }),
    });
  }
  const base = settings.baseUrl.replace(/\/+$/, "");
  return fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      temperature: 0.8,
      messages: [{ role: "system", content: buildSystemPrompt(identityId, customText) }, ...messages.slice(-MAX_HISTORY)],
    }),
  });
}

async function errorText(res) {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw);
    return j.error?.message || j.error || raw;
  } catch {
    return raw.slice(0, 300);
  }
}

async function streamReply(messages, onText) {
  let res;
  try {
    res = await request(messages);
  } catch (err) {
    throw new Error(
      proxyMode
        ? `連不上伺服器:${err.message}`
        : "無法連線到 API。請檢查網址是否正確,以及該服務是否允許瀏覽器跨來源(CORS)呼叫。"
    );
  }
  if (!res.ok) throw new Error(`API 回應 ${res.status}:${await errorText(res)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onText(full);
        }
      } catch {}
    }
  }
  return full;
}

async function send(text) {
  history.push({ role: "user", content: text });
  writeJson(historyKey(), history);
  addMsg("user", text);
  const bubble = addMsg("bot", "");
  bubble.classList.add("typing");
  setBusy(true);

  try {
    const reply = await streamReply(history, (t) => {
      bubble.textContent = t;
      log.scrollTop = log.scrollHeight;
    });
    if (!reply.trim()) throw new Error("模型沒有回覆內容");
    history.push({ role: "assistant", content: reply });
    writeJson(historyKey(), history);
  } catch (err) {
    bubble.remove();
    history.pop(); // 失敗的那句不留在歷史裡,可直接重送
    writeJson(historyKey(), history);
    addMsg("error", err.message);
    input.value = text;
  } finally {
    bubble.classList.remove("typing");
    setBusy(false);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  if (!proxyMode && !settings.apiKey && !isLocalUrl(settings.baseUrl)) {
    openSettings();
    return;
  }
  input.value = "";
  input.style.height = "auto";
  send(text);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

resetBtn.addEventListener("click", () => {
  if (busy) return;
  history = [];
  writeJson(historyKey(), history);
  render();
});

// --- 設定視窗(僅直連模式) ---
function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}
function openSettings() {
  baseUrlEl.value = settings.baseUrl;
  apiKeyEl.value = settings.apiKey;
  modelNameEl.value = settings.model;
  dialog.showModal();
}
settingsBtn.addEventListener("click", openSettings);
document.getElementById("cancel").addEventListener("click", () => dialog.close());
document.getElementById("clearKey").addEventListener("click", () => {
  settings = { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" };
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {}
  showModel("");
  dialog.close();
});
document.getElementById("settingsForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  settings = {
    baseUrl: baseUrlEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    model: modelNameEl.value.trim(),
  };
  writeJson(SETTINGS_KEY, settings);
  showModel(settings.model);
});

// --- 啟動:偵測有沒有本機伺服器 ---
async function detectProxy() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const config = await detectProxy();
customText = readJson(CUSTOM_KEY, "");
try {
  const saved = localStorage.getItem(IDENTITY_KEY);
  if (saved) identityId = findIdentity(saved).id;
} catch {}
if (identityId === "custom" && !customText) identityId = "visitor";
for (const i of IDENTITIES) identityEl.add(new Option(i.label, i.id));
identityEl.value = identityId;
editCustomBtn.hidden = identityId !== "custom";
history = readJson(historyKey(), []);
if (config) {
  proxyMode = true;
  showModel(config.model);
  render();
  if (!config.hasKey) addMsg("error", "後端尚未設定 API_KEY(若使用本機的 Ollama / LM Studio 可忽略)。");
} else {
  settings = { ...settings, ...readJson(SETTINGS_KEY, {}) };
  settingsBtn.hidden = false;
  showModel(settings.apiKey || isLocalUrl(settings.baseUrl) ? settings.model : "");
  render();
  if (!settings.apiKey && !isLocalUrl(settings.baseUrl)) {
    addMsg("error", "尚未設定 API。請按右上角「API 設定」填入你自己的服務網址、金鑰與模型。");
  }
}


function switchIdentity(next) {
  identityId = findIdentity(next).id;
  identityEl.value = identityId;
  editCustomBtn.hidden = identityId !== "custom";
  try {
    localStorage.setItem(IDENTITY_KEY, identityId);
  } catch {}
  history = readJson(historyKey(), []);
  render();
  input.focus();
}

function openCustom() {
  customTextEl.value = customText;
  customDialog.showModal();
}

identityEl.addEventListener("change", () => {
  if (identityEl.value === "custom" && !customText) {
    openCustom();
    return;
  }
  switchIdentity(identityEl.value);
});

editCustomBtn.addEventListener("click", openCustom);

document.getElementById("customCancel").addEventListener("click", () => {
  customDialog.close();
  identityEl.value = identityId; // 取消就回到原本的身分
});

document.getElementById("customForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const text = customTextEl.value.trim();
  if (!text) return;
  if (text !== customText) {
    customText = text;
    writeJson(CUSTOM_KEY, customText);
    writeJson(`${HISTORY_KEY}:custom`, []); // 身分改了,從新對話開始
  }
  switchIdentity("custom");
});

customDialog.addEventListener("close", () => {
  identityEl.value = identityId; // Esc 關閉時,選單也回到目前的身分
});
