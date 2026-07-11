// IndexedDB store adapter — 瀏覽器正式用（persist 過關機/重開）。
// keyPath = report_uuid（冪等鍵即主鍵，天生防重複列）。
// 介面與 outbox-store-memory 相同，可與 createOutbox 直接組。
// 連線快取單一份（每操作開新連線會洩漏、且卡住日後 version upgrade）；
// versionchange/close 時關閉並重置，下次操作自動重開。
export function createIdbStore({ dbName = 'machtile-outbox', storeName = 'outbox', version = 1 } = {}) {
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
        db.onversionchange = () => { db.close(); dbPromise = null; }; // 讓別的分頁升級
        db.onclose = () => { dbPromise = null; };                     // 意外關閉 → 下次重開
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { /* 等其它分頁釋放；open 會在解除後續走 onsuccess */ };
    });
    return dbPromise;
  }

  const reqP = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  // 在同一交易內跑 fn（fn 可 async，但只能鏈 IndexedDB 請求，勿夾非 IDB 的 await＝會自動 commit）。
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
    update: (k, patch) =>
      tx('readwrite', async (os) => {
        const cur = await reqP(os.get(k));
        if (cur) await reqP(os.put({ ...cur, ...patch }));
      }),
    all: () => tx('readonly', (os) => reqP(os.getAll())),
    delete: (k) => tx('readwrite', (os) => reqP(os.delete(k))),
  };
}
