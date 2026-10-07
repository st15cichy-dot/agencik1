import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBinanceOrderTransport } from '../lib/binance-order-transport.js';

// All traffic is injected. Never run exchange requests or use real credentials.
const order = { symbol: 'BTCUSDC', side: 'BUY', quantity: '0.0002', price: '60000', type: 'LIMIT', timeInForce: 'GTC', newClientOrderId: 'intent_1' };
const record = { symbol: 'BTCUSDC', clientOrderId: 'intent_1', orderId: 123, side: 'BUY', status: 'NEW', origQty: '0.00020000', executedQty: '0.00000000', price: '60000.00000000', type: 'LIMIT', timeInForce: 'GTC', accountPrivate: 'not-for-output' };
const query = { symbol: order.symbol, origClientOrderId: order.newClientOrderId };
const response = (data, status = 200, redirected = false) => ({ ok: status >= 200 && status < 300, status, redirected, json: async () => data });
function fixture(options = {}, final = response(record)) {
  const calls = [];
  const client = createBinanceOrderTransport({ enabled: true, apiKey: 'mock-key', apiSecret: 'mock-secret', fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return url.endsWith('/time') ? response({ serverTime: 1700000000000 }) : final;
  }, ...options });
  return { client, calls };
}
function checkSignature(params) {
  const signature = params.get('signature'); params.delete('signature');
  assert.equal(signature, createHmac('sha256', 'mock-secret').update(params.toString()).digest('hex'));
  assert.equal(params.get('recvWindow'), '5000');
  assert.equal(params.get('timestamp'), '1700000000000');
}
for (const options of [{ enabled: false }, { environment: 'LIVE' }]) {
  const { client, calls } = fixture(options);
  await assert.rejects(client.submitOrder(order));
  await assert.rejects(client.queryOrder(query));
  assert.equal(calls.length, 0);
}
for (const options of [{ environment: 'evil' }, { baseUrl: 'https://evil.example' }, { enabled: 'true' }, { timeoutMs: 0 }, { liveAcknowledgement: true }]) {
  assert.throws(() => fixture(options));
}
for (const update of [{ quantity: 0.001 }, { price: '6e4' }, { quantity: '0' }, { quantity: '-1' }, { quantity: '00.1' }, { type: 'MARKET' }, { symbol: 'BTCUSDT' }, { timeInForce: 'IOC' }, { extra: 1 }, { newClientOrderId: '../x' }]) {
  const { client, calls } = fixture();
  await assert.rejects(client.submitOrder({ ...order, ...update }));
  assert.equal(calls.length, 0);
}
{
  const { client, calls } = fixture();
  const result = await client.submitOrder(order);
  assert(Object.isFrozen(client)); assert(Object.isFrozen(result));
  assert.equal(result.accountPrivate, undefined);
  assert.equal(calls.length, 2);
  const request = calls[1];
  assert.equal(request.url, 'https://testnet.binance.vision/api/v3/order');
  assert.equal(request.opts.method, 'POST'); assert.equal(request.opts.redirect, 'error');
  assert.equal(request.opts.headers['X-MBX-APIKEY'], 'mock-key');
  const params = new URLSearchParams(request.opts.body); checkSignature(params);
  assert.equal(params.get('newOrderRespType'), 'RESULT');
  assert.equal(params.get('newClientOrderId'), order.newClientOrderId);
}
{
  const { client, calls } = fixture({ environment: 'LIVE', liveAcknowledgement: 'LIVE_TRADING_CONFIGURED' });
  await client.queryOrder(query); // Injected mock only, including this LIVE-origin assertion.
  assert(calls.every(({ url }) => url.startsWith('https://api.binance.com/')));
  assert.equal(calls[1].opts.method, 'GET'); assert.equal(calls[1].opts.body, undefined);
  checkSignature(new URL(calls[1].url).searchParams);
}
for (const final of [response({ code: -1007, msg: 'mock-secret' }, 504), response({ code: -2013, msg: 'mock-secret' }, 400), response(record, 429), response(record, 200, true), response({ ...record, clientOrderId: 'wrong' }), response({ ...record, executedQty: '0.1' }), response({ ...record, origQty: '0.1' }), response({ ...record, status: 'FILLED' }), response({ status: 'NOT_FOUND' }), { ok: true, status: 200, json: async () => { throw new Error('mock-secret'); } }]) {
  const { client, calls } = fixture({}, final);
  await assert.rejects(client.submitOrder(order), (e) => !e.message.includes('mock-secret') && !e.cause);
  assert.equal(calls.length, 2, 'never retry ambiguous sends');
}
{
  const { client, calls } = fixture({}, response({ code: -2013, msg: 'secret' }, 400));
  assert.deepEqual(await client.queryOrder(query), { status: 'NOT_FOUND' }); assert.equal(calls.length, 2);
}
for (const stage of ['fetch', 'json']) {
  let count = 0;
  const { client } = fixture({ timeoutMs: 10, fetchImpl: async (url) => {
    count++;
    if (url.endsWith('/time')) return response({ serverTime: 1700000000000 });
    if (stage === 'fetch') return new Promise(() => {});
    return { status: 200, ok: true, json: () => new Promise(() => {}) };
  } });
  await assert.rejects(client.submitOrder(order), /REQUEST_FAILED/); assert.equal(count, 2);
}
{
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const { client } = fixture({ fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/time')) { await barrier; return response({ serverTime: 1700000000000 }); }
    return response(record);
  } });
  const mutable = { ...order }; const pending = client.submitOrder(mutable); mutable.quantity = '100'; release();
  await pending; assert.equal(new URLSearchParams(calls[1].opts.body).get('quantity'), order.quantity);
}
console.log('Binance order transport: PASS (offline mocks only)');
