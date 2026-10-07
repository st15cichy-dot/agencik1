// Isolated single-machine execution preparation. No production broker or scheduler.
// A crashed owner leaves the lock in place: recovery requires an operator's inspection.
import { open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const TERMINAL = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH']);
const BROKER_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED', ...TERMINAL]);
const STATES = new Set(['SUBMITTING', 'UNKNOWN', ...BROKER_STATUSES]);
const fields = ['id', 'symbol', 'side', 'quantity', 'price'];
function decimal(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^(0|[1-9]\d*)(\.\d{1,16})?$/.test(value)) throw new Error('INVALID_DECIMAL');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
function validateIntent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || fields.some(key => !Object.hasOwn(input, key))) throw new Error('INVALID_INTENT');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id) || typeof input.id !== 'string' || !['BTCUSDC', 'ETHUSDC'].includes(input.symbol) || !['BUY', 'SELL'].includes(input.side)) throw new Error('INVALID_INTENT');
  if (decimal(input.quantity) <= 0n || decimal(input.price) <= 0n) throw new Error('INVALID_INTENT');
  return Object.fromEntries(fields.map(key => [key, input[key]]));
}
function clientId(id) { return `ag1_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`; }
function checkFill(status, fill, quantity) {
  if (fill < 0n || fill > quantity || (status === 'FILLED' && fill !== quantity) || (status === 'NEW' && fill !== 0n) || (status === 'PARTIALLY_FILLED' && (fill === 0n || fill === quantity))) throw new Error('INVALID_FILL');
}
function validateLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.orders)) throw new Error('INVALID_LEDGER');
  const ids = new Set();
  for (const row of ledger.orders) {
    const intent = validateIntent(row.intent);
    if (ids.has(intent.id) || row.clientOrderId !== clientId(intent.id) || !STATES.has(row.status) || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('INVALID_LEDGER');
    checkFill(row.status, decimal(row.executedQty), decimal(intent.quantity));
    ids.add(intent.id);
  }
  return ledger;
}
function responseUpdate(row, response) {
  const intent = row.intent;
  if (!response || response.symbol !== intent.symbol || response.side !== intent.side || response.clientOrderId !== row.clientOrderId || response.type !== 'LIMIT' || response.timeInForce !== 'GTC' || !BROKER_STATUSES.has(response.status) || decimal(response.origQty) !== decimal(intent.quantity) || decimal(response.price) !== decimal(intent.price)) throw new Error('BROKER_IDENTITY_MISMATCH');
  const fill = decimal(response.executedQty);
  checkFill(response.status, fill, decimal(intent.quantity));
  if (fill < decimal(row.executedQty)) throw new Error('FILL_REGRESSION');
  return { ...row, status: response.status, executedQty: response.executedQty, updatedAt: new Date().toISOString() };
}

export function createOrderExecutor({ storagePath, broker, executionEnabled = false, riskCheck } = {}) {
  if (typeof storagePath !== 'string' || !storagePath.trim()) throw new Error('STORAGE_PATH_REQUIRED');
  const path = resolve(storagePath);
  const lockPath = `${path}.lock`;
  async function read() {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return validateLedger(JSON.parse(await file.readFile('utf8'))); } finally { await file.close(); }
  }
  async function save(ledger) {
    validateLedger(ledger);
    const temp = `${path}.${randomUUID()}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(ledger)); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async function locked(task) {
    const lock = await open(lockPath, 'wx', 0o600);
    let succeeded = false;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await lock.sync();
      const result = await task();
      succeeded = true;
      return structuredClone(result);
    } finally {
      await lock.close();
      // Fail closed on persistence failures, including uncertain rename/fsync outcomes.
      if (succeeded) await unlink(lockPath);
    }
  }
  // Expected validation failures release the lock. Unexpected storage failures retain it.
  function rejected(message) { return { rejection: message }; }
  async function operation(task) {
    const result = await locked(task);
    if (result?.rejection) throw new Error(result.rejection);
    return result;
  }
  return Object.freeze({
    async initializeStore() {
      return locked(async () => {
        try { return await read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const ledger = { schemaVersion: 1, orders: [] };
        await save(ledger);
        return ledger;
      });
    },
    async snapshot() { return locked(read); },
    async execute(input) {
      const intent = validateIntent(input);
      return operation(async () => {
        const ledger = await read();
        const existing = ledger.orders.find(row => row.intent.id === intent.id);
        if (existing) return fields.every(key => existing.intent[key] === intent[key]) ? existing : rejected('INTENT_ID_CONFLICT');
        if (ledger.orders.some(row => ['SUBMITTING', 'UNKNOWN'].includes(row.status))) return rejected('UNRESOLVED_ORDER_BLOCKS_EXECUTION');
        if (executionEnabled !== true) return rejected('EXECUTION_DISABLED');
        if (typeof riskCheck !== 'function' || typeof broker?.submitOrder !== 'function' || typeof broker?.queryOrder !== 'function') return rejected('EXECUTION_DEPENDENCIES_REQUIRED');
        let risk;
        try { risk = await riskCheck(Object.freeze({ ...intent }), structuredClone(ledger)); } catch { return rejected('RISK_CHECK_FAILED'); }
        if (risk?.approved !== true) return rejected('RISK_NOT_APPROVED');
        let row = { intent, clientOrderId: clientId(intent.id), status: 'SUBMITTING', executedQty: '0', updatedAt: new Date().toISOString() };
        ledger.orders.push(row);
        await save(ledger); // Write-ahead: never submit before the intent is durable.
        try {
          const response = await broker.submitOrder({ symbol: intent.symbol, side: intent.side, quantity: intent.quantity, price: intent.price, type: 'LIMIT', timeInForce: 'GTC', newClientOrderId: row.clientOrderId });
          row = responseUpdate(row, response);
        } catch { row = { ...row, status: 'UNKNOWN', updatedAt: new Date().toISOString() }; }
        ledger.orders[ledger.orders.length - 1] = row;
        await save(ledger);
        return row;
      });
    },
    async reconcile(id) {
      return operation(async () => {
        const ledger = await read();
        const index = ledger.orders.findIndex(row => row.intent.id === id);
        if (index < 0) return rejected('INTENT_NOT_FOUND');
        let row = ledger.orders[index];
        if (TERMINAL.has(row.status)) return row;
        if (typeof broker?.queryOrder !== 'function') return rejected('QUERY_DEPENDENCY_REQUIRED');
        try { row = responseUpdate(row, await broker.queryOrder({ symbol: row.intent.symbol, origClientOrderId: row.clientOrderId })); }
        catch { row = { ...row, status: 'UNKNOWN', updatedAt: new Date().toISOString() }; }
        ledger.orders[index] = row;
        await save(ledger);
        return row;
      });
    },
  });
}
