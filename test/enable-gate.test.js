"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const backgroundSource = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
const popupSource = fs.readFileSync(path.join(__dirname, "../extension/popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(__dirname, "../extension/popup.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8"));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBackground(options = {}) {
  const storage = { ...(options.storage || {}) };
  const tabsMessages = [];
  const fetches = [];
  const badge = { text: null, title: null };
  const listeners = { runtime: [], commands: [] };
  let fetchHandler = options.fetch || (async () => ({
    ok: true,
    json: async () => ({ answers: [{ id: "q_0", answer: "A" }] }),
    text: async () => "",
  }));

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: storage[keys] };
          const out = {};
          for (const key of keys) out[key] = storage[key];
          return out;
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    action: {
      async setBadgeText({ text }) { badge.text = text; },
      async setBadgeBackgroundColor() {},
      async setTitle({ title }) { badge.title = title; },
    },
    runtime: {
      onMessage: { addListener(fn) { listeners.runtime.push(fn); } },
      lastError: null,
    },
    commands: {
      onCommand: { addListener(fn) { listeners.commands.push(fn); } },
    },
    tabs: {
      async query() { return [{ id: 7 }]; },
      async sendMessage(tabId, msg) {
        tabsMessages.push({ tabId, msg });
        if (msg.action === "detect") {
          return {
            count: 1,
            questions: [{ id: "q_0", type: "multiple_choice", text: "What is 2 + 2?", options: ["3", "4"] }],
          };
        }
        if (msg.action === "answer") return { ok: true, applied: 1, results: [{ id: "q_0", ok: true }] };
        if (msg.action === "clear") return { ok: true };
        return {};
      },
    },
    scripting: { async executeScript() { throw new Error("inject should not be required"); } },
  };

  const context = {
    chrome,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    fetch: async (url, opts) => {
      fetches.push({ url, opts });
      return fetchHandler(url, opts);
    },
  };
  vm.createContext(context);
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  return { storage, tabsMessages, fetches, badge, listeners, chrome, setFetch: (fn) => { fetchHandler = fn; } };
}

function dispatch(harness, msg) {
  const fn = harness.listeners.runtime[0];
  let response;
  let responded = false;
  const returned = fn(msg, {}, (resp) => {
    responded = true;
    response = resp;
  });
  return {
    returned,
    result: (async () => {
      for (let i = 0; i < 30 && !responded; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(responded, true);
      return response;
    })(),
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

test("manifest keeps Alt+Q and does not inject the highlight stylesheet", () => {
  assert.equal(manifest.commands["answer-quiz"].suggested_key.default, "Alt+Q");
  assert.equal(manifest.commands["answer-quiz"].suggested_key.mac, "Alt+Q");
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.equal(manifest.content_scripts[0].css, undefined);
});

test("enabled defaults on, persists, and blocks popup detect and answer", async () => {
  const harness = createBackground();
  assert.equal(harness.listeners.runtime.length, 1);
  assert.equal(harness.listeners.commands.length, 1);

  const initial = dispatch(harness, { action: "getEnabled" });
  assert.equal(initial.returned, true);
  assert.deepEqual(plain(await initial.result), { enabled: true });

  const detected = dispatch(harness, { action: "detect" });
  assert.equal(detected.returned, true);
  const detectBody = await detected.result;
  assert.equal(detectBody.count, 1);
  assert.equal(harness.tabsMessages.filter((item) => item.msg.action === "detect").length, 1);

  const off = dispatch(harness, { action: "setEnabled", enabled: false });
  assert.equal(off.returned, true);
  assert.deepEqual(plain(await off.result), { ok: true, enabled: false });
  assert.equal(harness.storage.enabled, false);
  assert.equal(harness.badge.text, "OFF");
  assert.match(harness.badge.title, /does not uninstall/i);

  const blockedDetect = await dispatch(harness, { action: "detect" }).result;
  assert.equal(blockedDetect.disabled, true);
  assert.equal(blockedDetect.ok, false);
  assert.equal(harness.tabsMessages.filter((item) => item.msg.action === "detect").length, 1);

  const blockedAnswer = await dispatch(harness, {
    action: "answer",
    answers: [{ id: "q_0", answer: "A" }],
  }).result;
  assert.equal(blockedAnswer.disabled, true);
  assert.equal(harness.tabsMessages.some((item) => item.msg.action === "answer"), false);

  const cleared = await dispatch(harness, { action: "clear" }).result;
  assert.deepEqual(plain(cleared), { ok: true });
  assert.equal(harness.tabsMessages.some((item) => item.msg.action === "clear"), true);

  const on = await dispatch(harness, { action: "setEnabled", enabled: true }).result;
  assert.deepEqual(plain(on), { ok: true, enabled: true });
  assert.equal(harness.storage.enabled, true);
  assert.equal(harness.badge.text, "");
});

test("Alt+Q uses stored provider settings and does not put the API key on the badge", async () => {
  const harness = createBackground({
    storage: {
      provider: "openai",
      openaiKey: "sk-test-secret",
      openaiBaseUrl: "https://api.groq.com/openai",
      openaiModel: "llama-3.3-70b-versatile",
    },
  });
  harness.listeners.commands[0]("answer-quiz");
  await flush();
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.fetches[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(harness.fetches[0].opts.headers.Authorization, "Bearer sk-test-secret");
  assert.equal(JSON.parse(harness.fetches[0].opts.body).model, "llama-3.3-70b-versatile");
  assert.equal(harness.storage.provider, "openai");
  assert.equal(harness.badge.text, "SENT");
  assert.equal(String(harness.badge.title).includes("sk-test-secret"), false);
  assert.equal(harness.tabsMessages.some((item) => item.msg.action === "answer"), true);

  const local = createBackground({
    storage: { provider: "local", backendUrl: "http://127.0.0.1:8765/" },
  });
  local.listeners.commands[0]("answer-quiz");
  await flush();
  assert.equal(local.fetches[0].url, "http://127.0.0.1:8765/api/answer");
  assert.equal(local.storage.provider, "local");
});

test("a late model result is not injected after the assistant is turned off", async () => {
  const harness = createBackground();
  const entered = deferred();
  const release = deferred();
  harness.setFetch(async (_url, opts) => {
    entered.resolve(opts);
    await release.promise;
    return {
      ok: true,
      json: async () => ({ answers: [{ id: "q_0", answer: "B" }] }),
      text: async () => "",
    };
  });

  harness.listeners.commands[0]("answer-quiz");
  const opts = await entered.promise;
  assert.equal(harness.tabsMessages.some((item) => item.msg.action === "detect"), true);
  const disabled = await dispatch(harness, { action: "setEnabled", enabled: false }).result;
  assert.equal(disabled.enabled, false);
  assert.equal(opts.signal.aborted, true);
  release.resolve();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(harness.tabsMessages.some((item) => item.msg.action === "answer"), false);
  assert.equal(harness.badge.text, "OFF");
  assert.equal(harness.storage.enabled, false);

  const again = await dispatch(harness, { action: "setEnabled", enabled: true }).result;
  assert.equal(again.enabled, true);
  const answered = await dispatch(harness, {
    action: "answer",
    answers: [{ id: "q_0", answer: "A" }],
  }).result;
  assert.equal(answered.ok, true);
  assert.equal(harness.tabsMessages.filter((item) => item.msg.action === "answer").length, 1);
});

test("popup toggle persists and blocks Detect while Clear stays usable", async () => {
  const dom = new JSDOM(popupHtml, { url: "https://example.com/popup.html", runScripts: "outside-only" });
  const storage = { openaiKey: "sk-popup-secret", provider: "local" };
  const messages = [];
  dom.window.fetch = async () => {
    throw new Error("offline");
  };
  const chromeMock = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of keys) out[key] = storage[key];
          return out;
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    runtime: {
      lastError: null,
      sendMessage(msg, callback) {
        messages.push(msg);
        if (msg.action === "setEnabled") storage.enabled = msg.enabled;
        if (msg.action === "getEnabled") callback({ enabled: storage.enabled !== false });
        else callback({ ok: true, enabled: storage.enabled !== false, count: 0, questions: [] });
      },
    },
  };
  dom.window.__chrome = chromeMock;
  dom.window.eval("var chrome = globalThis.__chrome;");
  dom.window.eval(popupSource + "\n//# sourceURL=popup.js");
  await flush();

  const button = dom.window.document.getElementById("btnEnabled");
  const detect = dom.window.document.getElementById("btnDetect");
  const answer = dom.window.document.getElementById("btnAnswer");
  const clear = dom.window.document.getElementById("btnClear");
  const key = dom.window.document.getElementById("openaiKey");
  assert.equal(button.textContent, "Enabled — click to turn off");
  assert.equal(detect.disabled, false);
  assert.equal(clear.disabled, false);
  assert.equal(key.type, "password");
  assert.equal(key.value, "sk-popup-secret");
  assert.equal(dom.window.document.getElementById("log").textContent.includes("sk-popup-secret"), false);

  button.click();
  await flush();
  assert.equal(storage.enabled, false);
  assert.equal(messages.some((msg) => msg.action === "setEnabled" && msg.enabled === false), true);
  assert.equal(button.textContent, "Disabled — click to turn on");
  assert.equal(button.disabled, false);
  assert.equal(detect.disabled, true);
  assert.equal(answer.disabled, true);
  assert.equal(clear.disabled, false);

  const before = messages.length;
  detect.click();
  answer.click();
  await flush();
  assert.equal(messages.length, before);

  clear.click();
  await flush();
  assert.equal(messages.some((msg) => msg.action === "clear"), true);

  button.click();
  await flush();
  assert.equal(storage.enabled, true);
  assert.equal(button.textContent, "Enabled — click to turn off");
  assert.equal(detect.disabled, false);
  assert.equal(storage.provider, "local");
  assert.equal(storage.openaiKey, "sk-popup-secret");
});
