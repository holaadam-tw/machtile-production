import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";

const run = (command) => childProcess.execFileSync("git", command, { encoding: "utf8" }).trim();
let base = process.env.ASSET_VERSION_BASE || "origin/pr-105-head";
try { run(["rev-parse", "--verify", base]); }
catch { base = run(["merge-base", "HEAD", "origin/main"]); }

const currentHtml = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const baseHtml = run(["show", `${base}:index.html`]);
const changed = new Set(run(["diff", "--name-only", base, "--"]).split(/\r?\n/).filter(Boolean));
const versionMap = (html) => new Map([...html.matchAll(/(?:src|href)=["']\.\/([^"'?]+)\?v=([^"']+)/g)].map((match) => [match[1], match[2]]));
const currentVersions = versionMap(currentHtml);
const baseVersions = versionMap(baseHtml);
const changedAssets = [...changed].filter((file) => currentVersions.has(file) && baseVersions.has(file));

assert.ok(changedAssets.length > 0, "test setup must find changed versioned assets");
for (const file of changedAssets) {
  assert.notEqual(currentVersions.get(file), baseVersions.get(file), `${file} changed, so its index.html ?v= must change`);
}
console.log(`PASS asset cache versions changed for: ${changedAssets.join(", ")}`);
