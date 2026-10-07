import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBitvavoOrderTransport } from '../lib/bitvavo-order-transport.js';

// Independent wire assertions; every HTTP response and credential is synthetic.
const id = 'ag1_0123456789abcdef0123456789abcdef';
// Expected UUID independently generated with Python uuid.uuid5(uuid.NAMESPACE_URL, name).
const uuid = '55aa9748-ad3c-5d37-a85b-86b4c1fd5db6';
const order = { symbol: 'BTCUSDC', side: 'BUY', quantity: '0.0002', price: '60000', type: 'LIMIT', timeInForce: 'GTC', newClientOrderId: id };
const query = { symbol: 'BTCUSDC', origClientOrderId: id };
const record = { market: 'BTC-USDC', clientOrderId: uuid, orderId: '12345678-1234-1234-1234-123456789abc', side: 'buy', status: 'new', amount: '0.00020000', filledAmount: '0.00000000', price: '60000.00000000', orderType: 'limit', timeInForce: 'GTC', privateAccount: 'not-for-output' };
const response = (data, status = 200, redirected = false) => ({ ok: status >= 200 && status < 300, status, redirected, json: async () => data });
function fixture(options = {}, final = response(record)) {
  const calls = [];
  const client = createBitvavoOrderTransport({ enabled: true, liveAcknowledgement: 'LIVE_TRADING_CONFIGURED', operatorId: 2001, apiKey: 'mock-key', apiSecret: 'mock-secret', fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return url.endsWith('/time') ? response({ time: 1700000000000 }) : final;
  }, ...options });
  return { client, calls };
}
function checkWire(request) {
  const { url, opts } = request;
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.bitvavo.com');
  assert.equal(opts.redirect, 'error');
  assert.equal(opts.headers['Bitvavo-Access-Key'], 'mock-key');
  assert.equal(String(opts.headers['Bitvavo-Access-Timestamp']), '1700000000000');
  const message = `1700000000000${opts.method}${parsed.pathname}${parsed.search}${opts.body ?? ''}`;
  assert.equal(opts.headers['Bitvavo-Access-Signature'], createHmac('sha256', 'mock-secret').update(message).digest('hex'));
}
for (const options of [{ enabled: false }, { liveAcknowledgement: undefined }]) {
  const { client, calls } = fixture(options);
  await assert.rejects(client.submitOrder(order));
  await assert.rejects(client.queryOrder(query));
  assert.equal(calls.length, 0);
}
for (const options of [{ operatorId: 0 }, { operatorId: '2001' }, { operatorId: 1.1 }, { operatorId: Number.MAX_SAFE_INTEGER + 1 }, { baseUrl: 'https://evil.example' }, { enabled: 'true' }, { timeoutMs: 0 }, { liveAcknowledgement: true }]) {
  assert.throws(() => fixture(options));
}
for (const update of [{ quantity: 0.001 }, { price: '6e4' }, { quantity: '0' }, { quantity: '-1' }, { quantity: '00.1' }, { type: 'MARKET' }, { symbol: 'BTCUSDT' }, { timeInForce: 'IOC' }, { extra: 1 }, { newClientOrderId: uuid }, { newClientOrderId: '../x' }]) {
  const { client, calls } = fixture();
  await assert.rejects(client.submitOrder({ ...order, ...update }));
  assert.equal(calls.length, 0);
}
{
  const { client, calls } = fixture();
  const result = await client.submitOrder(order);
  assert(Object.isFrozen(client)); assert(Object.isFrozen(result));
  assert.equal(result.privateAccount, undefined);
  assert.equal(result.symbol, 'BTCUSDC'); assert.equal(result.clientOrderId, id);
  assert.equal(result.status, 'NEW'); assert.equal(result.executedQty, record.filledAmount);
  assert.equal(calls.length, 2); checkWire(calls[1]);
  assert.equal(calls[1].url, 'https://api.bitvavo.com/v2/order');
  assert.equal(calls[1].opts.method, 'POST');
  const body = JSON.parse(calls[1].opts.body);
  for (const [key, value] of Object.entries({ market: 'BTC-USDC', side: 'buy', orderType: 'limit', amount: '0.0002', price: '60000', timeInForce: 'GTC', operatorId: 2001, clientOrderId: uuid })) assert.equal(body[key], value);
}
{
  const { client, calls } = fixture();
  await client.queryOrder(query); checkWire(calls[1]);
  assert.equal(calls[1].opts.method, 'GET'); assert.equal(calls[1].opts.body, undefined);
  const params = new URL(calls[1].url).searchParams;
  assert.equal(params.get('market'), 'BTC-USDC'); assert.equal(params.get('clientOrderId'), uuid);
  assert.equal(params.has('orderId'), false);
}
for (const [status, filled, expected] of [['partiallyFilled', '0.0001', 'PARTIALLY_FILLED'], ['filled', '0.0002', 'FILLED'], ['canceled', '0.0001', 'CANCELED'], ['expired', '0', 'EXPIRED']]) {
  const { client } = fixture({}, response({ ...record, status, filledAmount: filled }));
  assert.equal((await client.submitOrder(order)).status, expected);
}
for (const changed of [{ clientOrderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { market: 'ETH-USDC' }, { side: 'sell' }, { amount: '1' }, { price: '1' }, { orderType: 'market' }, { timeInForce: 'IOC' }, { orderId: 'invalid' }, { filledAmount: '0.1' }, { filledAmount: '-1' }, { status: 'filled' }, { status: 'partiallyFilled' }, { status: 'awaitingTrigger' }]) {
  const { client, calls } = fixture({}, response({ ...record, ...changed }));
  await assert.rejects(client.submitOrder(order)); assert.equal(calls.length, 2);
}
for (const final of [response({ errorCode: 240, error: 'mock-secret' }, 404), response({ error: 'mock-secret' }, 429), response(record, 200, true), { ok: true, status: 200, json: async () => { throw new Error('mock-secret'); } }]) {
  const { client, calls } = fixture({}, final);
  await assert.rejects(client.submitOrder(order), error => !error.message.includes('mock-secret') && !error.cause);
  assert.equal(calls.length, 2, 'never retry ambiguous sends');
}
{
  const { client } = fixture({}, response({ errorCode: 240, error: 'private' }, 404));
  assert.deepEqual(await client.queryOrder(query), { status: 'NOT_FOUND' });
}
for (const status of [200, 400, 401, 429, 500]) {
  const { client } = fixture({}, response({ errorCode: 240 }, status));
  await assert.rejects(client.queryOrder(query));
}
for (const stage of ['fetch', 'json']) {
  let count = 0;
  const { client } = fixture({ timeoutMs: 10, fetchImpl: async url => {
    count++;
    if (url.endsWith('/time')) return response({ time: 1700000000000 });
    if (stage === 'fetch') return new Promise(() => {});
    return { status: 200, ok: true, json: () => new Promise(() => {}) };
  } });
  await assert.rejects(client.submitOrder(order)); assert.equal(count, 2);
}
{
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const calls = [];
  const { client } = fixture({ fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/time')) { await barrier; return response({ time: 1700000000000 }); }
    return response(record);
  } });
  const mutable = { ...order }; const pending = client.submitOrder(mutable); mutable.quantity = '100'; release();
  await pending; assert.equal(JSON.parse(calls[1].opts.body).amount, order.quantity);
}
console.log('Bitvavo order transport: PASS (independent signatures and offline mocks only)');
