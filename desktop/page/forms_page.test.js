"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "forms_page.js"), "utf8");

function boot(html) {
  const dom = new JSDOM(html, { url: "https://docs.google.com/forms/d/e/fixture/viewform", runScripts: "dangerously" });
  dom.window.eval("var CSS = { escape(value) { return String(value); } };");
  dom.window.eval(source);
  return dom;
}

const html = `<!DOCTYPE html><body>
  <form action="https://docs.google.com/forms/d/e/fixture/formResponse">
    <div role="list">
      <div role="listitem" id="q">
        <div role="heading">Thu do cua Viet Nam la gi?</div>
        <div role="radiogroup">
          <div role="radio" aria-label="Hue" aria-checked="false" aria-posinset="2"></div>
          <div role="radio" aria-label="Ha Noi" aria-checked="false" aria-posinset="1"></div>
        </div>
      </div>
      <div role="listitem" id="mail">
        <div role="heading">Email</div>
        <input type="email" autocomplete="email" />
      </div>
    </div>
    <button type="submit" id="submit">Gui</button>
    <div role="button" id="next" aria-label="Tiep">Tiep</div>
  </form>
</body>`;

test("desktop page script detects a form, fills once, and never submits", () => {
  const dom = boot(html);
  const api = dom.window.__AIA_DESKTOP_API__;
  assert.ok(api);
  const before = dom.window.document.body.innerHTML;
  const detected = api.detect();
  assert.equal(dom.window.document.body.innerHTML, before);
  assert.equal(detected.count, 1);
  assert.equal(detected.questions[0].type, "multiple_choice");
  assert.equal(JSON.stringify(detected.questions[0].options), JSON.stringify(["Ha Noi", "Hue"]));

  const clicks = { radio: 0, submit: 0, next: 0 };
  const hanoi = [...dom.window.document.querySelectorAll("[role='radio']")].find((el) => el.getAttribute("aria-label") === "Ha Noi");
  hanoi.addEventListener("click", () => {
    clicks.radio += 1;
    hanoi.setAttribute("aria-checked", hanoi.getAttribute("aria-checked") === "true" ? "false" : "true");
  });
  dom.window.document.getElementById("submit").addEventListener("click", () => { clicks.submit += 1; });
  dom.window.document.getElementById("next").addEventListener("click", () => { clicks.next += 1; });

  const filled = api.answer({ answers: [{ id: "q_0", answer: "A" }] });
  assert.equal(filled.ok, true);
  assert.equal(clicks.radio, 1);
  assert.equal(clicks.submit, 0);
  assert.equal(clicks.next, 0);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  assert.equal(dom.window.document.querySelector("[type='email']").value, "");

  const htmlBeforeClear = dom.window.document.body.innerHTML;
  assert.equal(JSON.stringify(api.clear()), JSON.stringify({ ok: true }));
  assert.equal(dom.window.document.body.innerHTML, htmlBeforeClear);
  assert.equal(hanoi.getAttribute("aria-checked"), "true");
  const again = api.answer({ answers: [{ id: "q_0", answer: "B" }] });
  assert.equal(again.ok, false);
});
