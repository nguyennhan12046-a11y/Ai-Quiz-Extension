const DEFAULT_BACKEND = "http://localhost:8765";
const DEFAULT_OPENAI_BASE = "https://api.openai.com";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

let shortcutBusy = false;
let activeRun = 0;
let activeAbort = null;

function enabledFromStored(stored) {
  return !stored || stored.enabled !== false;
}

async function isEnabled() {
  const stored = await chrome.storage.local.get("enabled");
  return enabledFromStored(stored);
}

function startRequest() {
  const runId = ++activeRun;
  if (activeAbort) activeAbort.abort();
  const controller = new AbortController();
  activeAbort = controller;
  return { runId, signal: controller.signal, controller };
}

function isCurrent(runId) {
  return runId === activeRun;
}

function cancelInFlight() {
  activeRun += 1;
  shortcutBusy = false;
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

async function setBadge(text, title, color) {
  try {
    await chrome.action.setBadgeText({ text: text || "" });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
    if (title) await chrome.action.setTitle({ title });
  } catch (_) {}
}

async function readConfig() {
  const stored = await chrome.storage.local.get([
    "provider",
    "backendUrl",
    "openaiKey",
    "openaiBaseUrl",
    "openaiModel",
  ]);
  const provider = stored.provider || "local";
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey: stored.openaiKey || "",
      baseUrl: stored.openaiBaseUrl || DEFAULT_OPENAI_BASE,
      model: stored.openaiModel || DEFAULT_OPENAI_MODEL,
      backendUrl: stored.backendUrl || DEFAULT_BACKEND,
    };
  }
  return {
    provider: "local",
    backendUrl: stored.backendUrl || DEFAULT_BACKEND,
    apiKey: stored.openaiKey || "",
    baseUrl: stored.openaiBaseUrl || DEFAULT_OPENAI_BASE,
    model: stored.openaiModel || DEFAULT_OPENAI_MODEL,
  };
}

function injectContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await injectContentScript(tabId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function runAiQuizShortcut() {
  if (shortcutBusy) return;
  if (!(await isEnabled())) {
    await setBadge(
      "OFF",
      "AI Answer Assistant is off. Turn it on from the toolbar popup. This does not uninstall the extension.",
      "#64748b"
    );
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) {
    await setBadge("ERR", "AI Answer Assistant: no active tab", "#dc2626");
    return;
  }

  shortcutBusy = true;
  const { runId, signal, controller } = startRequest();
  await setBadge("...", "AI Answer Assistant is working", "#4f46e5");
  try {
    const detected = await sendToTab(tabId, { action: "detect" });
    if (!isCurrent(runId) || signal.aborted || !(await isEnabled())) return;
    if (!detected || detected.error) throw new Error(detected?.error || "Detect failed");
    if (!detected.count) {
      await setBadge("ERR", "AI Answer Assistant found 0 questions", "#dc2626");
      return;
    }

    const config = await readConfig();
    const result = await handleCallBackend({ config, questions: detected.questions }, signal);
    if (!isCurrent(runId) || signal.aborted || !(await isEnabled())) return;
    if (!result || !Array.isArray(result.answers) || result.answers.length === 0) {
      throw new Error("No answers");
    }

    const applied = await sendToTab(tabId, { action: "answer", answers: result.answers });
    if (!isCurrent(runId) || !(await isEnabled())) return;
    if (applied && applied.ok === false) {
      await setBadge("ERR", "AI Answer Assistant could not apply every answer", "#dc2626");
      return;
    }
    await setBadge("SENT", "AI Answer Assistant sent answers", "#16a34a");
  } catch (err) {
    if (!isCurrent(runId) || signal.aborted || err.name === "AbortError") return;
    await setBadge("ERR", "AI Answer Assistant could not answer this page", "#dc2626");
  } finally {
    if (activeAbort === controller) activeAbort = null;
    if (activeRun === runId) shortcutBusy = false;
  }
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "answer-quiz") runAiQuizShortcut();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.action !== "string") return;

  if (msg.action === "setEnabled") {
    const enabled = msg.enabled !== false;
    if (!enabled) cancelInFlight();
    chrome.storage.local.set({ enabled }).then(async () => {
      if (!enabled) {
        await setBadge(
          "OFF",
          "AI Answer Assistant is off. Turn it on from the toolbar popup. This does not uninstall the extension.",
          "#64748b"
        );
      } else {
        await setBadge("", "AI Answer Assistant", "#4f46e5");
      }
      sendResponse({ ok: true, enabled });
    }).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === "getEnabled") {
    isEnabled()
      .then((enabled) => sendResponse({ enabled }))
      .catch((err) => sendResponse({ enabled: true, error: err.message }));
    return true;
  }

  if (msg.action === "detect" || msg.action === "answer" || msg.action === "clear") {
    (async () => {
      if (msg.action !== "clear" && !(await isEnabled())) {
        sendResponse({
          ok: false,
          disabled: true,
          count: 0,
          questions: [],
          error: "Assistant is off",
        });
        return;
      }
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ error: "No active tab" });
        return;
      }
      if (msg.action !== "clear" && !(await isEnabled())) {
        sendResponse({
          ok: false,
          disabled: true,
          count: 0,
          questions: [],
          error: "Assistant is off",
        });
        return;
      }
      try {
        const resp = await sendToTab(tabId, msg);
        if (msg.action !== "clear" && !(await isEnabled())) {
          sendResponse({ ok: false, disabled: true, error: "Assistant is off" });
          return;
        }
        sendResponse(resp);
      } catch (err2) {
        sendResponse({
          count: 0,
          questions: [],
          error: `Content script not loaded. Try refreshing the page. ${err2.message}`,
        });
      }
    })();
    return true;
  }

  if (msg.action === "callBackend") {
    const { runId, signal } = startRequest();
    (async () => {
      if (!(await isEnabled())) {
        sendResponse({ error: "Assistant is off", disabled: true });
        return;
      }
      try {
        const result = await handleCallBackend(msg.payload, signal);
        if (!isCurrent(runId) || signal.aborted || !(await isEnabled())) {
          sendResponse({ error: "Assistant is off", disabled: true, aborted: true });
          return;
        }
        sendResponse(result);
      } catch (err) {
        if (err.name === "AbortError" || signal.aborted || !isCurrent(runId)) {
          sendResponse({ error: "Assistant is off", disabled: true, aborted: true });
          return;
        }
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});

async function handleCallBackend(payload, signal) {
  const { config, questions } = payload;

  if (config.provider === "openai") {
    return callOpenAI(config, questions, signal);
  }

  return callLocalBackend(config, questions, signal);
}

async function callLocalBackend(config, questions, signal) {
  const { backendUrl: storedUrl } = await chrome.storage.local.get("backendUrl");
  const url = (config.backendUrl || storedUrl || DEFAULT_BACKEND).replace(/\/$/, "");

  const resp = await fetch(`${url}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Backend error ${resp.status}: ${text}`);
  }

  return resp.json();
}

function buildPrompt(questions) {
  const lines = [
    "You are answering quiz questions. Answer each question concisely.",
    "For multiple choice / checkbox / select / button_choice questions, reply with ONLY the letter(s) of the correct option(s).",
    "For text questions, reply with the exact short answer (a word, number, or short phrase).",
    "Respond in strict JSON format with an array of objects: [{\"id\": \"...\", \"answer\": \"...\"}]",
    "",
  ];

  for (const q of questions) {
    lines.push(`Question ID: ${q.id} (type: ${q.type})`);
    lines.push(q.text);
    if (q.options) {
      q.options.forEach((opt, j) => {
        lines.push(`  ${String.fromCharCode(65 + j)}) ${opt}`);
      });
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseResponse(raw, questions) {
  const jsonMatch = raw.match(/\[.*\]/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((item) => ({ id: item.id, answer: String(item.answer) }));
    } catch {}
  }

  const answers = [];
  const pattern = new RegExp(
    "(?:Question\\s+ID:\\s*(\\S+)|Answer\\s*(?:for\\s*)?(\\S+)?\\s*:?\\s*(.+?))(?=\\n(?:Question|Answer|$)|\\Z)",
    "gi"
  );
  const matches = [...raw.matchAll(pattern)];
  for (const m of matches) {
    const qid = m[1] || m[2] || "unknown";
    answers.push({ id: qid, answer: (m[3] || "").trim() });
  }

  if (answers.length) return answers;
  return questions.map((q) => ({ id: q.id, answer: "" }));
}

async function callOpenAI(config, questions, signal) {
  const baseUrl = (config.baseUrl || DEFAULT_OPENAI_BASE).replace(/\/$/, "");
  const apiKey = config.apiKey;
  const model = config.model || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    throw new Error("OpenAI API key not set");
  }

  const prompt = buildPrompt(questions);

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
    signal,
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(`OpenAI error ${resp.status}: ${data.error?.message || "Unknown error"}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const answers = parseResponse(raw, questions);

  return { answers };
}
