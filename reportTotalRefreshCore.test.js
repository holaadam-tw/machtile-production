const assert = require("node:assert/strict");
const { adoptFreshProgress, retryRefresh } = require("./reportTotalRefreshCore.js");

const order = { done: 0, progressSource: { source: "app", done: 0 } };
const progress = { source: "legacy", done: 50, legacyKnown: true, totalFail: 2 };
assert.deepEqual(adoptFreshProgress(order, progress), { adopted: true, sourceChanged: true });
assert.equal(order.done, 50, "fresh quantity replaces the stale card quantity");
assert.equal(order.progressSource, progress, "fresh source becomes authoritative");
{ const legacyOrder = { done: 200, progressSource: { source: "legacy", done: 200 } };
  assert.deepEqual(adoptFreshProgress(legacyOrder, { source: "app", done: 50 }), { adopted: false, sourceChanged: true }, "legacy -> app downgrade stays fail-closed");
  assert.equal(legacyOrder.done, 200, "baseline untouched on refused downgrade"); assert.equal(legacyOrder.progressSource.source, "legacy"); }
{ const sameOrder = { done: 10, progressSource: { source: "legacy", done: 10 } };
  assert.deepEqual(adoptFreshProgress(sameOrder, { source: "legacy", done: 12 }), { adopted: true, sourceChanged: false }); assert.equal(sameOrder.done, 12); }
assert.deepEqual(adoptFreshProgress(order, { source: "legacy", done: NaN }), { adopted: false, sourceChanged: false }, "non-finite progress stays fail-closed");

(async () => {
  let calls = 0;
  const reloads = [];
  const sleeps = [];
  const result = await retryRefresh(async () => {
    calls += 1;
    if (calls < 3) throw new Error(`temporary-${calls}`);
    return "ready";
  }, async (retry) => reloads.push(retry), { retries: 2, delayMs: 1000, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(result, "ready");
  assert.equal(calls, 3, "initial attempt plus two retries");
  assert.deepEqual(reloads, [1, 2], "card progress reloads before each retry");
  assert.deepEqual(sleeps, [1000, 1000], "each retry has a one-second backoff");

  calls = 0;
  await assert.rejects(() => retryRefresh(async () => { calls += 1; throw new Error("still unavailable"); }, async () => {}, { retries: 2, delayMs: 0 }), /still unavailable/);
  assert.equal(calls, 3, "failure is exposed only after retries are exhausted");
  calls = 0; let reloaded = 0;
  await assert.rejects(() => retryRefresh(async () => { calls += 1; const e = new Error("downgrade"); e.noRetry = true; throw e; }, async () => { reloaded += 1; }, { retries: 2, delayMs: 0 }), /downgrade/);
  assert.equal(calls, 1, "noRetry errors are not retried"); assert.equal(reloaded, 0, "no card reload on a refused downgrade");
  console.log("PASS report total refresh core: source adoption and bounded retry");
})().catch((error) => { console.error(error); process.exitCode = 1; });
