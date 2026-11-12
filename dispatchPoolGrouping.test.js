// 待做池「同一張工單多道收成一組」（config.dispatchPoolGroupSteps，owner 2026-11-12）的顯示測試。
// 直接從 app.js 取出真正的 render 函式在 vm 裡跑（同 stationReportPanel.test.js 的做法），不連任何後端。
// `node --test dispatchPoolGrouping.test.js`
"use strict";
process.env.TZ = "Asia/Taipei";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("./dispatchPoolCore.js");

const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const slice = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `app.js must contain ${from} … ${to}`);
  return source.slice(start, end);
};
const htmlEscape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function freshI18n(language) {
  delete require.cache[require.resolve("./i18n.js")];
  delete global.MachTileI18n;
  delete global.machtileT;
  global.localStorage = { values: new Map(), getItem(key) { return this.values.get(key) || null; }, setItem(key, value) { this.values.set(key, value); } };
  const i18n = require("./i18n.js");
  i18n.setLanguage(language || "zh-Hant");
  return i18n;
}

// Build the real section renderer. `options.source` lets a developer run the same harness against another app.js.
function harness(options = {}) {
  const source = options.source || appSource;
  const i18n = freshI18n(options.language);
  const context = {
    machtileDispatchPoolCore: core,
    machtileDispatchPoolState: { status: "ready", items: options.items || [], error: "", claimBusy: options.claimBusy || "", claimMessage: "", openRefreshByMachine: new Map(), requestSequence: 0 },
    machtilePostAppliedRefresh: { retryMs: 10000, maxRetries: 3, timers: {}, retries: {}, syncing: new Set(), exhausted: new Set() },
    machtileDepartmentAccess: { role: options.role || "operator" },
    machtileAuthState: { role: options.role || "operator" },
    machtileCanEditSchedule: () => ["planner", "admin", "manager"].includes(options.role || "operator"),
    normalizedMachineDepartment: (machine) => machine.departmentName,
    machtileTranslate: (key, params) => i18n.t(key, params),
    escapeHtml: htmlEscape,
    config: Object.assign({ dispatchPoolMachines: ["A01", "A02"], multiStationMachines: [] },
      options.flag === undefined ? {} : { dispatchPoolGroupSteps: options.flag }),
  };
  const code = [
    slice(source, "function machtileOperationLabel(", "function machtileCardSelectionCandidates("),
    slice(source, "function machtileDispatchPoolOpenRefreshState(", "function machtileRefreshDispatchPoolOnOpen("),
    slice(source, "function machtileDispatchPoolForMachine(", "function machtilePostAppliedNeedsRetry("),
    "machtileDispatchPoolSectionMarkup",
  ].join("\n");
  const render = vm.runInNewContext(code, context);
  return { render, context };
}

const MACHINE = { code: "A01", name: "A01", departmentName: "車床課", status: "idle", order: null };
const row = (o) => Object.assign({ source_key: "01|N1|S1", work_order_no: "TEST-WO-1", process_order: 1, operation_name: "CNC車床加工-1/2",
  part_no: "TEST-P1", part_name: "測試軸", quantity: 120, due_date: "2026-11-20", planned_start: "2026-11-13T00:00:00Z", urgency: 2,
  department_code: "LATHE", eligible_machine_codes: ["A01", "A02"], source_status: "pending", synced_at: "2026-11-12T03:00:00Z" }, o);

// One row per work order = today's data shape.
const SINGLE_ROWS = [
  row({ source_key: "01|N1|S1", work_order_no: "TEST-WO-1", process_order: 2 }),
  row({ source_key: "01|N2|S2", work_order_no: "TEST-WO-2", process_order: 1, operation_name: "車削", part_no: "", part_name: "測試套", quantity: null, due_date: "2026-11-30", planned_start: null, urgency: 1, eligible_machine_codes: ["A02"], source_status: "returned" }),
  row({ source_key: "01|N3|S3", work_order_no: "TEST-WO-3", process_order: 3, operation_name: null, part_name: null, urgency: 3 }),
];
// Tomorrow's data shape: TEST-WO-1 has three machining steps in the pool, TEST-WO-2 (more urgent) one, TEST-WO-9 one.
const MULTI_ROWS = [
  row({ source_key: "01|N1|S3", work_order_no: "TEST-WO-1", process_order: 3, operation_name: "CNC車床加工-3/3", planned_start: "2026-11-13T00:00:00Z" }),
  row({ source_key: "01|N1|S1", work_order_no: "TEST-WO-1", process_order: 1, operation_name: "CNC車床加工-1/3", planned_start: "2026-11-15T00:00:00Z" }),
  row({ source_key: "01|N1|S2", work_order_no: "TEST-WO-1", process_order: 2, operation_name: "CNC車床加工-2/3", planned_start: "2026-11-14T00:00:00Z", source_status: "returned" }),
  row({ source_key: "01|N2|S1", work_order_no: "TEST-WO-2", process_order: 1, operation_name: "車削", part_no: "TEST-P2", part_name: "測試套", urgency: 1 }),
  row({ source_key: "01|N9|S1", work_order_no: "TEST-WO-9", process_order: 1, operation_name: "車削", part_no: "TEST-P9", part_name: "測試環", urgency: 4 }),
];

const liTags = (html) => [...html.matchAll(/<li([^>]*)>/g)].map((m) => {
  const dataset = {};
  for (const a of m[1].matchAll(/data-([a-z-]+)(?:="([^"]*)")?/g)) dataset[a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2] ?? "";
  return { attrs: m[1], dataset, hidden: false };
});
const poolKeys = (html) => liTags(html).filter((li) => "poolKey" in li.dataset).map((li) => li.dataset.poolKey);
const rowHtml = (html, key) => {
  const start = html.indexOf(`data-pool-key="${htmlEscape(key)}"`);
  assert.ok(start >= 0, `row ${key} rendered`);
  return html.slice(html.lastIndexOf("<li", start), html.indexOf("</li>", start) + 5);
};
const claimButtons = (html) => new Map([...html.matchAll(/<button type="button" data-pool-claim="([^"]*)" data-pool-machine="([^"]*)"[^>]*>[^<]*<\/button>/g)]
  .map((m) => [m[1], { html: m[0], payload: JSON.stringify(core.claimArgs(m[1], m[2])) }]));

// Legacy markup of SINGLE_ROWS, generated from origin/main 34a5df2 (before grouping existed) with this same harness.
const LEGACY_SINGLE_GOLDEN = fs.readFileSync(path.join(__dirname, "dispatchPoolGrouping.legacy.golden.txt"), "utf8").replace(/\r\n/g, "\n");

test("flag off (and flag absent): markup is byte-identical to the pre-grouping app", () => {
  for (const flag of [undefined, false]) {
    const html = harness({ items: SINGLE_ROWS, flag }).render(MACHINE);
    assert.equal(html, LEGACY_SINGLE_GOLDEN);
  }
});

test("flag on + one row per work order (today's data): renders exactly as before", () => {
  const html = harness({ items: SINGLE_ROWS, flag: true }).render(MACHINE);
  assert.equal(html, LEGACY_SINGLE_GOLDEN);
  assert.ok(!html.includes("pool-group-head") && !html.includes("pool-step-hint") && !html.includes("is-grouped"));
  // planner view (not-eligible rows listed and dimmed) is unchanged as well
  const off = harness({ items: SINGLE_ROWS, flag: false, role: "planner" }).render(MACHINE);
  assert.equal(harness({ items: SINGLE_ROWS, flag: true, role: "planner" }).render(MACHINE), off);
  assert.ok(off.includes("is-not-eligible"));
});

test("flag off with several steps of one order: still one flat legacy list in owner order", () => {
  const html = harness({ items: MULTI_ROWS, flag: false }).render(MACHINE);
  assert.ok(!html.includes("pool-group-head") && !html.includes("pool-step-hint"));
  assert.deepEqual(poolKeys(html), core.sortItems(MULTI_ROWS).map((x) => x.source_key));
});

test("flag on: steps of one order form one block, sorted by step, with header and per-row step + operation + quantity", () => {
  const html = harness({ items: MULTI_ROWS, flag: true }).render(MACHINE);
  // urgency order between different orders unchanged: WO-2 (緊急 1) → WO-1 (緊急 2) → WO-9 (緊急 4)
  assert.deepEqual(poolKeys(html), ["01|N2|S1", "01|N1|S1", "01|N1|S2", "01|N1|S3", "01|N9|S1"]);
  const lis = liTags(html);
  const heads = lis.filter((li) => "poolGroupHead" in li.dataset);
  assert.deepEqual(heads.map((li) => li.dataset.poolGroupHead), ["TEST-WO-1"]);
  assert.equal(lis.indexOf(heads[0]), 1, "header sits directly above its rows");
  assert.deepEqual(lis.slice(2, 5).map((li) => li.dataset.poolGroup), ["TEST-WO-1", "TEST-WO-1", "TEST-WO-1"]);
  assert.ok(!("pickSearchItem" in heads[0].dataset), "header is not a searchable / countable row");
  const head = html.slice(html.indexOf('<li class="pool-group-head"'), html.indexOf("</li>", html.indexOf('<li class="pool-group-head"')));
  assert.ok(head.includes("<strong>TEST-WO-1</strong>") && head.includes("TEST-P1 · 測試軸") && head.includes("這張單在待做池有 3 道：第 1、2、3 道"));
  assert.ok(!head.includes("<button"), "header has no buttons");
  const step2 = rowHtml(html, "01|N1|S2");
  assert.ok(step2.includes('data-pool-step="2"') && step2.includes("第 2 道 · CNC車床加工-2/3"));
  assert.ok(step2.includes("數量 120 · 交期 11/20"));
  assert.ok(step2.includes("退回待接") && step2.includes("緊急 2"));
  // rows of single-row orders keep the legacy layout (order number as the row title)
  assert.equal(rowHtml(html, "01|N2|S1"), rowHtml(harness({ items: MULTI_ROWS, flag: false }).render(MACHINE), "01|N2|S1"));
  assert.equal(rowHtml(html, "01|N9|S1"), rowHtml(harness({ items: MULTI_ROWS, flag: false }).render(MACHINE), "01|N9|S1"));
});

test("flag on: non-blocking hint names the earlier steps still in the pool; first step has none", () => {
  const html = harness({ items: MULTI_ROWS, flag: true }).render(MACHINE);
  assert.ok(!rowHtml(html, "01|N1|S1").includes("pool-step-hint"));
  assert.ok(rowHtml(html, "01|N1|S2").includes('data-pool-earlier-steps="1"') && rowHtml(html, "01|N1|S2").includes("前面第 1 道還在待做池（還沒做完）"));
  assert.ok(rowHtml(html, "01|N1|S3").includes('data-pool-earlier-steps="1,2"') && rowHtml(html, "01|N1|S3").includes("前面第 1、2 道還在待做池"));
  // the hint never disables the claim: every claim button is enabled on an idle, eligible, opened machine
  for (const [, button] of claimButtons(html)) assert.ok(!/\sdisabled/.test(button.html.replace(/aria-disabled="false"/, "")), button.html);
});

test("flag on: operator whose machine can only do a later step still gets the hint (earlier step hidden as not eligible)", () => {
  const items = [row({ source_key: "01|N1|S1", process_order: 1, eligible_machine_codes: ["A02"] }), row({ source_key: "01|N1|S2", process_order: 2, eligible_machine_codes: ["A01"] })];
  const html = harness({ items, flag: true }).render(MACHINE);
  assert.deepEqual(poolKeys(html), ["01|N1|S2"]);
  assert.ok(!html.includes("pool-group-head"), "a single visible row is not wrapped in a group");
  assert.ok(html.includes("<strong>TEST-WO-1</strong>") && html.includes("N2 CNC車床加工-1/2"), "legacy row layout kept");
  assert.ok(html.includes("前面第 1 道還在待做池"));
});

test("claim button and claim RPC payload are byte-identical with and without grouping", () => {
  for (const role of ["operator", "planner"]) {
    const before = claimButtons(harness({ items: MULTI_ROWS, flag: false, role }).render(MACHINE));
    const after = claimButtons(harness({ items: MULTI_ROWS, flag: true, role }).render(MACHINE));
    assert.equal(before.size, MULTI_ROWS.length);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
    for (const [key, button] of before) {
      assert.equal(after.get(key).html, button.html, `claim button of ${key}`);
      assert.equal(after.get(key).payload, button.payload, `claim payload of ${key}`);
      assert.equal(button.payload, JSON.stringify({ p_source_key: key, p_machine_code: "A01" }));
    }
  }
  // the click handler and sender still pass exactly (source_key, machine_code) from the button into claimArgs
  assert.ok(appSource.includes("void machtileClaimDispatchPool(poolClaim.dataset.poolClaim, poolClaim.dataset.poolMachine);"));
  const sender = slice(appSource, "async function machtileClaimDispatchPool(", "async function machtileReplaceStoppedDispatchPool(");
  assert.ok(sender.includes("const args = machtileDispatchPoolCore.claimArgs(sourceKey, machineCode);"));
  assert.ok(sender.includes('await supabaseFetch("rpc/dispatch_pool_claim", { method: "POST", body: JSON.stringify(args) });'));
});

test("grouping adds no buttons and rendering does not mutate pool state or rows", () => {
  const count = (html) => (html.match(/<button/g) || []).length;
  for (const role of ["operator", "planner"]) {
    const on = harness({ items: MULTI_ROWS, flag: true, role });
    const before = JSON.stringify(on.context.machtileDispatchPoolState.items);
    const stateKeys = JSON.stringify(Object.keys(on.context.machtileDispatchPoolState));
    const html = on.render(MACHINE);
    assert.equal(count(html), count(harness({ items: MULTI_ROWS, flag: false, role }).render(MACHINE)));
    assert.equal(JSON.stringify(on.context.machtileDispatchPoolState.items), before);
    assert.equal(JSON.stringify(Object.keys(on.context.machtileDispatchPoolState)), stateKeys);
    assert.equal(on.context.machtileDispatchPoolState.items.length, MULTI_ROWS.length);
    assert.ok(on.context.machtileDispatchPoolState.items.every((item, i) => item === MULTI_ROWS[i] && !("eligibleHere" in item)));
  }
});

test("search (order no / part no / part name / operation) keeps working and hides a header with no visible rows", () => {
  const html = harness({ items: MULTI_ROWS, flag: true }).render(MACHINE);
  const i18n = freshI18n();
  const apply = vm.runInNewContext(`${slice(appSource, "function machtilePickOrderApplySearch(", "function machtilePickOrderClearSearch(")}\n machtilePickOrderApplySearch`,
    { machtileDispatchPoolCore: core, machtileTranslate: (key, params) => i18n.t(key, params) });
  const run = (query) => {
    const lis = liTags(html);
    const countBox = { textContent: "" };
    const pane = { querySelectorAll: (selector) => lis.filter((li) => (selector === "[data-pick-search-item]" ? "pickSearchItem" in li.dataset : selector === "[data-pool-group-head]" ? "poolGroupHead" in li.dataset : false)) };
    const holder = { dataset: { pickOrder: "true" },
      querySelector: (selector) => (selector === "[data-pick-order-search]" ? { value: query } : selector.startsWith("[data-pick-pane]") ? pane : selector === "[data-pick-order-search-count]" ? countBox : null),
      querySelectorAll: () => [] };
    apply(holder);
    return { visible: lis.filter((li) => "poolKey" in li.dataset && !li.hidden).map((li) => li.dataset.poolKey),
      headHidden: lis.find((li) => "poolGroupHead" in li.dataset).hidden, count: countBox.textContent };
  };
  assert.deepEqual(run(""), { visible: ["01|N2|S1", "01|N1|S1", "01|N1|S2", "01|N1|S3", "01|N9|S1"], headHidden: false, count: i18n.t("pick_order_search_count", { matches: 5, total: 5 }) });
  assert.deepEqual(run("wo-1").visible, ["01|N1|S1", "01|N1|S2", "01|N1|S3"]);
  assert.equal(run("wo-1").headHidden, false);
  assert.deepEqual(run("TEST-P1").visible, ["01|N1|S1", "01|N1|S2", "01|N1|S3"]);
  assert.deepEqual(run("測試軸").visible, ["01|N1|S1", "01|N1|S2", "01|N1|S3"]);
  assert.deepEqual(run("2/3"), { visible: ["01|N1|S2"], headHidden: false, count: i18n.t("pick_order_search_count", { matches: 1, total: 5 }) });
  assert.deepEqual(run("測試環"), { visible: ["01|N9|S1"], headHidden: true, count: i18n.t("pick_order_search_count", { matches: 1, total: 5 }) });
  assert.equal(run("no-such-order").headHidden, true);
});

test("new strings exist in zh-Hant and vi (i18n.js and locales/*.json) and render in Vietnamese", () => {
  const i18n = freshI18n();
  const zhJson = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/zh-Hant.json"), "utf8"));
  const viJson = JSON.parse(fs.readFileSync(path.join(__dirname, "locales/vi.json"), "utf8"));
  for (const key of ["pool_step_label", "pool_group_steps", "pool_earlier_steps_waiting"]) {
    assert.equal(typeof i18n.dictionaries["zh-Hant"][key], "string", `${key} zh-Hant`);
    assert.equal(typeof i18n.dictionaries.vi[key], "string", `${key} vi`);
    assert.notEqual(i18n.dictionaries.vi[key], i18n.dictionaries["zh-Hant"][key], `${key} is translated`);
    assert.equal(zhJson[key], i18n.dictionaries["zh-Hant"][key], `${key} locales/zh-Hant.json`);
    assert.equal(viJson[key].value, i18n.dictionaries.vi[key], `${key} locales/vi.json`);
    const placeholders = (s) => (s.match(/{{\w+}}/g) || []).sort().join();
    assert.equal(placeholders(i18n.dictionaries.vi[key]), placeholders(i18n.dictionaries["zh-Hant"][key]), `${key} placeholders`);
  }
  const html = harness({ items: MULTI_ROWS, flag: true, language: "vi" }).render(MACHINE);
  assert.ok(html.includes("Công đoạn 2 · CNC車床加工-2/3") && html.includes("Công đoạn trước (1、2)") && !html.includes("{{"));
});

// Guard (same reason as stationCommandPollColumns.test.js): a column that does not exist in a PostgREST select = HTTP 400
// for every read. public.dispatch_pool_items columns, read from machtile-mini-mes origin/main bc277e6 migrations on
// 2026-11-12: created in 20261007120000_dispatch_pool_items.sql; no later migration adds or drops a column
// (20261014035353 only widens the status check, 20261015121359 only drops NOT NULL on operation_name / part_name).
const POOL_COLUMNS = new Set(["tenant_id", "source_key", "work_order_no", "process_order", "operation_name", "part_no", "part_name",
  "quantity", "due_date", "planned_start", "urgency", "department_code", "eligible_machine_codes", "source_status", "pooled_at",
  "status", "first_seen_at", "synced_at", "gone_at"]);

test("every dispatch_pool_items column the app selects, filters or orders by exists in the cloud schema", () => {
  const reads = fs.readdirSync(__dirname).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js")).flatMap((name) =>
    [...fs.readFileSync(path.join(__dirname, name), "utf8").matchAll(/dispatch_pool_items\?select=([^"`]+)/g)].map((m) => ({ name, query: m[1] })));
  assert.ok(reads.length >= 2, `expected at least 2 dispatch_pool_items reads, found ${reads.length}`);
  let checked = 0;
  for (const { name, query } of reads) {
    const [select, ...params] = query.split("&");
    assert.match(select, /^[A-Za-z0-9_,:]+$/, `${name}: plain column list expected (select=${select})`);
    const columns = select.split(",").map((item) => (item.includes(":") ? item.split(":")[1] : item));
    for (const param of params) {
      const [key, value = ""] = param.split("=");
      if (key === "order") columns.push(...value.split(",").map((item) => item.split(".")[0]));
      else if (key !== "limit" && key !== "offset") columns.push(key);
    }
    for (const column of columns) {
      assert.ok(POOL_COLUMNS.has(column), `${name}: dispatch_pool_items has no column "${column}" (${query})`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20);
});

test("the pool list only reads row fields that the pool select actually returns", () => {
  const select = appSource.match(/dispatch_pool_items\?select=([A-Za-z0-9_,]+)&status=eq\.waiting/);
  assert.ok(select, "pool list select found");
  const selected = new Set(select[1].split(","));
  const used = new Set();
  const renderSource = slice(appSource, "function machtileDispatchPoolSectionMarkup(", "function machtilePostAppliedNeedsRetry(");
  for (const m of renderSource.matchAll(/\bitem\.([a-z_A-Z]+)/g)) used.add(m[1]);
  const coreSource = fs.readFileSync(path.join(__dirname, "dispatchPoolCore.js"), "utf8");
  for (const m of coreSource.matchAll(/\b(?:item|other|a|b)\??\.([a-z]+_[a-z_]+)\b/g)) used.add(m[1]);
  for (const m of coreSource.matchAll(/firstText\("([a-z_]+)"\)/g)) used.add(m[1]);
  used.delete("eligibleHere"); // added in memory by itemsForMachine, never requested from the cloud
  for (const alias of ["process_name"]) used.delete(alias); // search-only alias for non-pool lists
  assert.ok(used.size >= 10, `expected to find the row fields in use, found ${[...used].join(",")}`);
  for (const field of used) assert.ok(selected.has(field), `row field "${field}" is rendered but not in the pool select (${select[1]})`);
});

module.exports = { harness, SINGLE_ROWS, MACHINE };
