const core = require("./inspectionLinkCore.js");
let passed = 0;
function equal(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  passed += 1; console.log(`PASS ${name}`);
}
equal("allowlist defaults closed", core.isAllowed("A04", []), false);
equal("allowlist is case insensitive", core.isAllowed("a04", ["A04"]), true);
equal("allowlist rejects another machine", core.isAllowed("B01", ["A04"]), false);
equal("allowlist wildcard", core.isAllowed("B01", ["*"]), true);
const result = core.buildUrl("https://holaadam-tw.github.io/I-Reporter/", {
  wo_id: "11111111-1111-4111-8111-111111111111", wo: "WO 100/甲",
  process_id: "22222222-2222-4222-8222-222222222222", process: "精銑 & 去毛邊",
  machine_id: "33333333-3333-4333-8333-333333333333", machine: "A04 小瀧澤",
  operator_id: "44444444-4444-4444-8444-444444444444", operator: "王小明", return_url: "https://app.machtile.com/",
});
const url = new URL(result);
equal("URL origin and path", `${url.origin}${url.pathname}`, "https://holaadam-tw.github.io/I-Reporter/");
equal("process-record tab", url.searchParams.get("tab"), "process_record");
equal("readable values round trip", [url.searchParams.get("wo"), url.searchParams.get("process"), url.searchParams.get("machine"), url.searchParams.get("operator")], ["WO 100/甲", "精銑 & 去毛邊", "A04 小瀧澤", "王小明"]);
equal("percent encoding is present", result.includes("WO+100%2F%E7%94%B2") && result.includes("%E7%B2%BE%E9%8A%91+%26+%E5%8E%BB%E6%AF%9B%E9%82%8A"), true);
equal("return URL", url.searchParams.get("return_url"), "https://app.machtile.com/");
equal("no secrets or email fields", [...url.searchParams.keys()].some((key) => /token|email/i.test(key)), false);
equal("invalid base URL closes link", core.buildUrl("not a URL", { wo: "WO-1" }), "");
equal("non-web scheme closes link", core.buildUrl("javascript:alert(1)", { wo: "WO-1" }), "");
console.log(`ALL PASS (${passed})`);
