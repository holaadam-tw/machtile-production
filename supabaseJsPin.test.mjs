// Guard: the optional Realtime SDK must load from an exact, integrity-checked URL (never a floating "@2"),
// and the Realtime flag stays off by default.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const app = read("app.js");
const urls = [...app.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@([^/"']+)\/([^"']+)/g)];
assert.equal(urls.length, 1, `expected exactly one supabase-js CDN URL in app.js, found ${urls.length}`);
const [, version, file] = urls[0];
assert.match(version, /^\d+\.\d+\.\d+$/, `supabase-js must be pinned to an exact version, got "@${version}"`);
assert.equal(file, "dist/umd/supabase.js", "use the published UMD file; jsDelivr-generated .min.js is not SRI-safe");
const loader = app.slice(app.indexOf("function machtileLoadSupabaseJs()"), app.indexOf("async function machtileStationCmdSubscribe("));
assert.match(loader, /script\.integrity = "sha384-[A-Za-z0-9+/]{64}";/, "loader must set a sha384 integrity value");
assert.match(loader, /script\.crossOrigin = "anonymous";/, "SRI on a cross-origin script needs crossOrigin=anonymous");
for (const name of ["config.js", "config.example.js", "config.production.example.js"]) {
  assert.doesNotMatch(read(name), /enableStationCommandRealtime:\s*true/, `${name}: enableStationCommandRealtime must stay off`);
}
assert.match(read("config.js"), /enableStationCommandRealtime:\s*false/, "config.js must keep enableStationCommandRealtime: false");
console.log(`PASS supabase-js pinned to ${version} with SRI; Realtime flag off`);
