(() => {
  "use strict";

  if (globalThis.__AIA_DESKTOP_LOADED__) return;

  if (typeof globalThis.CSS === "undefined" || !globalThis.CSS.escape) {
    globalThis.CSS = globalThis.CSS || {};
    globalThis.CSS.escape = function (value) {
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
    '.hackdown-content p',
    '.challenge_problem_statement_body p',
    '.question-title',
    '.challenge_problem_statement',
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

  // ─── CUSTOM DIV-BASED CHOICE DETECTION (HackerRank, etc.) ───

  function detectCustomChoiceItems() {
    const blocks = [];
    const seen = new Set();

    const choiceSelectors = [
      '.choice-item i.answer-icon',
      '.choice-item',
      '[data-analytics="McqChallengeOption"]',
    ];

    let choiceClickables = [];
    for (const sel of choiceSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length >= 2) {
        choiceClickables = Array.from(els).map((el) =>
          el.classList.contains("answer-icon") ? el.parentElement : el
        );
        log(`Custom choice: found ${els.length} elements via "${sel}"`);
        break;
      }
    }

    if (choiceClickables.length < 2) return blocks;

    const containerSelectors = [
      '.choices-container',
      '.choices-wrapper',
      '[class*="choices"]',
    ];

    let container = null;
    for (const sel of containerSelectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    if (!container) {
      container = getCommonAncestor(choiceClickables);
    }

    if (!container || seen.has(container)) return blocks;

    const options = choiceClickables.map((item) => {
      const label = item.querySelector(".choice-label, .ui-icon-label");
      return getVisibleText(label || item);
    }).filter(Boolean);

    log(`Custom choice: container`, container.tagName, container.className?.slice(0, 60), "options:", options);

    if (options.length < 2) return blocks;

    const { text } = findQuestionTextNearInputs(choiceClickables, container);
    const fallback = getVisibleText(container);

    if (!text && !isQuestionText(fallback)) {
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
                inputs: choiceClickables,
              });
              seen.add(container);
              found = true;
              log(`  + Added block ${blocks.length - 1} (custom via broader search):`, JSON.stringify(t).slice(0, 80));
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
        walker = walker.parentElement;
      }
      if (!found) return blocks;
    } else {
      blocks.push({
        id: `q_${blocks.length}`,
        type: "button_choice",
        text: text || fallback,
        options,
        element: container,
        inputs: choiceClickables,
      });
      seen.add(container);
      log(`  + Added block ${blocks.length - 1} (custom choice):`, JSON.stringify(text || fallback).slice(0, 80));
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

  // ─── GOOGLE FORMS ARIA CHOICES ───
  // Forms renders options as role="radio" / role="checkbox" inside each question,
  // not as <input>. Order follows aria-posinset when every option has one.

  const SENSITIVE_PROMPT = /(?:^|[^a-z0-9])e-?mails?\b|email address|địa chỉ email|thư điện tử|họ(?:\s+và)?\s+tên|\bfull name\b|\b(?:first|last|given|family)\s+name\b|\byour name\b|tên của bạn|tên đầy đủ|\b(?:phone|telephone|mobile)(?:\s+number)?\b|số điện thoại|điện thoại|contact (?:info|information|number|details)|thông tin liên hệ|(?:home|street|mailing)\s+address|địa chỉ liên hệ|địa chỉ nhà|\bconsent\b|\bi agree\b|tôi đồng ý|đồng ý|chấp thuận/;
  const SENSITIVE_AUTOCOMPLETE = /(?:^|[\s-])(email|name|given-name|family-name|additional-name|nickname|username|tel|tel-national|tel-country-code|street-address|address-line1|address-line2|postal-code|bday|bday-day|bday-month|bday-year)(?:$|[\s-])/;
  const NAV_LABELS = new Set([
    "submit", "next", "back", "previous", "prev", "send", "continue",
    "gửi", "gửi biểu mẫu", "nộp", "nộp bài", "tiếp", "tiếp theo", "quay lại", "trước", "sau",
  ]);

  function normText(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function fold(value) {
    return normText(value).normalize("NFC").toLowerCase();
  }

  function isSensitivePrompt(text) {
    return SENSITIVE_PROMPT.test(fold(text));
  }

  function ownedByRoot(el, root) {
    if (!el || !root || !root.contains(el)) return false;
    if (root.getAttribute("role") === "listitem") return el.closest('[role="listitem"]') === root;
    const item = el.closest('[role="listitem"]');
    return !item || root.contains(item);
  }

  function isInHiddenTree(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.hidden) return true;
      if (node.getAttribute("aria-hidden") === "true") return true;
      if ((node.getAttribute("type") || "").toLowerCase() === "hidden") return true;
      node = node.parentElement;
    }
    return false;
  }

  function isChoiceCandidate(el, root) {
    if (!ownedByRoot(el, root)) return false;
    if (isInHiddenTree(el)) return false;
    if (el.closest('[role="menu"], [role="menubar"], [role="navigation"], [role="listbox"]')) return false;
    return true;
  }

  function sortByPosinset(elements) {
    const allNumbered = elements.every((el) => {
      if (!el.hasAttribute("aria-posinset")) return false;
      return Number.isFinite(Number(el.getAttribute("aria-posinset")));
    });
    if (!allNumbered) return elements.slice();
    return elements
      .map((el, index) => ({ el, index, pos: Number(el.getAttribute("aria-posinset")) }))
      .sort((a, b) => a.pos - b.pos || a.index - b.index)
      .map((item) => item.el);
  }

  function cleanQuestionText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("[role='radio'], [role='checkbox'], [role='radiogroup'], input, textarea, select, button").forEach((node) => node.remove());
    [...clone.querySelectorAll("*")].forEach((node) => {
      const lab = node.getAttribute("aria-label") || "";
      const visible = normText(node.textContent || "");
      if (/required|bắt buộc|bat buoc/.test(fold(lab)) && visible.length <= 2) node.remove();
      else if (visible === "*" && node.children.length === 0) node.remove();
    });
    return normText(clone.textContent || "").replace(/\s*\*\s*$/, "").trim();
  }

  function textFromIds(doc, idref) {
    if (!doc || !idref) return "";
    const parts = idref.split(/\s+/).map((id) => {
      const el = doc.getElementById(id);
      return el ? cleanQuestionText(el) : "";
    }).filter(Boolean);
    return normText(parts.join(" "));
  }

  function readHeading(root) {
    const headings = [...root.querySelectorAll('[role="heading"]')].filter((heading) => {
      if (heading.closest("[role='radio'], [role='checkbox']")) return false;
      if (root.getAttribute("role") === "listitem") return heading.closest('[role="listitem"]') === root;
      const item = heading.closest('[role="listitem"]');
      return !item || root.contains(item);
    });
    if (headings[0]) return cleanQuestionText(headings[0]);

    const title = [...root.querySelectorAll(".M7eMe")].find((el) => {
      if (el.closest("[role='radio'], [role='checkbox']")) return false;
      if (root.getAttribute("role") === "listitem") return el.closest('[role="listitem"]') === root;
      return true;
    });
    if (title) return cleanQuestionText(title);

    const group = [...root.querySelectorAll('[role="radiogroup"], [role="group"]')].find((el) => ownedByRoot(el, root));
    if (group) {
      const labelled = textFromIds(group.ownerDocument, group.getAttribute("aria-labelledby"));
      if (labelled) return labelled;
      const aria = normText(group.getAttribute("aria-label") || "");
      if (aria) return aria.replace(/\s*\*\s*$/, "").trim();
    }
    return "";
  }

  function rowOptionText(el) {
    const parent = el.parentElement;
    if (!parent) return "";
    const choices = parent.querySelectorAll("[role='radio'], [role='checkbox']");
    if (choices.length > 1) {
      const next = el.nextElementSibling;
      if (!next) return "";
      const role = next.getAttribute("role") || "";
      if (role === "radio" || role === "checkbox") return "";
      return getVisibleText(next);
    }
    const clone = parent.cloneNode(true);
    clone.querySelectorAll("[role='radio'], [role='checkbox'], input, textarea, select, button").forEach((node) => node.remove());
    return getVisibleText(clone);
  }

  function optionLabel(el) {
    const doc = el.ownerDocument;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const nodes = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean);
      const text = nodes
        .filter((node) => node.getAttribute("role") !== "heading" && !node.contains(el))
        .map((node) => getVisibleText(node))
        .filter(Boolean)
        .join(" ");
      if (normText(text)) return normText(text);
    }
    const aria = normText(el.getAttribute("aria-label") || "");
    if (aria) return aria;
    const data = normText(el.getAttribute("data-value") || el.getAttribute("data-answer-value") || "");
    if (data) return data;
    const own = getVisibleText(el);
    if (own) return own;
    return normText(rowOptionText(el));
  }

  function formsQuestionRoots(doc) {
    const roots = [];
    const seen = new Set();
    doc.querySelectorAll('[role="listitem"]').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      roots.push(el);
    });
    doc.querySelectorAll('[role="radiogroup"], [role="group"]').forEach((group) => {
      if (group.closest('[role="listitem"]')) return;
      let root = group.closest("[data-params]") || group.parentElement || group;
      if (!root || root === doc.body || root === doc.documentElement) root = group;
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    });
    return roots;
  }

  function radiosInRoot(root) {
    const groups = [...root.querySelectorAll('[role="radiogroup"]')].filter((group) => ownedByRoot(group, root));
    if (groups.length) {
      return groups
        .map((group) => sortByPosinset([...group.querySelectorAll('[role="radio"]')].filter((el) => isChoiceCandidate(el, root))))
        .filter((radios) => radios.length >= 2);
    }
    const radios = sortByPosinset([...root.querySelectorAll('[role="radio"]')].filter((el) => isChoiceCandidate(el, root)));
    return radios.length >= 2 ? [radios] : [];
  }

  function checkboxesInRoot(root) {
    return sortByPosinset([...root.querySelectorAll('[role="checkbox"]')].filter((el) => isChoiceCandidate(el, root)));
  }

  function isSensitiveField(input, questionText) {
    const type = (input.getAttribute("type") || "").toLowerCase();
    if (type === "email" || type === "tel" || type === "password") return true;
    const inputMode = (input.getAttribute("inputmode") || "").toLowerCase();
    if (inputMode === "email" || inputMode === "tel") return true;
    const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
    if (SENSITIVE_AUTOCOMPLETE.test(autocomplete)) return true;
    const blob = [questionText, input.getAttribute("aria-label"), input.getAttribute("name"), input.getAttribute("placeholder"), input.id]
      .filter(Boolean)
      .join(" ");
    return isSensitivePrompt(blob);
  }

  function safeTextInput(root, questionText) {
    const question = normText(questionText);
    if (question.length < 2 || isSensitivePrompt(question)) return null;
    const inputs = [...root.querySelectorAll("input, textarea")];
    for (const input of inputs) {
      if (!ownedByRoot(input, root)) continue;
      if (isInHiddenTree(input)) continue;
      if (input.closest("[role='radio'], [role='checkbox'], [role='listbox']")) continue;
      if (input.disabled || input.readOnly) continue;
      const type = (input.getAttribute("type") || "").toLowerCase();
      const textual = input.tagName === "TEXTAREA" || type === "" || type === "text" || type === "number";
      if (!textual) continue;
      if (isSensitiveField(input, question)) continue;
      return input;
    }
    return null;
  }

  function buildChoiceBlock(root, elements, type, questionText) {
    const question = normText(questionText);
    if (question.length < 2) return null;
    const pairs = [];
    for (const el of elements) {
      const label = normText(optionLabel(el));
      if (!label) continue;
      pairs.push({ el, label });
    }
    if (pairs.length < 2) return null;
    return {
      id: "q_0",
      type,
      text: question,
      options: pairs.map((pair) => pair.label),
      element: root,
      inputs: pairs.map((pair) => pair.el),
    };
  }

  function detectGoogleFormsQuestions() {
    const blocks = [];
    for (const root of formsQuestionRoots(document)) {
      if (isInHiddenTree(root)) continue;
      const questionText = readHeading(root);
      const radioGroups = radiosInRoot(root);
      if (radioGroups.length) {
        for (const radios of radioGroups) {
          const block = buildChoiceBlock(root, radios, "multiple_choice", questionText);
          if (!block) continue;
          blocks.push(block);
          log(`Forms: + multiple_choice "${block.text}" options:`, block.options);
        }
        continue;
      }
      const checks = checkboxesInRoot(root);
      if (checks.length >= 2) {
        const block = buildChoiceBlock(root, checks, "checkbox", questionText);
        if (!block) continue;
        blocks.push(block);
        log(`Forms: + checkbox "${block.text}" options:`, block.options);
        continue;
      }
      const input = safeTextInput(root, questionText);
      if (!input) continue;
      blocks.push({
        id: "q_0",
        type: "text",
        text: normText(questionText),
        options: null,
        element: root,
        inputs: [input],
      });
      log(`Forms: + text "${normText(questionText)}"`);
    }
    return blocks;
  }

  function assignIds(blocks) {
    blocks.forEach((block, index) => {
      block.id = `q_${index}`;
    });
    return blocks;
  }

  function blockOverlaps(block, formsBlocks) {
    if (!block || !block.inputs) return false;
    return block.inputs.some((input) => formsBlocks.some((formsBlock) => {
      if (formsBlock.inputs.includes(input)) return true;
      return !!(formsBlock.element && formsBlock.element.contains && formsBlock.element.contains(input));
    }));
  }

  function detectQuestionBlocks() {
    log("=== Starting detection ===");

    const btnBlocks = detectButtonBasedQuestions();
    if (btnBlocks.length > 0) {
      log(`Button-based detection found ${btnBlocks.length} block(s)`);
      return assignIds(btnBlocks);
    }

    const customBlocks = detectCustomChoiceItems();
    if (customBlocks.length > 0) {
      log(`Custom choice detection found ${customBlocks.length} block(s)`);
      return assignIds(customBlocks);
    }

    const formsBlocks = detectGoogleFormsQuestions();
    log(`Google Forms detection found ${formsBlocks.length} block(s)`);

    const nativeBlocks = detectFormBasedQuestions().filter((block) => !blockOverlaps(block, formsBlocks));
    log(`Form-based detection found ${nativeBlocks.length} block(s)`);
    return assignIds(formsBlocks.concat(nativeBlocks));
  }

  // Answers are written only into the form controls. Nothing is drawn on the page.

  function isAriaWidget(el, role) {
    return !!el && el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.getAttribute && el.getAttribute("role") === role;
  }

  function ariaOn(el) {
    return fold(el.getAttribute("aria-checked") || "") === "true";
  }

  function isNavLabel(value) {
    return NAV_LABELS.has(fold(value));
  }

  function isForbiddenControl(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if ((node.getAttribute("type") || "").toLowerCase() === "submit") return true;
      const role = (node.getAttribute("role") || "").toLowerCase();
      if (node.tagName === "BUTTON" || role === "button") {
        const label = node.getAttribute("aria-label") || getVisibleText(node);
        if (isNavLabel(label)) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function clickOnce(el) {
    if (!el || isForbiddenControl(el)) return false;
    el.click();
    return true;
  }

  function resolveSingleIndex(block, answerText) {
    const options = block.options || [];
    const raw = normText(answerText);
    if (!raw || !options.length) return null;
    const key = fold(raw);
    const matches = [];
    options.forEach((opt, index) => {
      if (fold(opt) === key) matches.push(index);
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
    const letter = raw.match(/^([A-Za-z])(?:[.)])?$/);
    if (!letter) return null;
    const index = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (index < 0 || index >= options.length) return null;
    return index;
  }

  function resolveCheckboxIndexes(block, answerText) {
    const options = block.options || [];
    const raw = normText(answerText);
    if (!raw || !options.length) return null;

    const pieces = raw.split(/\s*[,;/|]\s*/).map((part) => part.trim()).filter(Boolean);
    if (pieces.length) {
      const indexes = [];
      let allMatch = true;
      for (const piece of pieces) {
        const index = options.findIndex((opt) => fold(opt) === fold(piece));
        if (index < 0) {
          allMatch = false;
          break;
        }
        indexes.push(index);
      }
      if (allMatch) return [...new Set(indexes)];
    }

    let letters = null;
    if (/^[A-Za-z]$/.test(raw) || /^[A-Za-z](?:\s*[,;/|\s]\s*[A-Za-z])+$/.test(raw) || /^[A-Za-z]{2,}$/.test(raw)) {
      letters = raw.toUpperCase().match(/[A-Z]/g) || [];
    }
    if (!letters || !letters.length) return null;
    const indexes = letters.map((letter) => letter.charCodeAt(0) - 65);
    if (indexes.some((index) => index < 0 || index >= options.length)) return null;
    return [...new Set(indexes)];
  }

  function applyAriaRadio(block, index) {
    const el = block.inputs[index];
    if (!el || isForbiddenControl(el)) return { ok: false, error: "Refusing navigation control" };
    if (ariaOn(el)) return { ok: true };
    if (!clickOnce(el)) return { ok: false, error: "Refusing navigation control" };
    return { ok: true };
  }

  function applyAriaCheckboxes(block, indexes) {
    const desired = new Set(indexes);
    for (const el of block.inputs) {
      if (isForbiddenControl(el)) return { ok: false, error: "Refusing navigation control" };
    }
    for (let i = 0; i < block.inputs.length; i++) {
      const el = block.inputs[i];
      if (ariaOn(el) === desired.has(i)) continue;
      if (!clickOnce(el)) return { ok: false, error: "Refusing navigation control" };
    }
    return { ok: true };
  }

  function applyNativeCheckboxes(block, indexes) {
    const desired = new Set(indexes);
    for (const el of block.inputs) {
      if (isForbiddenControl(el)) return { ok: false, error: "Refusing navigation control" };
    }
    block.inputs.forEach((input, index) => {
      const shouldCheck = desired.has(index);
      if (shouldCheck === Boolean(input.checked)) return;
      input.click();
      input.checked = shouldCheck;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return { ok: true };
  }

  function applyLegacyClick(block, targetIndex) {
    const el = block.inputs[targetIndex];
    if (!el || isForbiddenControl(el)) return { ok: false, error: "Refusing navigation control" };

    const icon = el.querySelector(".answer-icon, .ui-icon-circle, .ui-icon-check, [class*='icon']");
    const clickTarget = icon || el;
    if (isForbiddenControl(clickTarget)) return { ok: false, error: "Refusing navigation control" };

    clickTarget.focus();
    clickTarget.click();
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    clickTarget.dispatchEvent(new Event("change", { bubbles: true }));

    if (el !== clickTarget) {
      el.click();
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (el.tagName === "INPUT" && el.type === "radio") {
      el.checked = true;
    }

    log(`  -> Clicked [${targetIndex}]:`, el.tagName, typeof el.className === "string" ? el.className.slice(0, 40) : "");
    return { ok: true };
  }

  function applySelect(block, index) {
    const select = block.inputs[0];
    if (!select || isForbiddenControl(select)) return { ok: false, error: "Refusing navigation control" };
    const options = block.options || [];
    if (index < 0 || index >= options.length) return { ok: false, error: "Invalid option" };
    const first = select.options[0];
    const hasPlaceholder = !!first && !normText(first.value || "");
    const domIndex = hasPlaceholder ? index + 1 : index;
    const option = select.options[domIndex];
    if (!option) return { ok: false, error: "Invalid option" };
    select.selectedIndex = domIndex;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  function applyText(block, value) {
    const input = block.inputs[0];
    if (!input || isForbiddenControl(input)) return { ok: false, error: "Refusing navigation control" };
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && typeof desc.set === "function") desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  function injectAnswer(block, answerText) {
    const text = typeof answerText === "number" && Number.isFinite(answerText) ? String(answerText) : answerText;
    if (typeof text !== "string" || !normText(text)) return { ok: false, error: "Invalid answer" };
    log(`  Injecting: ${block.id} (${block.type}) <- "${text}"`);

    if (block.type === "text") {
      return applyText(block, normText(text));
    }

    const first = block.inputs && block.inputs[0];
    if (block.type === "checkbox") {
      const indexes = resolveCheckboxIndexes(block, text);
      if (!indexes) {
        log(`  -> Invalid checkbox answer "${text}"`);
        return { ok: false, error: "Invalid option" };
      }
      return isAriaWidget(first, "checkbox") ? applyAriaCheckboxes(block, indexes) : applyNativeCheckboxes(block, indexes);
    }

    if (block.type === "multiple_choice" || block.type === "button_choice" || block.type === "select") {
      const index = resolveSingleIndex(block, text);
      if (index == null) {
        log(`  -> Invalid option "${text}"`);
        return { ok: false, error: "Invalid option" };
      }
      let result;
      if (block.type === "select") result = applySelect(block, index);
      else if (isAriaWidget(first, "radio")) result = applyAriaRadio(block, index);
      else result = applyLegacyClick(block, index);
      return result;
    }

    return { ok: false, error: "Unsupported question" };
  }

  function coerceAnswerEntry(entry) {
    if (!entry || typeof entry !== "object") return { id: "", answer: null, error: "Invalid answer" };
    const id = entry.id == null ? "" : String(entry.id);
    let answer = entry.answer;
    if (typeof answer === "number" && Number.isFinite(answer)) answer = String(answer);
    if (!id || typeof answer !== "string") return { id, answer: null, error: "Invalid answer" };
    return { id, answer, error: null };
  }

  function applyAnswers(msg) {
    const answers = msg && Array.isArray(msg.answers) ? msg.answers : null;
    if (!answers || answers.length === 0) {
      return { ok: false, applied: 0, results: [], error: "No answers" };
    }
    const results = [];
    for (const entry of answers) {
      const coerced = coerceAnswerEntry(entry);
      if (coerced.error) {
        results.push({ id: coerced.id, ok: false, error: coerced.error });
        continue;
      }
      const block = detectedBlocks.find((item) => item.id === coerced.id);
      if (!block) {
        results.push({ id: coerced.id, ok: false, error: "Unknown question" });
        continue;
      }
      try {
        const applied = injectAnswer(block, coerced.answer);
        if (applied && applied.ok) results.push({ id: coerced.id, ok: true });
        else results.push({ id: coerced.id, ok: false, error: (applied && applied.error) || "Not applied" });
      } catch (err) {
        log("ERROR injecting answers:", err.message);
        results.push({ id: coerced.id, ok: false, error: err.message });
      }
    }
    const appliedCount = results.filter((item) => item.ok).length;
    return { ok: appliedCount === results.length, applied: appliedCount, results };
  }

  function desktopDetect() {
    try {
      detectedBlocks = detectQuestionBlocks();
    } catch (err) {
      log("ERROR in detectQuestionBlocks:", err.message, err.stack);
      detectedBlocks = [];
    }
    return {
      count: detectedBlocks.length,
      questions: detectedBlocks.map((block) => ({
        id: block.id,
        type: block.type,
        text: block.text,
        options: block.options,
      })),
    };
  }

  globalThis.__AIA_DESKTOP_API__ = {
    detect: desktopDetect,
    answer(msg) {
      try {
        return applyAnswers(msg || {});
      } catch (err) {
        log("ERROR injecting answers:", err.message);
        return { ok: false, applied: 0, results: [], error: err.message };
      }
    },
    clear() {
      detectedBlocks = [];
      return { ok: true };
    },
  };
  globalThis.__AIA_DESKTOP_LOADED__ = true;
})();
