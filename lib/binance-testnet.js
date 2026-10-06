import { createHmac } from 'node:crypto';

// Server-side, opt-in diagnostic client. Never imported by the production engine.
// /order/test checks exchange filters/signatures but never enters a matching engine.
const ORIGIN = 'https://testnet.binance.vision';
const SYMBOLS = new Set(['BTCUSDC', 'ETHUSDC']);
const CONFIG_KEYS = new Set(['apiKey', 'apiSecret', 'fetchImpl', 'now', 'timeoutMs']);
const ORDER_KEYS = new Set(['symbol', 'side', 'quantity', 'price', 'clientOrderId']);

export const BINANCE_TESTNET_POLICY = Object.freeze({
  mode: 'TESTNET_VALIDATION_ONLY',
  liveEnabled: false,
  canSubmitOrders: false,
});

function fail(code) {
  // Never attach upstream text, URLs, request objects, credentials, or causes.
  return new Error(`Binance testnet validation: ${code}`);
}

function assertObject(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).some((key) => !keys.has(key))) throw fail(code);
  // Reject accessors so validation cannot change values between checks and signing.
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some((field) => !('value' in field))) {
    throw fail(code);
  }
}

function assertSymbol(symbol) {
  if (!SYMBOLS.has(symbol)) throw fail('UNSUPPORTED_SYMBOL');
}

function isDecimal(value) {
  return typeof value === 'string' && value.length <= 40
    && /^(?:0|[1-9]\d*)(?:\.\d{1,16})?$/.test(value) && /[1-9]/.test(value);
}

function isCredential(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && /^[\x21-\x7e]+$/.test(value);
}

export function createBinanceTestnetClient(config = {}) {
  assertObject(config, CONFIG_KEYS, 'INVALID_CONFIG');
  const { apiKey, apiSecret, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 } = config;
  if (typeof fetchImpl !== 'function' || typeof now !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
      || (apiKey !== undefined && !isCredential(apiKey))
      || (apiSecret !== undefined && !isCredential(apiSecret))) throw fail('INVALID_CONFIG');

  async function request(path, options = {}) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${ORIGIN}${path}`, {
            ...options,
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response || response.ok !== true || response.redirected === true
              || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
            throw fail('REQUEST_REJECTED');
          }
          return await response.json();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            // Reject before abort, whose fetch rejection may contain private data.
            reject(fail('REQUEST_FAILED'));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
    } catch {
      // A timeout, 429, 418, 5xx, malformed JSON, or transport error is final.
      // There are no retries, including when a request outcome is unknown.
      throw fail('REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }

  async function getExchangeInfo(symbol) {
    assertSymbol(symbol);
    const result = await request(`/api/v3/exchangeInfo?symbol=${symbol}`);
    if (!result || !Array.isArray(result.symbols)) throw fail('INVALID_EXCHANGE_INFO');
    const matches = result.symbols.filter((entry) => entry?.symbol === symbol);
    const instrument = matches[0];
    if (matches.length !== 1 || instrument.status !== 'TRADING'
        || instrument.isSpotTradingAllowed !== true
        || !Array.isArray(instrument.orderTypes) || !instrument.orderTypes.includes('LIMIT')) {
      throw fail('SYMBOL_NOT_READY');
    }
    return result;
  }

  async function validateOrder(order) {
    assertObject(order, ORDER_KEYS, 'INVALID_ORDER');
    const { symbol, side, quantity, price, clientOrderId } = order;
    assertSymbol(symbol);
    if (!['BUY', 'SELL'].includes(side) || !isDecimal(quantity) || !isDecimal(price)
        || typeof clientOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId)) {
      throw fail('INVALID_ORDER');
    }
    if (!isCredential(apiKey) || !isCredential(apiSecret)) throw fail('CREDENTIALS_REQUIRED');
    await getExchangeInfo(symbol);
    const clock = await request('/api/v3/time');
    if (!clock || !Number.isSafeInteger(clock.serverTime) || clock.serverTime <= 0) {
      throw fail('INVALID_SERVER_TIME');
    }
    const params = new URLSearchParams({
      symbol,
      side,
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity,
      price,
      newClientOrderId: clientOrderId,
      recvWindow: '5000',
      timestamp: String(clock.serverTime),
    });
    const signature = createHmac('sha256', apiSecret).update(params.toString()).digest('hex');
    params.set('signature', signature);
    const result = await request('/api/v3/order/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-MBX-APIKEY': apiKey },
      body: params.toString(),
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)
        || Object.keys(result).length !== 0) throw fail('INVALID_VALIDATION_RESPONSE');
    return Object.freeze({
      mode: BINANCE_TESTNET_POLICY.mode,
      validated: true,
      canSubmitOrders: false,
      symbol,
      side,
    });
  }

  return Object.freeze({ getExchangeInfo, validateOrder });
}
