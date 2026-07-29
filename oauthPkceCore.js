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
    scrubCallbackUrl
  });
});
