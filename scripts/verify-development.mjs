import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_CHECKS = [
  { name: "test-core", command: "npm", args: ["run", "test-core"], timeoutMs: 300_000 },
  { name: "build", command: "npm", args: ["run", "build"], timeoutMs: 720_000 },
];

// Length prefixes and raw Git path bytes also handle spaces, newlines and symlinks.
export function captureSnapshot(cwd = process.cwd()) {
  const requestedRoot = path.resolve(cwd);
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: requestedRoot })
    .toString("utf8").replace(/\n$/, "");
  const git = (args) => execFileSync("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const commit = git(["rev-parse", "HEAD"]).toString("ascii").trim();
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const entries = new Map();
  let start = 0;
  for (let end = 0; end < listed.length; end += 1) {
    if (listed[end] === 0) {
      const name = listed.subarray(start, end);
      entries.set(name.toString("hex"), name);
      start = end + 1;
    }
  }
  const hash = createHash("sha256");
  const add = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };
  add("agencik1-development-snapshot-v1");
  add(commit);
  for (const name of [...entries.values()].sort(Buffer.compare)) {
    add(name);
    const filename = Buffer.concat([Buffer.from(root + path.sep), name]);
    let stat;
    try {
      stat = fs.lstatSync(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      add("deleted");
      continue;
    }
    add(String(stat.mode & 0o111));
    if (stat.isSymbolicLink()) {
      add("symlink");
      add(fs.readlinkSync(filename, { encoding: "buffer" }));
    } else if (stat.isFile()) {
      add("file");
      add(fs.readFileSync(filename));
    } else {
      // Reject submodules/special files rather than attesting unverified contents.
      throw new Error("Source snapshot contains an unsupported file type");
    }
  }
  return { commit, fingerprint: hash.digest("hex"), fileCount: entries.size };
}

function runCheck(check, cwd) {
  const startedAt = new Date().toISOString();
  return new Promise((resolve) => {
    let child;
    let timeout;
    let escalation;
    let timedOut = false;
    let settled = false;
    let exitCode = null;
    let signal = null;
    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(escalation);
      resolve({ status, startedAt, finishedAt: new Date().toISOString(), exitCode, signal, ...(error ? { error } : {}) });
    };
    const kill = (nextSignal) => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, nextSignal);
        else child.kill(nextSignal);
      } catch (error) {
        if (error.code !== "ESRCH") {
          // A failed group signal still gets a best-effort direct-child signal.
          try { child.kill(nextSignal); } catch {}
        }
      }
    };
    try {
      child = spawn(check.command, check.args, {
        cwd, shell: false, stdio: "inherit", detached: process.platform !== "win32",
      });
      child.once("error", () => {
        if (!timedOut) finish("FAIL", "Check process could not be started");
      });
      child.once("close", (code, receivedSignal) => {
        exitCode = code;
        signal = receivedSignal;
        // Keep the escalation alive even when the parent exits after SIGTERM.
        if (!timedOut) finish(code === 0 ? "PASS" : "FAIL");
      });
      timeout = setTimeout(() => {
        timedOut = true;
        kill("SIGTERM");
        escalation = setTimeout(() => {
          kill("SIGKILL");
          finish("TIMEOUT", "Check exceeded its timeout");
        }, 1_000);
      }, check.timeoutMs);
    } catch {
      finish("FAIL", "Check process could not be started");
    }
  });
}

export async function verifyDevelopment({
  cwd = process.cwd(), commands = DEFAULT_CHECKS, outputPath = ".development-output/verification.json",
} = {}) {
  const report = {
    schemaVersion: 1, status: "FAIL", startedAt: new Date().toISOString(), finishedAt: null,
    commit: null, sourceFingerprint: null, before: null, after: null, sourceChanged: null,
    checks: [], errors: [],
    independentReview: { automated: false, status: "REQUIRED", scope: "session-or-human-review-of-diff" },
  };
  let phase = "configuration";
  try {
    if (!Array.isArray(commands) || commands.length === 0 || commands.some((check) =>
      !check || typeof check.name !== "string" || !check.name || typeof check.command !== "string" || !check.command ||
      !Array.isArray(check.args) || check.args.some((arg) => typeof arg !== "string") ||
      !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs <= 0 || check.timeoutMs > 2_147_483_647)) {
      throw new Error("At least one valid check with a positive bounded timeout is required");
    }
    phase = "snapshot";
    report.before = captureSnapshot(cwd);
    report.commit = report.before.commit;
    report.sourceFingerprint = report.before.fingerprint;
    let failed = false;
    phase = "checks";
    for (const check of commands) {
      // Arguments and source contents are intentionally absent from the report.
      const identity = { name: check.name, command: path.basename(check.command), timeoutMs: check.timeoutMs };
      const result = failed ? { status: "SKIPPED", exitCode: null, signal: null } : await runCheck(check, cwd);
      report.checks.push({ ...identity, ...result });
      if (result.status !== "PASS") failed = true;
    }
    phase = "snapshot";
    report.after = captureSnapshot(cwd);
    report.sourceChanged = report.before.fingerprint !== report.after.fingerprint;
    if (report.sourceChanged) report.errors.push("Repository source changed during verification");
    if (!failed && !report.sourceChanged) report.status = "PASS";
  } catch {
    report.errors.push(phase === "configuration" ? "Invalid check configuration" :
      phase === "snapshot" ? "Source snapshot could not be captured" : "Development verification failed");
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      const destination = path.resolve(cwd, outputPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    } catch {
      report.status = "FAIL";
      report.errors.push("Verification report could not be written");
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await verifyDevelopment();
  console.log(`Development verification: ${report.status}; independent code review: REQUIRED`);
  process.exitCode = report.status === "PASS" ? 0 : 1;
}
