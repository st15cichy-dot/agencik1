import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { captureSnapshot, checkProfile, DEFAULT_CHECKS } from "./verify-development.mjs";

// This checks local evidence consistency, not authenticity or independent review.
export function checkDevelopmentEvidence({ cwd = process.cwd(),
  outputPath = ".development-output/verification.json", commands = DEFAULT_CHECKS,
} = {}) {
  const errors = [];
  const result = () => ({ status: errors.length ? "FAIL" : "PASS", errors,
    independentReview: { automated: false, status: "REQUIRED" } });
  const filename = path.resolve(cwd, outputPath);
  const unlocked = () => {
    try { fs.lstatSync(`${filename}.lock`); return false; }
    catch (error) { if (error.code === "ENOENT") return true; throw error; }
  };
  try {
    if (!unlocked()) { errors.push("Verification in progress or interrupted; lock present"); return result(); }
    const content = fs.readFileSync(filename, "utf8");
    const report = JSON.parse(content);
    if (!report || report.schemaVersion !== 2 || report.status !== "PASS" ||
        report.sourceChanged !== false || !Array.isArray(report.errors) || report.errors.length) {
      errors.push("Report is not completed passing evidence");
      return result();
    }
    const current = captureSnapshot(cwd);
    if (report.commit !== current.commit || report.sourceFingerprint !== current.fingerprint ||
        [report.before, report.after].some((snapshot) => !snapshot ||
          snapshot.commit !== current.commit || snapshot.fingerprint !== current.fingerprint ||
          snapshot.fileCount !== current.fileCount)) errors.push("Evidence does not match current sources and HEAD");
    if (!Array.isArray(commands) || !commands.length || report.checkProfile !== checkProfile(commands)) {
      errors.push("Evidence uses a different check profile");
    }
    const time = (value) => typeof value === "string" ? Date.parse(value) : NaN;
    const start = time(report.startedAt), finish = time(report.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start || finish > Date.now()) {
      errors.push("Invalid report timestamps");
    }
    let previousEnd = start;
    if (!Array.isArray(report.checks) || report.checks.length !== commands.length) {
      errors.push("Missing or extra checks");
    } else {
      report.checks.forEach((check, index) => {
        const expected = commands[index];
        const checkStart = time(check?.startedAt), checkEnd = time(check?.finishedAt);
        if (!check || check.name !== expected.name || check.command !== path.basename(expected.command) ||
            check.timeoutMs !== expected.timeoutMs || check.status !== "PASS" || check.exitCode !== 0 ||
            check.signal !== null || check.error || !Number.isFinite(checkStart) || !Number.isFinite(checkEnd) ||
            checkStart < previousEnd || checkEnd < checkStart || checkEnd > finish) {
          errors.push(`Invalid or unsuccessful check ${index + 1}`);
        }
        previousEnd = checkEnd;
      });
    }
    // Reject evidence replaced while checking; do not claim atomic protection of future edits.
    if (!unlocked() || fs.readFileSync(filename, "utf8") !== content) errors.push("Evidence changed during inspection");
  } catch {
    errors.push("Evidence missing, unreadable, malformed or source snapshot unavailable");
  }
  return result();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkDevelopmentEvidence();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 1;
}
