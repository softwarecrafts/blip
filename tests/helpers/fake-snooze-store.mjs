/**
 * In-memory stand-in for lib/snoozeStore.js.
 *
 * Same five methods, no chrome.storage and no alarms — so orchestrator tests
 * can set up a snooze schedule directly and assert on what the sweep does
 * with it. `calls` records the prune arguments, which is how we check that a
 * failed adapter contributed no keep-set.
 *
 * Mirrors makeFakeAdapter: real logic stays in snooze.js (pure, tested
 * directly); this only fakes the I/O boundary.
 */
import { pruneSnoozes } from '../../extension/lib/snooze.js';

export function makeFakeSnoozeStore(initial = {}) {
  let snoozes = structuredClone(initial);
  const calls = { load: 0, save: [], prune: [] };

  return {
    calls,
    /** Test helper: read the current map without going through load(). */
    peek: () => structuredClone(snoozes),

    async load() {
      calls.load++;
      return structuredClone(snoozes);
    },
    async save(next) {
      calls.save.push(structuredClone(next));
      snoozes = structuredClone(next);
      return snoozes;
    },
    async snooze(platform, id, wake) {
      snoozes[platform] = { ...(snoozes[platform] ?? {}), [id]: wake };
      calls.save.push(structuredClone(snoozes));
      return snoozes;
    },
    async unsnooze(platform, id) {
      delete snoozes[platform]?.[id];
      calls.save.push(structuredClone(snoozes));
      return snoozes;
    },
    async prune(keepByPlatform, now) {
      calls.prune.push({ keepByPlatform, now });
      snoozes = pruneSnoozes(snoozes, keepByPlatform, now);
      return structuredClone(snoozes);
    },
  };
}
