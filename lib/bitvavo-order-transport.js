import { createHash, createHmac } from 'node:crypto';

// Unwired server-side transport. Enabling this client is NOT a risk/readiness check.
// The caller must persist intents, enforce limits and reconcile ambiguous outcomes.
const ORIGIN = 'https://api.bitvavo.com';
const MARKETS = Object.freeze({ BTCUSDC: 'BTC-USDC', ETHUSDC: 'ETH-USDC' });
const NOT_FOUND = Symbol('NOT_FOUND');
const CONFIG = new Set(['operatorId', 'enabled', 'liveAcknowledgement', 'apiKey', 'apiSecret', 'fetchImpl', 'timeoutMs']);
const ORDER = new Set(['symbol', 'side', 'quantity', 'price', 'type', 'timeInForce', 'newClientOrderId']);
const QUERY = new Set(['symbol', 'origClientOrderId']);
const STATUSES = Object.freeze({ new: 'NEW', partiallyFilled: 'PARTIALLY_FILLED', filled: 'FILLED', canceled: 'CANCELED', expired: 'EXPIRED' });
const fail = (code) => new Error(`Bitvavo order transport: ${code}`);
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).some((key) => !keys.has(key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some((field) => !('value' in field))) throw fail('INVALID_INPUT');
}
const decimal = (v, zero = false) => typeof v === 'string' && v.length <= 40
  && /^(?:0|[1-9]\d*)(?:\.\d{1,16})?$/.test(v) && (zero || /[1-9]/.test(v));
const units = (v) => { const [a, b = ''] = v.split('.'); return BigInt(a + b.padEnd(16, '0')); };
const credential = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v);
const symbolValid = (v) => v === 'BTCUSDC' || v === 'ETHUSDC';
const idValid = (v) => typeof v === 'string' && /^ag1_[a-f0-9]{32}$/.test(v);
const uuidValid = (v) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
// RFC UUIDv5, URL namespace. Keep namespace and name stable across restarts/releases.
// Forward mapping is sufficient: reconciliation already knows the internal ID.
function externalId(id) {
  const digest = createHash('sha1')
    .update(Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'))
    .update(`agencik1:bitvavo:${id}`).digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return digest.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

export function createBitvavoOrderTransport(config = {}) {
  object(config, CONFIG);
  const { operatorId, enabled = false, liveAcknowledgement, apiKey, apiSecret,
    fetchImpl = globalThis.fetch, timeoutMs = 5000 } = config;
  if ((operatorId !== undefined && (!Number.isSafeInteger(operatorId) || operatorId <= 0)) || typeof enabled !== 'boolean' || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
      || (apiKey !== undefined && !credential(apiKey)) || (apiSecret !== undefined && !credential(apiSecret))
      || (liveAcknowledgement !== undefined && liveAcknowledgement !== 'LIVE_TRADING_CONFIGURED')) throw fail('INVALID_CONFIG');
  function permission() {
    if (!enabled) throw fail('DISABLED');
    if (liveAcknowledgement !== 'LIVE_TRADING_CONFIGURED') throw fail('LIVE_NOT_CONFIGURED');
    if (!Number.isSafeInteger(operatorId) || operatorId <= 0) throw fail('OPERATOR_ID_REQUIRED');
    if (!credential(apiKey) || !credential(apiSecret)) throw fail('CREDENTIALS_REQUIRED');
  }
  async function request(path, options = {}, allowNotFound = false) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${ORIGIN}${path}`, { ...options, redirect: 'error', cache: 'no-store', signal: controller.signal });
          if (!response || response.redirected === true || !Number.isInteger(response.status)) throw fail('REQUEST_FAILED');
          const data = await response.json();
          if (allowNotFound && response.status === 404 && data?.errorCode === 240) return NOT_FOUND;
          if (response.ok !== true || response.status < 200 || response.status >= 300 || (data && typeof data === 'object' && Object.hasOwn(data, 'errorCode'))) throw fail('REQUEST_FAILED');
          return data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(fail('REQUEST_FAILED')); controller.abort(); }, timeoutMs); }),
      ]);
    } catch { throw fail('REQUEST_FAILED'); }
    finally { clearTimeout(timer); }
  }
  async function signed(method, path, fields) {
    permission();
    const clock = await request('/v2/time');
    if (!clock || !Number.isSafeInteger(clock.time) || clock.time <= 0) throw fail('INVALID_SERVER_TIME');
    const timestamp = String(clock.time);
    const body = method === 'GET' ? '' : JSON.stringify(fields);
    const signature = createHmac('sha256', apiSecret).update(timestamp + method + path + body).digest('hex');
    const headers = { 'Bitvavo-Access-Key': apiKey, 'Bitvavo-Access-Timestamp': timestamp,
      'Bitvavo-Access-Signature': signature, 'Bitvavo-Access-Window': '10000', 'Content-Type': 'application/json' };
    return request(path, { method, headers, ...(method === 'GET' ? {} : { body }) }, method === 'GET');
  }
  function normalize(data, expected) {
    // Whitelist output: never expose fills, account details or exchange error messages.
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.market !== MARKETS[expected.symbol]
        || data.clientOrderId !== externalId(expected.clientOrderId) || !uuidValid(data.orderId)
        || !Object.hasOwn(STATUSES, data.status) || !['buy', 'sell'].includes(data.side)
        || data.orderType !== 'limit' || data.timeInForce !== 'GTC'
        || !decimal(data.amount) || !decimal(data.filledAmount, true) || !decimal(data.price)
        || units(data.filledAmount) > units(data.amount)
        || (data.status === 'filled' && units(data.filledAmount) !== units(data.amount))
        || (data.status === 'new' && units(data.filledAmount) !== 0n)
        || (data.status === 'partiallyFilled' && (units(data.filledAmount) === 0n || units(data.filledAmount) === units(data.amount)))
        || (expected.side && (data.side !== expected.side.toLowerCase() || units(data.amount) !== units(expected.quantity) || units(data.price) !== units(expected.price)))) throw fail('INVALID_ORDER_RESPONSE');
    return Object.freeze({ symbol: expected.symbol, clientOrderId: expected.clientOrderId, orderId: data.orderId,
      status: STATUSES[data.status], side: data.side.toUpperCase(), type: 'LIMIT', timeInForce: data.timeInForce,
      origQty: data.amount, executedQty: data.filledAmount, price: data.price });
  }
  async function submitOrder(input) {
    object(input, ORDER);
    const order = { ...input };
    if (!symbolValid(order.symbol) || !['BUY', 'SELL'].includes(order.side) || !decimal(order.quantity) || !decimal(order.price)
        || order.type !== 'LIMIT' || order.timeInForce !== 'GTC' || !idValid(order.newClientOrderId)) throw fail('INVALID_ORDER');
    return normalize(await signed('POST', '/v2/order', { market: MARKETS[order.symbol], side: order.side.toLowerCase(),
      orderType: 'limit', operatorId, clientOrderId: externalId(order.newClientOrderId), amount: order.quantity,
      price: order.price, timeInForce: 'GTC', selfTradePrevention: 'cancelNewest', responseRequired: true }),
    { ...order, clientOrderId: order.newClientOrderId });
  }
  async function queryOrder(input) {
    object(input, QUERY);
    const query = { ...input };
    if (!symbolValid(query.symbol) || !idValid(query.origClientOrderId)) throw fail('INVALID_QUERY');
    const params = new URLSearchParams({ market: MARKETS[query.symbol], clientOrderId: externalId(query.origClientOrderId) });
    const data = await signed('GET', `/v2/order?${params}`);
    if (data === NOT_FOUND) return Object.freeze({ status: 'NOT_FOUND' });
    return normalize(data, { symbol: query.symbol, clientOrderId: query.origClientOrderId });
  }
  return Object.freeze({ submitOrder, queryOrder });
}
