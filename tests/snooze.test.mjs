import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOOZE_PRESETS,
  availablePresets,
  presetWakeTime,
  SNOOZE_TIME_STEP_MINUTES,
  toDateValue,
  timeSlots,
  wakeFromParts,
  defaultPickerDate,
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

test("'evening' is 18:00 today when the day still has an evening left", () => {
  assert.equal(presetWakeTime('evening', at(10)), new Date(2026, 6, 14, 18).getTime());
  assert.equal(presetWakeTime('evening', at(17, 59)), new Date(2026, 6, 14, 18).getTime());
});

test("'evening' rolls to tomorrow once 18:00 has passed", () => {
  // Guards against ever handing setSnooze a wake time in the past, even
  // though the popup hides this preset after 18:00.
  const tomorrowEvening = new Date(2026, 6, 15, 18).getTime();
  assert.equal(presetWakeTime('evening', at(18)), tomorrowEvening, 'exactly 18:00 counts as past');
  assert.equal(presetWakeTime('evening', at(23, 30)), tomorrowEvening);
});

test("'monday' is the next Monday 09:00, and a full week away on a Monday", () => {
  const mondayAt9 = (day) => new Date(2026, 6, day, 9).getTime();
  // 14 Jul 2026 is a Tuesday; 20 Jul is the following Monday.
  assert.equal(presetWakeTime('monday', at(10)), mondayAt9(20), 'from Tuesday');
  assert.equal(
    presetWakeTime('monday', new Date(2026, 6, 19, 10).getTime()),
    mondayAt9(20),
    'from Sunday — tomorrow'
  );
  assert.equal(
    presetWakeTime('monday', new Date(2026, 6, 20, 10).getTime()),
    mondayAt9(27),
    'from Monday — the NEXT Monday, not today'
  );
});

test('every preset resolves strictly into the future, at any hour', () => {
  for (let h = 0; h < 24; h++) {
    const now = at(h, 30);
    for (const { id } of SNOOZE_PRESETS) {
      assert.ok(presetWakeTime(id, now) > now, `${id} at ${h}:30`);
    }
  }
});

test('availablePresets hides "This evening" only once the evening has gone', () => {
  const ids = (now) => availablePresets(now).map((p) => p.id);
  assert.ok(ids(at(9)).includes('evening'), 'morning');
  assert.ok(ids(at(17, 59)).includes('evening'), 'just before 18:00');
  assert.ok(!ids(at(18)).includes('evening'), 'from 18:00 on');
  assert.ok(!ids(at(22)).includes('evening'), 'late evening');
});

test('availablePresets keeps menu order and never drops the unconditional ones', () => {
  const always = SNOOZE_PRESETS.filter((p) => !p.available).map((p) => p.id);
  for (const h of [0, 9, 18, 23]) {
    const ids = availablePresets(at(h)).map((p) => p.id);
    for (const id of always) assert.ok(ids.includes(id), `${id} at ${h}:00`);
    const order = SNOOZE_PRESETS.map((p) => p.id).filter((id) => ids.includes(id));
    assert.deepEqual(ids, order, `order preserved at ${h}:00`);
  }
});

/* --- custom "snooze until" picker --- */

test('toDateValue formats the LOCAL calendar date, not the UTC one', () => {
  assert.equal(toDateValue(new Date(2026, 6, 14, 10).getTime()), '2026-07-14');
  // 23:30 local is already the next day in UTC east of Greenwich; the picker
  // must still say the 14th, because that is the day the user is living in.
  assert.equal(toDateValue(new Date(2026, 6, 14, 23, 30).getTime()), '2026-07-14');
  assert.equal(toDateValue(new Date(2026, 6, 14, 0, 30).getTime()), '2026-07-14');
});

test('wakeFromParts builds a local wall-clock time', () => {
  assert.equal(wakeFromParts('2026-07-14', '09:30'), new Date(2026, 6, 14, 9, 30).getTime());
  assert.equal(wakeFromParts('2026-07-14', '00:00'), new Date(2026, 6, 14, 0, 0).getTime());
});

test('wakeFromParts round-trips through toDateValue', () => {
  const ms = new Date(2026, 6, 14, 18, 30).getTime();
  assert.equal(wakeFromParts(toDateValue(ms), '18:30'), ms);
});

test('timeSlots covers the whole day on a future date, on the grid', () => {
  const slots = timeSlots('2026-07-20', at(10));
  assert.equal(slots.length, (24 * 60) / SNOOZE_TIME_STEP_MINUTES, '48 half-hour slots');
  assert.equal(slots[0], '00:00');
  assert.equal(slots[1], '00:30');
  assert.equal(slots.at(-1), '23:30');
  for (const s of slots) {
    assert.match(s, /^\d{2}:\d{2}$/);
    assert.equal(Number(s.slice(3)) % SNOOZE_TIME_STEP_MINUTES, 0, s);
  }
});

test('timeSlots drops slots already gone today', () => {
  const slots = timeSlots('2026-07-14', at(10, 5));
  assert.equal(slots[0], '10:30', 'the 10:00 slot has passed');
  assert.ok(!slots.includes('09:30'));
  assert.equal(slots.at(-1), '23:30');
});

test('timeSlots treats a slot exactly at now as gone', () => {
  const slots = timeSlots('2026-07-14', at(10, 0));
  assert.equal(slots[0], '10:30', 'never offer a wake time of exactly now');
});

test('timeSlots is empty for a past date, and after the last slot of today', () => {
  assert.deepEqual(timeSlots('2026-07-13', at(10)), [], 'yesterday');
  assert.deepEqual(timeSlots('2026-07-14', at(23, 45)), [], 'past the 23:30 slot');
});

test('every offered slot is strictly in the future', () => {
  for (const h of [0, 9, 15, 23]) {
    const now = at(h, 20);
    for (const slot of timeSlots(toDateValue(now), now)) {
      assert.ok(wakeFromParts(toDateValue(now), slot) > now, `${slot} at ${h}:20`);
    }
  }
});

test('defaultPickerDate opens on today while the day still has slots', () => {
  assert.equal(defaultPickerDate(at(10)), '2026-07-14');
  assert.equal(defaultPickerDate(at(23, 20)), '2026-07-14', '23:30 is still available');
});

test('defaultPickerDate rolls to tomorrow once today is spent', () => {
  // Otherwise a late-night snooze opens the picker on an empty dropdown.
  assert.equal(defaultPickerDate(at(23, 45)), '2026-07-15');
  assert.ok(timeSlots(defaultPickerDate(at(23, 45)), at(23, 45)).length > 0);
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
