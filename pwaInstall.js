// MachTile「安裝 App」(PWA) — 2026-10-01
// 1) 註冊 sw.js（network-only、零快取；updateViaCache: "none" 讓 sw.js 本身不被快取）。
// 2) 接住 beforeinstallprompt，讓頁面上的「安裝 App」按鈕可以叫出安裝視窗。
//    已安裝（standalone 開啟）或瀏覽器不支援（iOS Safari、桌機 Firefox…）時按鈕一律不出現。
// 退場：config.js 設 disableServiceWorker: true → 不註冊、並註銷已存在的 SW。
(function attachMachTilePwaInstall(root) {
  "use strict";

  const buttons = new Set();
  let deferredPrompt = null;

  function isStandalone() {
    try {
      if (root.matchMedia && root.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (error) { /* ignore */ }
    return root.navigator?.standalone === true;
  }

  function refresh() {
    const show = Boolean(deferredPrompt) && !isStandalone();
    buttons.forEach((button) => {
      if (!button.isConnected) { buttons.delete(button); return; }
      button.hidden = !show;
    });
  }

  function bindButton(button) {
    if (!button || buttons.has(button)) return;
    buttons.add(button);
    button.addEventListener("click", async () => {
      const promptEvent = deferredPrompt;
      if (!promptEvent) { refresh(); return; }
      deferredPrompt = null; // prompt() 每個事件只能用一次
      refresh();
      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
      } catch (error) {
        console.warn("PWA install prompt failed", error);
      }
    });
    refresh();
  }

  root.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // 改由我們的按鈕觸發（Chrome 選單裡的「安裝應用程式」仍然可用）
    deferredPrompt = event;
    refresh();
  });

  root.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    refresh();
  });

  function swDisabled() {
    return Boolean(root.MACHTILE_CONFIG && root.MACHTILE_CONFIG.disableServiceWorker);
  }

  async function registerServiceWorker() {
    const sw = root.navigator?.serviceWorker;
    if (!sw || !root.isSecureContext) return;
    try {
      if (swDisabled()) {
        const registrations = await sw.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        return;
      }
      const registration = await sw.register(new URL("sw.js", document.baseURI).href, {
        updateViaCache: "none",
      });
      // 長時間開著的平板也定期檢查一次 sw.js（只比對 sw.js，本身不快取任何東西）。
      root.setInterval(() => { registration.update().catch(() => {}); }, 60 * 60 * 1000);
    } catch (error) {
      console.warn("service worker registration failed", error);
    }
  }

  if (document.readyState === "complete") registerServiceWorker();
  else root.addEventListener("load", registerServiceWorker, { once: true });

  root.MachTilePwaInstall = Object.freeze({ bindButton, isStandalone, registerServiceWorker });
})(window);
