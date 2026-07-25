/**
 * Minimal fake of the chrome APIs the orchestrator touches.
 *
 * The orchestrator reads chrome.storage.local (settings, seen cache, snooze
 * schedule), writes chrome.action (badge), and — via snoozeStore — creates and
 * clears the one-shot wake alarm. Everything else exists only so that
 * importing a module which registers listeners doesn't throw.
 *
 * Usage: globalThis.chrome = makeChromeStub({ settings: {...} }) BEFORE the
 * module under test is invoked.
 */
export function makeChromeStub({ settings, seen, snoozes } = {}) {
  const store = {};
  if (settings !== undefined) store.settings = settings;
  if (seen !== undefined) store.seen = seen;
  if (snoozes !== undefined) store.snoozes = snoozes;

  const badge = { text: null, color: null };
  const noop = { addListener() {} };
  // Records what the snooze store did to the one-shot wake alarm.
  const alarmLog = { created: [], cleared: [] };

  return {
    store,
    badge,
    alarmLog,
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
    alarms: {
      create(name, info) {
        alarmLog.created.push({ name, info });
      },
      async clear(name) {
        alarmLog.cleared.push(name);
      },
      onAlarm: noop,
    },
    runtime: {
      onInstalled: noop,
      onStartup: noop,
      onMessage: noop,
      getURL: (p) => p,
    },
    tabs: { create() {} },
  };
}
