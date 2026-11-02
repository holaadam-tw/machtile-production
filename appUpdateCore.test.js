const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./appUpdateCore.js");

test("same or invalid versions do nothing", () => {
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "20261103-x-r1" }), "none");
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "" }), "none");
  assert.equal(core.decide({ pageVersion: "unversioned", latestVersion: "also-unversioned" }), "none");
});

test("a newer deployed version prompts only when idle", () => {
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "20261103-x-r2" }), "prompt");
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "20261103-x-r2", busy: true }), "defer");
});

test("older cached deployment never prompts or reloads", () => {
  assert.equal(core.decide({ pageVersion: "20261103-x-r2", latestVersion: "20261103-x-r1" }), "none");
  assert.equal(core.decide({ pageVersion: "20261103-x-r2", latestVersion: "20261102-x-r99", tv: true }), "none");
});

test("TV mode defers while busy and reloads only when idle", () => {
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "20261103-x-r2", busy: true, tv: true }), "defer");
  assert.equal(core.decide({ pageVersion: "20261103-x-r1", latestVersion: "20261103-x-r2", tv: true }), "reload");
});

test("same mismatch may reload only once per 30 minutes", () => {
  const now = 10_000_000;
  assert.equal(core.reloadAllowed(null, "20261103-x-r2", now), true);
  assert.equal(core.reloadAllowed({ version: "20261103-x-r2", reloadedAt: now - 1 }, "20261103-x-r2", now), false);
  assert.equal(core.reloadAllowed({ version: "20261103-x-r2", reloadedAt: now - core.RELOAD_COOLDOWN_MS }, "20261103-x-r2", now), true);
  assert.equal(core.reloadAllowed({ version: "20261103-x-r1", reloadedAt: now - 1 }, "20261103-x-r2", now), true);
});
