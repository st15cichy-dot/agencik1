import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { verifyDevelopment } from '../scripts/verify-development.mjs';
import { checkDevelopmentEvidence } from '../scripts/check-development-evidence.mjs';

const moduleURL = new URL('../scripts/verify-development.mjs', import.meta.url).href;
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const nodeCheck = (name, source = 'process.exit(0)', timeoutMs = 5000) => ({ name, command: process.execPath, args: ['-e', source], timeoutMs });
const commands = [nodeCheck('unit'), nodeCheck('build')];
const outputPath = '.development-output/verification.json';
const location = cwd => path.join(cwd, outputPath);
const read = cwd => JSON.parse(fs.readFileSync(location(cwd), 'utf8'));
const write = (cwd, report) => fs.writeFileSync(location(cwd), JSON.stringify(report));
const evidence = (cwd, checks = commands) => checkDevelopmentEvidence({ cwd, commands: checks });
async function fails(cwd, message, checks = commands) {
  const result = await evidence(cwd, checks);
  assert.equal(result.status, 'FAIL', message);
  assert.ok(result.errors.length > 0, `${message}: reason required`);
  assert.equal(result.independentReview.automated, false);
  assert.equal(result.independentReview.status, 'REQUIRED');
}
async function repository(run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agencik-freshness-'));
  try {
    git(cwd, ['init', '--quiet']);
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.development-output/\n');
    fs.writeFileSync(path.join(cwd, 'source.txt'), 'original\n');
    git(cwd, ['add', '.']);
    git(cwd, ['-c', 'user.name=Freshness Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    await run(cwd);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
async function until(predicate, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

await repository(async cwd => {
  await fails(cwd, 'missing report');
  const report = await verifyDevelopment({ cwd, commands });
  assert.equal(report.status, 'PASS');
  assert.equal(report.schemaVersion, 2);
  assert.equal(fs.existsSync(location(cwd) + '.lock'), false, 'successful verification releases lock');
  const profile = createHash('sha256').update(JSON.stringify(commands.map(({ name, command, args, timeoutMs }) => ({ name, command, args, timeoutMs })))).digest('hex');
  assert.equal(report.checkProfile, profile, 'profile binds canonical full check configuration including arguments');
  const accepted = await evidence(cwd);
  assert.equal(accepted.status, 'PASS');
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.independentReview.automated, false);
  assert.equal(accepted.independentReview.status, 'REQUIRED');
  await fails(cwd, 'empty expected check configuration is invalid', []);
  assert.equal((await checkDevelopmentEvidence({ cwd })).status, 'FAIL', 'default profile rejects custom report');
  await fails(cwd, 'different arguments invalidate evidence', [nodeCheck('unit', 'process.exit(1)'), commands[1]]);
  const mutations = [
    ['old schema', r => { r.schemaVersion = 1; }],
    ['unfinished', r => { r.status = 'RUNNING'; r.finishedAt = null; }],
    ['errors', r => { r.errors = ['previous error']; }],
    ['source changed', r => { r.sourceChanged = true; }],
    ['missing unchanged flag', r => { delete r.sourceChanged; }],
    ['top commit mismatch', r => { r.commit = '0'.repeat(40); }],
    ['top fingerprint mismatch', r => { r.sourceFingerprint = '0'.repeat(64); }],
    ['before count mismatch', r => { r.before.fileCount++; }],
    ['after count mismatch', r => { r.after.fileCount++; }],
    ['before fingerprint mismatch', r => { r.before.fingerprint = '0'.repeat(64); }],
    ['after commit mismatch', r => { r.after.commit = '0'.repeat(40); }],
    ['profile absent', r => { delete r.checkProfile; }],
    ['missing check', r => { r.checks.pop(); }],
    ['extra check', r => { r.checks.push(r.checks[0]); }],
    ['check order', r => { r.checks.reverse(); }],
    ['check name', r => { r.checks[0].name = 'unknown'; }],
    ['check command', r => { r.checks[0].command = 'other'; }],
    ['check timeout', r => { r.checks[0].timeoutMs++; }],
    ['check failed', r => { r.checks[0].status = 'FAIL'; }],
    ['check nonzero', r => { r.checks[0].exitCode = 1; }],
    ['check signal', r => { r.checks[0].signal = 'SIGTERM'; }],
    ['report reversed time', r => { r.finishedAt = '2000-01-01T00:00:00.000Z'; }],
    ['invalid time', r => { r.startedAt = 'invalid'; }],
    ['check outside report', r => { r.checks[0].startedAt = '2000-01-01T00:00:00.000Z'; }],
    ['check reversed time', r => { r.checks[0].finishedAt = '2000-01-01T00:00:00.000Z'; }],
    ['check missing time', r => { delete r.checks[0].startedAt; }],
  ];
  for (const [name, mutate] of mutations) {
    const altered = structuredClone(report); mutate(altered); write(cwd, altered);
    await fails(cwd, name);
  }
  write(cwd, report);
  fs.writeFileSync(location(cwd) + '.lock', 'owner');
  await fails(cwd, 'lock invalidates otherwise PASS evidence');
  fs.unlinkSync(location(cwd) + '.lock');
  fs.writeFileSync(location(cwd), '{broken');
  await fails(cwd, 'corrupt report');
  write(cwd, report);
  fs.appendFileSync(path.join(cwd, 'source.txt'), 'changed\n');
  await fails(cwd, 'working source changed after verification');
  fs.writeFileSync(path.join(cwd, 'source.txt'), 'original\n');
  git(cwd, ['-c', 'user.name=Freshness Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'new HEAD']);
  await fails(cwd, 'changed HEAD even with identical file contents');
});

await repository(async cwd => {
  await verifyDevelopment({ cwd, commands });
  const held = [nodeCheck('held', "const fs=require('node:fs');fs.writeFileSync('.development-output/entered','yes');const t=setInterval(()=>{if(fs.existsSync('.development-output/release')){clearInterval(t)}},20)")];
  const running = verifyDevelopment({ cwd, commands: held });
  try {
    await until(() => fs.existsSync(path.join(cwd, '.development-output/entered')), 'held check did not start');
    assert.equal(read(cwd).status, 'RUNNING', 'prior PASS is replaced before first check starts');
    assert.ok(fs.existsSync(location(cwd) + '.lock'));
    await fails(cwd, 'running evidence is not reusable', held);
    const bytes = fs.readFileSync(location(cwd), 'utf8');
    const collision = await verifyDevelopment({ cwd, commands: [nodeCheck('collision', "require('node:fs').writeFileSync('.development-output/collision','bad')")] });
    assert.equal(collision.status, 'FAIL');
    assert.equal(fs.readFileSync(location(cwd), 'utf8'), bytes, 'collision must not overwrite owner report');
    assert.equal(fs.existsSync(path.join(cwd, '.development-output/collision')), false, 'collision must not run commands');
    assert.ok(fs.existsSync(location(cwd) + '.lock'), 'collision must not release owner lock');
  } finally {
    fs.writeFileSync(path.join(cwd, '.development-output/release'), 'release');
    await running;
  }
  assert.equal(read(cwd).status, 'PASS');
  assert.equal(fs.existsSync(location(cwd) + '.lock'), false);
  const failed = await verifyDevelopment({ cwd, commands: [nodeCheck('failure', 'process.exit(7)')] });
  assert.equal(failed.status, 'FAIL');
  assert.equal(read(cwd).status, 'FAIL', 'failed rerun replaces old PASS');
  assert.equal(fs.existsSync(location(cwd) + '.lock'), false, 'failure releases lock');
});

await repository(async cwd => {
  fs.mkdirSync(location(cwd), { recursive: true });
  const result = await verifyDevelopment({ cwd, commands: [nodeCheck('must-not-run', "require('node:fs').writeFileSync('.development-output/ran','bad')")] });
  assert.equal(result.status, 'FAIL', 'report write failure is fail-closed');
  assert.equal(fs.existsSync(path.join(cwd, '.development-output/ran')), false, 'commands do not start without writable RUNNING report');
  assert.equal(fs.existsSync(location(cwd) + '.lock'), true, 'publication failure retains lock to reject any stale evidence');
  await fails(cwd, 'publication failure leaves unusable evidence');
});

await repository(async cwd => {
  const check = nodeCheck('crash-window', "const fs=require('node:fs');fs.writeFileSync('.development-output/check-pid',String(process.pid));setInterval(()=>{},1000)", 30000);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {verifyDevelopment} from ${JSON.stringify(moduleURL)}; await verifyDevelopment(${JSON.stringify({ cwd, commands: [check] })});`], { stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  let checkPid;
  try {
    await until(() => fs.existsSync(path.join(cwd, '.development-output/check-pid')), 'crash test check did not start');
    checkPid = Number(fs.readFileSync(path.join(cwd, '.development-output/check-pid'), 'utf8'));
    child.kill('SIGKILL'); await closed;
    assert.equal(read(cwd).status, 'RUNNING', 'crashed verifier cannot leave a PASS');
    assert.ok(fs.existsSync(location(cwd) + '.lock'), 'crash leaves stale lock for explicit recovery');
    await fails(cwd, 'crashed verification evidence', [check]);
    const bytes = fs.readFileSync(location(cwd), 'utf8');
    const retry = await verifyDevelopment({ cwd, commands });
    assert.equal(retry.status, 'FAIL', 'stale lock cannot silently be stolen');
    assert.equal(fs.readFileSync(location(cwd), 'utf8'), bytes);
  } finally {
    child.kill('SIGKILL'); await closed;
    if (checkPid) { try { process.kill(checkPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  }
});
console.log('verification freshness tests passed');
