import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { chromium = null; }

test("browser: start gap and configurable overtime decisions run in Chromium", { skip: !chromium }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: new URL("./stationCommandCore.js", import.meta.url).pathname.replace(/^\/(.:)/, "$1") });
    const result = await page.evaluate(() => ({
      gap: MachTileStationCommandCore.startQtyGap(208, 200),
      at1730: MachTileStationCommandCore.overtimePromptDue({ promptEnabled: true, noStartEnabled: false, shiftEndTime: "17:30", now: new Date(2026, 9, 28, 17, 31) }),
      at1800: MachTileStationCommandCore.overtimePromptDue({ promptEnabled: true, noStartEnabled: false, shiftEndTime: "18:00", now: new Date(2026, 9, 28, 18, 1) }),
      disabled: MachTileStationCommandCore.overtimePromptDue({ promptEnabled: false, noStartEnabled: false, shiftEndTime: "17:00", now: new Date(2026, 9, 28, 20, 0) }),
    }));
    assert.deepEqual(result, { gap: { machine: 208, reported: 200, gap: 8 }, at1730: true, at1800: true, disabled: false });
  } finally { await browser.close(); }
});

test("browser contract: untouched takeover choice, clickable validation and scroll target are wired", async () => {
  const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /allow_takeover_touched && viewState\.form\.allow_takeover \? "is-selected"/);
  assert.match(app, /data-takeover-stop-confirm aria-disabled=/);
  assert.match(app, /machtileTakeoverShowMissing[\s\S]*scrollIntoView/);
  assert.match(app, /start_qty_gap_warning/);
  assert.match(app, /overtimeGuardSnapshot/);
});
