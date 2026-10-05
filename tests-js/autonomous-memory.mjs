import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAutonomousMemory } from "../lib/autonomous-memory.js";
import { defaultPaperState, openPaperPosition, closePaperPosition, paperSnapshot, publicPaperSummary } from "../lib/paper-portfolio.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const filenames = {
  latest: "latest.json", history: "history.json", paper: "paper.json", trades: "paper-trades.json",
  journal: "journal.json", governance: "governance.json", executionIntents: "execution-intents.json",
  preflightAudit: "preflight-audit.json", executionQuality: "execution-quality.json",
};
const coreKeys = ["latest", "history", "paper", "trades", "journal"];
const diagnosticKeys = ["governance", "executionIntents", "preflightAudit", "executionQuality"];
const now = "2026-10-05T15:15:29.411Z";

function temporary(test) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agencik-memory-test-"));
  try { return test(cwd); } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

function fixture(cwd, version = "0.18.0") {
  const paper = defaultPaperState(now);
  const opened = openPaperPosition(paper, paperSnapshot(paper, {}), {
    symbol: "BTCUSDT", strategyId: "breakout", strategyName: "Breakout", config: {},
    rawPrice: 100, atrPct: 1, nowIso: "2026-10-03T20:09:34.312Z",
  });
  assert.equal(opened.opened, true);
  const position = structuredClone(opened.position);
  const closed = closePaperPosition(paper, position.id, { rawExitPrice: 102, nowIso: now, reason: "STRATEGY_EXIT" });
  assert.equal(closed.closed, true);
  const trades = [closed.trade];
  const values = {
    latest: {
      schemaVersion: 2, appVersion: version, mode: "AUTONOMOUS_RESEARCH_AND_PAPER",
      startedAt: "2026-10-05T15:15:17.745Z", completedAt: now,
      safeguards: { liveTrading: false, brokerConnected: false, orderSubmission: false, brokerAdapter: "NONE", paperOnly: true },
      paperPortfolio: publicPaperSummary(paper, trades, {}, now),
    },
    history: [{ at: now, paper: { equityPln: paper.cashPln, totalPnlPln: paper.realizedPnlPln, drawdownPct: 0 }, failures: [] }],
    paper, trades, journal: [],
    governance: { schemaVersion: 1, mode: "SHADOW_ONLY", paperAuthority: false, records: [] },
    executionIntents: [], preflightAudit: [],
    executionQuality: { schemaVersion: 1, mode: "SHADOW_ONLY", executable: false, canSubmitOrders: false, brokerConnected: false, brokerAdapter: "NONE", audit: [] },
  };
  const paths = Object.fromEntries(Object.entries(filenames).map(([key, filename]) => [key, path.join(cwd, filename)]));
  for (const [key, filename] of Object.entries(paths)) fs.writeFileSync(filename, JSON.stringify(values[key]) + "\n");
  return { values, paths, position };
}

function rejectsMemory(action) {
  assert.throws(action, (error) => /^MEMORY_/.test(error.code || ""), "unsafe or incomplete memory must fail with a fixed MEMORY error");
}

temporary((cwd) => {
  const { paths, values } = fixture(cwd);
  const loaded = loadAutonomousMemory({ paths });
  assert.equal(loaded.mode, "RESTORE");
  for (const key of Object.keys(filenames)) assert.deepEqual(loaded[key], values[key], `${key} is restored without resets`);
  const sourceBefore = Object.fromEntries(Object.entries(paths).map(([key, filename]) => [key, fs.readFileSync(filename, "utf8")]));
  values.paper.halted = true;
  values.paper.haltReason = "HARD_DRAWDOWN_STOP";
  values.paper.dailyHalt = true;
  fs.writeFileSync(paths.paper, JSON.stringify(values.paper));
  const halted = loadAutonomousMemory({ paths, mode: "RESTORE" });
  assert.equal(halted.paper.halted, true);
  assert.equal(halted.paper.dailyHalt, true);
  assert.equal(halted.paper.haltReason, "HARD_DRAWDOWN_STOP");
  assert.equal(halted.paper.cashPln, values.paper.cashPln);
  assert.equal(halted.paper.realizedPnlPln, values.paper.realizedPnlPln);
  for (const key of Object.keys(filenames).filter((key) => key !== "paper")) assert.equal(fs.readFileSync(paths[key], "utf8"), sourceBefore[key], "loader never modifies persisted input");
});

temporary((cwd) => {
  const empty = loadAutonomousMemory();
  assert.equal(empty.mode, "BOOTSTRAP");
  assert.equal(empty.paper, null);
  assert.equal(empty.latest, null);
  assert.deepEqual(empty.trades, []);
  const paths = Object.fromEntries(Object.entries(filenames).map(([key, filename]) => [key, path.join(cwd, filename)]));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
  rejectsMemory(() => loadAutonomousMemory({ paths, mode: "RESTORE" }));
  assert.equal(loadAutonomousMemory({ paths, mode: "BOOTSTRAP" }).mode, "BOOTSTRAP");
  fs.writeFileSync(paths.paper, "{}");
  rejectsMemory(() => loadAutonomousMemory({ paths, mode: "BOOTSTRAP" }));
});

for (const key of [...coreKeys, ...diagnosticKeys]) temporary((cwd) => {
  const { paths } = fixture(cwd);
  fs.unlinkSync(paths[key]);
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});

temporary((cwd) => {
  const { paths } = fixture(cwd, "0.10.0");
  for (const key of diagnosticKeys) fs.unlinkSync(paths[key]);
  const loaded = loadAutonomousMemory({ paths });
  assert.equal(loaded.mode, "RESTORE");
  assert.equal(loaded.governance, null);
  assert.deepEqual(loaded.executionIntents, []);
  assert.deepEqual(loaded.preflightAudit, []);
  assert.deepEqual(loaded.executionQuality, { audit: [] });
  fs.writeFileSync(paths.governance, "malformed optional diagnostic");
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});

for (const [key, shape] of [["paper", []], ["latest", null], ["history", {}], ["trades", [null]], ["journal", ["entry"]], ["governance", { records: {} }], ["executionIntents", {}], ["preflightAudit", [1]], ["executionQuality", { audit: {} }]]) temporary((cwd) => {
  const { paths } = fixture(cwd);
  fs.writeFileSync(paths[key], JSON.stringify(shape));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});

for (const [key, value] of [["cashPln", -1], ["startingCapitalPln", 0], ["totalFeesPln", -1], ["peakEquityPln", null], ["realizedPnlPln", null], ["halted", "false"], ["dailyHalt", "true"], ["currency", "USD"]]) temporary((cwd) => {
  const { paths, values } = fixture(cwd);
  values.paper[key] = value;
  fs.writeFileSync(paths.paper, JSON.stringify(values.paper));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});

for (const [key, value] of [["liveTrading", true], ["brokerConnected", true], ["paperOnly", false], ["orderSubmission", true], ["brokerAdapter", "LIVE"]]) temporary((cwd) => {
  const { paths, values } = fixture(cwd);
  values.latest.safeguards[key] = value;
  fs.writeFileSync(paths.latest, JSON.stringify(values.latest));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});
temporary((cwd) => {
  const { paths, values } = fixture(cwd);
  values.governance.paperAuthority = true;
  fs.writeFileSync(paths.governance, JSON.stringify(values.governance));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});
temporary((cwd) => {
  const { paths, values } = fixture(cwd);
  values.executionQuality.executable = true;
  fs.writeFileSync(paths.executionQuality, JSON.stringify(values.executionQuality));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
});

temporary((cwd) => {
  const { paths, values, position } = fixture(cwd);
  values.paper.openPositions = [{ ...position, stopPrice: position.entryPrice + 1 }];
  fs.writeFileSync(paths.paper, JSON.stringify(values.paper));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
  values.paper.openPositions = [position, { ...position, symbol: "ETHUSDT" }];
  fs.writeFileSync(paths.paper, JSON.stringify(values.paper));
  rejectsMemory(() => loadAutonomousMemory({ paths }));
  fs.writeFileSync(paths.paper, "{PRIVATE_CORRUPT_PAYLOAD");
  assert.throws(() => loadAutonomousMemory({ paths }), (error) => /^MEMORY_/.test(error.code || "") && !error.message.includes("PRIVATE_CORRUPT_PAYLOAD") && !error.message.includes(cwd));
});

temporary((cwd) => {
  const { paths } = fixture(cwd);
  fs.writeFileSync(paths.paper, "{PRIVATE_CORRUPT_PAYLOAD");
  const preloader = path.join(cwd, "deny-network.mjs");
  fs.writeFileSync(preloader, "import fs from 'node:fs';globalThis.fetch=async()=>{fs.writeFileSync('.network-attempted','unexpected');throw new Error('network denied by memory test')};\n");
  const variables = {
    latest: "PREVIOUS_LATEST_PATH", history: "PREVIOUS_HISTORY_PATH", paper: "PREVIOUS_PAPER_PATH", trades: "PREVIOUS_TRADES_PATH",
    journal: "PREVIOUS_JOURNAL_PATH", governance: "PREVIOUS_GOVERNANCE_PATH", executionIntents: "PREVIOUS_EXECUTION_INTENTS_PATH",
    preflightAudit: "PREVIOUS_PREFLIGHT_AUDIT_PATH", executionQuality: "PREVIOUS_EXECUTION_QUALITY_PATH",
  };
  const env = { ...process.env, AUTONOMOUS_MEMORY_MODE: "RESTORE", ...Object.fromEntries(Object.entries(paths).map(([key, filename]) => [variables[key], filename])) };
  const result = spawnSync(process.execPath, ["--import", preloader, path.join(repositoryRoot, "scripts", "autonomous-research.mjs")], { cwd, env, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  assert.equal(result.error, undefined, "corrupt memory must terminate promptly instead of reaching market-data retry loops");
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(cwd, ".network-attempted")), false, "validation precedes all market-data requests");
  assert.equal(fs.existsSync(path.join(cwd, ".auto-output")), false, "validation failure produces no candidate output memory");
  assert.equal((result.stdout + result.stderr).includes("PRIVATE_CORRUPT_PAYLOAD"), false);
});

function restoreFixture(cwd, behavior, version = "0.18.0", seedExistingMemory = false) {
  const inputs = path.join(cwd, "source-memory");
  fs.mkdirSync(inputs);
  const { values } = fixture(inputs, version);
  if (behavior === "restore-halted") {
    values.paper.halted = true;
    values.paper.dailyHalt = true;
    values.paper.haltReason = "HARD_DRAWDOWN_STOP";
    fs.writeFileSync(path.join(inputs, filenames.paper), JSON.stringify(values.paper) + "\n");
  }
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin);
  const sha = "1234567890abcdef1234567890abcdef12345678";
  fs.writeFileSync(path.join(bin, "git"), `#!/usr/bin/env node\nimport fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2),kind=process.env.MEMORY_TEST_GIT_KIND;if(args.includes('ls-remote')){if(kind==='bootstrap')process.exit(2);if(kind==='transport-error')process.exit(128);process.stdout.write('${sha}\\trefs/heads/research-data\\n');}else if(args.includes('fetch')){if(kind==='fetch-error')process.exit(128);}else if(args.includes('rev-parse')){process.stdout.write('${sha}\\n');}else if(args.includes('ls-tree')){const filename=args.at(-1);if(kind==='tree-error')process.exit(128);if(kind==='missing-diagnostic'&&filename==='execution-quality.json')process.exit(0);process.stdout.write(filename+'\\n');}else if(args.includes('show')){const filename=args.at(-1).split(':').at(-1);if(kind==='missing-core'&&filename==='paper.json')process.exit(128);const source=path.join(process.env.MEMORY_TEST_SOURCE,filename);if(!fs.existsSync(source))process.exit(128);process.stdout.write(fs.readFileSync(source));}else{process.stderr.write('Unexpected test Git invocation');process.exit(127);}\n`, { mode: 0o755 });
  // The stub is a module regardless of the temporary directory's package defaults.
  fs.writeFileSync(path.join(bin, "package.json"), '{"type":"module"}\n');
  if (seedExistingMemory) {
    fs.mkdirSync(path.join(cwd, ".auto-memory"));
    fs.writeFileSync(path.join(cwd, ".auto-memory", "paper.json"), '{"doNotReset":true}\n');
  }
  const environmentFile = path.join(cwd, "github-env");
  const result = spawnSync("bash", [path.join(repositoryRoot, "scripts", "restore-autonomous-memory.sh")], {
    cwd, encoding: "utf8", timeout: 5000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, GITHUB_ENV: environmentFile, MEMORY_TEST_GIT_KIND: behavior, MEMORY_TEST_SOURCE: inputs },
  });
  assert.equal(result.error, undefined);
  return { result, environmentFile, values, sha, inputs };
}

temporary((cwd) => {
  const { result, environmentFile } = restoreFixture(cwd, "bootstrap");
  assert.equal(result.status, 0);
  const env = fs.readFileSync(environmentFile, "utf8");
  assert.match(env, /^AUTONOMOUS_MEMORY_MODE=BOOTSTRAP$/m);
  assert.match(env, /^MEMORY_BASE_SHA=$/m);
  assert.equal(fs.existsSync(path.join(cwd, ".auto-memory", "paper.json")), false);
});
for (const behavior of ["transport-error", "fetch-error", "tree-error", "missing-core"]) temporary((cwd) => {
  const { result, environmentFile } = restoreFixture(cwd, behavior);
  assert.notEqual(result.status, 0, `${behavior} must abort rather than bootstrap`);
  if (fs.existsSync(environmentFile)) assert.equal(fs.readFileSync(environmentFile, "utf8").includes("AUTONOMOUS_MEMORY_MODE=BOOTSTRAP"), false);
});
temporary((cwd) => {
  const { result, environmentFile, values, sha, inputs } = restoreFixture(cwd, "restore-halted");
  assert.equal(result.status, 0, result.stderr);
  const env = fs.readFileSync(environmentFile, "utf8");
  assert.match(env, /^AUTONOMOUS_MEMORY_MODE=RESTORE$/m);
  assert.ok(env.includes(`MEMORY_BASE_SHA=${sha}`));
  for (const [key, filename] of Object.entries(filenames)) {
    const output = fs.readFileSync(path.join(cwd, ".auto-memory", filename), "utf8");
    assert.equal(output, fs.readFileSync(path.join(inputs, filename), "utf8"), "restore preserves blob contents exactly");
    assert.deepEqual(JSON.parse(output), values[key]);
  }
});
temporary((cwd) => {
  const { result } = restoreFixture(cwd, "missing-diagnostic");
  assert.notEqual(result.status, 0, "v0.18 diagnostics cannot disappear silently");
});
temporary((cwd) => {
  const { result } = restoreFixture(cwd, "missing-diagnostic", "0.16.0");
  assert.equal(result.status, 0, "legacy v0.16 may omit the subsequently introduced execution-quality artifact");
  assert.equal(fs.existsSync(path.join(cwd, ".auto-memory", "execution-quality.json")), false);
});
temporary((cwd) => {
  const { result } = restoreFixture(cwd, "bootstrap", "0.18.0", true);
  assert.notEqual(result.status, 0, "absent remote branch cannot silently reset existing local memory");
  assert.equal(fs.readFileSync(path.join(cwd, ".auto-memory", "paper.json"), "utf8"), '{"doNotReset":true}\n');
});
temporary((cwd) => {
  const { result } = restoreFixture(cwd, "transport-error", "0.18.0", true);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(cwd, ".auto-memory", "paper.json"), "utf8"), '{"doNotReset":true}\n', "transport failure preserves previous local memory");
});

// A stale second publisher cannot replace the memory written by a first publisher.
temporary((cwd) => {
  const git = (workingDirectory, args) => execFileSync("git", args, { cwd: workingDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remote = path.join(cwd, "remote.git");
  git(cwd, ["init", "--bare", "--quiet", remote]);
  const first = path.join(cwd, "first");
  const second = path.join(cwd, "second");
  fs.mkdirSync(first);
  git(first, ["init", "--quiet"]);
  git(first, ["remote", "add", "origin", remote]);
  const commit = (workingDirectory, value) => {
    fs.writeFileSync(path.join(workingDirectory, "paper.json"), JSON.stringify({ cashPln: value }));
    git(workingDirectory, ["add", "paper.json"]);
    git(workingDirectory, ["-c", "user.name=Memory Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", `memory ${value}`]);
    return git(workingDirectory, ["rev-parse", "HEAD"]);
  };
  const initial = commit(first, 200);
  git(first, ["push", "--quiet", "origin", "HEAD:research-data"]);
  git(cwd, ["clone", "--quiet", "--branch", "research-data", remote, second]);
  const firstPublished = commit(first, 190);
  git(first, ["push", "--quiet", `--force-with-lease=refs/heads/research-data:${initial}`, "origin", "HEAD:research-data"]);
  commit(second, 199);
  const stale = spawnSync("git", ["push", "--quiet", `--force-with-lease=refs/heads/research-data:${initial}`, "origin", "HEAD:research-data"], { cwd: second, encoding: "utf8" });
  assert.notEqual(stale.status, 0, "stale base must not overwrite newly published memory");
  assert.equal(git(remote, ["rev-parse", "refs/heads/research-data"]), firstPublished);
});

console.log("autonomous memory restoration integration suite: OK");
