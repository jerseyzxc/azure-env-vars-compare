const leftInput = document.getElementById("left-json");
const rightInput = document.getElementById("right-json");
const compareButton = document.getElementById("compare");
const clearButton = document.getElementById("clear");
const statusEl = document.getElementById("status");
const resultTable = document.getElementById("result-table");
const tbody = resultTable.querySelector("tbody");
const copyToSourceButton = document.getElementById("copy-to-source");
const copyToTargetButton = document.getElementById("copy-to-target");
const selectionSummary = document.getElementById("selection-summary");

const MISSING_INDICATOR = "—";

const selectedKeys = new Set();

const updateSelectionUI = () => {
  const count = selectedKeys.size;
  if (count === 0) {
    selectionSummary.textContent = "No variables selected.";
  } else {
    selectionSummary.textContent = `${count} variable${count === 1 ? "" : "s"} selected.`;
  }

  const disabled = count === 0;
  copyToSourceButton.disabled = disabled;
  copyToTargetButton.disabled = disabled;
};

updateSelectionUI();

const toDisplayString = (value) => {
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
};

const detectFormat = (parsed) => {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return "nameValueArray";
    }

    const nameValueEntries = parsed.filter(
      (item) => item && typeof item === "object" && !Array.isArray(item) && "name" in item && "value" in item
    );

    if (nameValueEntries.length === parsed.length) {
      return "nameValueArray";
    }

    const pairEntries = parsed.filter((item) => Array.isArray(item) && item.length >= 2);
    if (pairEntries.length === parsed.length) {
      return "pairArray";
    }

    return null;
  }

  if (parsed && typeof parsed === "object") {
    return "object";
  }

  return null;
};

const buildNormalizedMap = (parsed, format) => {
  if (format === "object") {
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [String(key), toDisplayString(value)])
    );
  }

  if (format === "nameValueArray") {
    const result = {};
    parsed.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return;
      }

      if ("name" in item) {
        result[String(item.name)] = toDisplayString(item.value);
      }
    });
    return result;
  }

  if (format === "pairArray") {
    const result = {};
    parsed.forEach((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) {
        return;
      }
      result[String(pair[0])] = toDisplayString(pair[1]);
    });
    return result;
  }

  return {};
};

const parseInput = (input) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      normalized: {},
      original: {},
      format: "empty",
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const format = detectFormat(parsed);
    if (!format) {
      throw new Error("Unsupported JSON structure. Use an object or an array with name/value pairs.");
    }

    return {
      normalized: buildNormalizedMap(parsed, format),
      original: parsed,
      format,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
};

const classifyRow = (leftValue, rightValue) => {
  if (leftValue === undefined && rightValue === undefined) {
    return { className: "", statusLabel: "" };
  }

  if (leftValue === undefined) {
    return { className: "only-target", statusLabel: "Only in target" };
  }

  if (rightValue === undefined) {
    return { className: "only-source", statusLabel: "Only in source" };
  }

  if (leftValue === rightValue) {
    return { className: "match", statusLabel: "Match" };
  }

  return { className: "different", statusLabel: "Different" };
};

const createValueCell = (value) => {
  const cell = document.createElement("td");
  if (value === undefined) {
    cell.textContent = MISSING_INDICATOR;
    cell.classList.add("missing-value");
  } else {
    cell.textContent = value;
  }
  return cell;
};

const createSelectionCell = (key) => {
  const cell = document.createElement("td");
  cell.className = "results__select-cell";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "results__select";
  checkbox.dataset.key = key;
  checkbox.checked = selectedKeys.has(key);
  checkbox.setAttribute("aria-label", `Select ${key}`);

  cell.appendChild(checkbox);
  return cell;
};

const cloneArray = (array) => array.map((item) => {
  if (Array.isArray(item)) {
    return item.slice();
  }
  if (item && typeof item === "object") {
    return { ...item };
  }
  return item;
});

const applyValueToStructure = (parseResult, key, value, preferredFormat) => {
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
};

const summarizeStats = (stats, total) => {
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
};

const compare = () => {
  statusEl.textContent = "";
  statusEl.classList.remove("error");
  tbody.innerHTML = "";

  let leftData;
  let rightData;

  try {
    leftData = parseInput(leftInput.value);
    rightData = parseInput(rightInput.value);
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.classList.add("error");
    resultTable.hidden = true;
    selectedKeys.clear();
    updateSelectionUI();
    return null;
  }

  const allKeys = new Set([
    ...Object.keys(leftData.normalized),
    ...Object.keys(rightData.normalized),
  ]);

  if (allKeys.size === 0) {
    statusEl.textContent = "No variables detected. Paste JSON into the panels and compare again.";
    resultTable.hidden = true;
    selectedKeys.clear();
    updateSelectionUI();
    return null;
  }

  const stats = {
    match: 0,
    different: 0,
    onlySource: 0,
    onlyTarget: 0,
  };

  const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));
  const keysSet = new Set(sortedKeys);
  Array.from(selectedKeys).forEach((key) => {
    if (!keysSet.has(key)) {
      selectedKeys.delete(key);
    }
  });

  sortedKeys.forEach((key) => {
      const leftValue = leftData.normalized[key];
      const rightValue = rightData.normalized[key];
      const { className, statusLabel } = classifyRow(leftValue, rightValue);

      const row = document.createElement("tr");
      row.className = className;
      row.dataset.key = key;

      row.appendChild(createSelectionCell(key));

      const nameCell = document.createElement("td");
      nameCell.textContent = key;
      row.appendChild(nameCell);

      row.appendChild(createValueCell(leftValue));
      row.appendChild(createValueCell(rightValue));

      const statusCell = document.createElement("td");
      statusCell.textContent = statusLabel;
      row.appendChild(statusCell);

      if (className === "match") {
        stats.match += 1;
      } else if (className === "different") {
        stats.different += 1;
      } else if (className === "only-source") {
        stats.onlySource += 1;
      } else if (className === "only-target") {
        stats.onlyTarget += 1;
      }

      tbody.appendChild(row);
    });

  resultTable.hidden = false;
  const summary = summarizeStats(stats, allKeys.size);
  statusEl.textContent = summary;
  updateSelectionUI();
  return summary;
};

const copySelected = (copyFromRight) => {
  if (selectedKeys.size === 0) {
    return;
  }

  const keys = Array.from(selectedKeys);
  const sourceInput = copyFromRight ? rightInput : leftInput;
  const targetInput = copyFromRight ? leftInput : rightInput;
  const destinationLabel = copyFromRight ? "source" : "target";
  const originLabel = copyFromRight ? "target" : "source";

  try {
    const sourceData = parseInput(sourceInput.value);
    let targetData = parseInput(targetInput.value);

    const missingKeys = [];
    let copiedCount = 0;

    keys.forEach((key) => {
      const sourceValue = sourceData.normalized[key];
      if (sourceValue === undefined) {
        missingKeys.push(key);
        return;
      }

      const update = applyValueToStructure(
        targetData,
        key,
        sourceValue,
        sourceData.format === "empty" ? undefined : sourceData.format
      );

      targetInput.value = update.text;
      targetData = parseInput(update.text);
      copiedCount += 1;
    });

    const summary = compare();
    let message = "";
    if (copiedCount === 0) {
      message = `No values copied. None of the selected variables exist on the ${originLabel} side.`;
      if (summary) {
        message += ` ${summary}`;
      }
      statusEl.classList.add("error");
    } else {
      message = `Copied ${copiedCount} selected variable${copiedCount === 1 ? "" : "s"} to the ${destinationLabel} environment.`;
      if (missingKeys.length) {
        message += ` Skipped ${missingKeys.length} missing on the ${originLabel} side (${missingKeys.join(", ")}).`;
      }
      if (summary) {
        message += ` ${summary}`;
      }
      statusEl.classList.remove("error");
    }

    statusEl.textContent = message;
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.classList.add("error");
  }
};

compareButton.addEventListener("click", () => {
  compare();
});

leftInput.addEventListener("input", () => {
  compare();
});

rightInput.addEventListener("input", () => {
  compare();
});

clearButton.addEventListener("click", () => {
  leftInput.value = "";
  rightInput.value = "";
  tbody.innerHTML = "";
  resultTable.hidden = true;
  statusEl.textContent = "Cleared inputs.";
  statusEl.classList.remove("error");
  selectedKeys.clear();
  updateSelectionUI();
  leftInput.focus();
});

tbody.addEventListener("change", (event) => {
  const target = event.target;
  if (!target || !target.matches('input[type="checkbox"][data-key]')) {
    return;
  }

  const { key } = target.dataset;
  if (!key) {
    return;
  }

  if (target.checked) {
    selectedKeys.add(key);
  } else {
    selectedKeys.delete(key);
  }
  updateSelectionUI();
});

copyToSourceButton.addEventListener("click", () => {
  copySelected(true);
});

copyToTargetButton.addEventListener("click", () => {
  copySelected(false);
});

const azureSampleSource = [
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
  {
    name: "FeatureToggle:NewHomePage",
    value: "true",
    slotSetting: false,
  },
];

const azureSampleTarget = [
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
    name: "FeatureToggle:NewHomePage",
    value: "false",
    slotSetting: false,
  },
  {
    name: "NewSetting",
    value: "Enabled",
    slotSetting: false,
  },
];

leftInput.value = JSON.stringify(azureSampleSource, null, 2);
rightInput.value = JSON.stringify(azureSampleTarget, null, 2);
compare();
