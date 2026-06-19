const DEFAULT_BACKEND = "http://localhost:8765";

function injectContentScript(tabId) {
  return Promise.all([
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    }),
    chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    }),
  ]);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "detect" || msg.action === "answer" || msg.action === "clear") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ error: "No active tab" });
        return;
      }
      try {
        const resp = await chrome.tabs.sendMessage(tabId, msg);
        sendResponse(resp);
      } catch {
        try {
          await injectContentScript(tabId);
          await new Promise((r) => setTimeout(r, 100));
          const resp = await chrome.tabs.sendMessage(tabId, msg);
          sendResponse(resp);
        } catch (err2) {
          sendResponse({
            count: 0,
            questions: [],
            error: `Content script not loaded. Try refreshing the page. ${err2.message}`,
          });
        }
      }
    });
    return true;
  }

  if (msg.action === "callBackend") {
    handleCallBackend(msg.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleCallBackend(payload) {
  const { config, questions } = payload;

  if (config.provider === "openai") {
    return callOpenAI(config, questions);
  }

  return callLocalBackend(config, questions);
}

async function callLocalBackend(config, questions) {
  const { backendUrl: storedUrl } = await chrome.storage.local.get("backendUrl");
  const url = (config.backendUrl || storedUrl || DEFAULT_BACKEND).replace(/\/$/, "");

  const resp = await fetch(`${url}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions }),
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

async function callOpenAI(config, questions) {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const apiKey = config.apiKey;
  const model = config.model || "gpt-4o";

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
