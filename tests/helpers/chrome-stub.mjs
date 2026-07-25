/**
 * Minimal fake of the chrome APIs the orchestrator touches.
 *
 * The orchestrator reads chrome.storage.local (settings + seen cache) and
 * writes chrome.action (badge). Everything else exists only so that importing
 * a module which registers listeners doesn't throw.
 *
 * Usage: globalThis.chrome = makeChromeStub({ settings: {...} }) BEFORE the
 * module under test is invoked.
 */
export function makeChromeStub({ settings, seen } = {}) {
  const store = {};
  if (settings !== undefined) store.settings = settings;
  if (seen !== undefined) store.seen = seen;

  const badge = { text: null, color: null };
  const noop = { addListener() {} };

  return {
    store,
    badge,
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
          return { ...store };
        },
        async set(obj) {
          Object.assign(store, structuredClone(obj));
        },
      },
      onChanged: noop,
    },
    action: {
      setBadgeText({ text }) {
        badge.text = text;
      },
      setBadgeBackgroundColor({ color }) {
        badge.color = color;
      },
    },
    alarms: { create() {}, onAlarm: noop },
    runtime: {
      onInstalled: noop,
      onStartup: noop,
      onMessage: noop,
      getURL: (p) => p,
    },
    tabs: { create() {} },
  };
}
