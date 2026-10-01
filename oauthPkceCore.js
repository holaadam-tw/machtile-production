(function attachMachTileOauthPkceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileOauthPkceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileOauthPkceCore() {
  "use strict";

  const TRANSACTION_VERSION = 1;
  const TRANSACTION_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_SCOPE = "openid email profile";

  function text(value) {
    return String(value ?? "").trim();
  }

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomValue(cryptoApi, byteLength = 32) {
    if (!cryptoApi?.getRandomValues) throw new Error("OAUTH_CRYPTO_UNAVAILABLE");
    const bytes = new Uint8Array(byteLength);
    cryptoApi.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function sha256Challenge(verifier, cryptoApi) {
    if (!cryptoApi?.subtle?.digest) throw new Error("OAUTH_CRYPTO_UNAVAILABLE");
    const encoded = new TextEncoder().encode(text(verifier));
    const digest = await cryptoApi.subtle.digest("SHA-256", encoded);
    return base64Url(new Uint8Array(digest));
  }

  function requireHttpsUrl(value, label) {
    let parsed;
    try {
      parsed = new URL(text(value));
    } catch {
      throw new Error(`${label}_INVALID`);
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error(`${label}_HTTPS_REQUIRED`);
    }
    return parsed.toString();
  }

  function configured(config = {}) {
    return Boolean(
      config.oauthEnabled &&
      text(config.oauthClientId) &&
      text(config.oauthAuthorizationEndpoint) &&
      text(config.oauthTokenEndpoint) &&
      text(config.oauthRedirectUri)
    );
  }

  async function createAuthorization(config = {}, cryptoApi = globalThis.crypto, now = Date.now()) {
    if (!configured(config)) throw new Error("OAUTH_NOT_CONFIGURED");

    const authorizationEndpoint = requireHttpsUrl(
      config.oauthAuthorizationEndpoint,
      "OAUTH_AUTHORIZATION_ENDPOINT"
    );
    const redirectUri = requireHttpsUrl(config.oauthRedirectUri, "OAUTH_REDIRECT_URI");
    requireHttpsUrl(config.oauthTokenEndpoint, "OAUTH_TOKEN_ENDPOINT");

    const verifier = randomValue(cryptoApi, 48);
    const state = randomValue(cryptoApi, 32);
    const challenge = await sha256Challenge(verifier, cryptoApi);
    const scope = text(config.oauthScope) || DEFAULT_SCOPE;
    const url = new URL(authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", text(config.oauthClientId));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scope);

    return {
      url: url.toString(),
      transaction: {
        version: TRANSACTION_VERSION,
        state,
        verifier,
        redirectUri,
        createdAt: now
      }
    };
  }

  function parseTransaction(rawValue, now = Date.now()) {
    if (!rawValue) return { transaction: null, reason: "missing" };
    let value;
    try {
      value = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    } catch {
      return { transaction: null, reason: "malformed" };
    }
    if (!value || Number(value.version) !== TRANSACTION_VERSION) {
      return { transaction: null, reason: "unsupported-version" };
    }
    const createdAt = Number(value.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > TRANSACTION_TTL_MS || createdAt > now + 60_000) {
      return { transaction: null, reason: "expired" };
    }
    const state = text(value.state);
    const verifier = text(value.verifier);
    let redirectUri = "";
    try {
      redirectUri = requireHttpsUrl(value.redirectUri, "OAUTH_REDIRECT_URI");
    } catch {
      return { transaction: null, reason: "invalid-redirect" };
    }
    if (state.length < 32 || verifier.length < 43) {
      return { transaction: null, reason: "invalid" };
    }
    return {
      transaction: {
        version: TRANSACTION_VERSION,
        state,
        verifier,
        redirectUri,
        createdAt
      },
      reason: "ok"
    };
  }

  function parseCallback(urlValue) {
    let url;
    try {
      url = new URL(String(urlValue));
    } catch {
      return { kind: "none" };
    }
    const code = text(url.searchParams.get("code"));
    const state = text(url.searchParams.get("state"));
    const error = text(url.searchParams.get("error"));
    const errorDescription = text(url.searchParams.get("error_description"));
    if (error) return { kind: "error", error, errorDescription, state };
    if (code || state) return { kind: "code", code, state };
    return { kind: "none" };
  }

  function validateCallback(callback, transaction) {
    if (!callback || callback.kind !== "code") return { ok: false, reason: "not-code" };
    if (!callback.code) return { ok: false, reason: "missing-code" };
    if (!callback.state || callback.state !== transaction?.state) {
      return { ok: false, reason: "state-mismatch" };
    }
    return { ok: true, reason: "ok" };
  }

  function tokenRequestBody(config, code, transaction) {
    if (!configured(config)) throw new Error("OAUTH_NOT_CONFIGURED");
    const validation = validateCallback({ kind: "code", code, state: transaction?.state }, transaction);
    if (!validation.ok) throw new Error(`OAUTH_${validation.reason.toUpperCase().replace(/-/g, "_")}`);
    return new URLSearchParams({
      grant_type: "authorization_code",
      code: text(code),
      client_id: text(config.oauthClientId),
      redirect_uri: transaction.redirectUri,
      code_verifier: transaction.verifier
    });
  }

  function refreshRequestBody(config, refreshToken) {
    if (!configured(config)) throw new Error("OAUTH_NOT_CONFIGURED");
    const token = text(refreshToken);
    if (!token) throw new Error("OAUTH_REFRESH_TOKEN_REQUIRED");
    return new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
      client_id: text(config.oauthClientId)
    });
  }

  // ---- Cross-tab handoff (Android installed App / PWA, 2026-10-01) ----
  // In a standalone PWA the login center opens in a Chrome Custom Tab, and the
  // OAuth redirect back to the App lands in that Custom Tab, not in the App
  // window. sessionStorage is per tab, so the Custom Tab cannot see the PKCE
  // verifier the App window stored. The verifier therefore also goes to
  // localStorage (keyed by state, 10-minute TTL, deleted on first read), and
  // the Custom Tab hands the exchanged tokens back through a one-time,
  // 2-minute localStorage entry encrypted with a key derived from the
  // verifier. Once the Custom Tab has consumed the shared copy, only the
  // initiating window (sessionStorage) still holds the verifier, so a
  // leftover handoff entry is unreadable by anyone else.
  const HANDOFF_VERSION = 1;
  const HANDOFF_TTL_MS = 2 * 60 * 1000;
  const PENDING_MAX = 3;
  const SHARED_TRANSACTION_PREFIX = "machtileOauthPkceTx:";
  const HANDOFF_PREFIX = "machtileOauthHandoff:";
  const HANDOFF_KEY_LABEL = "machtile-oauth-handoff-v1:";

  function sharedTransactionKey(state) {
    return `${SHARED_TRANSACTION_PREFIX}${text(state)}`;
  }

  function handoffKey(state) {
    return `${HANDOFF_PREFIX}${text(state)}`;
  }

  function freshTimestamp(createdAt, ttlMs, now) {
    const value = Number(createdAt);
    return Number.isFinite(value) && value > 0 && now - value <= ttlMs && value <= now + 60_000;
  }

  // Per-tab list of logins this window started (newest last). A retry adds a
  // new entry instead of replacing the old one, so a Custom Tab that finishes
  // an earlier attempt can still hand its result back.
  function parsePendingTransactions(rawValue, now = Date.now()) {
    let list;
    try {
      list = typeof rawValue === "string" ? JSON.parse(rawValue || "[]") : rawValue;
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => parseTransaction(item, now).transaction)
      .filter(Boolean)
      .slice(-PENDING_MAX);
  }

  function addPendingTransaction(rawValue, transaction, now = Date.now()) {
    const list = parsePendingTransactions(rawValue, now)
      .filter((item) => item.state !== transaction?.state);
    const parsed = parseTransaction(transaction, now).transaction;
    if (parsed) list.push(parsed);
    return list.slice(-PENDING_MAX);
  }

  function findPendingTransaction(rawValue, state, now = Date.now()) {
    const wanted = text(state);
    if (!wanted) return null;
    return parsePendingTransactions(rawValue, now).find((item) => item.state === wanted) || null;
  }

  // Only the fields the App already keeps from a token response.
  function minimalTokenPayload(payload = {}) {
    const result = {
      access_token: text(payload?.access_token),
      refresh_token: text(payload?.refresh_token),
      expires_in: Number(payload?.expires_in) || 0
    };
    const userId = text(payload?.user?.id);
    const userEmail = text(payload?.user?.email);
    if (userId || userEmail) result.user = { id: userId, email: userEmail };
    return result;
  }

  function bytesFromBase64Url(value) {
    const normalized = text(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "===".slice((normalized.length + 3) % 4);
    const binary = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function handoffCryptoKey(verifier, cryptoApi) {
    if (!cryptoApi?.subtle?.digest || !cryptoApi?.subtle?.importKey) {
      throw new Error("OAUTH_CRYPTO_UNAVAILABLE");
    }
    const material = await cryptoApi.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${HANDOFF_KEY_LABEL}${text(verifier)}`)
    );
    return cryptoApi.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  function handoffAad(state, createdAt) {
    return new TextEncoder().encode(`${text(state)}|${Number(createdAt)}`);
  }

  async function sealHandoff(tokenPayload, transaction, cryptoApi = globalThis.crypto, now = Date.now()) {
    const minimal = minimalTokenPayload(tokenPayload);
    if (!minimal.access_token) throw new Error("OAUTH_HANDOFF_EMPTY");
    if (!transaction?.state || !transaction?.verifier) throw new Error("OAUTH_HANDOFF_NO_TRANSACTION");
    const key = await handoffCryptoKey(transaction.verifier, cryptoApi);
    const iv = new Uint8Array(12);
    cryptoApi.getRandomValues(iv);
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: handoffAad(transaction.state, now) },
      key,
      new TextEncoder().encode(JSON.stringify(minimal))
    );
    return {
      key: handoffKey(transaction.state),
      value: JSON.stringify({
        version: HANDOFF_VERSION,
        state: transaction.state,
        createdAt: now,
        iv: base64Url(iv),
        data: base64Url(new Uint8Array(ciphertext))
      })
    };
  }

  // Returns { payload, reason }. reason: ok | missing | malformed |
  // unsupported-version | state-mismatch | expired | undecryptable | invalid.
  async function openHandoff(rawValue, transaction, cryptoApi = globalThis.crypto, now = Date.now()) {
    if (!rawValue) return { payload: null, reason: "missing" };
    let value;
    try {
      value = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    } catch {
      return { payload: null, reason: "malformed" };
    }
    if (!value || typeof value !== "object") return { payload: null, reason: "malformed" };
    if (Number(value.version) !== HANDOFF_VERSION) return { payload: null, reason: "unsupported-version" };
    if (!transaction?.state || text(value.state) !== transaction.state) {
      return { payload: null, reason: "state-mismatch" };
    }
    if (!freshTimestamp(value.createdAt, HANDOFF_TTL_MS, now)) return { payload: null, reason: "expired" };
    let plain;
    try {
      const key = await handoffCryptoKey(transaction.verifier, cryptoApi);
      const decrypted = await cryptoApi.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytesFromBase64Url(value.iv),
          additionalData: handoffAad(value.state, value.createdAt)
        },
        key,
        bytesFromBase64Url(value.data)
      );
      plain = JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      return { payload: null, reason: "undecryptable" };
    }
    const payload = minimalTokenPayload(plain);
    if (!payload.access_token) return { payload: null, reason: "invalid" };
    return { payload, reason: "ok" };
  }

  // Shared localStorage entries (verifier copies and handoffs) that are past
  // their TTL or unreadable; callers delete these on every App start.
  function staleSharedEntry(key, rawValue, now = Date.now()) {
    const name = text(key);
    if (name.startsWith(SHARED_TRANSACTION_PREFIX)) {
      return !parseTransaction(rawValue, now).transaction;
    }
    if (name.startsWith(HANDOFF_PREFIX)) {
      try {
        const value = JSON.parse(rawValue);
        return !freshTimestamp(value?.createdAt, HANDOFF_TTL_MS, now);
      } catch {
        return true;
      }
    }
    return false;
  }

  function scrubCallbackUrl(urlValue) {
    const url = new URL(String(urlValue));
    ["code", "state", "error", "error_description"].forEach((name) => url.searchParams.delete(name));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  return Object.freeze({
    TRANSACTION_VERSION,
    TRANSACTION_TTL_MS,
    DEFAULT_SCOPE,
    configured,
    createAuthorization,
    parseTransaction,
    parseCallback,
    validateCallback,
    tokenRequestBody,
    refreshRequestBody,
    scrubCallbackUrl,
    HANDOFF_VERSION,
    HANDOFF_TTL_MS,
    PENDING_MAX,
    SHARED_TRANSACTION_PREFIX,
    HANDOFF_PREFIX,
    sharedTransactionKey,
    handoffKey,
    parsePendingTransactions,
    addPendingTransaction,
    findPendingTransaction,
    minimalTokenPayload,
    sealHandoff,
    openHandoff,
    staleSharedEntry
  });
});
