(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileReportTotalRefreshCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function adoptFreshProgress(order, progress) {
    if (!order || !progress || !Number.isFinite(Number(progress.done))) return { adopted: false, sourceChanged: false };
    const sourceChanged = Boolean(order.progressSource?.source && order.progressSource.source !== progress.source);
    order.done = Math.max(0, Number(progress.done));
    order.progressSource = progress;
    return { adopted: true, sourceChanged };
  }

  async function retryRefresh(operation, reload, options = {}) {
    const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : 2;
    const delayMs = Number.isFinite(Number(options.delayMs)) ? Math.max(0, Number(options.delayMs)) : 1000;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try { return await operation(attempt); }
      catch (error) {
        lastError = error;
        if (attempt >= retries) break;
        await reload(attempt + 1, error);
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  return { adoptFreshProgress, retryRefresh };
});
