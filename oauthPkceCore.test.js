// 純邏輯測試：repo 根目錄執行 `node oauthPkceCore.test.js`（Node 20+，用內建 WebCrypto）。
// 重點是 2026-10-01 安卓桌面 App（PWA）跨分頁登入交接的規則：綁 state、過期丟棄、格式不對丟棄、
// 只有發起那個視窗（持有 verifier）解得開交接資料。
const c = require("./oauthPkceCore.js");
const cryptoApi = globalThis.crypto;
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
};

const config = {
  oauthEnabled: true,
  oauthClientId: "client-test",
  oauthAuthorizationEndpoint: "https://login.example.test/authorize",
  oauthTokenEndpoint: "https://login.example.test/token",
  oauthRedirectUri: "https://app.example.test/",
};
const tokens = {
  access_token: "header.payload.sig",
  refresh_token: "refresh-1",
  expires_in: 3600,
  token_type: "bearer",
  provider_token: "should-not-travel",
  user: { id: "u-1", email: "op@example.test", app_metadata: { role: "operator" } },
};

(async () => {
  const now = 1_800_000_000_000;
  const a = await c.createAuthorization(config, cryptoApi, now);
  const b = await c.createAuthorization(config, cryptoApi, now);
  const txA = a.transaction, txB = b.transaction;

  console.log("== existing PKCE behaviour (unchanged) ==");
  ok("authorize URL carries state + S256", new URL(a.url).searchParams.get("state") === txA.state
    && new URL(a.url).searchParams.get("code_challenge_method") === "S256");
  ok("transaction parses within TTL", c.parseTransaction(JSON.stringify(txA), now + 1000).reason === "ok");
  ok("transaction expires after 10 min", c.parseTransaction(JSON.stringify(txA), now + c.TRANSACTION_TTL_MS + 1).reason === "expired");
  ok("callback state mismatch rejected", c.validateCallback({ kind: "code", code: "x", state: txB.state }, txA).reason === "state-mismatch");

  console.log("== pending list (per tab) ==");
  let list = c.addPendingTransaction("", txA, now);
  list = c.addPendingTransaction(JSON.stringify(list), txB, now + 1);
  ok("keeps both attempts after a retry", list.length === 2 && list[1].state === txB.state);
  ok("finds the earlier attempt by state", c.findPendingTransaction(JSON.stringify(list), txA.state, now + 2)?.verifier === txA.verifier);
  ok("unknown state not found", c.findPendingTransaction(JSON.stringify(list), "nope", now) === null);
  ok("expired attempts drop out", c.parsePendingTransactions(JSON.stringify(list), now + c.TRANSACTION_TTL_MS + 5).length === 0);
  ok("garbage list parses to empty", c.parsePendingTransactions("{not json", now).length === 0);
  let many = "";
  for (let i = 0; i < 5; i += 1) {
    const t = (await c.createAuthorization(config, cryptoApi, now)).transaction;
    many = JSON.stringify(c.addPendingTransaction(many, t, now));
  }
  ok("list capped at PENDING_MAX", JSON.parse(many).length === c.PENDING_MAX);

  console.log("== handoff seal / open ==");
  const sealed = await c.sealHandoff(tokens, txA, cryptoApi, now);
  ok("key is bound to state", sealed.key === c.handoffKey(txA.state));
  ok("tokens are not stored in clear text", !sealed.value.includes("refresh-1") && !sealed.value.includes("header.payload.sig"));
  const opened = await c.openHandoff(sealed.value, txA, cryptoApi, now + 1000);
  ok("initiating window opens it", opened.reason === "ok" && opened.payload.access_token === tokens.access_token
    && opened.payload.refresh_token === "refresh-1" && opened.payload.user.email === "op@example.test");
  ok("only minimal fields travel", JSON.stringify(Object.keys(opened.payload).sort()) === JSON.stringify(["access_token", "expires_in", "refresh_token", "user"])
    && JSON.stringify(Object.keys(opened.payload.user).sort()) === JSON.stringify(["email", "id"]));
  ok("expired after 2 min", (await c.openHandoff(sealed.value, txA, cryptoApi, now + c.HANDOFF_TTL_MS + 1)).reason === "expired");
  ok("other login (state) rejected", (await c.openHandoff(sealed.value, txB, cryptoApi, now)).reason === "state-mismatch");
  ok("same state but wrong verifier cannot decrypt",
    (await c.openHandoff(sealed.value, { ...txA, verifier: txB.verifier }, cryptoApi, now)).reason === "undecryptable");
  const tampered = JSON.parse(sealed.value); tampered.createdAt = now + 500;
  ok("tampered timestamp rejected (AAD)", (await c.openHandoff(JSON.stringify(tampered), txA, cryptoApi, now + 600)).reason === "undecryptable");
  ok("malformed rejected", (await c.openHandoff("{oops", txA, cryptoApi, now)).reason === "malformed");
  ok("wrong version rejected", (await c.openHandoff(JSON.stringify({ ...JSON.parse(sealed.value), version: 9 }), txA, cryptoApi, now)).reason === "unsupported-version");
  ok("missing rejected", (await c.openHandoff("", txA, cryptoApi, now)).reason === "missing");
  let threw = false;
  try { await c.sealHandoff({ refresh_token: "r" }, txA, cryptoApi, now); } catch { threw = true; }
  ok("refuses to seal without access token", threw);

  console.log("== stale shared entries ==");
  ok("fresh shared tx kept", !c.staleSharedEntry(c.sharedTransactionKey(txA.state), JSON.stringify(txA), now + 1000));
  ok("expired shared tx stale", c.staleSharedEntry(c.sharedTransactionKey(txA.state), JSON.stringify(txA), now + c.TRANSACTION_TTL_MS + 1));
  ok("fresh handoff kept", !c.staleSharedEntry(sealed.key, sealed.value, now + 1000));
  ok("expired handoff stale", c.staleSharedEntry(sealed.key, sealed.value, now + c.HANDOFF_TTL_MS + 1));
  ok("garbage handoff stale", c.staleSharedEntry(sealed.key, "nope", now));
  ok("unrelated keys untouched", !c.staleSharedEntry("machtileRememberedAuthSession", "x", now));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
