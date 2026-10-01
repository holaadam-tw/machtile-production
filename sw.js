// MachTile service worker — 只為了讓安卓 Chrome 可以「安裝 App」，刻意不做任何快取。
//
// 規則（2026-10-01）：
// - 不呼叫 event.respondWith()：每個請求都由瀏覽器照常直接走網路，跟沒有 SW 一模一樣，
//   所以平板永遠拿到 GitHub Pages 上的最新版，不會卡在舊檔。
// - 不開 Cache Storage；啟用時還會把同網域殘留的 cache 全部刪掉（保險）。
// - 頁面用 updateViaCache: "none" 註冊，瀏覽器檢查 sw.js 更新時不走 HTTP 快取。
//
// 退場（kill switch）：把下面 KILL_SWITCH 改成 true 後部署即可（不必 bump ?v=，瀏覽器每次
// 導覽都會繞過快取重新比對 sw.js）。已安裝的手機下次打開 App 時，新的 sw.js 會自我註銷、
// 清掉 cache，並把開著的頁面重新載入一次；之後這台裝置就完全沒有 SW。
// 另一條路：config.js 設 disableServiceWorker: true，頁面端也會主動註銷（見 pwaInstall.js）。
const KILL_SWITCH = false;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (error) {
      // 清不掉也不影響：這支 SW 從來不寫 cache。
    }
    if (KILL_SWITCH) {
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((client) => {
        try { client.navigate(client.url); } catch (error) { /* 下次開啟自然生效 */ }
      });
      return;
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", () => {
  // 刻意留白：不呼叫 respondWith → 瀏覽器自己走網路（network-only，零快取）。
});
