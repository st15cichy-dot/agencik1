import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { captureSnapshot, verifyDevelopment } from "../scripts/verify-development.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function withRepository(test) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agencik-development-test-"));
  try {
    git(cwd, ["init", "--quiet"]);
    fs.writeFileSync(path.join(cwd, ".gitignore"), ".verification-output/\n");
    fs.writeFileSync(path.join(cwd, "source.txt"), "original source\n");
    git(cwd, ["add", "--all"]);
    git(cwd, ["-c", "user.name=Development Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "test fixture"]);
    fs.mkdirSync(path.join(cwd, ".verification-output"));
    await test(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function nodeCheck(name, source, timeoutMs = 3000, extraArgs = []) {
  return { name, command: process.execPath, args: ["-e", source, ...extraArgs], timeoutMs };
}

await withRepository(async (cwd) => {
  const before = captureSnapshot(cwd);
  assert.equal(before.commit, git(cwd, ["rev-parse", "HEAD"]));
  assert.match(before.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(captureSnapshot(cwd), before, "unchanged source snapshot is stable");
  fs.mkdirSync(path.join(cwd, "nested"));
  assert.deepEqual(captureSnapshot(path.join(cwd, "nested")), before, "snapshots bind the whole repository when invoked from a subdirectory");
  const outputPath = path.join(cwd, ".verification-output", "report.json");
  const report = await verifyDevelopment({
    cwd, outputPath,
    commands: [
      nodeCheck("implementation tests", "const fs=require('node:fs');if(fs.readFileSync('source.txt','utf8')!=='original source\\n')process.exit(1)"),
      nodeCheck("literal arguments", "require('node:fs').writeFileSync('.verification-output/literal.txt', process.argv[1])", 3000, ["$(touch injected); literal argument"]),
    ],
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.commit, before.commit);
  assert.equal(report.sourceFingerprint, before.fingerprint);
  assert.deepEqual(report.before, before);
  assert.deepEqual(report.after, before);
  assert.equal(report.sourceChanged, false);
  assert.deepEqual(report.checks.map((check) => check.status), ["PASS", "PASS"]);
  assert.equal(fs.readFileSync(path.join(cwd, ".verification-output", "literal.txt"), "utf8"), "$(touch injected); literal argument");
  assert.equal(fs.existsSync(path.join(cwd, "injected")), false, "commands run without shell interpretation");
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, "utf8")), report, "persisted evidence matches returned result");
  assert.equal(report.independentReview.automated, false);
  assert.equal(report.independentReview.status, "REQUIRED", "passing commands do not fabricate independent code review");
});

await withRepository(async (cwd) => {
  const outputPath = path.join(cwd, ".verification-output", "failure.json");
  const report = await verifyDevelopment({ cwd, outputPath, commands: [
    nodeCheck("failed tests", "process.exit(7)"),
    nodeCheck("must skip", "require('node:fs').writeFileSync('.verification-output/skipped.txt','unexpected')"),
  ] });
  assert.equal(report.status, "FAIL");
  assert.equal(report.checks[0].status, "FAIL");
  assert.equal(report.checks[0].exitCode, 7);
  assert.equal(report.checks[1].status, "SKIPPED");
  assert.equal(fs.existsSync(path.join(cwd, ".verification-output", "skipped.txt")), false);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).status, "FAIL");
});

await withRepository(async (cwd) => {
  const before = captureSnapshot(cwd);
  const report = await verifyDevelopment({
    cwd, outputPath: path.join(cwd, ".verification-output", "edited-source.json"),
    commands: [nodeCheck("mutating test", "require('node:fs').writeFileSync('source.txt','changed during verification\\n')")],
  });
  assert.equal(report.checks[0].status, "PASS", "the command itself succeeded");
  assert.equal(report.status, "FAIL", "successful tests cannot attest changed source");
  assert.equal(report.sourceChanged, true);
  assert.equal(report.before.fingerprint, before.fingerprint);
  assert.notEqual(report.after.fingerprint, before.fingerprint);
});

await withRepository(async (cwd) => {
  const original = captureSnapshot(cwd);
  fs.unlinkSync(path.join(cwd, "source.txt"));
  assert.notEqual(captureSnapshot(cwd).fingerprint, original.fingerprint, "tracked deletion invalidates evidence");
  fs.writeFileSync(path.join(cwd, "source.txt"), "original source\n");
  assert.equal(captureSnapshot(cwd).fingerprint, original.fingerprint);
  fs.chmodSync(path.join(cwd, "source.txt"), 0o755);
  assert.notEqual(captureSnapshot(cwd).fingerprint, original.fingerprint, "executable-bit changes invalidate evidence");
  fs.chmodSync(path.join(cwd, "source.txt"), 0o644);
  assert.equal(captureSnapshot(cwd).fingerprint, original.fingerprint);

  if (process.platform !== "win32") {
    const link = path.join(cwd, "source-link");
    fs.symlinkSync("source.txt", link);
    const linked = captureSnapshot(cwd);
    fs.unlinkSync(link);
    fs.symlinkSync("missing-source.txt", link);
    assert.notEqual(captureSnapshot(cwd).fingerprint, linked.fingerprint, "symlink target changes invalidate evidence without following targets");
    fs.unlinkSync(link);
    assert.equal(captureSnapshot(cwd).fingerprint, original.fingerprint);
  }

  // NUL-delimited Git paths and byte hashing must cover binary source and unusual names.
  const binaryPath = path.join(cwd, "untracked source with spaces\nand newline.bin");
  fs.writeFileSync(binaryPath, Buffer.from([0, 255, 1, 0, 128]));
  const withUntracked = captureSnapshot(cwd);
  assert.notEqual(withUntracked.fingerprint, original.fingerprint, "untracked source is included");
  fs.writeFileSync(binaryPath, Buffer.from([0, 255, 2, 0, 128]));
  assert.notEqual(captureSnapshot(cwd).fingerprint, withUntracked.fingerprint, "binary byte changes invalidate evidence");
  git(cwd, ["add", "--all"]);
  git(cwd, ["-c", "user.name=Development Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "tracked binary with unusual filename"]);
  const trackedBinary = captureSnapshot(cwd);
  fs.writeFileSync(binaryPath, Buffer.from([0, 255, 3, 0, 128]));
  assert.notEqual(captureSnapshot(cwd).fingerprint, trackedBinary.fingerprint, "tracked binary names and byte changes are covered");
  fs.unlinkSync(binaryPath);
  const beforeArtifact = captureSnapshot(cwd);
  fs.writeFileSync(path.join(cwd, ".verification-output", "artifact.json"), "{}");
  assert.equal(captureSnapshot(cwd).fingerprint, beforeArtifact.fingerprint, "ignored verification artifacts do not invalidate their own report");
  git(cwd, ["-c", "user.name=Development Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "new head with same files"]);
  const newHead = captureSnapshot(cwd);
  assert.notEqual(newHead.commit, original.commit);
  assert.notEqual(newHead.fingerprint, original.fingerprint, "evidence is bound to the exact commit, even with identical files");
});

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      // A terminated child can remain as a zombie until the container reaps it.
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      return state !== "Z";
    }
    return true;
  } catch (error) {
    if (error.code === "ESRCH" || error.code === "ENOENT") return false;
    throw error;
  }
}

await withRepository(async (cwd) => {
  let childPid;
  try {
    const report = await verifyDevelopment({
      cwd, outputPath: path.join(cwd, ".verification-output", "timeout.json"),
      commands: [
        nodeCheck("timeout with descendant", "const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});fs.writeFileSync('.verification-output/child.pid',String(child.pid));setInterval(()=>{},1000)", 600),
        nodeCheck("after timeout", "process.exit(0)"),
      ],
    });
    childPid = Number(fs.readFileSync(path.join(cwd, ".verification-output", "child.pid"), "utf8"));
    assert.equal(report.status, "FAIL");
    assert.equal(report.checks[0].status, "TIMEOUT");
    assert.equal(report.checks[1].status, "SKIPPED");
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    if (process.platform !== "win32") assert.equal(processAlive(childPid), false, "timed out process-group descendants must not survive");
  } finally {
    if (childPid && processAlive(childPid)) process.kill(childPid, "SIGKILL");
  }
});

await withRepository(async (cwd) => {
  const report = await verifyDevelopment({
    cwd, outputPath: path.join(cwd, ".verification-output", "missing-command.json"),
    commands: [
      { name: "missing executable", command: path.join(cwd, "does-not-exist"), args: [], timeoutMs: 1000 },
      nodeCheck("after missing executable", "require('node:fs').writeFileSync('.verification-output/must-not-run','unexpected')"),
    ],
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.checks[0].status, "FAIL");
  assert.equal(report.checks[1].status, "SKIPPED");
  assert.equal(fs.existsSync(path.join(cwd, ".verification-output", "must-not-run")), false);
});

await withRepository(async (cwd) => {
  const report = await verifyDevelopment({ cwd, commands: [], outputPath: path.join(cwd, ".verification-output", "empty.json") });
  assert.equal(report.status, "FAIL", "no commands means no verification evidence");
  assert.equal(report.independentReview.status, "REQUIRED");
});

await withRepository(async (cwd) => {
  const report = await verifyDevelopment({
    cwd, outputPath: path.join(cwd, ".verification-output", "overflow-timeout.json"),
    commands: [nodeCheck("invalid overflowing timeout", "require('node:fs').writeFileSync('.verification-output/overflow-command-ran','unexpected')", 2 ** 31)],
  });
  assert.equal(report.status, "FAIL", "timeouts beyond Node's timer bound are rejected");
  assert.equal(report.checks.length, 0, "invalid timeout is rejected before spawning any process");
  assert.equal(fs.existsSync(path.join(cwd, ".verification-output", "overflow-command-ran")), false);
});

const invalidRepositoryParent = fs.mkdtempSync(path.join(os.tmpdir(), "agencik-private-repository-test-"));
try {
  const cwd = path.join(invalidRepositoryParent, "missing-repository");
  const outputPath = "verification.json";
  const report = await verifyDevelopment({ cwd, outputPath, commands: [nodeCheck("cannot verify missing repository", "process.exit(0)")] });
  assert.equal(report.status, "FAIL");
  assert.equal(report.checks.length, 0);
  assert.deepEqual(report.errors, ["Source snapshot could not be captured"]);
  const evidence = fs.readFileSync(path.join(cwd, outputPath), "utf8");
  assert.equal(evidence.includes(invalidRepositoryParent), false, "snapshot failures do not expose private filesystem paths in evidence");
  assert.deepEqual(JSON.parse(evidence), report);
} finally {
  fs.rmSync(invalidRepositoryParent, { recursive: true, force: true });
}

console.log("development collaboration integration suite: OK");
