// In-memory store adapter — 單元測試用（也可當「無持久化」降級後備）。
// 存的是 record 副本，避免外部改到內部狀態。
export function createMemoryStore(seed = []) {
  const map = new Map(seed.map((r) => [r.report_uuid, { ...r }]));
  return {
    async get(k) {
      const v = map.get(k);
      return v ? { ...v } : undefined;
    },
    async put(rec) {
      map.set(rec.report_uuid, { ...rec });
    },
    async update(k, patch) {
      const v = map.get(k);
      if (!v) return;
      map.set(k, { ...v, ...patch });
    },
    async all() {
      return [...map.values()].map((r) => ({ ...r }));
    },
    async delete(k) {
      map.delete(k);
    },
  };
}
