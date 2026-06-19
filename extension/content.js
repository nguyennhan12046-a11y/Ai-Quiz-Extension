(() => {
  "use strict";

  if (typeof CSS === "undefined" || !CSS.escape) {
    CSS.escape = function (value) {
      const str = String(value);
      let result = "";
      for (let i = 0; i < str.length; i++) {
        const ch = str.charAt(i);
        const cp = str.codePointAt(i);
        if (
          (cp >= 0x0001 && cp <= 0x001f) ||
          cp === 0x007f ||
          (cp >= 0x0030 && cp <= 0x0039 && (i === 0 || (i === 1 && str.charAt(0) === "-")))
        ) {
          result += "\\" + cp.toString(16) + " ";
          if (cp > 0xffff) i++;
          continue;
        }
        if (
          cp >= 0x0080 || cp === 0x002d || cp === 0x005f ||
          (cp >= 0x0030 && cp <= 0x0039) ||
          (cp >= 0x0041 && cp <= 0x005a) ||
          (cp >= 0x0061 && cp <= 0x007a)
        ) {
          result += ch;
          continue;
        }
        result += "\\" + ch;
      }
      return result;
    };
  }

  const LOG_PREFIX = "[AIA]";

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  const QUESTION_WORDS = /\b(what|which|when|where|who|whom|whose|why|how|is|are|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|select|choose|pick|identify|determine|calculate|compute|find|solve|evaluate|explain|describe|define|list|name|state|true|false|correct|following)\b/i;

  let detectedBlocks = [];

  function isQuestionText(text) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length < 5 || cleaned.length > 2000) return false;
    if (QUESTION_WORDS.test(cleaned)) return true;
    if (cleaned.endsWith("?")) return true;
    if (/^\d+[.)]\s/.test(cleaned)) return true;
    return false;
  }

  function getVisibleText(el) {
    if (!el || !el.textContent) return "";
    return el.textContent.replace(/\s+/g, " ").trim();
  }

  function findLabelForInput(input) {
    const id = input.id;
    if (id) {
      const escaped = CSS.escape(id);
      const label = document.querySelector(`label[for="${escaped}"]`);
      if (label) return getVisibleText(label);
    }
    let parent = input.closest("label");
    if (parent) return getVisibleText(parent);
    parent = input.parentElement;
    if (parent) {
      const prevLabel = parent.previousElementSibling;
      if (prevLabel && prevLabel.tagName === "LABEL") return getVisibleText(prevLabel);
    }
    return "";
  }

  function getCommonAncestor(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0];
    const paths = elements.map((el) => {
      const path = [];
      let cur = el;
      while (cur) {
        path.unshift(cur);
        cur = cur.parentElement;
      }
      return path;
    });
    let ancestor = null;
    const minLen = Math.min(...paths.map((p) => p.length));
    for (let i = 0; i < minLen; i++) {
      const tag = paths[0][i];
      if (paths.every((p) => p[i] === tag)) ancestor = tag;
      else break;
    }
    return ancestor;
  }

  // ─── QUESTION TEXT DISCOVERY (walks up from ancestor) ───

  const QUESTION_SELECTORS = [
    '[data-testid*="question"]',
    '[data-cy*="question"]',
    '[data-cy*="text-container"]',
    '[id*="question"]',
    '[id*="Question"]',
    '.question-text-color',
    '.question-text',
    '.resizeable-text .text-container .question-text-color',
    'legend', 'label', 'p',
  ];

  function findQuestionTextNearInputs(inputs, ancestor) {
    let container = ancestor;
    while (container && container !== document.body) {
      for (const sel of QUESTION_SELECTORS) {
        const matches = container.querySelectorAll(sel);
        for (const el of matches) {
          const text = getVisibleText(el);
          if (isQuestionText(text)) return { element: el, text };
        }
      }
      const ownText = (container.childNodes[0]?.textContent || "").replace(/\s+/g, " ").trim();
      if (isQuestionText(ownText) && !container.querySelector("input, select, textarea, button[role='option']")) {
        return { element: container, text: ownText };
      }
      container = container.parentElement;
    }
    return { element: ancestor, text: "" };
  }

  // ─── BUTTON-BASED QUIZ DETECTION (Quizizz, Kahoot, etc.) ───

  function detectButtonBasedQuestions() {
    const blocks = [];
    const seen = new Set();

    const optionButtons = document.querySelectorAll('button[role="option"], [role="option"][data-cy^="option-"], .option.is-selectable.is-mcq, button[data-cy^="option-"]');
    log("Button-based: raw option elements found:", optionButtons.length);

    if (optionButtons.length < 2) return blocks;

    const containerCandidates = [];

    const testContainers = [
      '.options-grid',
      '[class*="options-grid"]',
      '[class*="options"]',
    ];

    for (const sel of testContainers) {
      document.querySelectorAll(sel).forEach((grid) => {
        const btns = grid.querySelectorAll('button[role="option"], [role="option"]');
        if (btns.length >= 2 && !containerCandidates.includes(grid)) {
          containerCandidates.push({ container: grid, buttons: Array.from(btns) });
        }
      });
    }

    if (containerCandidates.length === 0) {
      const ancestor = getCommonAncestor([...optionButtons]);
      if (ancestor) {
        containerCandidates.push({ container: ancestor, buttons: [...optionButtons] });
      }
    }

    log("Button-based: container candidates:", containerCandidates.length);

    for (const { container, buttons } of containerCandidates) {
      if (seen.has(container)) continue;

      const options = buttons.map((btn) => getVisibleText(btn)).filter(Boolean);
      log(`Button-based: container`, container.tagName, container.className?.slice(0, 60), "buttons:", buttons.length, "options:", options);

      if (options.length < 2) continue;

      const { text, element: textEl } = findQuestionTextNearInputs(buttons, container);
      const fallback = getVisibleText(container);
      log(`Button-based: question text:`, JSON.stringify(text), "fallback:", JSON.stringify(fallback).slice(0, 80));

      if (!text && !isQuestionText(fallback)) {
        log("Button-based: no question text found, trying broader search");

        let found = false;
        let walker = container.parentElement;
        while (walker && walker !== document.body) {
          for (const sel of QUESTION_SELECTORS) {
            const matches = walker.querySelectorAll(sel);
            for (const el of matches) {
              const t = getVisibleText(el);
              if (isQuestionText(t)) {
                blocks.push({
                  id: `q_${blocks.length}`,
                  type: "button_choice",
                  text: t,
                  options,
                  element: container,
                  inputs: buttons,
                });
                seen.add(container);
                found = true;
                log(`  + Added block ${blocks.length - 1} (button_choice via broader search)`);
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
          walker = walker.parentElement;
        }

        if (!found) continue;
      } else {
        blocks.push({
          id: `q_${blocks.length}`,
          type: "button_choice",
          text: text || fallback,
          options,
          element: container,
          inputs: buttons,
        });
        seen.add(container);
        log(`  + Added block ${blocks.length - 1} (button_choice)`);
      }
    }

    return blocks;
  }

  // ─── NATIVE FORM ELEMENT DETECTION ───

  function detectFormBasedQuestions() {
    const blocks = [];
    const seen = new Set();

    const allRadios = document.querySelectorAll('input[type="radio"]');
    log("Native: raw radios found:", allRadios.length);

    const radioGroups = new Map();
    allRadios.forEach((radio) => {
      const name = radio.name || radio.id || `radio_${Math.random()}`;
      if (!radioGroups.has(name)) radioGroups.set(name, []);
      radioGroups.get(name).push(radio);
    });

    for (const [name, radios] of radioGroups) {
      if (radios.length < 2) {
        log(`Native: skipping radio group "${name}" — only ${radios.length} radio(s)`);
        continue;
      }
      const ancestor = getCommonAncestor(radios);
      if (!ancestor || seen.has(ancestor)) continue;

      const { text } = findQuestionTextNearInputs(radios, ancestor);
      const firstLabel = findLabelForInput(radios[0]);
      const combinedText = text || firstLabel;
      const fallbackText = getVisibleText(ancestor);

      if (!combinedText && !isQuestionText(fallbackText)) continue;

      const options = radios.map((r) => findLabelForInput(r) || r.value || r.name).filter(Boolean);

      blocks.push({
        id: `q_${blocks.length}`,
        type: "multiple_choice",
        text: combinedText || fallbackText,
        options,
        element: ancestor,
        inputs: radios,
      });
      seen.add(ancestor);
      log(`Native: + radio block "${name}" options:`, options);
    }

    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
    log("Native: raw checkboxes found:", allCheckboxes.length);

    const checkboxGroups = new Map();
    allCheckboxes.forEach((cb) => {
      const name = cb.name || `cb_${Math.random()}`;
      if (!checkboxGroups.has(name)) checkboxGroups.set(name, []);
      checkboxGroups.get(name).push(cb);
    });

    for (const [name, checkboxes] of checkboxGroups) {
      if (checkboxes.length < 2) continue;
      const ancestor = getCommonAncestor(checkboxes);
      if (!ancestor || seen.has(ancestor)) continue;

      const { text } = findQuestionTextNearInputs(checkboxes, ancestor);
      const fallbackText = getVisibleText(ancestor);
      if (!text && !isQuestionText(fallbackText)) continue;

      const options = checkboxes.map((c) => findLabelForInput(c) || c.value || c.name).filter(Boolean);

      blocks.push({
        id: `q_${blocks.length}`,
        type: "checkbox",
        text: text || fallbackText,
        options,
        element: ancestor,
        inputs: checkboxes,
      });
      seen.add(ancestor);
    }

    const allSelects = document.querySelectorAll("select");
    allSelects.forEach((sel) => {
      if (seen.has(sel)) return;
      const label = findLabelForInput(sel);
      const parentText = getVisibleText(sel.closest("label") || sel.parentElement || {});
      if (!label && !isQuestionText(parentText)) return;

      const options = [];
      sel.querySelectorAll("option").forEach((opt) => {
        if (opt.value && opt.textContent.trim()) options.push(opt.textContent.trim());
      });

      if (options.length >= 2) {
        blocks.push({
          id: `q_${blocks.length}`,
          type: "select",
          text: label || getVisibleText(sel.closest("div") || sel.parentElement),
          options,
          element: sel.closest("div") || sel.parentElement,
          inputs: [sel],
        });
        seen.add(sel);
      }
    });

    const textInputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
    log("Native: raw text inputs found:", textInputs.length);

    textInputs.forEach((input) => {
      if (seen.has(input)) return;
      const label = findLabelForInput(input);
      if (!isQuestionText(label)) return;

      const container = input.closest("div") || input.parentElement;
      blocks.push({
        id: `q_${blocks.length}`,
        type: "text",
        text: label,
        options: null,
        element: container,
        inputs: [input],
      });
      seen.add(input);
    });

    return blocks;
  }

  function detectQuestionBlocks() {
    log("=== Starting detection ===");

    const btnBlocks = detectButtonBasedQuestions();
    if (btnBlocks.length > 0) {
      log(`Button-based detection found ${btnBlocks.length} block(s)`);
      return btnBlocks;
    }

    const formBlocks = detectFormBasedQuestions();
    log(`Form-based detection found ${formBlocks.length} block(s)`);
    return formBlocks;
  }

  // ─── HIGHLIGHT / ANSWER INJECTION ───

  function highlightBlocks(blocks) {
    blocks.forEach((block) => {
      const el = block.element;
      el.classList.add("aia-highlight");
      el.style.position = el.style.position || "relative";
      if (!el.querySelector(".aia-question-badge")) {
        const badge = document.createElement("span");
        badge.className = "aia-question-badge";
        badge.textContent = block.id;
        el.appendChild(badge);
      }
    });
  }

  function clearHighlights() {
    document.querySelectorAll(".aia-highlight, .aia-answered").forEach((el) => {
      el.classList.remove("aia-highlight", "aia-answered");
    });
    document.querySelectorAll(".aia-question-badge").forEach((b) => b.remove());
  }

  function markAnswered(block) {
    block.element.classList.remove("aia-highlight");
    block.element.classList.add("aia-answered");
  }

  function injectAnswer(block, answerText) {
    const answer = answerText.trim().toUpperCase();
    log(`  Injecting: ${block.id} (${block.type}) <- "${answerText}"`);

    switch (block.type) {
      case "button_choice":
      case "multiple_choice": {
        const targetIndex = answer.charCodeAt(0) - 65;
        if (targetIndex >= 0 && targetIndex < block.inputs.length) {
          const el = block.inputs[targetIndex];
          el.focus();
          el.click();
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));

          if (el.tagName === "INPUT" && el.type === "radio") {
            el.checked = true;
          }

          log(`  -> Clicked [${targetIndex}]:`, el.tagName, el.className?.slice(0, 40));
        } else {
          log(`  -> Invalid index ${targetIndex} (answer="${answer}")`);
        }
        break;
      }
      case "checkbox": {
        const letters = answer.match(/[A-Z]/g) || [];
        block.inputs.forEach((cb, i) => {
          const shouldCheck = letters.some((l) => l.charCodeAt(0) - 65 === i);
          if (shouldCheck && !cb.checked) {
            cb.click();
            cb.checked = true;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (!shouldCheck && cb.checked) {
            cb.click();
            cb.checked = false;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        break;
      }
      case "select": {
        const select = block.inputs[0];
        const targetIndex = answer.charCodeAt(0) - 65;
        if (targetIndex >= 0 && targetIndex < select.options.length) {
          select.selectedIndex = targetIndex + 1;
          select.value = select.options[targetIndex + 1]?.value || select.options[targetIndex]?.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        break;
      }
      case "text": {
        const input = block.inputs[0];
        const valSetter = Object.getOwnPropertyDescriptor(
          input.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype,
          "value"
        ).set;
        valSetter.call(input, answerText.trim());
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }

    markAnswered(block);
  }

  log("Content script loaded on", window.location.href);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    log("Message received:", msg.action);

    switch (msg.action) {
      case "detect": {
        clearHighlights();
        try {
          detectedBlocks = detectQuestionBlocks();
        } catch (err) {
          log("ERROR in detectQuestionBlocks:", err.message, err.stack);
          detectedBlocks = [];
        }
        highlightBlocks(detectedBlocks);

        const payload = detectedBlocks.map((b) => ({
          id: b.id,
          type: b.type,
          text: b.text,
          options: b.options,
        }));

        sendResponse({ count: detectedBlocks.length, questions: payload });
        break;
      }
      case "answer": {
        const { answers } = msg;
        log(`Answering ${answers.length} question(s)`);
        try {
          for (const ans of answers) {
            const block = detectedBlocks.find((b) => b.id === ans.id);
            if (block) {
              injectAnswer(block, ans.answer);
            } else {
              log(`  No block found for answer id: ${ans.id}`);
            }
          }
        } catch (err) {
          log("ERROR injecting answers:", err.message);
        }
        sendResponse({ ok: true });
        break;
      }
      case "clear": {
        clearHighlights();
        detectedBlocks = [];
        sendResponse({ ok: true });
        break;
      }
    }
  });
})();
