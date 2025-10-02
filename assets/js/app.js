(() => {
  const sourceInput = document.getElementById("source-input");
  const targetInput = document.getElementById("target-input");
  const swapButton = document.getElementById("swap");
  const clearButton = document.getElementById("clear");
  const statusMessage = document.getElementById("status-message");
  const resultsTable = document.getElementById("results-table");
  const resultsBody = resultsTable.querySelector("tbody");
  const selectionSummary = document.getElementById("selection-summary");
  const copyToSourceButton = document.getElementById("copy-to-source");
  const copyToTargetButton = document.getElementById("copy-to-target");
  const valueEditorOverlay = document.getElementById("value-editor-overlay");
  const valueEditorTitle = document.getElementById("value-editor-title");
  const valueEditorTextarea = document.getElementById("value-editor-textarea");
  const valueEditorCloseButton = document.getElementById("value-editor-close");
  const sourceCopyButton = document.getElementById("source-copy");
  const targetCopyButton = document.getElementById("target-copy");
  const sourceDownloadButton = document.getElementById("source-download");
  const targetDownloadButton = document.getElementById("target-download");

  const MISSING_INDICATOR = "—";
  const STATUS_CLASSNAMES = {
    success: "status-panel__message--success",
    warning: "status-panel__message--warning",
    error: "status-panel__message--error",
  };

  const STORAGE_KEYS = {
    source: "envDiffTool.source",
    target: "envDiffTool.target",
  };

  const storage = (() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return null;
      }
      const testKey = "envDiffTool.__test";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch (error) {
      console.warn("Local storage is not available; state persistence disabled.", error);
      return null;
    }
  })();

  const state = {
    selection: new Set(),
    parses: {
      source: createEmptyParse(),
      target: createEmptyParse(),
    },
    diffRows: [],
    expandedEditor: null,
  };
  let suppressNextOverlayFocus = false;

  function createEmptyParse() {
    return {
      format: "empty",
      normalized: {},
      original: {},
      text: "",
    };
  }

  function persistCurrentState() {
    if (!storage) {
      return;
    }

    try {
      storage.setItem(STORAGE_KEYS.source, sourceInput.value ?? "");
      storage.setItem(STORAGE_KEYS.target, targetInput.value ?? "");
    } catch (error) {
      console.warn("Failed to persist editor state.", error);
    }
  }

  function restorePersistedState() {
    if (!storage) {
      return false;
    }

    try {
      const storedSource = storage.getItem(STORAGE_KEYS.source);
      const storedTarget = storage.getItem(STORAGE_KEYS.target);

      if (storedSource === null && storedTarget === null) {
        return false;
      }

      sourceInput.value = storedSource ?? "";
      targetInput.value = storedTarget ?? "";
      return true;
    } catch (error) {
      console.warn("Failed to restore editor state.", error);
      return false;
    }
  }

  function setStatus(message, tone = "warning") {
    statusMessage.textContent = message;
    Object.values(STATUS_CLASSNAMES).forEach((className) => {
      statusMessage.classList.remove(className);
    });
    const className = STATUS_CLASSNAMES[tone];
    if (className) {
      statusMessage.classList.add(className);
    }
  }

  function escapeForSelector(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function getValueInputElement(key, side) {
    const escapedKey = escapeForSelector(key);
    return resultsBody.querySelector(
      `.results-table__value-input[data-key="${escapedKey}"][data-side="${side}"]`
    );
  }

  function toDisplayString(value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        console.warn("Unable to stringify value", value, error);
        return String(value);
      }
    }

    return String(value ?? "");
  }

  function detectFormat(parsed) {
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return "nameValueArray";
      }

      const everyNameValue = parsed.every(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && "name" in entry && "value" in entry
      );
      if (everyNameValue) {
        return "nameValueArray";
      }

      const everyPair = parsed.every((entry) => Array.isArray(entry) && entry.length >= 2);
      if (everyPair) {
        return "pairArray";
      }

      return null;
    }

    if (parsed && typeof parsed === "object") {
      return "object";
    }

    return null;
  }

  function buildNormalizedMap(parsed, format) {
    if (format === "object") {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [String(key), toDisplayString(value)])
      );
    }

    if (format === "nameValueArray") {
      const result = {};
      parsed.forEach((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return;
        }

        if ("name" in entry) {
          result[String(entry.name)] = toDisplayString(entry.value);
        }
      });
      return result;
    }

    if (format === "pairArray") {
      const result = {};
      parsed.forEach((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) {
          return;
        }
        result[String(entry[0])] = toDisplayString(entry[1]);
      });
      return result;
    }

    return {};
  }

  function parseEnvironment(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return createEmptyParse();
    }

    try {
      const parsed = JSON.parse(trimmed);
      const format = detectFormat(parsed);
      if (!format) {
        throw new Error(
          "Unsupported JSON structure. Use an object or an array of objects with name/value pairs."
        );
      }

      return {
        format,
        original: parsed,
        normalized: buildNormalizedMap(parsed, format),
        text,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  function classifyRow(leftValue, rightValue) {
    if (leftValue === undefined && rightValue === undefined) {
      return { className: "", label: "" };
    }

    if (leftValue === undefined) {
      return { className: "only-target", label: "Only in target" };
    }

    if (rightValue === undefined) {
      return { className: "only-source", label: "Only in source" };
    }

    if (leftValue === rightValue) {
      return { className: "match", label: "Match" };
    }

    return { className: "different", label: "Different" };
  }

  function buildDiff(leftMap, rightMap) {
    const allKeys = new Set([...Object.keys(leftMap), ...Object.keys(rightMap)]);
    const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));

    const rows = [];
    const stats = {
      match: 0,
      different: 0,
      onlySource: 0,
      onlyTarget: 0,
    };

    sortedKeys.forEach((key) => {
      const leftValue = leftMap[key];
      const rightValue = rightMap[key];
      const { className, label } = classifyRow(leftValue, rightValue);

      if (className === "match") {
        stats.match += 1;
      } else if (className === "different") {
        stats.different += 1;
      } else if (className === "only-source") {
        stats.onlySource += 1;
      } else if (className === "only-target") {
        stats.onlyTarget += 1;
      }

      rows.push({
        key,
        leftValue,
        rightValue,
        className,
        label,
      });
    });

    return { rows, stats, total: sortedKeys.length };
  }

  function createValueCell(value, key, side) {
    const cell = document.createElement("td");
    cell.className = "results-table__value";

    if (value === undefined) {
      cell.classList.add("results-table__value--missing");
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "results-table__value-input";
    input.dataset.key = key;
    input.dataset.side = side;
    input.placeholder = value === undefined ? MISSING_INDICATOR : "";
    input.value = value === undefined ? "" : value;
    input.title = value === undefined ? "Not present" : value;
    input.setAttribute(
      "aria-label",
      `${side === "source" ? "Source" : "Target"} value for ${key}`
    );

    cell.appendChild(input);
    return cell;
  }

  function createSelectionCell(key) {
    const cell = document.createElement("td");
    cell.className = "results-table__select";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.key = key;
    checkbox.checked = state.selection.has(key);
    checkbox.setAttribute("aria-label", `Select ${key}`);

    cell.appendChild(checkbox);
    return cell;
  }

  function renderResults(rows) {
    resultsBody.innerHTML = "";
    if (rows.length === 0) {
      resultsTable.hidden = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      if (row.className) {
        tableRow.classList.add(row.className);
      }
      tableRow.dataset.key = row.key;

      tableRow.appendChild(createSelectionCell(row.key));

      const keyCell = document.createElement("td");
      keyCell.className = "results-table__variable";
      keyCell.textContent = row.key;
      tableRow.appendChild(keyCell);

      tableRow.appendChild(createValueCell(row.leftValue, row.key, "source"));
      tableRow.appendChild(createValueCell(row.rightValue, row.key, "target"));

      const statusCell = document.createElement("td");
      statusCell.textContent = row.label;
      tableRow.appendChild(statusCell);

      fragment.appendChild(tableRow);
    });

    resultsBody.appendChild(fragment);
    resultsTable.hidden = false;
  }

  function updateSelectionSummary() {
    const count = state.selection.size;
    if (count === 0) {
      selectionSummary.textContent = "No variables selected.";
    } else {
      selectionSummary.textContent = `${count} variable${count === 1 ? "" : "s"} selected.`;
    }

    const disable = count === 0;
    copyToSourceButton.disabled = disable;
    copyToTargetButton.disabled = disable;
  }

  function pruneSelection(validKeys) {
    const valid = new Set(validKeys);
    Array.from(state.selection).forEach((key) => {
      if (!valid.has(key)) {
        state.selection.delete(key);
      }
    });
  }

  function summarizeStats(stats, total) {
    if (total === 0) {
      return "No variables detected. Paste JSON to compare.";
    }

    const parts = [];
    if (stats.match) {
      parts.push(`${stats.match} match${stats.match === 1 ? "" : "es"}`);
    }
    if (stats.different) {
      parts.push(`${stats.different} different value${stats.different === 1 ? "" : "s"}`);
    }
    if (stats.onlySource) {
      parts.push(`${stats.onlySource} only in source`);
    }
    if (stats.onlyTarget) {
      parts.push(`${stats.onlyTarget} only in target`);
    }

    const suffix = parts.length ? ` (${parts.join(", ")})` : "";
    return `Compared ${total} variable${total === 1 ? "" : "s"}.${suffix}`;
  }

  function refreshDiff(options = {}) {
    const { suppressStatus = false } = options;

    persistCurrentState();

    const sourceText = sourceInput.value;
    const targetText = targetInput.value;

    try {
      const sourceParse = parseEnvironment(sourceText);
      const targetParse = parseEnvironment(targetText);

      state.parses.source = sourceParse;
      state.parses.target = targetParse;

      const { rows, stats, total } = buildDiff(sourceParse.normalized, targetParse.normalized);
      state.diffRows = rows;

      pruneSelection(rows.map((row) => row.key));
      renderResults(rows);
      syncExpandedEditor();
      updateSelectionSummary();

      if (suppressStatus) {
        return;
      }

      if (total === 0) {
        setStatus("Paste JSON to begin comparing.", "warning");
        return;
      }

      const summary = summarizeStats(stats, total);
      const tone = stats.different === 0 && stats.onlySource === 0 && stats.onlyTarget === 0 ? "success" : "warning";
      setStatus(summary, tone);
    } catch (error) {
      state.parses.source = createEmptyParse();
      state.parses.target = createEmptyParse();
      state.diffRows = [];
      state.selection.clear();
      renderResults([]);
      updateSelectionSummary();
      closeExpandedEditor();
      setStatus(error.message, "error");
    }
  }

  let scheduledRefreshHandle = null;
  let scheduledRefreshOptions = null;

  function scheduleRefresh(options = {}) {
    scheduledRefreshOptions = { ...(scheduledRefreshOptions || {}), ...options };
    if (scheduledRefreshHandle !== null) {
      return;
    }

    const run = () => {
      scheduledRefreshHandle = null;
      const opts = scheduledRefreshOptions || {};
      scheduledRefreshOptions = null;
      refreshDiff(opts);
    };

    if (typeof requestAnimationFrame === "function") {
      scheduledRefreshHandle = requestAnimationFrame(run);
    } else {
      scheduledRefreshHandle = setTimeout(run, 16);
    }
  }

  function cancelScheduledRefresh() {
    if (scheduledRefreshHandle !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(scheduledRefreshHandle);
      } else {
        clearTimeout(scheduledRefreshHandle);
      }
    }

    scheduledRefreshHandle = null;
    scheduledRefreshOptions = null;
  }

  function cloneArray(array) {
    return array.map((item) => {
      if (Array.isArray(item)) {
        return item.slice();
      }
      if (item && typeof item === "object") {
        return { ...item };
      }
      return item;
    });
  }

  function applyValueToStructure(parseResult, key, value, preferredFormat) {
    const format = parseResult.format === "empty" ? preferredFormat || "object" : parseResult.format;
    let updatedStructure;

    if (format === "object") {
      const base = parseResult.format === "empty" ? {} : { ...parseResult.original };
      base[key] = value;
      updatedStructure = base;
    } else if (format === "nameValueArray") {
      const base = Array.isArray(parseResult.original) ? cloneArray(parseResult.original) : [];
      const index = base.findIndex(
        (item) => item && typeof item === "object" && !Array.isArray(item) && String(item.name) === key
      );

      if (index >= 0) {
        base[index] = { ...base[index], name: key, value };
      } else {
        const template = base.find((item) => item && typeof item === "object" && !Array.isArray(item));
        if (template) {
          const newEntry = { ...template };
          Object.keys(newEntry).forEach((entryKey) => {
            if (entryKey !== "name" && entryKey !== "value") {
              newEntry[entryKey] = template[entryKey];
            }
          });
          newEntry.name = key;
          newEntry.value = value;
          base.push(newEntry);
        } else {
          base.push({ name: key, value, slotSetting: false });
        }
      }

      updatedStructure = base;
    } else if (format === "pairArray") {
      const base = Array.isArray(parseResult.original) ? cloneArray(parseResult.original) : [];
      const index = base.findIndex((item) => Array.isArray(item) && String(item[0]) === key);
      if (index >= 0) {
        const pair = Array.isArray(base[index]) ? base[index].slice() : [];
        pair[0] = key;
        pair[1] = value;
        base[index] = pair;
      } else {
        base.push([key, value]);
      }
      updatedStructure = base;
    } else {
      throw new Error("Unsupported target format for copy action.");
    }

    return {
      text: JSON.stringify(updatedStructure, null, 2),
      format,
    };
  }

  function copySelected(direction) {
    if (state.selection.size === 0) {
      return;
    }

    const copyingToSource = direction === "source";
    const fromParse = copyingToSource ? state.parses.target : state.parses.source;
    const toParse = copyingToSource ? state.parses.source : state.parses.target;
    const toInput = copyingToSource ? sourceInput : targetInput;
    const destinationLabel = copyingToSource ? "source" : "target";
    const originLabel = copyingToSource ? "target" : "source";

    const keys = Array.from(state.selection);
    const missingKeys = [];
    let copiedCount = 0;
    let updatedParse = toParse;

    keys.forEach((key) => {
      const value = fromParse.normalized[key];
      if (value === undefined) {
        missingKeys.push(key);
        return;
      }

      const update = applyValueToStructure(updatedParse, key, value, fromParse.format === "empty" ? undefined : fromParse.format);
      toInput.value = update.text;
      updatedParse = parseEnvironment(update.text);
      copiedCount += 1;
    });

    scheduleRefresh({ suppressStatus: true });

    if (copiedCount === 0) {
      setStatus(
        `No values copied. None of the selected variables exist on the ${originLabel} side.`,
        "warning"
      );
      return;
    }

    let message = `Copied ${copiedCount} variable${copiedCount === 1 ? "" : "s"} to the ${destinationLabel} environment.`;
    if (missingKeys.length) {
      message += ` Skipped ${missingKeys.length} missing on the ${originLabel} side (${missingKeys.join(", ")}).`;
    }
    setStatus(message, "success");
  }

  function handleSelectionChange(event) {
    const checkbox = event.target;
    if (!checkbox.matches('input[type="checkbox"][data-key]')) {
      return;
    }

    const key = checkbox.dataset.key;
    if (!key) {
      return;
    }

    if (checkbox.checked) {
      state.selection.add(key);
    } else {
      state.selection.delete(key);
    }

    updateSelectionSummary();
  }

  function commitValueChange({
    key,
    side,
    value,
    selectionStart,
    selectionEnd,
    focusMode = "table",
  }) {
    if (!key || (side !== "source" && side !== "target")) {
      return;
    }

    const parse = state.parses[side];
    const otherParse = state.parses[side === "source" ? "target" : "source"];
    const preferredFormat =
      parse.format !== "empty"
        ? parse.format
        : otherParse.format !== "empty"
        ? otherParse.format
        : undefined;

    const safeStart = typeof selectionStart === "number" ? selectionStart : value.length;
    const safeEnd = typeof selectionEnd === "number" ? selectionEnd : value.length;

    try {
      const update = applyValueToStructure(parse, key, value, preferredFormat);
      const destinationInput = side === "source" ? sourceInput : targetInput;
      destinationInput.value = update.text;

      scheduleRefresh();

      const restoreTableFocus = () => {
        const nextInput = getValueInputElement(key, side);
        if (nextInput) {
          nextInput.focus();
          try {
            nextInput.setSelectionRange(safeStart, safeEnd);
          } catch (error) {
            // Some input types may not support selection ranges; safely ignore.
          }
        }
      };

      const restoreOverlayFocus = () => {
        if (valueEditorTextarea) {
          valueEditorTextarea.focus({ preventScroll: true });
          try {
            valueEditorTextarea.setSelectionRange(safeStart, safeEnd);
          } catch (error) {
            // Some browsers may not support programmatic selection.
          }
        }
      };

      if (focusMode === "table") {
        if (typeof queueMicrotask === "function") {
          queueMicrotask(restoreTableFocus);
        } else {
          setTimeout(restoreTableFocus, 0);
        }
      } else if (focusMode === "overlay") {
        if (typeof queueMicrotask === "function") {
          queueMicrotask(restoreOverlayFocus);
        } else {
          setTimeout(restoreOverlayFocus, 0);
        }
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function handleValueInput(event) {
    const input = event.target;
    if (!input.classList.contains("results-table__value-input")) {
      return;
    }

    const { key, side } = input.dataset;

    commitValueChange({
      key,
      side,
      value: input.value,
      selectionStart: input.selectionStart ?? input.value.length,
      selectionEnd: input.selectionEnd ?? input.value.length,
      focusMode: "table",
    });
  }

  function openExpandedEditor(input) {
    if (!valueEditorOverlay || !valueEditorTextarea || !valueEditorTitle) {
      return;
    }

    const { key, side } = input.dataset;
    if (!key || (side !== "source" && side !== "target")) {
      return;
    }

    state.expandedEditor = { key, side };

    const headingSide = side === "source" ? "Source" : "Target";
    valueEditorTitle.textContent = `${headingSide} value for ${key}`;
    valueEditorTextarea.value = input.value;
    valueEditorTextarea.placeholder = input.placeholder || "";
    valueEditorTextarea.dataset.key = key;
    valueEditorTextarea.dataset.side = side;

    valueEditorOverlay.removeAttribute("hidden");
    valueEditorOverlay.setAttribute("aria-hidden", "false");

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;

    requestAnimationFrame(() => {
      try {
        valueEditorTextarea.focus({ preventScroll: true });
        valueEditorTextarea.setSelectionRange(start, end);
      } catch (error) {
        // Some browsers may not support programmatic selection; ignore.
      }
    });
  }

  function closeExpandedEditor(options = {}) {
    if (!valueEditorOverlay || !valueEditorTextarea) {
      return;
    }

    if (valueEditorOverlay.hasAttribute("hidden")) {
      return;
    }

    const { restoreFocus = false } = options;
    suppressNextOverlayFocus = restoreFocus;
    const activeEditor = state.expandedEditor;

    valueEditorOverlay.setAttribute("hidden", "");
    valueEditorOverlay.setAttribute("aria-hidden", "true");
    valueEditorTextarea.value = "";
    valueEditorTextarea.placeholder = "";
    valueEditorTextarea.dataset.key = "";
    valueEditorTextarea.dataset.side = "";
    state.expandedEditor = null;

    if (restoreFocus && activeEditor) {
      const nextInput = getValueInputElement(activeEditor.key, activeEditor.side);
      if (nextInput) {
        nextInput.focus();
      }
    }
  }

  function syncExpandedEditor() {
    if (!state.expandedEditor || !valueEditorTextarea || !valueEditorOverlay || !valueEditorTitle) {
      return;
    }

    if (valueEditorOverlay.hasAttribute("hidden")) {
      return;
    }

    const { key, side } = state.expandedEditor;
    const input = getValueInputElement(key, side);

    if (!input) {
      closeExpandedEditor();
      return;
    }

    const currentValue = input.value;
    const placeholder = input.placeholder || "";

    if (valueEditorTextarea.value !== currentValue) {
      const caretStart = valueEditorTextarea.selectionStart ?? currentValue.length;
      const caretEnd = valueEditorTextarea.selectionEnd ?? currentValue.length;
      valueEditorTextarea.value = currentValue;
      try {
        valueEditorTextarea.setSelectionRange(caretStart, caretEnd);
      } catch (error) {
        // Ignore if selection cannot be restored.
      }
    }

    valueEditorTextarea.placeholder = placeholder;
    valueEditorTextarea.dataset.key = key;
    valueEditorTextarea.dataset.side = side;
    valueEditorTitle.textContent = `${side === "source" ? "Source" : "Target"} value for ${key}`;
  }

  function handleValueFocus(event) {
    const input = event.target;
    if (!input.classList.contains("results-table__value-input")) {
      return;
    }

    if (suppressNextOverlayFocus) {
      suppressNextOverlayFocus = false;
      return;
    }

    openExpandedEditor(input);
  }

  function handleOverlayInput() {
    if (!state.expandedEditor) {
      return;
    }

    const { key, side } = state.expandedEditor;

    commitValueChange({
      key,
      side,
      value: valueEditorTextarea.value,
      selectionStart: valueEditorTextarea.selectionStart ?? valueEditorTextarea.value.length,
      selectionEnd: valueEditorTextarea.selectionEnd ?? valueEditorTextarea.value.length,
      focusMode: "overlay",
    });
  }

  function handleGlobalKeydown(event) {
    if (event.key === "Escape" && valueEditorOverlay && !valueEditorOverlay.hasAttribute("hidden")) {
      event.preventDefault();
      closeExpandedEditor({ restoreFocus: true });
    }
  }

  function fallbackCopyToClipboard(text) {
    try {
      if (typeof document.execCommand !== "function") {
        return false;
      }

      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.top = "-1000px";
      helper.style.left = "-1000px";
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      const result = document.execCommand("copy");
      document.body.removeChild(helper);
      return result;
    } catch (error) {
      console.warn("Fallback clipboard copy failed.", error);
      return false;
    }
  }

  function copyEditorContent(side) {
    const text = side === "source" ? sourceInput.value : targetInput.value;
    const label = side === "source" ? "source" : "target";

    const notifySuccess = () => setStatus(`Copied ${label} JSON to clipboard.`, "success");
    const notifyFailure = () => setStatus(`Unable to copy ${label} JSON.`, "error");

    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          notifySuccess();
        })
        .catch(() => {
          if (fallbackCopyToClipboard(text)) {
            notifySuccess();
          } else {
            notifyFailure();
          }
        });
      return;
    }

    if (fallbackCopyToClipboard(text)) {
      notifySuccess();
    } else {
      notifyFailure();
    }
  }

  function downloadEditorContent(side) {
    const text = side === "source" ? sourceInput.value : targetInput.value;
    const label = side === "source" ? "source" : "target";

    try {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        throw new Error("File download is not supported in this environment.");
      }

      const safeText = text ?? "";
      const blob = new Blob([safeText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${label}-environment-${timestamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      setStatus(`Downloaded ${label} environment as JSON.`, "success");
    } catch (error) {
      console.error("Download failed.", error);
      setStatus(`Unable to download ${label} environment.`, "error");
    }
  }

  function swapInputs() {
    closeExpandedEditor();
    const sourceText = sourceInput.value;
    sourceInput.value = targetInput.value;
    targetInput.value = sourceText;
    cancelScheduledRefresh();
    refreshDiff();
  }

  function clearInputs() {
    closeExpandedEditor();
    sourceInput.value = "";
    targetInput.value = "";
    state.selection.clear();
    cancelScheduledRefresh();
    refreshDiff({ suppressStatus: true });
    setStatus("Cleared inputs.", "warning");
  }

  function initialize() {
    sourceInput.addEventListener("input", () => scheduleRefresh());
    targetInput.addEventListener("input", () => scheduleRefresh());
    resultsBody.addEventListener("change", handleSelectionChange);
    resultsBody.addEventListener("input", handleValueInput);
    resultsBody.addEventListener("focusin", handleValueFocus);
    copyToSourceButton.addEventListener("click", () => copySelected("source"));
    copyToTargetButton.addEventListener("click", () => copySelected("target"));
    swapButton.addEventListener("click", swapInputs);
    clearButton.addEventListener("click", clearInputs);

    if (sourceCopyButton) {
      sourceCopyButton.addEventListener("click", () => copyEditorContent("source"));
    }

    if (targetCopyButton) {
      targetCopyButton.addEventListener("click", () => copyEditorContent("target"));
    }

    if (sourceDownloadButton) {
      sourceDownloadButton.addEventListener("click", () => downloadEditorContent("source"));
    }

    if (targetDownloadButton) {
      targetDownloadButton.addEventListener("click", () => downloadEditorContent("target"));
    }

    if (valueEditorTextarea) {
      valueEditorTextarea.addEventListener("input", handleOverlayInput);
    }

    if (valueEditorCloseButton) {
      valueEditorCloseButton.addEventListener("click", () => closeExpandedEditor({ restoreFocus: true }));
    }

    if (valueEditorOverlay) {
      valueEditorOverlay.addEventListener("click", (event) => {
        if (event.target === valueEditorOverlay) {
          closeExpandedEditor();
        }
      });
    }

    document.addEventListener("keydown", handleGlobalKeydown);

    restorePersistedState();
    cancelScheduledRefresh();
    refreshDiff();
  }

  initialize();
})();
