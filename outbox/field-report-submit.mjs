// Field-report submit seam: composes outbox (offline-first, idempotent) + Supabase RPC sender
// + operators attribution. This is the single entry the CNC 現場報工 UI (app.js) should call
// when real submit is enabled — it replaces the direct `production_reports` POST.
//
// Why a seam: app.js currently POSTs the table directly (no report_uuid, no idempotency, no
// operators). Routing through here gives: offline queue + replay-safe report_uuid + operators
// for SoftNet 每人產值 — without the caller knowing outbox/RPC internals.
//
// Usage (app.js, when config enables real submit):
//   import { createOutbox } from './outbox/outbox.mjs';
//   import { createIdbStore } from './outbox/outbox-store-idb.mjs';
//   import { createSupabaseFieldReportSender, createPostgrestRpcCall } from './outbox/sender-supabase.mjs';
//   import { createFieldReportSubmitter } from './outbox/field-report-submit.mjs';
//   const outbox = createOutbox({ store: createIdbStore(),
//     sender: createSupabaseFieldReportSender({ callRpc: createPostgrestRpcCall({ baseUrl: config.supabaseUrl, getHeaders: supabaseHeaders }) }) });
//   const submitter = createFieldReportSubmitter({ outbox });
//   const { report_uuid } = await submitter.submit(basePayload, { operators: [currentAppUserId] });

export function createFieldReportSubmitter({ outbox }) {
  if (!outbox || typeof outbox.enqueue !== 'function' || typeof outbox.flush !== 'function') {
    throw new Error('field-report-submit: outbox with enqueue()/flush() required');
  }
  return {
    // payload: { work_order_id, process_id, completed_qty, defect_qty, started_at, ended_at, ... }
    // opts.operators: array of app_user uuids credited on this report (0..N). Empty is allowed.
    // Returns { report_uuid, queued:true }. Never throws for offline — the row is durably queued
    // and flush() best-efforts the send (online driver / heartbeat retries the rest).
    async submit(payload, opts = {}) {
      const operators = Array.isArray(opts.operators)
        ? opts.operators.filter((x) => typeof x === 'string' && x.trim() !== '')
        : [];
      const full = { ...payload };
      if (operators.length > 0) full.operators = operators;
      const report_uuid = await outbox.enqueue(full);   // report_uuid fixed at enqueue time
      // fire-and-forget: online → sent now; offline → stays queued, no throw
      Promise.resolve(outbox.flush()).catch(() => {});
      return { report_uuid, queued: true };
    },
  };
}
