import { createHmac } from 'node:crypto';

// Server-only, explicitly enabled reader. It has no trading or withdrawal methods.
// Credentials are supplied by the caller; this module never reads the environment.
const ORIGIN = 'https://api.bitvavo.com';
const CONFIG = new Set(['enabled', 'apiKey', 'apiSecret', 'fetchImpl', 'timeoutMs']);
const fail = (code) => new Error(`Bitvavo account reader: ${code}`);
const credential = (value) => typeof value === 'string' && value.length >= 1
  && value.length <= 512 && /^[\x21-\x7e]+$/.test(value);
const decimal = (value) => typeof value === 'string' && value.length <= 64
  && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value);

function fields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => !('value' in descriptors[key]))) throw new Error();
  return descriptors;
}

export function createBitvavoAccountReader(config = {}) {
  let enabled, apiKey, apiSecret, fetchImpl, timeoutMs;
  try {
    const descriptors = fields(config);
    if (Reflect.ownKeys(descriptors).some((key) => !CONFIG.has(key))) throw new Error();
    ({ enabled = false, apiKey, apiSecret, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = config);
    if (typeof enabled !== 'boolean' || typeof fetchImpl !== 'function'
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
        || (apiKey !== undefined && !credential(apiKey))
        || (apiSecret !== undefined && !credential(apiSecret))) throw new Error();
  } catch { throw fail('INVALID_CONFIG'); }

  async function request(path, headers) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(`${ORIGIN}${path}`, {
            method: 'GET', ...(headers ? { headers } : {}), redirect: 'error',
            cache: 'no-store', signal: controller.signal,
          });
          if (!response || response.redirected === true || response.ok !== true
              || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw new Error();
          const data = await response.json();
          if (data && typeof data === 'object' && Object.hasOwn(data, 'errorCode')) throw new Error();
          return data;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { reject(fail('REQUEST_FAILED')); controller.abort(); }, timeoutMs);
        }),
      ]);
    } catch { throw fail('REQUEST_FAILED'); }
    finally { clearTimeout(timer); }
  }

  async function getBalance() {
    if (!enabled) throw fail('DISABLED');
    if (!credential(apiKey) || !credential(apiSecret)) throw fail('CREDENTIALS_REQUIRED');
    const clock = await request('/v2/time');
    let timestamp;
    try {
      const time = fields(clock).time?.value;
      if (!Number.isSafeInteger(time) || time <= 0) throw new Error();
      timestamp = String(time);
    } catch { throw fail('INVALID_SERVER_TIME'); }
    const signature = createHmac('sha256', apiSecret)
      .update(timestamp + 'GET' + '/v2/balance').digest('hex');
    const data = await request('/v2/balance', {
      'Bitvavo-Access-Key': apiKey,
      'Bitvavo-Access-Timestamp': timestamp,
      'Bitvavo-Access-Signature': signature,
      'Bitvavo-Access-Window': '10000',
    });
    try {
      if (!Array.isArray(data) || data.length > 10000) throw new Error();
      const seen = new Set();
      const balances = [];
      for (const entry of data) {
        const descriptors = fields(entry);
        const symbol = descriptors.symbol?.value;
        const available = descriptors.available?.value;
        const inOrder = descriptors.inOrder?.value;
        if (typeof symbol !== 'string' || !/^[A-Z0-9]{1,32}$/.test(symbol)
            || seen.has(symbol) || !decimal(available) || !decimal(inOrder)) throw new Error();
        seen.add(symbol);
        // Preserve exact decimal strings and expose only these three fields.
        balances.push(Object.freeze({ symbol, available, inOrder }));
      }
      return Object.freeze(balances);
    } catch { throw fail('INVALID_BALANCE_RESPONSE'); }
  }

  return Object.freeze({ getBalance });
}
