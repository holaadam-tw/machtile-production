// Supabase 真送出 sender：呼叫 field_report_upsert RPC（202607110001..0003 migrations）。
// 契約（README「sender 契約」＋ docs/MACHTILE_CNC_OUTBOX_REVIEW_FIX_2026-07-11.md）：
//   { ok:true, reportId }        → 新增成功（RPC 回 inserted=true）
//   { duplicate:true, reportId } → Supabase 已有此 report_uuid（重放）＝視同成功
//   { ok:false, error }                 → 暫時性失敗（斷網、5xx、429、401…）＝outbox 退避重試到成功
//   { ok:false, error, permanent:true } → 永久性失敗（伺服器明確拒絕；重送同 payload 必然再失敗）
//                                          ＝outbox 立即 dead-letter（可 requeue）
// 環境無關：注入 callRpc(name, body) -> Promise<parsed json>（HTTP/認證由呼叫端包，
// 瀏覽器端可直接餵 app.js 既有的 fetch 慣例；測試餵 mock）。

// 4xx 中「重試可能會好」的例外：401/403 token 過期可等重新登入、408/425/429 本質是重試訊號。
const RETRYABLE_4XX = new Set([401, 403, 408, 425, 429]);
const isPermanentStatus = (status) =>
  Number.isInteger(status) && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status);

export function createSupabaseFieldReportSender({ callRpc }) {
  if (typeof callRpc !== 'function') throw new Error('sender-supabase: callRpc required');
  return {
    async send(report_uuid, payload) {
      let data;
      try {
        data = await callRpc('field_report_upsert', {
          p_report_uuid: report_uuid,
          p_payload: payload,
        });
      } catch (e) {
        return {
          ok: false,
          error: (e && e.message) || String(e),
          permanent: isPermanentStatus(e && e.status),
        };
      }
      if (data && data.inserted === true) return { ok: true, reportId: data.report_id };
      if (data && data.inserted === false) return { duplicate: true, reportId: data.report_id };
      // 回應形狀違約＝接錯線/契約破壞，重送同 payload 不會變好 → 永久性，讓 dead-letter 大聲浮出。
      return { ok: false, error: 'field_report_upsert: unexpected response shape', permanent: true };
    },
  };
}

// 瀏覽器接線用的 callRpc 工廠：PostgREST /rest/v1/rpc/<fn>。
// getHeaders 每次呼叫時取（token 會換）；fetchImpl 可注入（測試用 mock）。
// HTTP 錯誤拋出的 Error 帶 .status，供 sender 分類暫時/永久。
export function createPostgrestRpcCall({ baseUrl, getHeaders, fetchImpl }) {
  if (!baseUrl) throw new Error('sender-supabase: baseUrl required');
  if (typeof getHeaders !== 'function') throw new Error('sender-supabase: getHeaders required');
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('sender-supabase: no fetch available');
  const root = String(baseUrl).replace(/\/$/, '');
  return async function callRpc(functionName, body) {
    const resp = await doFetch(`${root}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders() },
      body: JSON.stringify(body || {}),
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { message: text }; }
    if (!resp.ok) {
      const msg = (parsed && (parsed.message || parsed.hint || parsed.code)) || `HTTP ${resp.status}`;
      const err = new Error(`rpc ${functionName}: ${msg}`);
      err.status = resp.status;
      throw err;
    }
    return parsed;
  };
}
