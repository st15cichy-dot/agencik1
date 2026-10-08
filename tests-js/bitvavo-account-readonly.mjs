import assert from 'node:assert/strict';
import { createBitvavoAccountReader } from '../lib/bitvavo-account-readonly.js';

// All credentials, balances and HTTP responses below are synthetic. No network calls.
const key = 'fixture-key-DO-NOT-LEAK';
const secret = 'fixture-secret-DO-NOT-LEAK';
const time = 1700000000123;
const record = { symbol: 'BTC', available: '0.00020000', inOrder: '0.00010000' };
const response = (data, status = 200, redirected = false) => ({ ok: status >= 200 && status < 300, status, redirected, json: async () => data });
const expectedError = code => error => {
  assert.equal(error.message, `Bitvavo account reader: ${code}`);
  assert.equal(error.cause, undefined);
  assert(!JSON.stringify(error).includes(secret));
  assert(!JSON.stringify(error).includes(key));
  return true;
};
function fixture(options = {}, balance = response([record])) {
  const calls = [];
  const client = createBitvavoAccountReader({ enabled: true, apiKey: key, apiSecret: secret, fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return url.endsWith('/time') ? response({ time }) : balance;
  }, ...options });
  return { client, calls };
}
{
  const { client, calls } = fixture({ enabled: false });
  await assert.rejects(client.getBalance(), expectedError('DISABLED'));
  assert.equal(calls.length, 0);
  await assert.rejects(createBitvavoAccountReader().getBalance(), expectedError('DISABLED'));
}
for (const options of [{ apiKey: undefined }, { apiSecret: undefined }]) {
  const { client, calls } = fixture(options);
  await assert.rejects(client.getBalance(), expectedError('CREDENTIALS_REQUIRED'));
  assert.equal(calls.length, 0);
}
for (const options of [null, [], 1, { apiKey: '' }, { apiSecret: '' }, Object.create({ enabled: true }), { enabled: 'true' }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { timeoutMs: 1.5 }, { timeoutMs: NaN }, { fetchImpl: 'fetch' }, { baseUrl: 'https://example.invalid' }, { apiKey: 'line\nbreak' }, { apiSecret: 'é' }, { apiKey: 'x'.repeat(513) }]) {
  assert.throws(() => createBitvavoAccountReader(options), expectedError('INVALID_CONFIG'));
}
{
  let getterCalls = 0;
  const config = Object.defineProperty({}, 'enabled', { enumerable: true, get() { getterCalls++; throw new Error(secret); } });
  assert.throws(() => createBitvavoAccountReader(config), expectedError('INVALID_CONFIG'));
  assert.equal(getterCalls, 0, 'configuration accessors must not execute');
}
{
  const source = [{ ...record, privateAccount: secret }, { symbol: 'EUR', available: '0', inOrder: '1.2' }];
  const { client, calls } = fixture({}, response(source));
  const result = await client.getBalance();
  assert.deepEqual(Object.keys(client), ['getBalance']);
  assert(Object.isFrozen(client)); assert(Object.isFrozen(result));
  assert(result.every(Object.isFrozen));
  assert.deepEqual(result, [record, { symbol: 'EUR', available: '0', inOrder: '1.2' }]);
  source[0].available = '999'; assert.equal(result[0].available, record.available);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.url), ['https://api.bitvavo.com/v2/time', 'https://api.bitvavo.com/v2/balance']);
  for (const { opts } of calls) {
    assert.equal(opts.method, 'GET'); assert.equal(opts.body, undefined);
    assert.equal(opts.redirect, 'error'); assert(opts.signal instanceof AbortSignal);
  }
  assert(!JSON.stringify(calls[0].opts.headers ?? {}).includes(key), 'public time request must not carry credentials');
  const headers = calls[1].opts.headers;
  assert.equal(headers['Bitvavo-Access-Key'], key);
  assert.equal(String(headers['Bitvavo-Access-Timestamp']), String(time));
  assert.equal(String(headers['Bitvavo-Access-Window']), '10000');
  // Python hmac.new(secret, b'1700000000123GET/v2/balance', hashlib.sha256).hexdigest().
  assert.equal(headers['Bitvavo-Access-Signature'], 'a8154288b300db487ea7cc0c3b03b46fe7e43b23e791b2c3b0843a21d043b5a3');
}
{
  const { client } = fixture({}, response([]));
  assert.deepEqual(await client.getBalance(), []);
}
for (const invalid of [null, {}, [null], [{ ...record, symbol: 'btc' }], [{ ...record, symbol: 'BTC-USDC' }], [{ ...record, symbol: '' }], [{ ...record, symbol: 'X'.repeat(33) }], [record, record], Array(10001).fill(record)]) {
  const { client } = fixture({}, response(invalid));
  await assert.rejects(client.getBalance(), expectedError('INVALID_BALANCE_RESPONSE'));
}
for (const field of ['available', 'inOrder']) {
  for (const value of [undefined, null, 1, -1, '-0', '-1', '1e2', 'Infinity', 'NaN', '00', '01.2', '.1', '1.', ' 1', '1 ', '1.1234567890123456789', '9'.repeat(65)]) {
    const { client } = fixture({}, response([{ ...record, [field]: value }]));
    await assert.rejects(client.getBalance(), expectedError('INVALID_BALANCE_RESPONSE'));
  }
}
for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, String(time), null, undefined]) {
  const calls = [];
  const { client } = fixture({ fetchImpl: async url => { calls.push(url); return response({ time: value }); } });
  await assert.rejects(client.getBalance(), expectedError('INVALID_SERVER_TIME'));
  assert.equal(calls.length, 1);
}
for (const stage of ['time', 'balance']) {
  for (const bad of [response({ errorCode: 101, error: secret }), response([record], 401), response([record], 429), response([record], 500), response([record], 200, true), { ok: true, status: 200, json: async () => { throw new Error(secret); } }]) {
    let calls = 0;
    const { client } = fixture({ fetchImpl: async url => {
      calls++;
      return stage === 'time' || !url.endsWith('/time') ? bad : response({ time });
    } });
    await assert.rejects(client.getBalance(), expectedError('REQUEST_FAILED'));
    assert.equal(calls, stage === 'time' ? 1 : 2, 'no implicit retries');
  }
  for (const hang of ['fetch', 'json']) {
    let calls = 0;
    const { client } = fixture({ timeoutMs: 10, fetchImpl: async url => {
      calls++;
      if (stage === 'balance' && url.endsWith('/time')) return response({ time });
      if (hang === 'fetch') return new Promise(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    } });
    await assert.rejects(client.getBalance(), expectedError('REQUEST_FAILED'));
    assert.equal(calls, stage === 'time' ? 1 : 2);
  }
}
{
  const { client } = fixture({ fetchImpl: async () => { throw new Error(`${key} ${secret}`); } });
  await assert.rejects(client.getBalance(), expectedError('REQUEST_FAILED'));
}
console.log('Bitvavo account read-only: PASS (offline GET-only contract, independent HMAC, strict balances, gates, sanitization and deadlines)');
