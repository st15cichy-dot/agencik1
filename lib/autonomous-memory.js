import fs from "node:fs";

const CORE = ["latest", "history", "paper", "trades", "journal"];
const INTRODUCED = { governance: 11, executionIntents: 14, preflightAudit: 16, executionQuality: 17 };
const EMPTY = () => ({ latest: null, history: [], paper: null, trades: [], journal: [],
  governance: null, executionIntents: [], preflightAudit: [], executionQuality: { audit: [] } });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const records = (value) => Array.isArray(value) && value.every(object);
const positive = (value) => Number.isFinite(value) && value > 0;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value) => typeof value === "string" && value.length > 0;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function version(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) fail("MEMORY_INVALID_SHAPE");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) fail("MEMORY_INVALID_SHAPE");
  return parts;
}

function beforeIntroduction(parts, minor) {
  return parts[0] === 0 && parts[1] < minor;
}

function checkSafety(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["liveTrading", "brokerConnected", "orderSubmission", "executable", "canSubmitOrders",
      "paperAuthority", "shadowPaperAuthority"].includes(key) && child !== false) fail("MEMORY_UNSAFE_STATE");
    if (key === "brokerAdapter" && child !== "NONE") fail("MEMORY_UNSAFE_STATE");
    if (key === "paperOnly" && child !== true) fail("MEMORY_UNSAFE_STATE");
    checkSafety(child);
  }
}

function validatePaper(paper) {
  if (!object(paper) || paper.schemaVersion !== 1 || paper.currency !== "PLN" ||
    !positive(paper.startingCapitalPln) || !nonnegative(paper.cashPln) ||
    !Number.isFinite(paper.realizedPnlPln) || !nonnegative(paper.totalFeesPln) ||
    !positive(paper.peakEquityPln) || paper.peakEquityPln < paper.startingCapitalPln ||
    !positive(paper.dayStartEquityPln) || typeof paper.dailyHalt !== "boolean" ||
    typeof paper.halted !== "boolean" || !(paper.haltReason === null || typeof paper.haltReason === "string") ||
    !timestamp(paper.lastUpdatedAt) || !records(paper.openPositions) ||
    typeof paper.dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paper.dayKey) ||
    !timestamp(`${paper.dayKey}T00:00:00Z`) ||
    new Date(`${paper.dayKey}T00:00:00Z`).toISOString().slice(0, 10) !== paper.dayKey) fail("MEMORY_INVALID_PAPER");
  const positionIds = new Set();
  for (const position of paper.openPositions) {
    if (!text(position.id) || !text(position.symbol) || position.side !== "LONG" ||
      !["entryMarketPrice", "entryPrice", "stopPrice", "notionalPln", "riskPln"].every((key) => positive(position[key])) ||
      position.stopPrice >= position.entryPrice || !timestamp(position.openedAt) || !timestamp(position.maxHoldUntil)) {
      fail("MEMORY_INVALID_PAPER");
    }
    if (positionIds.has(position.id)) fail("MEMORY_INVALID_PAPER");
    positionIds.add(position.id);
    for (const key of ["lastMarketPrice", "highestMarketPrice", "lowestMarketPrice", "stopPct"]) {
      if (key in position && !positive(position[key])) fail("MEMORY_INVALID_PAPER");
    }
    if ("entryFeePln" in position && !nonnegative(position.entryFeePln)) fail("MEMORY_INVALID_PAPER");
    for (const key of ["lastCheckedAt", "entrySignalAt"]) {
      if (key in position && position[key] !== null && !timestamp(position[key])) fail("MEMORY_INVALID_PAPER");
    }
  }
}

// Restored state is validated, never repaired or replaced with initial capital.
export function loadAutonomousMemory({ paths = {}, mode } = {}) {
  if (!object(paths)) fail("MEMORY_INVALID_PATHS");
  const values = EMPTY();
  const present = new Set();
  let configured = false;
  for (const key of Object.keys(values)) {
    const filename = paths[key];
    if (filename === undefined || filename === null || filename === "") continue;
    if (typeof filename !== "string") fail("MEMORY_INVALID_PATHS");
    configured = true;
    try {
      fs.lstatSync(filename);
      present.add(key);
    } catch (error) {
      if (error.code !== "ENOENT") fail("MEMORY_READ_FAILED");
    }
  }
  const selectedMode = mode === undefined ? (configured ? "RESTORE" : "BOOTSTRAP") : mode;
  if (!["BOOTSTRAP", "RESTORE"].includes(selectedMode)) fail("MEMORY_INVALID_MODE");
  if (selectedMode === "BOOTSTRAP") {
    if (present.size) fail("MEMORY_BOOTSTRAP_WITH_EXISTING_STATE");
    return { ...values, mode: selectedMode };
  }
  if (CORE.some((key) => !present.has(key))) fail("MEMORY_REQUIRED_FILE_MISSING");
  for (const key of present) {
    let content;
    try { content = fs.readFileSync(paths[key], "utf8"); } catch { fail("MEMORY_READ_FAILED"); }
    try { values[key] = JSON.parse(content); } catch { fail("MEMORY_INVALID_JSON"); }
  }
  if (!object(values.latest) || !timestamp(values.latest.completedAt)) fail("MEMORY_INVALID_SHAPE");
  const appVersion = version(values.latest.appVersion);
  const safeguards = values.latest.safeguards;
  if (!object(safeguards) || safeguards.liveTrading !== false || safeguards.brokerConnected !== false ||
    safeguards.paperOnly !== true || (!beforeIntroduction(appVersion, 14) &&
      (safeguards.orderSubmission !== false || safeguards.brokerAdapter !== "NONE"))) fail("MEMORY_UNSAFE_STATE");
  for (const key of ["history", "trades", "journal", "executionIntents", "preflightAudit"]) {
    if (!records(values[key])) fail("MEMORY_INVALID_SHAPE");
  }
  for (const key of ["screen", "deep"]) {
    if (key in values.latest && !records(values.latest[key])) fail("MEMORY_INVALID_SHAPE");
  }
  for (const [key, minor] of Object.entries(INTRODUCED)) {
    if (!present.has(key) && !beforeIntroduction(appVersion, minor)) fail("MEMORY_REQUIRED_FILE_MISSING");
  }
  if (present.has("governance") && (!object(values.governance) || !records(values.governance.records) ||
    values.governance.mode !== "SHADOW_ONLY" || values.governance.paperAuthority !== false)) fail("MEMORY_INVALID_SHAPE");
  if (!object(values.executionQuality) || !records(values.executionQuality.audit)) fail("MEMORY_INVALID_SHAPE");
  if (present.has("executionQuality") && values.executionQuality.mode !== "SHADOW_ONLY") fail("MEMORY_UNSAFE_STATE");
  validatePaper(values.paper);
  checkSafety(values);
  return { ...values, mode: selectedMode };
}
