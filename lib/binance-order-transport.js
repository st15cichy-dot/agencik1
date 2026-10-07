import { createHmac } from 'node:crypto';

// Unwired server-side transport. Enabling this client is NOT a risk/readiness check.
// The caller must persist intents, enforce limits and reconcile ambiguous outcomes.
const ORIGINS = Object.freeze({ TESTNET: 'https://testnet.binance.vision', LIVE: 'https://api.binance.com' });
const NOT_FOUND = Symbol('NOT_FOUND');
const CONFIG = new Set(['environment', 'enabled', 'liveAcknowledgement', 'apiKey', 'apiSecret', 'fetchImpl', 'timeoutMs']);
const ORDER = new Set(['symbol', 'side', 'quantity', 'price', 'type', 'timeInForce', 'newClientOrderId']);
const QUERY = new Set(['symbol', 'origClientOrderId']);
const STATUSES = new Set(['NEW', 'PENDING_NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'PENDING_CANCEL', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH']);
const fail = (code) => new Error(`Binance order transport: ${code}`);
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
const idValid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,36}$/.test(v);

export function createBinanceOrderTransport(config = {}) {
  object(config, CONFIG);
  const { environment = 'TESTNET', enabled = false, liveAcknowledgement, apiKey, apiSecret,
    fetchImpl = globalThis.fetch, timeoutMs = 5000 } = config;
  if (typeof environment !== 'string' || !Object.hasOwn(ORIGINS, environment) || typeof enabled !== 'boolean' || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
      || (apiKey !== undefined && !credential(apiKey)) || (apiSecret !== undefined && !credential(apiSecret))
      || (liveAcknowledgement !== undefined && liveAcknowledgement !== 'LIVE_TRADING_CONFIGURED')) throw fail('INVALID_CONFIG');
  const origin = ORIGINS[environment];
  function permission() {
    if (!enabled) throw fail('DISABLED');
    if (environment === 'LIVE' && liveAcknowledgement !== 'LIVE_TRADING_CONFIGURED') throw fail('LIVE_NOT_CONFIGURED');
    if (!credential(apiKey) || !credential(apiSecret)) throw fail('CREDENTIALS_REQUIRED');
  }
  async function request(path, options = {}, allowNotFound = false) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${origin}${path}`, { ...options, redirect: 'error', cache: 'no-store', signal: controller.signal });
          if (!response || response.redirected === true || !Number.isInteger(response.status)) throw fail('REQUEST_FAILED');
          const data = await response.json();
          if (allowNotFound && response.status === 400 && data?.code === -2013) return NOT_FOUND;
          if (response.ok !== true || response.status < 200 || response.status >= 300 || data?.code < 0) throw fail('REQUEST_FAILED');
          return data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(fail('REQUEST_FAILED')); controller.abort(); }, timeoutMs); }),
      ]);
    } catch { throw fail('REQUEST_FAILED'); }
    finally { clearTimeout(timer); }
  }
  async function signed(method, fields) {
    permission();
    const clock = await request('/api/v3/time');
    if (!clock || !Number.isSafeInteger(clock.serverTime) || clock.serverTime <= 0) throw fail('INVALID_SERVER_TIME');
    const params = new URLSearchParams({ ...fields, recvWindow: '5000', timestamp: String(clock.serverTime) });
    params.set('signature', createHmac('sha256', apiSecret).update(params.toString()).digest('hex'));
    const headers = { 'X-MBX-APIKEY': apiKey };
    if (method === 'GET') return request(`/api/v3/order?${params}`, { method, headers }, true);
    return request('/api/v3/order', { method, headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  }
  function normalize(data, expected) {
    // Never forward extra account fields, fills, response messages or response objects.
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.symbol !== expected.symbol
        || data.clientOrderId !== expected.clientOrderId || !Number.isSafeInteger(data.orderId) || data.orderId < 0
        || !STATUSES.has(data.status) || !['BUY', 'SELL'].includes(data.side) || data.type !== 'LIMIT' || data.timeInForce !== 'GTC'
        || !decimal(data.origQty) || !decimal(data.executedQty, true) || !decimal(data.price)
        || units(data.executedQty) > units(data.origQty)
        || (data.status === 'FILLED' && units(data.executedQty) !== units(data.origQty))
        || (expected.side && (data.side !== expected.side || units(data.origQty) !== units(expected.quantity) || units(data.price) !== units(expected.price)))) throw fail('INVALID_ORDER_RESPONSE');
    return Object.freeze({ symbol: data.symbol, clientOrderId: data.clientOrderId, orderId: data.orderId,
      status: data.status, side: data.side, type: data.type, timeInForce: data.timeInForce,
      origQty: data.origQty, executedQty: data.executedQty, price: data.price });
  }
  async function submitOrder(input) {
    object(input, ORDER);
    const order = { ...input };
    if (!symbolValid(order.symbol) || !['BUY', 'SELL'].includes(order.side) || !decimal(order.quantity) || !decimal(order.price)
        || order.type !== 'LIMIT' || order.timeInForce !== 'GTC' || !idValid(order.newClientOrderId)) throw fail('INVALID_ORDER');
    return normalize(await signed('POST', { ...order, newOrderRespType: 'RESULT' }), { ...order, clientOrderId: order.newClientOrderId });
  }
  async function queryOrder(input) {
    object(input, QUERY);
    const query = { ...input };
    if (!symbolValid(query.symbol) || !idValid(query.origClientOrderId)) throw fail('INVALID_QUERY');
    const data = await signed('GET', query);
    if (data === NOT_FOUND) return Object.freeze({ status: 'NOT_FOUND' });
    return normalize(data, { symbol: query.symbol, clientOrderId: query.origClientOrderId });
  }
  return Object.freeze({ submitOrder, queryOrder });
}
