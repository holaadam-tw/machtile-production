(function attachMachTileAuthSessionPersistenceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MachTileAuthSessionPersistenceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMachTileAuthSessionPersistenceCore() {
  "use strict";

  const STORAGE_VERSION = 1;
  const SESSION_MODE = "session";
  const REMEMBERED_MODE = "remembered";
  const PASSWORD_AUTH_METHOD = "password";
  const OAUTH_AUTH_METHOD = "oauth";
  const REMEMBER_DEVICE_DAYS = 7;
  const REMEMBER_DEVICE_MS = REMEMBER_DEVICE_DAYS * 24 * 60 * 60 * 1000;

  function text(value) {
    return String(value ?? "").trim();
  }

  function timestamp(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function createRecord(input = {}, now = Date.now()) {
    const mode = input.mode === REMEMBERED_MODE ? REMEMBERED_MODE : SESSION_MODE;
    const createdAt = timestamp(input.createdAt, now);
    const maximumRememberUntil = createdAt + REMEMBER_DEVICE_MS;
    const requestedRememberUntil = timestamp(input.rememberUntil, maximumRememberUntil);
    const rememberUntil = mode === REMEMBERED_MODE
      ? Math.min(requestedRememberUntil, maximumRememberUntil)
      : 0;
    const authMethod = input.authMethod === OAUTH_AUTH_METHOD
      ? OAUTH_AUTH_METHOD
      : PASSWORD_AUTH_METHOD;

    return {
      version: STORAGE_VERSION,
      accessToken: text(input.accessToken),
      refreshToken: text(input.refreshToken),
      email: text(input.email),
      authMethod,
      mode,
      createdAt,
      rememberUntil,
    };
  }

  function parseRecord(rawValue, sourceMode, now = Date.now()) {
    if (!rawValue) return { record: null, reason: "empty" };

    let value;
    try {
      value = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    } catch (error) {
      return { record: null, reason: "malformed" };
    }

    if (!value || Number(value.version || STORAGE_VERSION) !== STORAGE_VERSION) {
      return { record: null, reason: "unsupported-version" };
    }

    const record = createRecord({
      ...value,
      mode: sourceMode,
    }, now);

    if (!record.accessToken) return { record: null, reason: "missing-access-token" };
    if (record.mode === REMEMBERED_MODE && !record.refreshToken) {
      return { record: null, reason: "missing-refresh-token" };
    }
    if (record.mode === REMEMBERED_MODE && record.rememberUntil <= now) {
      return { record: null, reason: "expired" };
    }

    return { record, reason: "ok" };
  }

  function selectRecord(sessionValue, rememberedValue, now = Date.now()) {
    const session = parseRecord(sessionValue, SESSION_MODE, now);
    if (session.record) {
      return {
        record: session.record,
        source: SESSION_MODE,
        removeSession: false,
        removeRemembered: Boolean(rememberedValue),
        reason: "session",
      };
    }

    const remembered = parseRecord(rememberedValue, REMEMBERED_MODE, now);
    if (remembered.record) {
      return {
        record: remembered.record,
        source: REMEMBERED_MODE,
        removeSession: Boolean(sessionValue),
        removeRemembered: false,
        reason: "remembered",
      };
    }

    return {
      record: null,
      source: "",
      removeSession: Boolean(sessionValue),
      removeRemembered: Boolean(rememberedValue),
      reason: remembered.reason !== "empty" ? remembered.reason : session.reason,
    };
  }

  return Object.freeze({
    STORAGE_VERSION,
    SESSION_MODE,
    REMEMBERED_MODE,
    PASSWORD_AUTH_METHOD,
    OAUTH_AUTH_METHOD,
    REMEMBER_DEVICE_DAYS,
    REMEMBER_DEVICE_MS,
    createRecord,
    parseRecord,
    selectRecord,
  });
});
