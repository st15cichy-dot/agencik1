import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createBitvavoOrderTransport } from '../lib/bitvavo-order-transport.js';
import { createOrderExecutor } from '../lib/order-executor.js';

// Actual executor + actual adapter, injected exchange only. No real account/order.
const dir = await mkdtemp(join(tmpdir(), 'ag1-bitvavo-integration-'));
const intent = { id: 'bitvavo_integration_1', symbol: 'BTCUSDC', side: 'BUY', quantity: '0.0002', price: '50000' };
const key = 'fixture-key'; const secret = 'fixture-secret';
const serverTime = 1780000000000;
const response = (data, status = 200) => ({ status, ok: status === 200, redirected: false, async json() { return data; } });
const calls = [];
let order; let queryState = 'missing'; let ledgerPath = join(dir, 'orders.json');
// Independent Python uuid5 oracle for this fixture; not copied from adapter algorithm.
const expectedUuid = '37baae31-6707-59b6-acac-97fb258053dd';
let queryOverride = {};
const fetchImpl = async (url, options) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.bitvavo.com'); assert.equal(options.redirect, 'error');
  calls.push({ path: parsed.pathname, method: options.method ?? 'GET' });
  if (parsed.pathname === '/v2/time') return response({ time: serverTime });
  assert.equal(parsed.pathname, '/v2/order');
  assert.equal(options.headers['Bitvavo-Access-Signature'], createHmac('sha256', secret).update(`${serverTime}${options.method}${parsed.pathname}${parsed.search}${options.body ?? ''}`).digest('hex'));
  assert.equal(options.headers['Bitvavo-Access-Key'], key);
  if (options.method === 'POST') {
    const body = JSON.parse(options.body);
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.orders.at(-1).status, 'SUBMITTING');
    assert.equal(body.clientOrderId, expectedUuid);
    order = { ...body, orderId: '12345678-1234-1234-1234-123456789abc' };
    throw new Error('lost response; private exchange diagnostic');
  }
  assert.equal(options.method, 'GET');
  assert.equal(parsed.searchParams.get('clientOrderId'), order.clientOrderId);
  if (queryState === 'missing') return response({ errorCode: 240, error: 'private exchange diagnostic' }, 404);
  return response({ ...order, status: queryState, filledAmount: queryState === 'filled' ? '0.00020000' : '0.00010000', ...queryOverride });
};
const broker = createBitvavoOrderTransport({ enabled: true, liveAcknowledgement: 'LIVE_TRADING_CONFIGURED', operatorId: 2001, apiKey: key, apiSecret: secret, fetchImpl });
const create = (extra = {}) => createOrderExecutor({ storagePath: ledgerPath, broker, executionEnabled: true, riskCheck: () => ({ approved: true }), ...extra });
try {
  const executor = create(); await executor.initializeStore();
  assert.equal((await executor.execute(intent)).status, 'UNKNOWN');
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  let restarted = create();
  assert.equal((await restarted.execute(intent)).status, 'UNKNOWN');
  assert.equal((await restarted.reconcile(intent.id)).status, 'UNKNOWN');
  const beforeBlocked = calls.length;
  await assert.rejects(restarted.execute({ ...intent, id: 'second' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);
  assert.equal(calls.length, beforeBlocked);
  queryState = 'partiallyFilled';
  for (const mismatch of [{ side: 'sell' }, { amount: '0.0003' }, { price: '50001' }, { clientOrderId: 'aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee' }]) {
    queryOverride = mismatch;
    assert.equal((await restarted.reconcile(intent.id)).status, 'UNKNOWN');
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  }
  queryOverride = {};
  assert.equal((await restarted.reconcile(intent.id)).executedQty, '0.00010000');
  restarted = create(); queryState = 'filled';
  const filled = await restarted.reconcile(intent.id);
  assert.equal(filled.status, 'FILLED'); assert.equal(filled.executedQty, '0.00020000');
  const callsAtFill = calls.length;
  assert.deepEqual(await create().execute(intent), filled);
  assert.deepEqual(await create().reconcile(intent.id), filled);
  assert.equal(calls.length, callsAtFill);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  const persisted = await readFile(ledgerPath, 'utf8');
  for (const sensitive of [key, secret, 'private exchange diagnostic', 'signature']) assert.equal(persisted.includes(sensitive), false);
  ledgerPath = join(dir, 'disabled-executor.json');
  const disabled = create({ executionEnabled: false }); await disabled.initializeStore();
  await assert.rejects(disabled.execute(intent), /EXECUTION_DISABLED/);
  assert.equal(calls.length, callsAtFill); assert.equal((await disabled.snapshot()).orders.length, 0);
  const disabledBroker = createBitvavoOrderTransport({ operatorId: 2001, apiKey: key, apiSecret: secret, fetchImpl });
  const blocked = create({ broker: disabledBroker });
  assert.equal((await blocked.execute(intent)).status, 'UNKNOWN'); assert.equal(calls.length, callsAtFill);
  await assert.rejects(blocked.execute({ ...intent, id: 'second' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);
  console.log('Bitvavo execution integration: PASS (offline lost response, restart, stable UUID, no duplicate POST, partial/full recovery, disabled gates)');
} finally { await rm(dir, { recursive: true, force: true }); }
