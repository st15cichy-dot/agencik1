import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createBinanceTestnetClient, BINANCE_TESTNET_POLICY } from "../lib/binance-testnet.js";

// All transport is injected. This suite must never contact Binance or use credentials.
const apiKey = "TEST_ONLY_KEY_DO_NOT_LOG";
const apiSecret = "TEST_ONLY_SECRET_DO_NOT_LOG";
const serverTime = 1791290123456;
const order = { symbol: "BTCUSDC", side: "BUY", quantity: "0.00100000", price: "60000.00", clientOrderId: "test_order-1" };
const market = (patch = {}) => ({ symbol: "BTCUSDC", status: "TRADING", isSpotTradingAllowed: true, orderTypes: ["LIMIT"], ...patch });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const info = (patch = {}) => ({ symbols: [market(patch)] });
const calls = [];
const mock = (replies = [info(), { serverTime }, {}]) => async (input, init = {}) => {
  calls.push({ url: new URL(input), init });
  assert.ok(replies.length > 0, "Unexpected retry or extra request");
  const reply = replies.shift();
  if (reply instanceof Error) throw reply;
  if (typeof reply === "function") return reply(input, init);
  return reply instanceof Response ? reply : response(reply);
};
const client = (fetchImpl = mock(), extra = {}) => createBinanceTestnetClient({ apiKey, apiSecret, fetchImpl, ...extra });
const cleanFailure = async (operation) => {
  let thrown;
  try { await operation(); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof Error, "Operation must fail closed");
  const rendered = `${String(thrown)} ${JSON.stringify(thrown)} ${String(thrown.cause ?? "")}`;
  for (const sensitive of [apiKey, apiSecret, "UPSTREAM_PRIVATE", "signature=", "https://evil.example"]) {
    assert.ok(!rendered.includes(sensitive), `Error leaked ${sensitive}`);
  }
};

assert.equal(BINANCE_TESTNET_POLICY.mode, "TESTNET_VALIDATION_ONLY");
assert.equal(BINANCE_TESTNET_POLICY.liveEnabled, false);
assert.equal(BINANCE_TESTNET_POLICY.canSubmitOrders, false);
assert.ok(Object.isFrozen(BINANCE_TESTNET_POLICY));
assert.ok(Object.isFrozen(client()));
assert.deepEqual(Object.keys(client()).sort(), ["getExchangeInfo", "validateOrder"]);

{
  calls.length = 0;
  const result = await client().validateOrder(order);
  assert.deepEqual(result, { mode: "TESTNET_VALIDATION_ONLY", validated: true, canSubmitOrders: false, symbol: "BTCUSDC", side: "BUY" });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(({ url }) => url.pathname), ["/api/v3/exchangeInfo", "/api/v3/time", "/api/v3/order/test"]);
  assert.equal(calls[0].url.searchParams.get("symbol"), order.symbol);
  for (const { url, init } of calls) {
    assert.equal(url.origin, "https://testnet.binance.vision");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(!url.href.includes(apiSecret));
    assert.ok(!url.searchParams.has("signature"));
  }
  const submitted = calls[2];
  assert.equal(submitted.init.method, "POST");
  const headers = new Headers(submitted.init.headers);
  assert.equal(headers.get("X-MBX-APIKEY"), apiKey);
  assert.ok(headers.get("Content-Type").startsWith("application/x-www-form-urlencoded"));
  const body = new URLSearchParams(submitted.init.body);
  const signature = body.get("signature");
  body.delete("signature");
  assert.equal(signature, createHmac("sha256", apiSecret).update(body.toString()).digest("hex"));
  assert.deepEqual(Object.fromEntries(body), { symbol: order.symbol, side: order.side, type: "LIMIT", timeInForce: "GTC", quantity: order.quantity, price: order.price, newClientOrderId: order.clientOrderId, timestamp: String(serverTime), recvWindow: "5000" });
}

{
  calls.length = 0;
  await client(mock([info({ symbol: "ETHUSDC" }), { serverTime }, {}])).validateOrder({ ...order, symbol: "ETHUSDC", side: "SELL" });
  assert.equal(new URLSearchParams(calls[2].init.body).get("side"), "SELL");
}

// Configuration cannot open a route to production, withdrawals, or real testnet orders.
for (const extra of [{ baseUrl: "https://api.binance.com" }, { liveEnabled: true }, { mode: "LIVE" }, { canSubmitOrders: true }, { recvWindow: 60000 }, { unknown: true }]) {
  await cleanFailure(() => client(mock(), extra));
}
for (const timeoutMs of [0, -1, NaN, Infinity, "15"]) await cleanFailure(() => client(mock(), { timeoutMs }));
for (const credentials of [{ apiKey: undefined }, { apiSecret: undefined }, { apiKey: "" }, { apiSecret: "" }, { apiKey: "line\nbreak" }]) {
  calls.length = 0;
  await cleanFailure(() => client(mock(), credentials).validateOrder(order));
  assert.equal(calls.length, 0, "Credentials must be checked before any request");
}
{
  calls.length = 0;
  const publicClient = createBinanceTestnetClient({ fetchImpl: mock([info()]) });
  const result = await publicClient.getExchangeInfo("BTCUSDC");
  assert.equal(result.symbols[0].symbol, "BTCUSDC");
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init.headers).has("X-MBX-APIKEY"), false);
}

// Malformed quantities must not be coerced, rounded, or sent over the network.
for (const field of ["quantity", "price"]) {
  for (const value of [0.1, 0, null, undefined, "", "0", "0.000", "-1", "+1", " 1", "1 ", "1e3", "Infinity", "NaN", ".1", "1.", "1.00000000000000001", "9".repeat(1000)]) {
    calls.length = 0;
    await cleanFailure(() => client().validateOrder({ ...order, [field]: value }));
    assert.equal(calls.length, 0, `${field} ${String(value).slice(0, 40)} reached transport`);
  }
}
for (const patch of [{ symbol: "BTCUSDT" }, { symbol: "btcusdc" }, { symbol: "BTCUSDC?x=1" }, { side: "buy" }, { side: "HOLD" }, { clientOrderId: "" }, { clientOrderId: "x".repeat(37) }, { clientOrderId: "a/b" }, { clientOrderId: "a\n" }, { clientOrderId: "ż" }, { type: "MARKET" }, { quoteOrderQty: "200" }, { test: false }]) {
  calls.length = 0;
  await cleanFailure(() => client().validateOrder({ ...order, ...patch }));
  assert.equal(calls.length, 0);
}
for (const symbol of [undefined, null, "BTCUSDT", "BTCUSDC/../../order", ["BTCUSDC"]]) {
  calls.length = 0;
  await cleanFailure(() => client().getExchangeInfo(symbol));
  assert.equal(calls.length, 0);
}

for (const exchangeInfo of [null, {}, [], { symbols: [] }, { symbols: [market(), market()] }, info({ symbol: "ETHUSDC" }), info({ status: "BREAK" }), info({ isSpotTradingAllowed: false }), info({ isSpotTradingAllowed: "true" }), info({ orderTypes: ["MARKET"] })]) {
  calls.length = 0;
  await cleanFailure(() => client(mock([exchangeInfo])).validateOrder(order));
  assert.equal(calls.length, 1, "Invalid market data must stop before signing");
}
for (const time of [null, {}, { serverTime: 0 }, { serverTime: -1 }, { serverTime: "1791290123456" }, { serverTime: 1.5 }, { serverTime: Number.MAX_SAFE_INTEGER + 1 }]) {
  calls.length = 0;
  await cleanFailure(() => client(mock([info(), time])).validateOrder(order));
  assert.equal(calls.length, 2);
}
for (const result of [null, [], "", { orderId: 123 }, { code: -1, msg: "UPSTREAM_PRIVATE" }]) {
  calls.length = 0;
  await cleanFailure(() => client(mock([info(), { serverTime }, result])).validateOrder(order));
  assert.equal(calls.length, 3);
}

// Rate limits, server errors and ambiguous failures never trigger retries.
for (const status of [301, 418, 429, 500, 504]) {
  for (let stage = 0; stage < 3; stage++) {
    const replies = [info(), { serverTime }, {}].slice(0, stage);
    replies.push(response({ code: -1007, msg: `UPSTREAM_PRIVATE ${apiKey} ${apiSecret}` }, status));
    calls.length = 0;
    await cleanFailure(() => client(mock(replies)).validateOrder(order));
    assert.equal(calls.length, stage + 1);
  }
}
{
  const leak = new Error(`UPSTREAM_PRIVATE ${apiSecret} ${apiKey} https://evil.example?signature=private`);
  calls.length = 0;
  await cleanFailure(() => client(mock([info(), { serverTime }, leak])).validateOrder(order));
  assert.equal(calls.length, 3);
}
{
  calls.length = 0;
  await cleanFailure(() => client(mock([new Response("UPSTREAM_PRIVATE invalid json")])).validateOrder(order));
  assert.equal(calls.length, 1);
}

// Neither a transport ignoring AbortSignal nor stalled response parsing may hang forever.
for (const stalled of [() => new Promise(() => {}), () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })]) {
  calls.length = 0;
  const started = Date.now();
  const watchdog = setTimeout(() => { throw new Error("Testnet transport failed to enforce timeout"); }, 2000);
  try {
    await cleanFailure(() => client(mock([stalled]), { timeoutMs: 15 }).validateOrder(order));
    assert.ok(Date.now() - started < 1500);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.signal.aborted, true);
  } finally { clearTimeout(watchdog); }
}

console.log("Binance testnet validation tests: OK (mock transport only)");
