// CNC 現場報工 offline outbox — 環境無關核心。
// 設計 + 冪等合約：SoftNet repo docs/CNC_OFFLINE_QUEUE_DESIGN_v0.md
// 錯誤語意（暫時/永久）與修復決策：docs/MACHTILE_CNC_OUTBOX_REVIEW_FIX_2026-07-11.md
//
// 冪等鍵 report_uuid 於「擷取當下」生成、進 outbox 即固定（重試沿用不重生），
// 一路帶到 Supabase(upsert unique)→回寫橋→MES(dedup)，任一層看到同鍵皆 no-op＝重放安全。
//
// 錯誤語意：
//   - 暫時性（網路層拋錯、5xx、429、401…）→ 指數退避重試到成功為止，**永不 dead-letter**
//     （現場數據以耐久為先；離線半天不會弄丟報工）。
//   - 永久性（sender 標 permanent:true＝伺服器明確拒絕，重送同 payload 必然再失敗）
//     → 立即 FAILED dead-letter，UI 紅字提示，可 requeue() 重排。
//   - online() 注入（瀏覽器接 () => navigator.onLine）：離線時 flush 直接跳過，不燒退避。
//
// 注入 store（async CRUD）與 sender（async send），故：
//   - 單元測：in-memory store + mock sender，純 Node 無依賴。
//   - 正式：IndexedDB store adapter + Supabase field-report RPC sender（接真送出時只換 sender）。

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',   // 待送（含 backoff 中）
  SENDING: 'sending',   // 送出中（App 若在此時被關→下次 reclaimStale 打回 PENDING）
  SENT: 'sent',         // 已送達（含 Supabase 認得重放的 duplicate）；record.report_id = 伺服器 id
  FAILED: 'failed',     // 伺服器永久拒絕＝dead-letter，UI 要紅字提示、不靜默吞；requeue() 可重排
});

const defaultUuid = () =>
  (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * @param {object} o
 * @param {object} o.store   store adapter：get(k)/put(rec)/update(k,patch)/all()（皆 async）
 * @param {object} o.sender  { send(report_uuid, payload) -> {ok,reportId?}|{duplicate,reportId?}|{ok:false,error,permanent?} }
 * @param {function} [o.now] 回傳毫秒時間（可注入時鐘，測試用）
 * @param {function} [o.uuid] 回傳字串鍵（可注入決定性 uuid）
 * @param {function} [o.online] 回 false 時 flush 直接跳過（瀏覽器接 () => navigator.onLine）
 * @param {function} [o.onSent] 送達後回呼 ({report_uuid, payload, report_id, duplicate})；拋錯不影響 outbox
 * @param {number} [o.baseBackoffMs] 指數退避基數
 * @param {number} [o.maxBackoffMs] 退避上限
 * @param {number} [o.sendingTimeoutMs] SENDING 逾此視為卡死→reclaim
 */
export function createOutbox({
  store,
  sender,
  now = () => Date.now(),
  uuid = defaultUuid,
  online = () => true,
  onSent = null,
  baseBackoffMs = 1000,
  maxBackoffMs = 60000,
  sendingTimeoutMs = 30000,
} = {}) {
  if (!store) throw new Error('outbox: store adapter required');
  if (!sender || typeof sender.send !== 'function') throw new Error('outbox: sender.send required');
  const { PENDING, SENDING, SENT, FAILED } = OUTBOX_STATUS;

  const backoff = (attempts) => Math.min(baseBackoffMs * 2 ** (attempts - 1), maxBackoffMs);

  // 入列一筆報工。payload 可自帶 report_uuid（重放/測試）；同鍵已在 outbox → 不重複入列（enqueue 冪等）。
  async function enqueue(payload = {}) {
    const report_uuid = payload.report_uuid || uuid();
    const existing = await store.get(report_uuid);
    if (existing) return report_uuid;
    const t = now();
    await store.put({
      report_uuid,
      payload: { ...payload, report_uuid },
      status: PENDING,
      attempts: 0,
      created_at: t,
      updated_at: t,
      next_attempt_at: t,   // 立即可送
      last_error: null,
      report_id: null,      // 送達後回填伺服器 id（附件上傳等後續動作用）
    });
    return report_uuid;
  }

  // 逾時的 SENDING（上次 flush 送出中 App 被關）打回 PENDING；因冪等，重送安全。
  async function reclaimStale() {
    const t = now();
    for (const it of await store.all()) {
      if (it.status === SENDING && t - it.updated_at > sendingTimeoutMs) {
        await store.update(it.report_uuid, { status: PENDING, updated_at: t });
      }
    }
  }

  async function markSent(item, res, result) {
    const report_id = (res && res.reportId != null) ? res.reportId : null;
    await store.update(item.report_uuid, { status: SENT, updated_at: now(), report_id });
    if (typeof onSent === 'function') {
      try {
        await onSent({
          report_uuid: item.report_uuid,
          payload: item.payload,
          report_id,
          duplicate: !!(res && res.duplicate),
        });
      } catch { /* onSent 是外掛後續動作，失敗不得影響 outbox 本體 */ }
    }
    if (res && res.duplicate) result.duplicate++;
    else result.sent++;
  }

  async function doFlush() {
    await reclaimStale();
    const t0 = now();
    const queue = (await store.all())
      .filter((x) => x.status === PENDING && (x.next_attempt_at == null || x.next_attempt_at <= t0))
      .sort((a, b) => a.created_at - b.created_at || String(a.report_uuid).localeCompare(String(b.report_uuid)));

    const result = { sent: 0, duplicate: 0, retried: 0, deadLettered: 0, offline: false };
    for (const item of queue) {
      await store.update(item.report_uuid, { status: SENDING, updated_at: now() });
      try {
        const res = await sender.send(item.report_uuid, item.payload);
        if (res && (res.ok || res.duplicate)) {
          await markSent(item, res, result);
        } else {
          const err = new Error((res && res.error) || 'sender returned not-ok');
          err.permanent = !!(res && res.permanent);
          throw err;
        }
      } catch (e) {
        const attempts = item.attempts + 1;
        const permanent = !!(e && e.permanent);   // 只有伺服器明確拒絕才 dead-letter；暫時性錯誤重試到成功
        if (permanent) result.deadLettered++;
        else result.retried++;
        await store.update(item.report_uuid, {
          status: permanent ? FAILED : PENDING,
          attempts,
          updated_at: now(),
          next_attempt_at: permanent ? null : now() + backoff(attempts),
          last_error: String((e && e.message) || e),
        });
      }
    }
    return result;
  }

  // 併發 flush 互斥：submit/online event/heartbeat 三個觸發源共用同一次進行中的掃描。
  let inFlight = null;
  function flush() {
    if (!online()) {
      return Promise.resolve({ sent: 0, duplicate: 0, retried: 0, deadLettered: 0, offline: true });
    }
    if (inFlight) return inFlight;
    inFlight = doFlush().finally(() => { inFlight = null; });
    return inFlight;
  }

  // dead-letter 出路：FAILED → PENDING（attempts 歸零、立即可送）。回 true=有重排。
  async function requeue(report_uuid) {
    const it = await store.get(report_uuid);
    if (!it || it.status !== FAILED) return false;
    await store.update(report_uuid, {
      status: PENDING, attempts: 0, next_attempt_at: now(), updated_at: now(),
    });
    return true;
  }

  const list = () => store.all();
  const get = (report_uuid) => store.get(report_uuid);
  const pending = async () => (await store.all()).filter((x) => x.status === PENDING);
  const deadLetters = async () => (await store.all()).filter((x) => x.status === FAILED);

  return { enqueue, flush, reclaimStale, requeue, list, get, pending, deadLetters, OUTBOX_STATUS };
}
