// IndexedDB attachment store — 附件離線佇列（2026-07-11 backlog A）。
// 獨立 DB（與 outbox 本體分開）：value = { report_uuid, entries: [{file, kind, label}] }
// File 即 Blob，IDB 原生可存 → 附件跟報工一樣過關機/重開。
// 生命週期：seam 於 enqueue 後、flush 前寫入；app 端 onSent 讀出上傳，
// 成敗皆刪（T3=盡力一次後刪：報工本體永不丟，附件 best-effort，儲存不洩漏）。
// 連線快取與 versionchange 處理同 outbox-store-idb。
export function createIdbFileStore({ dbName = 'machtile-outbox-files', storeName = 'files', version = 1 } = {}) {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'report_uuid' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { /* 等其它分頁釋放 */ };
    });
    return dbPromise;
  }

  const reqP = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  function tx(mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(storeName, mode);
          const os = t.objectStore(storeName);
          let out;
          Promise.resolve(fn(os)).then(
            (v) => { out = v; },
            (e) => { try { t.abort(); } catch { /* noop */ } reject(e); }
          );
          t.oncomplete = () => resolve(out);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error('idb tx aborted'));
        })
    );
  }

  return {
    get: (k) => tx('readonly', (os) => reqP(os.get(k))),
    put: (rec) => tx('readwrite', (os) => reqP(os.put(rec))),
    delete: (k) => tx('readwrite', (os) => reqP(os.delete(k))),
  };
}
