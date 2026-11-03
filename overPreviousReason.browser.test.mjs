import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const mod = await import(process.env.MACHTILE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MACHTILE_PLAYWRIGHT_MODULE).href : "playwright");
const { chromium } = mod.default || mod;
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const app = await readFile(path.join(root, "app.js"), "utf8");
const core = await readFile(path.join(root, "stationReportCore.js"), "utf8");
const start = app.indexOf("const machtileOverPreviousOptions");
const end = app.indexOf("const machtileStationReportEnabled", start);
if (start < 0 || end < 0) throw new Error("over-previous dialog source not found");
const dialogSource = app.slice(start, end);
const retryNoteStart = app.indexOf("function machtileStationReportRetryNote");
const retryNoteEnd = app.indexOf("async function machtileStationReportRetryAck", retryNoteStart);
if (retryNoteStart < 0 || retryNoteEnd < 0) throw new Error("station report retry-note source not found");
const retryNoteSource = app.slice(retryNoteStart, retryNoteEnd);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
await page.setContent("<!doctype html><html lang='zh-Hant'><body></body></html>");
await page.addStyleTag({ path: path.join(root, "styles.css") });
await page.addScriptTag({ content: `window.config={enableOverPreviousReasonPrompt:false}; window.escapeHtml=(v)=>String(v); window.machtileTranslate=(key,p)=>({over_previous_title:'這次比上一站多報 '+p?.count+' 件，請選原因',over_previous_choose:'多報原因',over_previous_f01:'F01 漏報／晚報',over_previous_retest:'同一台重測',over_previous_other:'其他',over_previous_other_label:'請填其他原因（至少 4 字）',over_previous_other_short:'請選原因；其他原因至少填 4 個字。',over_previous_submit:'確認並送出',cancel:'取消'})[key]||key;` });
await page.addScriptTag({ content: core });
await page.addScriptTag({ content: `${dialogSource}\n${retryNoteSource}\nwindow.testAsk=machtileAskOverPreviousReason; window.testOptions=machtileOverPreviousOptions; window.testRetryNote=machtileStationReportRetryNote;` });

const preview = await page.evaluate(() => {
  const result = { allowed: false, hard: false, guard_code: "QTY_OVER_PREVIOUS_WITH_REASON", available: 8,
    legacy_snapshot: { report: { guard: { code: "QTY_OVER_PREVIOUS_WITH_REASON", hard: false, Details: { available: 8 } } } } };
  const row = { command_uuid: "11111111-1111-4111-8111-111111111111", command_type: "report_preview", status: "previewed", preview_result: result };
  return { off: MachTileStationReportCore.resultCard(row, testOptions()).kind, row };
});
if (preview.off !== "preview-blocked") throw new Error("flag off must not open reason flow");
await page.evaluate(() => { config.enableOverPreviousReasonPrompt = true; window.reasonPromise = testAsk(3); });
await page.locator('input[value="other"]').check();
await page.locator("[data-over-previous-other]").fill("三字喔");
await page.locator("[data-over-previous-form] button[type=submit]").click();
if (await page.locator("[data-over-previous-dialog]").count() !== 1) throw new Error("other under four characters must stay blocked");
await page.locator("[data-over-previous-other]").fill("治具定位偏移");
await page.locator("[data-over-previous-form] button[type=submit]").click();
const reason = await page.evaluate(() => reasonPromise);
const payload = await page.evaluate(({ row, reason }) => {
  const c = MachTileStationReportCore;
  const before = { p_command_uuid: row.command_uuid, p_preview: true, p_acks: null, p_report_note: null };
  return c.retryWithAck(before, c.OVER_PREVIOUS_ACK, "22222222-2222-4222-8222-222222222222", reason, testOptions());
}, { row: preview.row, reason });
if (payload.p_command_uuid === preview.row.command_uuid) throw new Error("retry UUID was not renewed");
if (payload.p_acks?.[0] !== "QTY_OVER_PREVIOUS_WITH_REASON" || payload.p_report_note !== "其他：治具定位偏移") throw new Error("retry payload missing ack or note");
const finalPayload = await page.evaluate((overPayload) => {
  const c = MachTileStationReportCore;
  const note = testRetryNote(overPayload, "", c);
  return c.retryWithAck(overPayload, "AUTO_PULL_ACK", "33333333-3333-4333-8333-333333333333", note, testOptions());
}, payload);
if (finalPayload.p_command_uuid === payload.p_command_uuid) throw new Error("AUTO_PULL_ACK retry UUID was not renewed");
if (finalPayload.p_report_note !== "其他：治具定位偏移") throw new Error("AUTO_PULL_ACK retry lost over-previous reason");
if (finalPayload.p_acks?.join(",") !== "QTY_OVER_PREVIOUS_WITH_REASON,AUTO_PULL_ACK") throw new Error("AUTO_PULL_ACK retry did not preserve both acknowledgements");
const ordinaryNote = await page.evaluate(() => testRetryNote({ p_acks: ["OLD_ORDER_NEWER_OPEN"], p_report_note: "stored" }, "row note", MachTileStationReportCore));
if (ordinaryNote !== "row note") throw new Error("non-over-previous retry behavior changed");
const shotDir = process.env.OVER_PREVIOUS_SHOT_DIR || path.join(os.tmpdir(), "machtile-shots");
await mkdir(shotDir, { recursive: true });
await page.evaluate(() => { window.reasonPromise = testAsk(3); });
await page.locator('input[value="F01 漏報／晚報"]').check();
await page.screenshot({ path: path.join(shotDir, "g01-over-previous-reason.png"), fullPage: true });
await page.locator("[data-over-previous-cancel]").click();
await browser.close();
console.log("OVER_PREVIOUS_REASON_BROWSER PASS");
