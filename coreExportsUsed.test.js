// Guard: every `<coreGlobal>.<member>` that app code calls must exist on that core module's public object.
// 2026-11-12: app.js called machtileStationCmdCore.taiwanParts, which was defined inside stationCommandCore.js
// but never exported, so the call threw "taiwanParts is not a function" after an operator pressed start.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = __dirname;
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...indexHtml.matchAll(/<script[^>]+src="\.\/([^"?]+\.js)(?:\?[^"]*)?"/g)].map((m) => m[1]);
assert.ok(scripts.includes("app.js"), "index.html must load app.js");

// Load every non-app script in page order into one sandbox, recording which globals each one adds.
const windowObj = {};
const sandbox = { window: windowObj, self: windowObj, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  crypto: require("crypto").webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Intl, Date, Math, JSON,
  navigator: { userAgent: "node", language: "zh-TW" }, location: { href: "http://localhost/", search: "", hostname: "localhost", origin: "http://localhost" },
  document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, documentElement: { lang: "zh-Hant", dataset: {} }, createElement() { return { style: {}, dataset: {}, setAttribute() {}, appendChild() {} }; } },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
sandbox.globalThis = windowObj;
Object.assign(windowObj, { addEventListener() {}, navigator: sandbox.navigator, location: sandbox.location, document: sandbox.document, localStorage: sandbox.localStorage, sessionStorage: sandbox.sessionStorage, crypto: sandbox.crypto, setTimeout, clearTimeout });
vm.createContext(sandbox);
const loadErrors = [];
for (const file of scripts) {
  if (file === "app.js" || !fs.existsSync(path.join(root, file))) continue;
  try { vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file }); }
  catch (error) { loadErrors.push(`${file}: ${error.message}`); }
}

// app.js binds cores to local names: `const machtileXxxCore = window.SomeGlobal ...`. Resolve name -> object.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const bindings = new Map();
for (const m of appSource.matchAll(/(?:const|let|var)[ ]+(machtile[A-Za-z0-9]*Core)[ ]*=[^;]*?(?:window|globalThis|self)[.]([A-Z][A-Za-z0-9_$]*Core)[^;]*;/g)) bindings.set(m[1], m[2]);
assert.ok(bindings.size >= 5, `expected app.js to bind at least 5 core modules, found ${bindings.size}`);

let checked = 0;
const missing = [];
const unresolved = [];
for (const [localName, globalName] of bindings) {
  const core = windowObj[globalName];
  if (!core || typeof core !== "object") { unresolved.push(`${localName} <- window.${globalName}`); continue; }
  const used = new Set([...appSource.matchAll(new RegExp("(?:^|[^A-Za-z0-9_$])" + localName + "(?:[(][)])?[?]?[.]([A-Za-z_$][A-Za-z0-9_$]*)", "g"))].map((m) => m[1]));
  for (const member of used) {
    checked += 1;
    if (!(member in core)) missing.push(`${localName}.${member} (window.${globalName} has no "${member}")`);
  }
}
assert.deepStrictEqual(missing, [], `app.js uses core members that are not exported:\n  ${missing.join("\n  ")}`);
console.log(`PASS core exports used by app.js exist: ${bindings.size} cores bound, ${checked} members checked` +
  (unresolved.length ? `; not loadable in node (skipped): ${unresolved.join(", ")}` : "") +
  (loadErrors.length ? `; load errors: ${loadErrors.length}` : ""));
