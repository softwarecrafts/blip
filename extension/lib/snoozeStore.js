/**
 * snoozeStore — the stateful half of snooze: chrome.storage.local plus the
 * 'snooze-wake' alarm. All the decision logic is pure and lives in snooze.js;
 * this module only persists the map and keeps the alarm in step with it.
 *
 * Invariant: every write goes through save(), and save() always re-arms the
 * alarm from the map it just wrote. There is exactly one 'snooze-wake' alarm
 * at any time, set to the earliest unexpired wake across all platforms; the
 * sweep it fires re-arms the next one (a chained one-shot rather than a poll,
 * so a snooze a week out costs nothing until it's due).
 *
 * Injected into createOrchestrator so tests can swap in a plain object with
 * the same five methods — see tests/helpers/fake-snooze-store.mjs.
 */
import { earliestWake, pruneSnoozes, withSnooze, withoutSnooze } from './snooze.js';

export const WAKE_ALARM = 'snooze-wake';

export function createSnoozeStore({ storage = chrome.storage.local, alarms = chrome.alarms } = {}) {
  /** The whole map: { [platform]: { [id]: wakeEpochMs } }. */
  async function load() {
    const { snoozes } = await storage.get('snoozes');
    return snoozes ?? {};
  }

  /** Persist the map and re-arm the one-shot wake alarm to match it. */
  async function save(snoozes) {
    await storage.set({ snoozes });
    const next = earliestWake(snoozes, Date.now());
    if (next === null) await alarms.clear(WAKE_ALARM);
    else alarms.create(WAKE_ALARM, { when: next });
    return snoozes;
  }

  /** Mute one conversation until `wake` (epoch ms, must be in the future). */
  async function snooze(platform, id, wake) {
    if (!Number.isFinite(wake) || wake <= Date.now()) {
      throw new Error('snooze wake time must be in the future');
    }
    return save(withSnooze(await load(), platform, id, wake));
  }

  /** Wake one conversation now. */
  async function unsnooze(platform, id) {
    return save(withoutSnooze(await load(), platform, id));
  }

  /**
   * Drop expired/irrelevant entries. Writes only when something actually
   * changed, so a quiet sweep doesn't churn storage or reset the alarm.
   */
  async function prune(keepByPlatform, now = Date.now()) {
    const snoozes = await load();
    const pruned = pruneSnoozes(snoozes, keepByPlatform, now);
    if (JSON.stringify(pruned) === JSON.stringify(snoozes)) return snoozes;
    return save(pruned);
  }

  return { load, save, snooze, unsnooze, prune };
}
