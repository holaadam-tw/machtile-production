import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("production assembly config opens only F01/G01 for the approved tenant", async () => {
  const source = await readFile(new URL("./config.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "config.js" });
  const config = context.window.MACHTILE_CONFIG;

  assert.equal(config.assemblyReportEnabled, true);
  assert.deepEqual(Array.from(config.assemblyStations), ["F01", "G01"]);
  assert.deepEqual(Array.from(config.assemblyReportTenants), ["a5b73213-3b81-43cf-9e88-dfaa7d3fcd1f"]);
  assert.deepEqual(Array.from(config.assemblyDefectStations), ["G01"]);
  assert.deepEqual(Array.from(config.assemblyDefectReasons), []);
});
