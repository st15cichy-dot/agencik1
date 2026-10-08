import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readHidden, runBalanceCli } from '../scripts/bitvavo-balance.mjs';

const key = 'offline-key-SENSITIVE';
const secret = 'offline-secret-SENSITIVE';
function fixture(overrides = {}) {
  let stdout = ''; let stderr = ''; let prompts = 0; let requests = 0;
  const options = {
    argv: [], platform: 'linux', input: { isTTY: true },
    output: { isTTY: true, write: (value) => { stdout += value; } },
    errorOutput: { isTTY: true, write: (value) => { stderr += value; } },
    prompt: async () => [key, secret][prompts++],
    createReader: (config) => {
      assert.deepEqual(config, { enabled: true, apiKey: key, apiSecret: secret });
      return { getBalance: async () => { requests++; return [{ symbol: 'EUR', available: '12.50', inOrder: '0' }]; } };
    }, ...overrides,
  };
  return { options, state: () => ({ stdout, stderr, prompts, requests }) };
}
const happy = fixture();
assert.equal(await runBalanceCli(happy.options), 0);
assert.match(happy.state().stdout, /EUR\t12.50\t0/);
assert.match(happy.state().stdout, /READ ONLY/);
assert.equal(happy.state().requests, 1);
assert.equal(happy.state().prompts, 2);
assert.equal(happy.state().stderr, '');
for (const sensitive of [key, secret]) assert.ok(!happy.state().stdout.includes(sensitive));

for (const override of [{ argv: [secret] }, { argv: ['--help', secret] }, { platform: 'win32' },
  { input: { isTTY: false } }, { output: { isTTY: false, write() {} } }, { errorOutput: { isTTY: false, write() {} } }]) {
  const f = fixture(override);
  assert.equal(await runBalanceCli(f.options), 1);
  assert.equal(f.state().prompts, 0);
  assert.equal(f.state().requests, 0);
  assert.ok(!f.state().stderr.includes(secret));
}
const help = fixture({ argv: ['--help'], platform: 'win32', input: { isTTY: false } });
assert.equal(await runBalanceCli(help.options), 0);
assert.equal(help.state().prompts, 0);
const empty = fixture({ createReader: () => ({ getBalance: async () => [] }) });
assert.equal(await runBalanceCli(empty.options), 0);
assert.match(empty.state().stdout, /pustą listę sald/);
for (const override of [
  { prompt: async () => { throw new Error(secret); } },
  { createReader: () => { throw new Error(secret); } },
  { createReader: () => ({ getBalance: async () => { throw new Error(secret); } }) },
  { prompt: async () => '' },
  ...[null, {}, [{ symbol: '\x1b[2J', available: '1', inOrder: '0' }],
    [{ symbol: 'EUR', available: secret, inOrder: '0' }],
    [{ symbol: 'EUR', available: '1', inOrder: '0' }, { symbol: 'EUR', available: '2', inOrder: '0' }],
  ].map((rows) => ({ createReader: () => ({ getBalance: async () => rows }) })),
]) {
  const f = fixture(override);
  assert.equal(await runBalanceCli(f.options), 1);
  assert.ok(!f.state().stdout.includes(secret));
  assert.ok(!f.state().stderr.includes(secret));
  assert.ok(!f.state().stdout.includes('odczyt zakończony'));
}

function terminal() {
  const input = new PassThrough();
  input.isTTY = true; input.isRaw = false;
  input.setRawMode = (mode) => { input.isRaw = mode; };
  let text = '';
  const output = { isTTY: true, write: (value) => { text += value; } };
  return { input, output, text: () => text };
}
const sigintListeners = process.listenerCount('SIGINT');
const sigtermListeners = process.listenerCount('SIGTERM');
for (const [typed, expected] of [['abc\u007fd\r', 'abd'], [`${secret}\n`, secret]]) {
  const t = terminal();
  const pending = readHidden('Secret: ', t);
  assert.equal(t.input.isRaw, true);
  t.input.write(typed);
  assert.equal(await pending, expected);
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount('data'), 0);
  assert.equal(t.input.isPaused(), true);
  assert.equal(t.text(), 'Secret: \n');
}
for (const typed of ['\u0003', '\u0004', 'abc\ndef\n', 'x'.repeat(513), '\u001b']) {
  const t = terminal();
  const pending = readHidden('Secret: ', t);
  t.input.write(typed);
  await assert.rejects(pending);
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount('data'), 0);
  assert.equal(t.input.isPaused(), true);
  assert.equal(t.text(), 'Secret: \n');
}
const eof = terminal();
const eofPending = readHidden('Secret: ', eof);
eof.input.end();
await assert.rejects(eofPending);
assert.equal(eof.input.isRaw, false);
assert.equal(process.listenerCount('SIGINT'), sigintListeners);
assert.equal(process.listenerCount('SIGTERM'), sigtermListeners);
console.log('Bitvavo balance CLI: PASS (offline TTY input, no echo, cancellation, redaction, read-only output)');
