import fs from "node:fs";
import path from "node:path";
import { evaluateWatchdog } from "../lib/watchdog.js";

const latestPath = process.env.LATEST_PATH || ".watchdog/latest.json";
const outDir = process.env.WATCHDOG_OUT_DIR || ".watchdog-output";

function readLatest() {
  try {
    return JSON.parse(fs.readFileSync(latestPath, "utf8"));
  } catch {
    return null;
  }
}

fs.mkdirSync(outDir, { recursive: true });

const result = evaluateWatchdog(
  readLatest(),
  process.env.WATCHDOG_NOW || new Date().toISOString()
);

fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify(result, null, 2) + "\n"
);

console.log(JSON.stringify(result, null, 2));
