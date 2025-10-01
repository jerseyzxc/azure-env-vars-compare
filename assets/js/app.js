(() => {
  const sourceInput = document.getElementById("source-input");
  const targetInput = document.getElementById("target-input");
  const loadSampleButton = document.getElementById("load-sample");
  const swapButton = document.getElementById("swap");
  const clearButton = document.getElementById("clear");
  const statusMessage = document.getElementById("status-message");
  const resultsTable = document.getElementById("results-table");
  const resultsBody = resultsTable.querySelector("tbody");
  const selectionSummary = document.getElementById("selection-summary");
  const copyToSourceButton = document.getElementById("copy-to-source");
  const copyToTargetButton = document.getElementById("copy-to-target");

  const MISSING_INDICATOR = "—";
  const STATUS_CLASSNAMES = {
    success: "status-panel__message--success",
    warning: "status-panel__message--warning",
    error: "status-panel__message--error",
  };

  const state = {
    selection: new Set(),
    parses: {
      source: createEmptyParse(),
      target: createEmptyParse(),
    },
    diffRows: [],
  };

  const azureSamples = {
    source: [
      {
        name: "AaIntegrationRedirectUrl",
        value: "https://vipm-clinician-dev.clarifidev.com/integrations/rethink",
        slotSetting: false,
      },
      {
        name: "AccountsApiClient:ApiBaseUrl",
        value: "https://app-accounts-service-dev.azurewebsites.net/api/v1/",
        slotSetting: false,
      },
      {
        name: "AccountsApiClient:ApiKey",
        value: "be717ee9-24b4-4d11-adf7-e28be4d8ef4a",
        slotSetting: false,
      },
    ],
    target: [
      {
        name: "AaIntegrationRedirectUrl",
        value: "https://vipm-clinician-prod.clarifidev.com/integrations/rethink",
        slotSetting: false,
      },
      {
        name: "AccountsApiClient:ApiBaseUrl",
        value: "https://app-accounts-service.azurewebsites.net/api/v1/",
        slotSetting: false,
      },
      {
        name: "AccountsApiClient:ApiKey",
        value: "prod-secret-key",
        slotSetting: false,
      },
      {
        name: "NewFeatureToggle",
        value: "true",
        slotSetting: false,
      },
    ],
  };

  function createEmptyParse() {
    return {
      format: "empty",
      normalized: {},
      original: {},
      text: "",
    };
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
      updateSelectionSummary();

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
      setStatus(error.message, "error");
    }
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

    refreshDiff();

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

  function handleValueInput(event) {
    const input = event.target;
    if (!input.classList.contains("results-table__value-input")) {
      return;
    }

    const { key, side } = input.dataset;
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

    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? input.value.length;

    try {
      const update = applyValueToStructure(parse, key, input.value, preferredFormat);
      const destinationInput = side === "source" ? sourceInput : targetInput;
      destinationInput.value = update.text;
      refreshDiff();

      const restoreFocus = () => {
        const escapedKey =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(key)
            : key.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        const selector = `.results-table__value-input[data-key="${escapedKey}"][data-side="${side}"]`;
        const nextInput = resultsBody.querySelector(selector);
        if (nextInput) {
          nextInput.focus();
          try {
            nextInput.setSelectionRange(selectionStart, selectionEnd);
          } catch (error) {
            // Some input types may not support selection ranges; safely ignore.
          }
        }
      };

      if (typeof queueMicrotask === "function") {
        queueMicrotask(restoreFocus);
      } else {
        setTimeout(restoreFocus, 0);
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function loadSamples() {
    sourceInput.value = JSON.stringify(azureSamples.source, null, 2);
    targetInput.value = JSON.stringify(azureSamples.target, null, 2);
    refreshDiff();
  }

  function swapInputs() {
    const sourceText = sourceInput.value;
    sourceInput.value = targetInput.value;
    targetInput.value = sourceText;
    refreshDiff();
  }

  function clearInputs() {
    sourceInput.value = "";
    targetInput.value = "";
    state.selection.clear();
    refreshDiff();
    setStatus("Cleared inputs.", "warning");
  }

  function initialize() {
    sourceInput.addEventListener("input", () => refreshDiff());
    targetInput.addEventListener("input", () => refreshDiff());
    resultsBody.addEventListener("change", handleSelectionChange);
    resultsBody.addEventListener("input", handleValueInput);
    copyToSourceButton.addEventListener("click", () => copySelected("source"));
    copyToTargetButton.addEventListener("click", () => copySelected("target"));
    loadSampleButton.addEventListener("click", loadSamples);
    swapButton.addEventListener("click", swapInputs);
    clearButton.addEventListener("click", clearInputs);

    loadSamples();
  }

  initialize();
})();
