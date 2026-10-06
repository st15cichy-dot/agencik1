import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrderExecutor } from '../lib/order-executor.js';

const dir = await mkdtemp(join(tmpdir(), 'ag1-executor-'));
const intent = { id: 'pilot_1', symbol: 'BTCUSDC', side: 'BUY', quantity: '0.002', price: '50000' };
const approved = () => ({ approved: true });
const response = (order, extra = {}) => ({ symbol: order.symbol, side: order.side, price: order.price, origQty: order.quantity, clientOrderId: order.newClientOrderId, type: 'LIMIT', timeInForce: 'GTC', executedQty: '0', status: 'NEW', ...extra });
let counter = 0;
async function setup(extra = {}) {
  const storagePath = join(dir, `${++counter}.json`);
  const executor = createOrderExecutor({ storagePath, ...extra });
  await executor.initializeStore();
  return { executor, storagePath };
}
try {
  const missing = createOrderExecutor({ storagePath: join(dir, 'absent.json') });
  await assert.rejects(missing.execute(intent), /ENOENT/);
  const disabled = await setup();
  assert.equal(Object.isFrozen(disabled.executor), true);
  await assert.rejects(disabled.executor.execute(intent), /EXECUTION_DISABLED/);
  assert.equal((await disabled.executor.snapshot()).orders.length, 0);
  for (const riskCheck of [undefined, () => ({ approved: false }), () => ({ approved: 'true' }), () => { throw Error('private'); }]) {
    const { executor } = await setup({ executionEnabled: true, broker: { submitOrder() { assert.fail('must not submit'); }, queryOrder() {} }, riskCheck });
    await assert.rejects(executor.execute(intent), /REQUIRED|RISK/);
    assert.equal((await executor.snapshot()).orders.length, 0);
  }
  let submits = 0;
  let lastOrder;
  let queryResult;
  const broker = {
    async submitOrder(order) {
      submits++;
      lastOrder = order;
      const disk = JSON.parse(await readFile(main.storagePath, 'utf8'));
      assert.equal(disk.orders[0].status, 'SUBMITTING');
      return response(order);
    },
    async queryOrder(query) { assert.equal(query.origClientOrderId, lastOrder.newClientOrderId); return queryResult; },
  };
  const main = await setup({ executionEnabled: true, broker, riskCheck: approved });
  const initial = await main.executor.execute(intent);
  assert.equal(initial.status, 'NEW');
  assert.equal(lastOrder.type, 'LIMIT');
  assert.equal(lastOrder.timeInForce, 'GTC');
  assert.equal(lastOrder.newClientOrderId.length, 36);
  assert.deepEqual(await main.executor.execute({ ...intent }), initial);
  await assert.rejects(main.executor.execute({ ...intent, price: '50001' }), /CONFLICT/);
  assert.equal(submits, 1);
  queryResult = response(lastOrder, { status: 'PARTIALLY_FILLED', executedQty: '0.001' });
  assert.equal((await main.executor.reconcile(intent.id)).status, 'PARTIALLY_FILLED');
  queryResult = response(lastOrder, { executedQty: '0' });
  const regression = await main.executor.reconcile(intent.id);
  assert.equal(regression.status, 'UNKNOWN');
  assert.equal(regression.executedQty, '0.001');
  for (const bad of [{ executedQty: '0.003', status: 'FILLED' }, { status: 'FILLED', executedQty: '0.001' }, { symbol: 'ETHUSDC' }, { side: 'SELL' }, { price: '40000' }, { clientOrderId: 'different' }]) {
    queryResult = response(lastOrder, bad);
    assert.equal((await main.executor.reconcile(intent.id)).status, 'UNKNOWN');
  }
  queryResult = response(lastOrder, { status: 'FILLED', executedQty: '0.002' });
  assert.equal((await main.executor.reconcile(intent.id)).status, 'FILLED');
  broker.queryOrder = () => assert.fail('terminal must not be queried');
  assert.equal((await main.executor.reconcile(intent.id)).status, 'FILLED');
  const restarted = createOrderExecutor({ storagePath: main.storagePath, executionEnabled: true, broker, riskCheck: approved });
  assert.equal((await restarted.execute(intent)).status, 'FILLED');
  assert.equal(submits, 1);
  let ambiguousSubmits = 0;
  const ambiguous = await setup({ executionEnabled: true, riskCheck: approved, broker: { submitOrder() { ambiguousSubmits++; throw Error('timeout secret'); }, queryOrder() { throw Error('NOT_FOUND'); } } });
  assert.equal((await ambiguous.executor.execute(intent)).status, 'UNKNOWN');
  assert.equal((await ambiguous.executor.execute(intent)).status, 'UNKNOWN');
  assert.equal((await ambiguous.executor.reconcile(intent.id)).status, 'UNKNOWN');
  await assert.rejects(ambiguous.executor.execute({ ...intent, id: 'another_intent' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);
  assert.equal(ambiguousSubmits, 1);
  assert.equal((await readFile(ambiguous.storagePath, 'utf8')).includes('secret'), false);
  const saved = JSON.parse(await readFile(ambiguous.storagePath, 'utf8'));
  saved.orders[0].status = 'SUBMITTING';
  await writeFile(ambiguous.storagePath, JSON.stringify(saved));
  assert.equal((await ambiguous.executor.execute(intent)).status, 'SUBMITTING');
  await assert.rejects(ambiguous.executor.execute({ ...intent, id: 'another_intent' }), /UNRESOLVED_ORDER_BLOCKS_EXECUTION/);
  assert.equal(ambiguousSubmits, 1);
  // Exclusive cross-instance lock prevents concurrent submissions.
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const concurrent = await setup({ executionEnabled: true, riskCheck: approved, broker: { async submitOrder(order) { began(); await gate; return response(order); }, queryOrder() {} } });
  const pending = concurrent.executor.execute(intent);
  await started;
  const other = createOrderExecutor({ storagePath: concurrent.storagePath });
  await assert.rejects(other.snapshot(), /EEXIST/);
  release();
  await pending;
  assert.equal((await other.snapshot()).orders.length, 1);
  for (const bad of [{ symbol: 'BTCUSDT' }, { quantity: 1 }, { quantity: '1e-3' }, { quantity: '0.00000000000000001' }, { price: '0' }, { quantity: '-1' }, { side: 'SHORT' }, { unexpected: true }]) {
    await assert.rejects(main.executor.execute({ ...intent, ...bad }), /INVALID/);
  }
  const corrupt = await setup();
  await writeFile(corrupt.storagePath, '{}');
  await assert.rejects(corrupt.executor.snapshot(), /INVALID_LEDGER/);
  await assert.rejects(corrupt.executor.initializeStore(), /EEXIST/);
  assert.equal(await readFile(corrupt.storagePath, 'utf8'), '{}');
  console.log('order-executor: PASS (durability, idempotency, restart, risk, locks, reconciliation, fills, corruption)');
} finally { await rm(dir, { recursive: true, force: true }); }
