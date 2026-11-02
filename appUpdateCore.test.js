const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./appUpdateCore.js");

test("same or invalid versions do nothing", () => {
  assert.equal(core.decide({ pageVersion: "r1", latestVersion: "r1" }), "none");
  assert.equal(core.decide({ pageVersion: "r1", latestVersion: "" }), "none");
});

test("a newer deployed version prompts only when idle", () => {
  assert.equal(core.decide({ pageVersion: "r1", latestVersion: "r2" }), "prompt");
  assert.equal(core.decide({ pageVersion: "r1", latestVersion: "r2", busy: true }), "defer");
});

test("TV mode reloads directly even when busy", () => {
  assert.equal(core.decide({ pageVersion: "r1", latestVersion: "r2", busy: true, tv: true }), "reload");
});
