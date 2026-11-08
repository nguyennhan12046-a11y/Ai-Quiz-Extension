"use strict";

// DOM fixtures only. These tests do not open docs.google.com and do not submit a form.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const contentSource = fs.readFileSync(path.join(__dirname, "../extension/content.js"), "utf8");
const quizHtml = fs.readFileSync(path.join(__dirname, "../test-quiz.html"), "utf8");

function createPage(html, url = "https://example.com/quiz") {
  const dom = new JSDOM(html, { url, runScripts: "dangerously" });
  dom.window.console.log = () => {};
  dom.window.eval(`
    var CSS = {
      escape(value) {
        return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
      }
    };
    var chrome = {
      runtime: {
        onMessage: {
          listeners: [],
          addListener(fn) { this.listeners.push(fn); }
        }
      }
    };
    globalThis.__chromeListeners = chrome.runtime.onMessage.listeners;
  `);
  dom.window.eval(contentSource + "\n//# sourceURL=content.js");
  const listeners = dom.window.__chromeListeners;
  return { window: dom.window, document: dom.window.document, listeners };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function send(page, msg) {
  const responses = [];
  for (const fn of page.listeners) {
    let responded = false;
    fn(msg, {}, (resp) => {
      responded = true;
      responses.push(resp);
    });
    if (!responded) responses.push(undefined);
  }
  assert.equal(responses.length, 1, "content script registered more than one listener");
  return responses[0];
}

function wireFormsBehavior(doc) {
  const events = [];
  const remember = (el, event) => events.push({ el, type: event.type, target: event.target });

  doc.querySelectorAll("[role='radio']").forEach((el) => {
    el.addEventListener("mousedown", (event) => remember(el, event));
    el.addEventListener("click", (event) => {
      remember(el, event);
      const was = el.getAttribute("aria-checked") === "true";
      const group = el.closest("[role='radiogroup']") || el.closest("[role='listitem']") || el.parentElement;
      group.querySelectorAll("[role='radio']").forEach((radio) => radio.setAttribute("aria-checked", "false"));
      el.setAttribute("aria-checked", was ? "false" : "true");
    });
  });

  doc.querySelectorAll("[role='checkbox']").forEach((el) => {
    el.addEventListener("click", (event) => {
      remember(el, event);
      const was = el.getAttribute("aria-checked") === "true";
      el.setAttribute("aria-checked", was ? "false" : "true");
    });
  });

  doc.querySelectorAll("button, [role='button']").forEach((el) => {
    el.addEventListener("click", (event) => remember(el, event));
  });

  return events;
}

function eventsOn(events, el, type = "click") {
  return events.filter((item) => item.el === el && item.type === type);
}

function formsHtml() {
  return `<!DOCTYPE html><html><body>
    <form id="mG61Hd" action="https://docs.google.com/forms/d/e/fixture/formResponse" method="POST">
      <div role="list">
        <div role="listitem" id="q-capital">
          <div role="heading" aria-level="3">
            <span class="M7eMe">Thủ đô của Việt Nam là gì?</span>
            <span aria-label="Câu hỏi bắt buộc">*</span>
          </div>
          <div role="radiogroup">
            <div role="radio" aria-label="Huế" data-value="Huế" aria-checked="false" aria-posinset="2" aria-setsize="4" tabindex="-1"><div class="icon"></div></div>
            <div role="radio" aria-label="Hà Nội" data-value="Hà Nội" aria-checked="false" aria-posinset="1" aria-setsize="4" tabindex="0"><div class="icon"></div></div>
            <div role="radio" aria-label="Thành phố Hồ Chí Minh" data-value="Thành phố Hồ Chí Minh" aria-checked="false" aria-posinset="4" aria-setsize="4" tabindex="-1"><div class="icon"></div></div>
            <div role="radio" aria-label="Đà Nẵng" data-value="Đà Nẵng" aria-checked="false" aria-posinset="3" aria-setsize="4" tabindex="-1"><div class="icon"></div></div>
          </div>
        </div>
        <div role="listitem" id="q-math">
          <div role="heading" aria-level="3">12 x 8 bằng bao nhiêu?</div>
          <div role="radiogroup">
            <div class="row"><div role="radio" aria-checked="false" tabindex="-1"></div><span>86</span></div>
            <div class="row"><div role="radio" aria-checked="false" tabindex="-1"></div><span>96</span></div>
            <div class="row"><div role="radio" aria-checked="false" tabindex="-1"></div><span>88</span></div>
            <div class="row"><div role="radio" aria-checked="false" tabindex="-1"></div><span>108</span></div>
          </div>
        </div>
        <div role="listitem" id="q-water">
          <div role="heading" aria-level="3"><span class="M7eMe">Công thức hóa học của nước là gì?</span></div>
          <div role="radiogroup">
            <div role="radio" aria-label="CO2" data-value="CO2" aria-checked="false" aria-posinset="1" tabindex="0"></div>
            <div role="radio" aria-label="H2O" data-value="H2O" aria-checked="false" aria-posinset="2" tabindex="-1"></div>
            <div role="radio" aria-label="O2" data-value="O2" aria-checked="false" aria-posinset="3" tabindex="-1"></div>
            <div role="radio" aria-label="NaCl" data-value="NaCl" aria-checked="false" aria-posinset="4" tabindex="-1"></div>
          </div>
        </div>
        <div role="listitem" id="q-cat">
          <div role="heading" aria-level="3"><span class="M7eMe">Từ "cat" trong tiếng Anh có nghĩa là gì?</span></div>
          <div role="radiogroup">
            <div role="radio" aria-label="Con chó" data-value="Con chó" aria-checked="false" aria-posinset="1" tabindex="0"></div>
            <div role="radio" aria-label="Con mèo" data-value="Con mèo" aria-checked="false" aria-posinset="2" tabindex="-1"></div>
            <div role="radio" aria-label="Con chim" data-value="Con chim" aria-checked="false" aria-posinset="3" tabindex="-1"></div>
            <div role="radio" aria-label="Con cá" data-value="Con cá" aria-checked="false" aria-posinset="4" tabindex="-1"></div>
          </div>
        </div>
        <div role="listitem" id="q-multi">
          <div role="heading" aria-level="3">Những số nào chia hết cho 3?</div>
          <div role="group">
            <div role="checkbox" aria-label="6" data-answer-value="6" aria-checked="false" aria-posinset="2" tabindex="-1"></div>
            <div role="checkbox" aria-label="3" data-answer-value="3" aria-checked="false" aria-posinset="1" tabindex="0"></div>
            <div role="checkbox" aria-label="4" data-answer-value="4" aria-checked="false" aria-posinset="4" tabindex="-1"></div>
            <div role="checkbox" aria-label="9" data-answer-value="9" aria-checked="false" aria-posinset="3" tabindex="-1"></div>
          </div>
        </div>
        <div role="listitem" id="q-iron">
          <div role="heading" aria-level="3"><span class="M7eMe">Tên của nguyên tố Na là gì?</span></div>
          <input type="text" aria-label="Câu trả lời của bạn" autocomplete="off" />
        </div>
        <div role="listitem" id="q-email">
          <div role="heading" aria-level="3">Email</div>
          <input type="email" autocomplete="email" aria-label="Email" />
        </div>
        <div role="listitem" id="q-name">
          <div role="heading" aria-level="3">Họ và tên</div>
          <input type="text" autocomplete="name" />
        </div>
        <div role="listitem" id="q-phone">
          <div role="heading" aria-level="3">Số điện thoại</div>
          <input type="tel" autocomplete="tel" />
        </div>
        <div role="listitem" id="q-consent">
          <div role="heading" aria-level="3">Tôi đồng ý để được liên hệ</div>
          <textarea aria-label="Câu trả lời của bạn"></textarea>
        </div>
        <div role="listitem" id="q-hidden" hidden>
          <div role="heading" aria-level="3">Câu hỏi ẩn không được tính?</div>
          <div role="radiogroup">
            <div role="radio" aria-label="Ẩn A" aria-checked="false"></div>
            <div role="radio" aria-label="Ẩn B" aria-checked="false"></div>
          </div>
        </div>
      </div>
      <button type="submit">Submit</button>
      <div role="button" aria-label="Next">Next</div>
      <div role="button" aria-label="Tiếp">Tiếp</div>
    </form>
  </body></html>`;
}

function choice(doc, id, role, label) {
  return [...doc.querySelectorAll(`#${id} [role="${role}"]`)].find((el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria === label;
    return (el.parentElement.textContent || "").replace(/\s+/g, " ").trim() === label;
  });
}

test("source does not call a model, submit a form, or replace the message protocol", () => {
  assert.match(contentSource, /__AIA_CONTENT_LOADED__/);
  assert.doesNotMatch(contentSource, /fetch\s*\(/);
  assert.doesNotMatch(contentSource, /groq/i);
  assert.doesNotMatch(contentSource, /\.submit\s*\(/);
  assert.match(contentSource, /case "detect"/);
  assert.match(contentSource, /case "answer"/);
  assert.match(contentSource, /case "clear"/);
});

test("Google Forms fixture finds MCQ, checkbox, and safe text in option order", () => {
  const page = createPage(formsHtml());
  const detected = send(page, { action: "detect" });
  assert.equal(detected.count, 6, JSON.stringify(detected.questions));
  assert.equal(detected.questions.length, 6);
  assert.deepEqual(Object.keys(detected).sort(), ["count", "questions"]);

  const expected = [
    ["q_0", "multiple_choice", "Thủ đô của Việt Nam là gì?", ["Hà Nội", "Huế", "Đà Nẵng", "Thành phố Hồ Chí Minh"]],
    ["q_1", "multiple_choice", "12 x 8 bằng bao nhiêu?", ["86", "96", "88", "108"]],
    ["q_2", "multiple_choice", "Công thức hóa học của nước là gì?", ["CO2", "H2O", "O2", "NaCl"]],
    ["q_3", "multiple_choice", 'Từ "cat" trong tiếng Anh có nghĩa là gì?', ["Con chó", "Con mèo", "Con chim", "Con cá"]],
    ["q_4", "checkbox", "Những số nào chia hết cho 3?", ["3", "6", "9", "4"]],
    ["q_5", "text", "Tên của nguyên tố Na là gì?", null],
  ];

  expected.forEach((row, index) => {
    const question = detected.questions[index];
    assert.deepEqual(Object.keys(question).sort(), ["id", "options", "text", "type"]);
    assert.equal(question.id, row[0]);
    assert.equal(question.type, row[1]);
    assert.equal(question.text, row[2]);
    assert.deepEqual(plain(question.options), row[3]);
  });

  const blob = detected.questions.map((q) => q.text).join("\n");
  assert.doesNotMatch(blob, /email|họ và tên|số điện thoại|đồng ý|ẩn không được tính/i);
  assert.equal(page.document.querySelectorAll("button").length, 1);
  assert.equal(page.document.querySelectorAll("#aia-popup, .aia-fab, [data-aia-ui]").length, 0);

  const capital = page.document.getElementById("q-capital");
  assert.ok(capital.classList.contains("aia-highlight"));
  assert.equal(capital.querySelector(".aia-question-badge").textContent, "q_0");
  assert.equal(capital.querySelector(".aia-question-badge").className, "aia-question-badge");
});

test("answers click the scoped Forms control once and do not submit or advance", () => {
  const page = createPage(formsHtml());
  const events = wireFormsBehavior(page.document);
  const detected = send(page, { action: "detect" });
  assert.equal(events.length, 0);

  const hanoi = choice(page.document, "q-capital", "radio", "Hà Nội");
  const hue = choice(page.document, "q-capital", "radio", "Huế");
  const ninetySix = choice(page.document, "q-math", "radio", "96");
  const eightySix = choice(page.document, "q-math", "radio", "86");
  const water = choice(page.document, "q-water", "radio", "H2O");
  const cat = choice(page.document, "q-cat", "radio", "Con mèo");
  const three = choice(page.document, "q-multi", "checkbox", "3");
  const six = choice(page.document, "q-multi", "checkbox", "6");
  const nine = choice(page.document, "q-multi", "checkbox", "9");
  const four = choice(page.document, "q-multi", "checkbox", "4");
  const submit = page.document.querySelector("button[type='submit']");
  const next = page.document.querySelector("[aria-label='Next']");
  const tiep = page.document.querySelector("[aria-label='Tiếp']");

  const answers = {
    action: "answer",
    answers: [
      { id: "q_0", answer: "A" },
      { id: "q_1", answer: "B" },
      { id: "q_2", answer: "h2o" },
      { id: "q_3", answer: "B" },
      { id: "q_4", answer: "A,C" },
      { id: "q_5", answer: "Natri" },
    ],
  };
  const first = send(page, answers);
  assert.equal(first.ok, true);
  assert.equal(first.applied, 6);
  assert.equal(first.results.every((item) => item.ok), true);

  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(hue.getAttribute("aria-checked"), "false");
  assert.equal(eventsOn(events, hanoi).length, 1);
  assert.equal(eventsOn(events, hue).length, 0);
  assert.equal(eventsOn(events, hanoi, "mousedown").length, 0);
  assert.equal(eventsOn(events, hanoi)[0].target, hanoi);
  assert.notEqual(eventsOn(events, hanoi)[0].target.className, "icon");

  assert.equal(ninetySix.getAttribute("aria-checked"), "true");
  assert.equal(eightySix.getAttribute("aria-checked"), "false");
  assert.equal(eventsOn(events, ninetySix).length, 1);
  assert.equal(eventsOn(events, eightySix).length, 0);
  assert.equal(water.getAttribute("aria-checked"), "true");
  assert.equal(eventsOn(events, water).length, 1);
  assert.equal(cat.getAttribute("aria-checked"), "true");
  assert.equal(eventsOn(events, cat).length, 1);

  assert.equal(three.getAttribute("aria-checked"), "true");
  assert.equal(nine.getAttribute("aria-checked"), "true");
  assert.equal(six.getAttribute("aria-checked"), "false");
  assert.equal(four.getAttribute("aria-checked"), "false");
  assert.equal(eventsOn(events, three).length, 1);
  assert.equal(eventsOn(events, nine).length, 1);
  assert.equal(eventsOn(events, six).length, 0);
  assert.equal(eventsOn(events, four).length, 0);

  assert.equal(page.document.querySelector("#q-iron input").value, "Natri");
  assert.equal(page.document.querySelector("#q-email input").value, "");
  assert.equal(page.document.querySelector("#q-name input").value, "");
  assert.equal(page.document.querySelector("#q-phone input").value, "");
  assert.equal(page.document.querySelector("#q-consent textarea").value, "");
  assert.equal(eventsOn(events, submit).length, 0);
  assert.equal(eventsOn(events, next).length, 0);
  assert.equal(eventsOn(events, tiep).length, 0);
  assert.ok(page.document.getElementById("q-capital").classList.contains("aia-answered"));
  assert.equal(detected.questions[0].options.includes("96"), false);
  assert.equal(detected.questions[1].options.includes("Hà Nội"), false);

  const before = events.length;
  const second = send(page, answers);
  assert.equal(second.ok, true);
  assert.equal(events.length, before);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(three.getAttribute("aria-checked"), "true");
  assert.equal(nine.getAttribute("aria-checked"), "true");
});

test("a checked Forms radio is not clicked again when the answer changes to another option", () => {
  const page = createPage(formsHtml());
  const events = wireFormsBehavior(page.document);
  send(page, { action: "detect" });
  const hanoi = choice(page.document, "q-capital", "radio", "Hà Nội");
  const hue = choice(page.document, "q-capital", "radio", "Huế");
  hanoi.setAttribute("aria-checked", "true");

  const kept = send(page, { action: "answer", answers: [{ id: "q_0", answer: "A" }] });
  assert.equal(kept.ok, true);
  assert.equal(eventsOn(events, hanoi).length, 0);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");

  const moved = send(page, { action: "answer", answers: [{ id: "q_0", answer: "B" }] });
  assert.equal(moved.ok, true);
  assert.equal(eventsOn(events, hanoi).length, 0);
  assert.equal(eventsOn(events, hue).length, 1);
  assert.equal(eventsOn(events, hue)[0].target, hue);
  assert.equal(hue.getAttribute("aria-checked"), "true");
  assert.equal(hanoi.getAttribute("aria-checked"), "false");
});

test("invalid, partial, and unknown answers are not reported as success", () => {
  const page = createPage(formsHtml());
  const events = wireFormsBehavior(page.document);
  send(page, { action: "detect" });
  const hanoi = choice(page.document, "q-capital", "radio", "Hà Nội");
  const water = choice(page.document, "q-water", "radio", "H2O");
  const three = choice(page.document, "q-multi", "checkbox", "3");

  const missing = send(page, { action: "answer" });
  assert.equal(missing.ok, false);
  assert.equal(missing.applied, 0);

  const empty = send(page, { action: "answer", answers: [] });
  assert.equal(empty.ok, false);

  const badLetter = send(page, { action: "answer", answers: [{ id: "q_0", answer: "Z" }] });
  assert.equal(badLetter.ok, false);
  assert.equal(badLetter.results[0].error, "Invalid option");
  assert.equal(eventsOn(events, hanoi).length, 0);
  assert.equal(hanoi.getAttribute("aria-checked"), "false");
  assert.ok(page.document.getElementById("q-capital").classList.contains("aia-highlight"));
  assert.equal(page.document.getElementById("q-capital").classList.contains("aia-answered"), false);

  const multiLetter = send(page, { action: "answer", answers: [{ id: "q_0", answer: "A,B" }] });
  assert.equal(multiLetter.ok, false);
  assert.equal(events.length, 0);

  const badBox = send(page, { action: "answer", answers: [{ id: "q_4", answer: "A,E" }] });
  assert.equal(badBox.ok, false);
  assert.equal(three.getAttribute("aria-checked"), "false");

  const unknown = send(page, { action: "answer", answers: [{ id: "q_99", answer: "A" }] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.results[0].error, "Unknown question");

  const blank = send(page, { action: "answer", answers: [{ id: "q_5", answer: "   " }] });
  assert.equal(blank.ok, false);
  assert.equal(blank.results[0].error, "Invalid answer");

  const before = send(page, { action: "answer" });
  assert.equal(before.ok, false);
  const fresh = createPage(formsHtml());
  assert.equal(send(fresh, { action: "answer", answers: [{ id: "q_0", answer: "A" }] }).ok, false);

  const partial = send(page, {
    action: "answer",
    answers: [
      { id: "q_0", answer: "A" },
      { id: "q_2", answer: "Paris" },
    ],
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.applied, 1);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(water.getAttribute("aria-checked"), "false");
  assert.equal(eventsOn(events, water).length, 0);
  assert.ok(page.document.getElementById("q-capital").classList.contains("aia-answered"));
  assert.ok(page.document.getElementById("q-water").classList.contains("aia-highlight"));
});

test("clear removes highlights and detection state without changing answers", () => {
  const page = createPage(formsHtml());
  const events = wireFormsBehavior(page.document);
  send(page, { action: "detect" });
  send(page, {
    action: "answer",
    answers: [
      { id: "q_0", answer: "A" },
      { id: "q_5", answer: "Natri" },
    ],
  });
  const hanoi = choice(page.document, "q-capital", "radio", "Hà Nội");
  const hue = choice(page.document, "q-capital", "radio", "Huế");
  const input = page.document.querySelector("#q-iron input");
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(input.value, "Natri");

  const cleared = send(page, { action: "clear" });
  assert.deepEqual(plain(cleared), { ok: true });
  assert.equal(page.document.querySelectorAll(".aia-highlight, .aia-answered, .aia-question-badge").length, 0);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(input.value, "Natri");

  const clicksBefore = events.length;
  const after = send(page, { action: "answer", answers: [{ id: "q_0", answer: "B" }] });
  assert.equal(after.ok, false);
  assert.equal(after.results[0].error, "Unknown question");
  assert.equal(events.length, clicksBefore);
  assert.equal(hue.getAttribute("aria-checked"), "false");
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(input.value, "Natri");
});

test("a second content-script injection does not register another listener or double-toggle", () => {
  const html = `<!DOCTYPE html><body>
    <div role="listitem" id="only">
      <div role="heading">Thủ đô của Việt Nam là gì?</div>
      <div role="radiogroup">
        <div role="radio" aria-label="Hà Nội" aria-checked="false" aria-posinset="1" tabindex="0"></div>
        <div role="radio" aria-label="Huế" aria-checked="false" aria-posinset="2" tabindex="-1"></div>
      </div>
    </div>
  </body>`;
  const page = createPage(html);
  assert.equal(page.window.__AIA_CONTENT_LOADED__, true);
  assert.doesNotThrow(() => page.window.eval(contentSource));
  assert.equal(page.listeners.length, 1);

  const events = wireFormsBehavior(page.document);
  const detected = send(page, { action: "detect" });
  assert.equal(detected.count, 1);
  const hanoi = choice(page.document, "only", "radio", "Hà Nội");
  const result = send(page, { action: "answer", answers: [{ id: "q_0", answer: "A" }] });
  assert.equal(result.ok, true);
  assert.equal(eventsOn(events, hanoi).length, 1);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
});

test("radiogroup outside listitem still stays tied to its own heading", () => {
  const html = `<!DOCTYPE html><body>
    <div id="orphan">
      <div role="heading" id="oq">Màu nào là màu của lá?</div>
      <div role="radiogroup" aria-labelledby="oq">
        <div role="radio" aria-label="Đỏ" aria-checked="false" aria-posinset="1"></div>
        <div role="radio" aria-label="Xanh" aria-checked="false" aria-posinset="2"></div>
      </div>
    </div>
  </body>`;
  const page = createPage(html);
  const events = wireFormsBehavior(page.document);
  const detected = send(page, { action: "detect" });
  assert.equal(detected.count, 1);
  assert.equal(detected.questions[0].text, "Màu nào là màu của lá?");
  assert.deepEqual(plain(detected.questions[0].options), ["Đỏ", "Xanh"]);
  const xanh = choice(page.document, "orphan", "radio", "Xanh");
  assert.equal(send(page, { action: "answer", answers: [{ id: "q_0", answer: "B" }] }).ok, true);
  assert.equal(eventsOn(events, xanh).length, 1);
  assert.equal(xanh.getAttribute("aria-checked"), "true");
  assert.equal(choice(page.document, "orphan", "radio", "Đỏ").getAttribute("aria-checked"), "false");
});

test("mixed Forms and native questions stay associated with their own controls", () => {
  const html = `<!DOCTYPE html><body>
    <div role="listitem" id="forms-q">
      <div role="heading">Thủ đô của Việt Nam là gì?</div>
      <div role="radiogroup">
        <div role="radio" aria-label="Hà Nội" aria-checked="false" aria-posinset="1"></div>
        <div role="radio" aria-label="Huế" aria-checked="false" aria-posinset="2"></div>
      </div>
    </div>
    <fieldset id="native-q">
      <legend>What is the capital of France?</legend>
      <label><input type="radio" name="q1" value="london"> London</label>
      <label><input type="radio" name="q1" value="paris"> Paris</label>
    </fieldset>
    <button type="submit">Submit</button>
  </body>`;
  const page = createPage(html, "https://example.com/mixed");
  const events = wireFormsBehavior(page.document);
  const detected = send(page, { action: "detect" });
  assert.deepEqual(plain(detected.questions.map((q) => [q.type, q.text, q.options])), [
    ["multiple_choice", "Thủ đô của Việt Nam là gì?", ["Hà Nội", "Huế"]],
    ["multiple_choice", "What is the capital of France?", ["London", "Paris"]],
  ]);

  const hanoi = choice(page.document, "forms-q", "radio", "Hà Nội");
  const result = send(page, {
    action: "answer",
    answers: [
      { id: "q_0", answer: "A" },
      { id: "q_1", answer: "B" },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(choice(page.document, "forms-q", "radio", "Huế").getAttribute("aria-checked"), "false");
  assert.equal(page.document.querySelector("input[value='paris']").checked, true);
  assert.equal(page.document.querySelector("input[value='london']").checked, false);
  assert.equal(eventsOn(events, hanoi).length, 1);
  assert.equal(eventsOn(events, page.document.querySelector("button")).length, 0);
});

test("native quiz regression still detects and answers every original control", () => {
  const page = createPage(quizHtml, "https://example.com/test-quiz.html");
  const detected = send(page, { action: "detect" });
  assert.equal(detected.count, 6, JSON.stringify(detected.questions, null, 2));
  const byText = Object.fromEntries(detected.questions.map((q) => [q.text, q]));

  assert.equal(byText["What is the capital of France?"].type, "multiple_choice");
  assert.deepEqual(plain(byText["What is the capital of France?"].options), ["London", "Paris", "Berlin", "Madrid"]);
  assert.deepEqual(plain(byText["Which planet is known as the Red Planet?"].options), ["Venus", "Mars", "Jupiter"]);
  assert.equal(byText["Which of these are programming languages? (Select all that apply)"].type, "checkbox");
  assert.deepEqual(plain(byText["Which of these are programming languages? (Select all that apply)"].options), ["Python", "HTML", "Java", "CSS"]);
  assert.equal(byText["What is 2 + 2?"].type, "text");
  assert.equal(byText["What is 2 + 2?"].options, null);
  assert.equal(byText["Which year did World War II end?"].type, "select");
  assert.deepEqual(plain(byText["Which year did World War II end?"].options), ["1943", "1944", "1945", "1946"]);
  assert.equal(byText['What does "HTTP" stand for?'].type, "text");

  const parisClicks = [];
  page.document.querySelector("input[value='paris']").addEventListener("click", () => parisClicks.push(1));
  const bad = send(page, { action: "answer", answers: [{ id: byText["What is the capital of France?"].id, answer: "Z" }] });
  assert.equal(bad.ok, false);
  assert.equal(parisClicks.length, 0);
  assert.equal(page.document.querySelector("input[value='paris']").checked, false);

  const good = send(page, {
    action: "answer",
    answers: [
      { id: byText["What is the capital of France?"].id, answer: "B" },
      { id: byText["Which planet is known as the Red Planet?"].id, answer: "B" },
      { id: byText["Which of these are programming languages? (Select all that apply)"].id, answer: "A,C" },
      { id: byText["What is 2 + 2?"].id, answer: "4" },
      { id: byText["Which year did World War II end?"].id, answer: "C" },
      { id: byText['What does "HTTP" stand for?'].id, answer: "Hypertext Transfer Protocol" },
    ],
  });
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(parisClicks.length, 1);
  assert.equal(page.document.querySelector("input[value='paris']").checked, true);
  assert.equal(page.document.querySelector("input[value='london']").checked, false);
  assert.equal(page.document.querySelector("input[value='mars']").checked, true);
  assert.deepEqual(
    plain([...page.document.querySelectorAll("input[name='q3']")].filter((el) => el.checked).map((el) => el.value)),
    ["python", "java"]
  );
  assert.equal(page.document.getElementById("q4").value, "4");
  assert.equal(page.document.getElementById("q5").value, "1945");
  assert.equal(page.document.getElementById("q6").value, "Hypertext Transfer Protocol");
  assert.ok(page.document.querySelector("input[value='paris']").closest("fieldset").classList.contains("aia-answered"));
});

test("button-choice detection still wins and a numeric text answer is accepted", () => {
  const html = `<!DOCTYPE html><body>
    <div id="quiz">
      <div class="question-text">What is 2 + 2?</div>
      <div class="options-grid">
        <button type="button" role="option">3</button>
        <button type="button" role="option">4</button>
        <button type="button" role="option">5</button>
      </div>
    </div>
    <fieldset>
      <legend>What is the capital of France?</legend>
      <label><input type="radio" name="q1" value="london"> London</label>
      <label><input type="radio" name="q1" value="paris"> Paris</label>
    </fieldset>
    <div role="listitem" id="num">
      <div role="heading">12 x 8 bằng bao nhiêu?</div>
      <input type="text" aria-label="Câu trả lời của bạn" autocomplete="off" />
    </div>
  </body>`;
  const page = createPage(html, "https://example.com/buttons");
  const detected = send(page, { action: "detect" });
  assert.equal(detected.count, 1);
  assert.equal(detected.questions[0].type, "button_choice");
  assert.deepEqual(plain(detected.questions[0].options), ["3", "4", "5"]);
  assert.equal(detected.questions[0].text, "What is 2 + 2?");

  const buttons = [...page.document.querySelectorAll("button[role='option']")];
  const clicks = [0, 0, 0];
  buttons.forEach((button, index) => button.addEventListener("click", () => { clicks[index] += 1; }));
  const bad = send(page, { action: "answer", answers: [{ id: "q_0", answer: "Z" }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(clicks, [0, 0, 0]);
  const good = send(page, { action: "answer", answers: [{ id: "q_0", answer: "B" }] });
  assert.equal(good.ok, true);
  assert.deepEqual(clicks, [0, 1, 0]);
  assert.equal(page.document.querySelector("input[value='paris']").checked, false);

  const textPage = createPage(`<!DOCTYPE html><body>
    <div role="listitem">
      <div role="heading">12 x 8 bằng bao nhiêu?</div>
      <input id="product" type="text" autocomplete="off" />
    </div>
  </body>`);
  const textDetected = send(textPage, { action: "detect" });
  assert.equal(textDetected.count, 1);
  assert.equal(textDetected.questions[0].type, "text");
  const numeric = send(textPage, { action: "answer", answers: [{ id: "q_0", answer: 96 }] });
  assert.equal(numeric.ok, true);
  assert.equal(textPage.document.getElementById("product").value, "96");
});
