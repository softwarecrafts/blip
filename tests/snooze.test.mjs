import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOOZE_PRESETS,
  presetWakeTime,
  wakeAt,
  isSnoozed,
  withSnooze,
  withoutSnooze,
  earliestWake,
  partitionBySnooze,
  pruneSnoozes,
  formatWake,
} from '../extension/lib/snooze.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// A fixed local-time anchor keeps the calendar math deterministic.
const at = (h, m = 0) => new Date(2026, 6, 14, h, m).getTime(); // Tue 14 Jul 2026 local

/* --- presets --- */

test('every preset id resolves to a future wake time', () => {
  const now = at(10);
  for (const { id } of SNOOZE_PRESETS) {
    assert.ok(presetWakeTime(id, now) > now, id);
  }
});

test('fixed-duration presets', () => {
  const now = at(10);
  assert.equal(presetWakeTime('1h', now), now + HOUR);
  assert.equal(presetWakeTime('3d', now), now + 3 * DAY);
  assert.equal(presetWakeTime('1w', now), now + 7 * DAY);
});

test("'tomorrow' is next calendar day 09:00 local, morning or night", () => {
  const tomorrow9 = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
  assert.equal(presetWakeTime('tomorrow', at(8)), tomorrow9); // before 9am still skips a day
  assert.equal(presetWakeTime('tomorrow', at(23)), tomorrow9);
});

test('unknown preset throws', () => {
  assert.throws(() => presetWakeTime('nope', at(10)));
});

/* --- platform-scoped map access --- */

test('isSnoozed: future yes, expired/absent/exact-now no', () => {
  const now = at(10);
  assert.equal(isSnoozed({ claude: { a: now + 1 } }, 'claude', 'a', now), true);
  assert.equal(isSnoozed({ claude: { a: now - 1 } }, 'claude', 'a', now), false);
  assert.equal(isSnoozed({ claude: { a: now } }, 'claude', 'a', now), false);
  assert.equal(isSnoozed({ claude: {} }, 'claude', 'a', now), false);
  assert.equal(isSnoozed({}, 'claude', 'a', now), false);
  assert.equal(isSnoozed(undefined, 'claude', 'a', now), false);
});

test('the same id on two platforms does not collide', () => {
  const now = at(10);
  const snoozes = withSnooze({}, 'claude', 'dup', now + HOUR);
  assert.equal(isSnoozed(snoozes, 'claude', 'dup', now), true);
  assert.equal(isSnoozed(snoozes, 'chatgpt', 'dup', now), false);
});

test('withSnooze/withoutSnooze do not mutate the input', () => {
  const now = at(10);
  const before = { claude: { a: now + HOUR } };
  const added = withSnooze(before, 'claude', 'b', now + DAY);
  assert.deepEqual(before, { claude: { a: now + HOUR } });
  assert.equal(wakeAt(added, 'claude', 'b'), now + DAY);

  const removed = withoutSnooze(added, 'claude', 'b');
  assert.equal(wakeAt(removed, 'claude', 'b'), 0);
  assert.equal(wakeAt(removed, 'claude', 'a'), now + HOUR);
});

test('withoutSnooze drops the platform key once it empties', () => {
  const now = at(10);
  const one = withSnooze({}, 'claude', 'a', now + HOUR);
  assert.deepEqual(withoutSnooze(one, 'claude', 'a'), {});
});

/* --- alarm scheduling --- */

test('earliestWake finds the soonest unexpired wake across platforms', () => {
  const now = at(10);
  const snoozes = {
    claude: { a: now + 2 * DAY, expired: now - DAY },
    chatgpt: { b: now + HOUR },
  };
  assert.equal(earliestWake(snoozes, now), now + HOUR);
});

test('earliestWake is null when nothing is live (so the alarm is cleared)', () => {
  const now = at(10);
  assert.equal(earliestWake({}, now), null);
  assert.equal(earliestWake({ claude: { a: now - 1 } }, now), null);
  assert.equal(earliestWake(undefined, now), null);
});

/* --- popup partitioning --- */

test('partitionBySnooze splits, annotates wakeAt, sorts soonest-first', () => {
  const now = at(10);
  const items = [
    { platform: 'claude', id: 'late', name: 'late' },
    { platform: 'claude', id: 'awake', name: 'awake' },
    { platform: 'claude', id: 'soon', name: 'soon' },
    { platform: 'claude', id: 'expired', name: 'expired' },
  ];
  const snoozes = { claude: { late: now + 2 * DAY, soon: now + HOUR, expired: now - MIN } };
  const { waiting, snoozed } = partitionBySnooze(items, snoozes, now);
  assert.deepEqual(waiting.map((i) => i.id), ['awake', 'expired']);
  assert.deepEqual(snoozed.map((i) => i.id), ['soon', 'late']);
  assert.equal(snoozed[0].wakeAt, now + HOUR);
});

test('partitionBySnooze sorts across platforms, not within them', () => {
  const now = at(10);
  const items = [
    { platform: 'claude', id: 'a', name: 'a' },
    { platform: 'chatgpt', id: 'b', name: 'b' },
  ];
  const snoozes = { claude: { a: now + DAY }, chatgpt: { b: now + HOUR } };
  const { snoozed } = partitionBySnooze(items, snoozes, now);
  assert.deepEqual(snoozed.map((i) => i.platform), ['chatgpt', 'claude']);
});

/* --- pruning --- */

test('pruneSnoozes drops expired entries and ids outside the keep set', () => {
  const now = at(10);
  const snoozes = { claude: { keep: now + HOUR, expired: now - 1, evicted: now + HOUR } };
  const pruned = pruneSnoozes(snoozes, { claude: new Set(['keep', 'expired']) }, now);
  assert.deepEqual(pruned, { claude: { keep: now + HOUR } });
});

test('pruneSnoozes drops a platform once all its entries go', () => {
  const now = at(10);
  const snoozes = { claude: { a: now - 1 }, chatgpt: { b: now + HOUR } };
  const pruned = pruneSnoozes(snoozes, { claude: new Set(['a']), chatgpt: new Set(['b']) }, now);
  assert.deepEqual(pruned, { chatgpt: { b: now + HOUR } });
});

test('a platform absent from the keep set is left alone, not wiped', () => {
  // An adapter whose list() threw contributes no keep-set; its snoozes must
  // survive rather than being read as "none of these are still waiting".
  const now = at(10);
  const snoozes = { claude: { a: now + HOUR }, chatgpt: { b: now + HOUR } };
  const pruned = pruneSnoozes(snoozes, { claude: new Set(['a']) }, now);
  assert.deepEqual(pruned, snoozes);
});

test('pruneSnoozes still expires entries for an absent platform', () => {
  const now = at(10);
  const pruned = pruneSnoozes({ chatgpt: { b: now - 1 } }, {}, now);
  assert.deepEqual(pruned, {});
});

/* --- display --- */

test('formatWake buckets', () => {
  const now = at(10);
  assert.equal(formatWake(now + 45 * MIN, now), 'in 45 min');
  assert.equal(formatWake(now + 30_000, now), 'in 1 min'); // never "in 0 min"
  assert.match(formatWake(now + 3 * HOUR, now), /^today /);
  assert.match(formatWake(now + DAY, now), /^tomorrow /);
  assert.match(formatWake(presetWakeTime('tomorrow', at(23)), at(23)), /^tomorrow /);
  assert.match(formatWake(now + 3 * DAY, now), /^\S+ \d/); // weekday + time
  assert.match(formatWake(now + 30 * DAY, now), /,/); // full date form
});
