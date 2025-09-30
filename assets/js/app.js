const leftInput = document.getElementById("left-json");
const rightInput = document.getElementById("right-json");
const compareButton = document.getElementById("compare");
const clearButton = document.getElementById("clear");
const statusEl = document.getElementById("status");
const resultTable = document.getElementById("result-table");
const tbody = resultTable.querySelector("tbody");

const MISSING_INDICATOR = "—";

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

const createActionButton = (direction, label, icon, key) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.dataset.action = "copy";
  button.dataset.direction = direction;
  button.dataset.key = key;
  button.title = label;
  button.innerHTML = `<span aria-hidden="true">${icon}</span><span>${label}</span>`;
  return button;
};

const createActionsCell = (leftValue, rightValue, key) => {
  const cell = document.createElement("td");
  if (leftValue === undefined && rightValue === undefined) {
    cell.textContent = MISSING_INDICATOR;
    cell.classList.add("missing-value");
    return cell;
  }

  const container = document.createElement("div");
  container.className = "results__actions";

  if (rightValue !== undefined) {
    container.appendChild(createActionButton("to-left", "Copy to source", "←", key));
  }

  if (leftValue !== undefined) {
    container.appendChild(createActionButton("to-right", "Copy to target", "→", key));
  }

  if (!container.children.length) {
    cell.textContent = MISSING_INDICATOR;
    cell.classList.add("missing-value");
    return cell;
  }

  cell.appendChild(container);
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
    return null;
  }

  const allKeys = new Set([
    ...Object.keys(leftData.normalized),
    ...Object.keys(rightData.normalized),
  ]);

  if (allKeys.size === 0) {
    statusEl.textContent = "No variables detected. Paste JSON into the panels and compare again.";
    resultTable.hidden = true;
    return null;
  }

  const stats = {
    match: 0,
    different: 0,
    onlySource: 0,
    onlyTarget: 0,
  };

  Array.from(allKeys)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const leftValue = leftData.normalized[key];
      const rightValue = rightData.normalized[key];
      const { className, statusLabel } = classifyRow(leftValue, rightValue);

      const row = document.createElement("tr");
      row.className = className;
      row.dataset.key = key;

      const nameCell = document.createElement("td");
      nameCell.textContent = key;
      row.appendChild(nameCell);

      row.appendChild(createValueCell(leftValue));
      row.appendChild(createValueCell(rightValue));

      const statusCell = document.createElement("td");
      statusCell.textContent = statusLabel;
      row.appendChild(statusCell);

      row.appendChild(createActionsCell(leftValue, rightValue, key));

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
  return summary;
};

compareButton.addEventListener("click", () => {
  compare();
});

clearButton.addEventListener("click", () => {
  leftInput.value = "";
  rightInput.value = "";
  tbody.innerHTML = "";
  resultTable.hidden = true;
  statusEl.textContent = "Cleared inputs.";
  statusEl.classList.remove("error");
  leftInput.focus();
});

tbody.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-action=\"copy\"]");
  if (!target) {
    return;
  }

  const direction = target.dataset.direction;
  const key = target.dataset.key;
  if (!direction || !key) {
    return;
  }

  const copyFromRight = direction === "to-left";
  const sourceInput = copyFromRight ? rightInput : leftInput;
  const targetInput = copyFromRight ? leftInput : rightInput;

  try {
    const sourceData = parseInput(sourceInput.value);
    const targetData = parseInput(targetInput.value);
    const sourceValue = sourceData.normalized[key];

    if (sourceValue === undefined) {
      statusEl.textContent = `Cannot copy ${key}: the value is missing on the source side.`;
      statusEl.classList.add("error");
      return;
    }

    const update = applyValueToStructure(
      targetData,
      key,
      sourceValue,
      sourceData.format === "empty" ? undefined : sourceData.format
    );

    targetInput.value = update.text;
    const summary = compare();
    if (summary) {
      const destinationLabel = copyFromRight ? "source" : "target";
      statusEl.textContent = `Copied ${key} to the ${destinationLabel} environment. ${summary}`;
      statusEl.classList.remove("error");
    }
  } catch (error) {
    statusEl.textContent = error.message;
    statusEl.classList.add("error");
  }
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
