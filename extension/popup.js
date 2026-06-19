const DEFAULT_BACKEND = "http://localhost:8765";
const DEFAULT_OPENAI_BASE = "https://api.openai.com";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

const $ = (s) => document.querySelector(s);
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const btnDetect = $("#btnDetect");
const btnAnswer = $("#btnAnswer");
const btnClear = $("#btnClear");
const progress = $("#progress");
const logEl = $("#log");

const providerSelect = $("#provider");
const fieldLocal = $("#fieldLocal");
const fieldOpenAI = $("#fieldOpenAI");
const backendInput = $("#backendUrl");
const openaiKeyInput = $("#openaiKey");
const openaiBaseUrlInput = $("#openaiBaseUrl");
const openaiModelInput = $("#openaiModel");

let detectedQuestions = [];

function setStatus(ok, text) {
  statusDot.className = `status-dot ${ok ? "on" : "off"}`;
  statusText.textContent = text;
}

function log(msg) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function getProvider() {
  return providerSelect.value;
}

function getProviderConfig() {
  const provider = getProvider();
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey: openaiKeyInput.value.trim(),
      baseUrl: openaiBaseUrlInput.value.trim() || DEFAULT_OPENAI_BASE,
      model: openaiModelInput.value.trim() || DEFAULT_OPENAI_MODEL,
    };
  }
  return {
    provider: "local",
    backendUrl: backendInput.value.trim() || DEFAULT_BACKEND,
  };
}

async function checkConnection() {
  const provider = getProvider();
  if (provider === "openai") {
    const key = openaiKeyInput.value.trim();
    const baseUrl = openaiBaseUrlInput.value.trim() || DEFAULT_OPENAI_BASE;
    if (!key) {
      setStatus(false, "API key not set");
      return false;
    }
    try {
      const resp = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        setStatus(true, `OpenAI connected (${openaiModelInput.value.trim() || DEFAULT_OPENAI_MODEL})`);
        log(`OpenAI OK: ${baseUrl}`);
        return true;
      }
      const data = await resp.json().catch(() => ({}));
      setStatus(false, data.error?.message || `HTTP ${resp.status}`);
      log(`OpenAI error: ${resp.status}`);
    } catch (e) {
      setStatus(false, "OpenAI unreachable");
      log(`OpenAI unreachable: ${e.message}`);
    }
    return false;
  }

  const backendUrl = backendInput.value.trim() || DEFAULT_BACKEND;
  try {
    const resp = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      setStatus(true, "Backend connected");
      log(`Backend OK: ${backendUrl}`);
      return true;
    }
  } catch (_) {}
  setStatus(false, "Backend unreachable");
  log(`Backend unreachable: ${backendUrl}`);
  return false;
}

function showFields() {
  const provider = getProvider();
  fieldLocal.classList.toggle("visible", provider === "local");
  fieldOpenAI.classList.toggle("visible", provider === "openai");
}

async function sendToTab(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

async function callBackendViaBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "callBackend", payload }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp.error) {
        reject(new Error(resp.error));
      } else {
        resolve(resp);
      }
    });
  });
}

btnDetect.addEventListener("click", async () => {
  try {
    progress.textContent = "Detecting...";
    btnDetect.disabled = true;
    btnAnswer.disabled = true;

    const result = await sendToTab({ action: "detect" });
    if (!result) {
      throw new Error("No response from page. Refresh the page and try again.");
    }
    if (result.error) {
      throw new Error(result.error);
    }
    detectedQuestions = result.questions || [];
    progress.textContent = `Found ${result.count} question(s)`;
    log(`Detect: ${result.count} question(s)`);

    if (result.count > 0) {
      log(`Types: ${detectedQuestions.map((q) => q.type).join(", ")}`);
      btnAnswer.disabled = false;
    } else {
      log("No questions found — open DevTools Console for [AIA] logs");
    }
  } catch (err) {
    progress.textContent = "Detection failed";
    log(`Error: ${err.message}`);
  } finally {
    btnDetect.disabled = false;
  }
});

btnAnswer.addEventListener("click", async () => {
  if (!detectedQuestions.length) return;

  try {
    progress.textContent = "Asking AI...";
    btnAnswer.disabled = true;
    btnDetect.disabled = true;

    const config = getProviderConfig();
    log(`Calling ${config.provider}...`);
    const response = await callBackendViaBackground({
      config,
      questions: detectedQuestions,
    });

    await sendToTab({ action: "answer", answers: response.answers });
    progress.textContent = `Answered ${response.answers.length} question(s)`;
    log(`Answers: ${response.answers.map((a) => `${a.id}=${a.answer}`).join(", ")}`);
  } catch (err) {
    progress.textContent = "Answering failed";
    log(`Error: ${err.message}`);
  } finally {
    btnAnswer.disabled = false;
    btnDetect.disabled = false;
  }
});

btnClear.addEventListener("click", async () => {
  try {
    await sendToTab({ action: "clear" });
    detectedQuestions = [];
    progress.textContent = "";
    btnAnswer.disabled = true;
    log("Cleared");
  } catch (err) {
    log(`Error: ${err.message}`);
  }
});

async function saveSettings() {
  await chrome.storage.local.set({
    provider: getProvider(),
    backendUrl: backendInput.value.trim(),
    openaiKey: openaiKeyInput.value.trim(),
    openaiBaseUrl: openaiBaseUrlInput.value.trim(),
    openaiModel: openaiModelInput.value.trim(),
  });
}

providerSelect.addEventListener("change", async () => {
  showFields();
  await saveSettings();
  await checkConnection();
});

[backendInput, openaiKeyInput, openaiBaseUrlInput, openaiModelInput].forEach((el) => {
  el.addEventListener("change", async () => {
    await saveSettings();
    await checkConnection();
  });
});

(async () => {
  const stored = await chrome.storage.local.get([
    "provider", "backendUrl", "openaiKey", "openaiBaseUrl", "openaiModel",
  ]);

  if (stored.provider) providerSelect.value = stored.provider;
  backendInput.value = stored.backendUrl || "";
  if (stored.openaiKey) openaiKeyInput.value = stored.openaiKey;
  openaiBaseUrlInput.value = stored.openaiBaseUrl || "";
  openaiModelInput.value = stored.openaiModel || "";

  showFields();
  await checkConnection();
})();
