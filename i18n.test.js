const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function freshI18n() {
  delete require.cache[require.resolve("./i18n.js")];
  delete global.MachTileI18n;
  delete global.machtileT;
  global.localStorage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) || null; },
    setItem(key, value) { this.values.set(key, value); }
  };
  return require("./i18n.js");
}

test("falls back to zh-Hant and warns only once", () => {
  const i18n = freshI18n();
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    i18n.setLanguage("vi");
    delete i18n.dictionaries.vi.report;
    assert.equal(i18n.t("report"), "報工");
    assert.equal(i18n.t("report"), "報工");
    assert.equal(warnings.length, 1);
  } finally { console.warn = original; }
});

test("interpolates named parameters", () => {
  const i18n = freshI18n();
  assert.equal(i18n.t("dispatch_pool_count", { count: 3 }), "待做池：目前 3 張可接");
});

test("switches language, persists per device and rejects unsupported values", () => {
  const i18n = freshI18n();
  assert.equal(i18n.getLanguage(), "zh-Hant");
  assert.equal(i18n.setLanguage("vi"), true);
  assert.equal(i18n.t("report"), "Báo cáo");
  assert.equal(global.localStorage.getItem(i18n.STORAGE_KEY), "vi");
  assert.equal(i18n.setLanguage("en"), false);
  assert.equal(i18n.getLanguage(), "vi");
  i18n.setLanguage("zh-Hant");
  assert.equal(i18n.t("report"), "報工");
});

test("locale files have matching keys and every Vietnamese entry is marked draft", () => {
  const zh = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/zh-Hant.json"), "utf8"));
  const vi = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/vi.json"), "utf8"));
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(zh).sort());
  Object.values(vi).forEach((entry) => {
    assert.equal(entry._draft, true);
    assert.equal(typeof entry.value, "string");
    assert.ok(entry.value.length > 0);
  });
});
