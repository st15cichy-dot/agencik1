import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createBinanceOrderTransport } from '../lib/binance-order-transport.js';
import { createOrderExecutor } from '../lib/order-executor.js';
import { buildForecastDiagnostics } from '../lib/forecast-diagnostics.js';

// No real HTTP, account keys or exchange orders. Exercise the actual two modules
// together so their response and failure contracts cannot drift independently.
const dir = await mkdtemp(join(tmpdir(), 'ag1-execution-integration-'));
const intent = { id: 'integration_1', symbol: 'BTCUSDC', side: 'BUY', quantity: '0.0002', price: '50000' };
const key = 'fixture-key';
const secret = 'fixture-secret';
const serverTime = 1780000000000;
const response = (data, status = 200) => ({ status, ok: status === 200, redirected: false, async json() { return data; } });
let calls = [];
let order;
let queryState = 'missing';
let ledgerPath = join(dir, 'orders.json');
const fetchImpl = async (url, options) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://testnet.binance.vision');
  assert.equal(options.redirect, 'error');
  calls.push({ path: parsed.pathname, method: options.method ?? 'GET' });
  if (parsed.pathname === '/api/v3/time') return response({ serverTime });
  assert.equal(parsed.pathname, '/api/v3/order');
  const params = options.method === 'POST' ? new URLSearchParams(options.body) : parsed.searchParams;
  const signature = params.get('signature');
  params.delete('signature');
  assert.equal(signature, createHmac('sha256', secret).update(params.toString()).digest('hex'));
  assert.equal(params.get('timestamp'), String(serverTime));
  assert.equal(options.headers['X-MBX-APIKEY'], key);
  if (options.method === 'POST') {
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.orders.at(-1).status, 'SUBMITTING');
    assert.equal(ledger.orders.at(-1).clientOrderId, params.get('newClientOrderId'));
    order = { symbol: params.get('symbol'), side: params.get('side'), clientOrderId: params.get('newClientOrderId'),
      orderId: 42, type: params.get('type'), timeInForce: params.get('timeInForce'),
      origQty: params.get('quantity'), price: params.get('price') };
    // Exchange has accepted the order but the HTTP response is lost.
    throw new Error('lost response; private exchange diagnostic');
  }
  assert.equal(options.method, 'GET');
  assert.equal(params.get('origClientOrderId'), order.clientOrderId);
  if (queryState === 'missing') return response({ code: -2013, msg: 'private exchange diagnostic' }, 400);
  return response({ ...order, status: queryState, executedQty: queryState === 'FILLED' ? '0.00020000' : '0.00010000' });
};
const broker = createBinanceOrderTransport({ enabled: true, apiKey: key, apiSecret: secret, fetchImpl });
const create = (extra = {}) => createOrderExecutor({ storagePath: ledgerPath, broker, executionEnabled: true, riskCheck: () => ({ approved: true }), ...extra });
try {
  const executor = create();
  await executor.initializeStore();
  assert.equal((await executor.execute(intent)).status, 'UNKNOWN');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  let restarted = create();
  assert.equal((await restarted.execute(intent)).status, 'UNKNOWN');
  assert.equal((await restarted.reconcile(intent.id)).status, 'UNKNOWN');
  const callsBeforeBlocked = calls.length;
  await assert.rejects(restarted.execute({ ...intent, id: 'second' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);
  assert.equal(calls.length, callsBeforeBlocked);
  queryState = 'PARTIALLY_FILLED';
  assert.equal((await restarted.reconcile(intent.id)).executedQty, '0.00010000');
  restarted = create();
  queryState = 'FILLED';
  const filled = await restarted.reconcile(intent.id);
  assert.equal(filled.status, 'FILLED');
  assert.equal(filled.executedQty, '0.00020000');
  const callsAtFill = calls.length;
  assert.deepEqual(await create().execute(intent), filled);
  assert.deepEqual(await create().reconcile(intent.id), filled);
  assert.equal(calls.length, callsAtFill);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  const persisted = await readFile(ledgerPath, 'utf8');
  for (const sensitive of [key, secret, 'private exchange diagnostic', 'signature']) assert.equal(persisted.includes(sensitive), false);

  // Executor off: no clock request or HTTP submission even with enabled broker.
  ledgerPath = join(dir, 'disabled-executor.json');
  const disabled = create({ executionEnabled: false });
  await disabled.initializeStore();
  await assert.rejects(disabled.execute(intent), /EXECUTION_DISABLED/);
  assert.equal(calls.length, callsAtFill);
  assert.equal((await disabled.snapshot()).orders.length, 0);
  // Transport off: executor records uncertainty but no credential-bearing request.
  const disabledBroker = createBinanceOrderTransport({ apiKey: key, apiSecret: secret, fetchImpl });
  const blockedTransport = create({ broker: disabledBroker });
  assert.equal((await blockedTransport.execute(intent)).status, 'UNKNOWN');
  assert.equal(calls.length, callsAtFill);
  await assert.rejects(blockedTransport.execute({ ...intent, id: 'second' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);

  // Independent causality oracle: replace all target/future values while keeping
  // the forecast's prefix intact. Its probability must remain exactly identical.
  const intervalMs = 3600000;
  const start = 1700002800000;
  const bars = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + ((i * 17) % 23);
    return { time: start + i * intervalMs, open: close, high: close + 1, low: close - 1, close, volume: 1 };
  });
  const build = xs => buildForecastDiagnostics(xs, { nowMs: xs.at(-1).time + intervalMs, intervalMs });
  for (const cutoff of [25, 49, 65]) {
    const forecast = build(bars.slice(0, cutoff)).next;
    const changed = bars.map((bar, i) => i < cutoff ? bar : { ...bar, open: 500 + i, high: 502 + i, low: 499 + i, close: 501 + i });
    assert.equal(build(changed).predictions.find(p => p.asOfTime === forecast.asOfTime).upProbability, forecast.upProbability);
    const begin = Math.max(1, cutoff - 48);
    let ups = 0;
    for (let i = begin; i < cutoff; i++) ups += Number(bars[i].close > bars[i - 1].close);
    assert.equal(forecast.upProbability, (ups + 1) / (cutoff - begin + 2));
  }
  console.log('execution-integration: PASS (mock HTTP, signed requests, write-ahead, lost response, restart, no duplicate, disable gates, forecast causality)');
} finally { await rm(dir, { recursive: true, force: true }); }
