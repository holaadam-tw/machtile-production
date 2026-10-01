// 安卓桌面 App（PWA）統一登入「跨分頁交接」的瀏覽器端到端測試（Playwright）。
// 同一個 browser context 開兩個分頁＝共用 localStorage、各自一份 sessionStorage，正好模擬
// 「App 視窗（分頁 A）發起登入 → Chrome Custom Tab（分頁 B）收到回跳」。
// 不會碰任何真的後端：config.js 換成測試設定，登入中心／token 端點都是假網域，由這支腳本攔截回應；
// 其他對外請求一律擋掉並記錄，最後斷言沒有打到正式專案。
//
// 跑法（playwright 不是這個 repo 的相依）：
//   npm i --no-save playwright && npx playwright install chromium
//   node oauthHandoff.browser.test.mjs
//   或 MACHTILE_PLAYWRIGHT_MODULE=<已安裝的 playwright/index.js 路徑> node oauthHandoff.browser.test.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const modSpec = process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright";
const pw = await import(modSpec);
const { chromium } = pw.default || pw;

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "\n        " + extra : "")); }
}

// ---------- static server for the repo (config.js swapped for a test config) ----------
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
let base = "";
const FAKE_SUPABASE = "https://fake-supabase.test";
const FAKE_LOGIN = "https://fake-login.test";
const T = "11111111-1111-4111-8111-111111111111";
const testConfig = () => `window.MACHTILE_CONFIG = {
  authMode: "strict", supabaseUrl: "${FAKE_SUPABASE}", supabaseAnonKey: "anon-test-key", tenantId: "${T}",
  useSupabase: true, useTenantHeaderAuth: true, enableOutboxSubmit: false, enableFileUpload: false,
  enableScheduleContracts: false, enableCalibrationGovernance: false, enableManufacturingQuoteTracking: false,
  useHmcWorklistSupabase: false, enableJevTriage: false, enableAccountDelete: false,
  enableFaceStatus: false, faceAdminUrl: "", disableServiceWorker: true, hmcFixedStagingEnabled: false,
  oauthEnabled: true, oauthClientId: "client-test",
  oauthAuthorizationEndpoint: "${FAKE_LOGIN}/authorize",
  oauthTokenEndpoint: "${FAKE_SUPABASE}/auth/v1/oauth/token",
  oauthRedirectUri: "${base}", oauthScope: "openid email profile",
  loginCenterUrl: "${FAKE_LOGIN}", oauthSystemTag: "",
};`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);
  if (p === "/config.js") { res.writeHead(200, { "Content-Type": types[".js"] }); res.end(testConfig()); return; }
  if (p === "/__blank.html") {
    res.writeHead(200, { "Content-Type": types[".html"] });
    res.end('<!doctype html><meta charset="utf-8"><script src="./oauthPkceCore.js"></script><p>helper</p>');
    return;
  }
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
base = `http://127.0.0.1:${server.address().port}/`;

// ---------- fake login center + token endpoint ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "auth-user-1", email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", app_metadata: { tenant_id: T, role: "operator" } })}.sig`;
const authorizeRequests = [];  // { state, challenge, url }
const tokenRequests = [];      // URLSearchParams
const blocked = [];
let authorizeMode = "stay";    // "stay" = Custom Tab (App window does not navigate); "redirect" = same-tab browser flow

async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  if (url.origin === base.replace(/\/$/, "")) return r.continue();
  if (url.origin === FAKE_LOGIN && url.pathname === "/authorize") {
    const state = url.searchParams.get("state");
    authorizeRequests.push({ state, challenge: url.searchParams.get("code_challenge"), url: url.toString() });
    if (authorizeMode === "redirect") {
      return r.fulfill({ status: 302, headers: { Location: `${base}?code=code-${authorizeRequests.length}&state=${encodeURIComponent(state)}` } });
    }
    return r.fulfill({ status: 204, body: "" }); // navigation cancelled: the App window stays where it is
  }
  if (url.origin === FAKE_SUPABASE) {
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
    if (url.pathname === "/auth/v1/oauth/token") {
      const body = new URLSearchParams(req.postData() || "");
      tokenRequests.push(body);
      return json(200, { access_token: jwt("op@test.invalid"), refresh_token: `rt-${tokenRequests.length}`, expires_in: 3600, token_type: "bearer", user: { id: "auth-user-1", email: "op@test.invalid" } });
    }
    if (url.pathname.startsWith("/auth/v1/user")) return json(200, { id: "auth-user-1", email: "op@test.invalid" });
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (url.pathname.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  }
  blocked.push(url.toString());
  return r.abort();
}

async function newContext(browser, { standalone = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 860 } });
  await context.route("**/*", route);
  if (standalone) {
    await context.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => (String(query).includes("display-mode: standalone")
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : original(query));
    });
  }
  return context;
}

const pkceChallenge = (verifier) => createHash("sha256").update(verifier).digest("base64url");
const storage = (page) => page.evaluate(() => ({
  local: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
  session: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])),
}));
const gateText = (page) => page.evaluate(() => document.getElementById("machtileLoginGate")?.innerText || "");
const signedIn = (page) => page.evaluate(() => !document.getElementById("machtileLoginGate") && Boolean(sessionStorage.getItem("machtileAuthSession")));
const sharedKeys = (s) => Object.keys(s.local).filter((k) => k.startsWith("machtileOauthPkceTx:") || k.startsWith("machtileOauthHandoff:"));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
async function startLoginInAppWindow(context) {
  const before = authorizeRequests.length;
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "commit" });
  await waitFor(async () => authorizeRequests.length > before);
  await page.waitForTimeout(300);
  return { page, auth: authorizeRequests[authorizeRequests.length - 1] };
}
// Writes a handoff from a second document (storage events only fire in *other* documents).
async function writeHandoffFromOtherTab(context, { stateKey, transaction, createdAt, raw }) {
  const helper = await context.newPage();
  await helper.goto(base + "__blank.html", { waitUntil: "domcontentloaded" });
  await helper.evaluate(async ({ stateKey, transaction, createdAt, raw }) => {
    const c = window.MachTileOauthPkceCore;
    let value = raw;
    if (!value) {
      const sealed = await c.sealHandoff({ access_token: "a.b.c", refresh_token: "rt-forged", expires_in: 3600 }, transaction, crypto, createdAt);
      value = sealed.value;
    }
    localStorage.setItem(c.handoffKey(stateKey), value);
  }, { stateKey, transaction, createdAt, raw });
  await helper.close();
}

const browser = await chromium.launch();
try {
  // ===== 1. Installed App: tab A starts, Custom Tab B finishes, A takes over =====
  console.log("== 1. 交接成功（App 視窗 A 發起、Custom Tab B 回跳）==");
  {
    authorizeMode = "stay";
    const context = await newContext(browser, { standalone: true });
    const { page: a, auth } = await startLoginInAppWindow(context);
    let s = await storage(a);
    ok(Boolean(auth?.state), "A 發起登入（攔到 authorize，state 有值）");
    ok(Boolean(s.local[`machtileOauthPkceTx:${auth.state}`]), "verifier 共享到 localStorage（以 state 為鍵）");
    ok(Boolean(s.session.machtileOauthPkceTransaction), "A 的 sessionStorage 照舊存 transaction");

    const b = await context.newPage();
    await b.goto(`${base}?code=code-cct&state=${encodeURIComponent(auth.state)}`, { waitUntil: "domcontentloaded" });
    await waitFor(async () => (await gateText(b)).includes("請回到 MachTile App") || (await gateText(b)).includes("已交給"));
    const tokenReq = tokenRequests[tokenRequests.length - 1];
    ok(tokenReq?.get("code") === "code-cct", "B 拿 code 去換 token");
    ok(tokenReq && pkceChallenge(tokenReq.get("code_verifier")) === auth.challenge, "B 用的 verifier 對得上 A 發起時的 challenge");

    const okA = await waitFor(() => signedIn(a));
    ok(okA, "A 接手登入（登入閘門消失、sessionStorage 有 session）");
    s = await storage(a);
    const sess = JSON.parse(s.session.machtileAuthSession || "{}");
    ok(sess.authMethod === "oauth" && sess.mode === "session", "A 的 session 仍是 sessionStorage／oauth／session 模式");
    ok(!s.local.machtileRememberedAuthSession, "沒有寫成 localStorage 長期 session");
    ok(sharedKeys(s).length === 0, "交接後 localStorage 的交接鍵與 verifier 都已刪除", JSON.stringify(sharedKeys(s)));
    ok(!s.session.machtileOauthPendingTransactions && !s.session.machtileOauthPkceTransaction, "A 的待完成登入紀錄已清掉");
    const sb = await storage(b);
    ok(!sb.session.machtileAuthSession, "Custom Tab B 自己不保留 session（避免兩邊共用 refresh token）");
    await waitFor(async () => (await gateText(b)).includes("已交給"));
    ok((await gateText(b)).includes("已交給 MachTile App"), "B 顯示「已交給 MachTile App」");
    await context.close();
  }

  // ===== 2. Expired handoff is rejected =====
  console.log("== 2. 過期交接被拒 ==");
  {
    authorizeMode = "stay";
    const context = await newContext(browser, { standalone: true });
    const { page: a, auth } = await startLoginInAppWindow(context);
    const tx = JSON.parse((await storage(a)).session.machtileOauthPkceTransaction);
    await writeHandoffFromOtherTab(context, { stateKey: auth.state, transaction: tx, createdAt: Date.now() - 3 * 60 * 1000 });
    await a.waitForTimeout(800);
    const s = await storage(a);
    ok(!(await signedIn(a)), "A 沒有登入");
    ok(!s.local[`machtileOauthHandoff:${auth.state}`], "過期交接鍵被刪");
    await context.close();
  }

  // ===== 3. State mismatch / wrong verifier / malformed are rejected =====
  console.log("== 3. state 不符、verifier 不符、格式錯被拒 ==");
  {
    authorizeMode = "stay";
    const context = await newContext(browser, { standalone: true });
    const { page: a, auth } = await startLoginInAppWindow(context);
    const tx = JSON.parse((await storage(a)).session.machtileOauthPkceTransaction);
    const otherTx = { ...tx, state: "S".repeat(43), verifier: "V".repeat(64) };

    // (a) handoff for a login A never started
    await writeHandoffFromOtherTab(context, { stateKey: otherTx.state, transaction: otherTx, createdAt: Date.now() });
    await a.waitForTimeout(600);
    let s = await storage(a);
    ok(!(await signedIn(a)), "別人的 state：A 不接");
    ok(Boolean(s.local[`machtileOauthHandoff:${otherTx.state}`]), "別人的交接鍵 A 不動（不是它的）");

    // (b) placed under A's key but sealed for another state
    await writeHandoffFromOtherTab(context, { stateKey: auth.state, transaction: otherTx, createdAt: Date.now() });
    await a.waitForTimeout(600);
    s = await storage(a);
    ok(!(await signedIn(a)), "鍵是 A 的、內容 state 不符：拒絕");
    ok(!s.local[`machtileOauthHandoff:${auth.state}`], "被拒的交接鍵已刪");

    // (c) right state, wrong verifier (cannot decrypt)
    await writeHandoffFromOtherTab(context, { stateKey: auth.state, transaction: { ...tx, verifier: "W".repeat(64) }, createdAt: Date.now() });
    await a.waitForTimeout(600);
    ok(!(await signedIn(a)), "verifier 不符（解不開）：拒絕");

    // (d) malformed
    await writeHandoffFromOtherTab(context, { stateKey: auth.state, raw: "{not-json" });
    await a.waitForTimeout(600);
    s = await storage(a);
    ok(!(await signedIn(a)), "格式錯：拒絕");
    ok(!s.local[`machtileOauthHandoff:${auth.state}`], "格式錯的交接鍵已刪");

    // A can still complete its real login afterwards
    const b = await context.newPage();
    await b.goto(`${base}?code=code-after&state=${encodeURIComponent(auth.state)}`, { waitUntil: "domcontentloaded" });
    ok(await waitFor(() => signedIn(a)), "被拒之後，真正的回跳仍可完成交接");
    await context.close();
  }

  // ===== 4. App window reloads mid-login + retry: no second login window, old attempt still accepted =====
  console.log("== 4. App 重新載入不重複發起；重試後舊 state 仍可交接 ==");
  {
    authorizeMode = "stay";
    const context = await newContext(browser, { standalone: true });
    const { page: a, auth } = await startLoginInAppWindow(context);
    const countBefore = authorizeRequests.length;
    await a.reload({ waitUntil: "commit" });
    await a.waitForTimeout(800);
    ok(authorizeRequests.length === countBefore, "重新載入後沒有再自動開一次登入");
    ok((await gateText(a)).includes("等待登入完成"), "顯示「等待登入完成」");
    await a.click("[data-machtile-oauth-login]");
    await waitFor(async () => authorizeRequests.length > countBefore);
    ok(authorizeRequests.length === countBefore + 1, "按「重新前往」只發起一次");
    const s = await storage(a);
    ok(JSON.parse(s.session.machtileOauthPendingTransactions || "[]").length === 2, "兩次嘗試都留在 A 的待完成清單");
    // The FIRST attempt's Custom Tab finishes.
    const b = await context.newPage();
    await b.goto(`${base}?code=code-first&state=${encodeURIComponent(auth.state)}`, { waitUntil: "domcontentloaded" });
    ok(await waitFor(() => signedIn(a)), "第一次（舊 state）的回跳仍被 A 接手");
    ok(sharedKeys(await storage(a)).length === 0, "兩次嘗試的共享鍵都清乾淨");
    await context.close();
  }

  // ===== 5. Normal browser tab: unchanged same-tab flow =====
  console.log("== 5. 一般瀏覽器分頁（非 App）登入不變 ==");
  {
    authorizeMode = "redirect";
    const context = await newContext(browser, { standalone: false });
    const before = authorizeRequests.length;
    const tokensBefore = tokenRequests.length;
    const page = await context.newPage();
    const seenTexts = [];
    page.on("console", () => {});
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const done = await waitFor(async () => {
      try { seenTexts.push(await gateText(page)); return await signedIn(page); } catch { return false; }
    }, 10000);
    ok(done, "同分頁回跳後直接登入");
    ok(authorizeRequests.length === before + 1 && tokenRequests.length === tokensBefore + 1, "authorize、token 各一次");
    const tokenReq = tokenRequests[tokenRequests.length - 1];
    ok(pkceChallenge(tokenReq.get("code_verifier")) === authorizeRequests[authorizeRequests.length - 1].challenge, "PKCE verifier 正確");
    const s = await storage(page);
    ok(JSON.parse(s.session.machtileAuthSession || "{}").authMethod === "oauth", "session 存在 sessionStorage（oauth）");
    ok(!s.local.machtileRememberedAuthSession, "沒有 localStorage 長期 session");
    ok(sharedKeys(s).length === 0, "localStorage 沒有殘留交接鍵或 verifier");
    ok(!seenTexts.some((t) => t.includes("請回到 MachTile App")), "沒有出現「請回到 App」畫面");
    ok(!new URL(page.url()).searchParams.get("code"), "網址上的 code 已清掉");

    // Reload keeps the per-tab session (unchanged behaviour).
    const authBefore = authorizeRequests.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    ok(await waitFor(() => signedIn(page)), "重新整理：同分頁 session 照舊恢復");
    ok(authorizeRequests.length === authBefore, "重新整理不會再去登入中心");

    // A brand-new tab has no session (sessionStorage is per tab) → goes to login as before.
    const other = await context.newPage();
    await other.goto(base, { waitUntil: "domcontentloaded" });
    await waitFor(async () => authorizeRequests.length > authBefore);
    ok(authorizeRequests.length === authBefore + 1, "新分頁不共用 session（照舊各自登入）");
    await context.close();
  }

  // ===== 6. Normal browser: callback with unknown state still errors as before =====
  console.log("== 6. 一般分頁：沒有對應登入資料的回跳照舊報錯 ==");
  {
    authorizeMode = "stay";
    const context = await newContext(browser, { standalone: false });
    const page = await context.newPage();
    await page.goto(`${base}?code=zzz&state=${"Q".repeat(43)}`, { waitUntil: "domcontentloaded" });
    await waitFor(async () => (await gateText(page)).includes("找不到登入驗證資料"));
    ok((await gateText(page)).includes("找不到登入驗證資料"), "顯示「找不到登入驗證資料」");
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const prodHits = blocked.filter((u) => /machtile\.com|supabase\.co/.test(u));
ok(prodHits.length === 0, "沒有任何請求打到正式網域", prodHits.join("\n        "));
console.log(`\n${pass} passed, ${fail} failed` + (blocked.length ? `  (blocked ${blocked.length} external: ${[...new Set(blocked.map((u) => new URL(u).host))].join(", ")})` : ""));
process.exit(fail ? 1 : 0);
