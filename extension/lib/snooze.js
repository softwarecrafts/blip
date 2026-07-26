/**
 * Snooze bookkeeping: pure helpers over the `snoozes` map stored in
 * chrome.storage.local as { [platform]: { [conversationId]: wakeEpochMs } }.
 *
 * Platform-scoped to mirror the orchestrator's `seen` cache — conversation
 * ids are only unique within a platform, so an unscoped map would collide
 * once a second adapter lands.
 *
 * The map is the source of truth for WHEN a chat wakes; the 💤🔴 title
 * prefix (see titleTransform.js) is derived display. A chat counts as
 * snoozed only while its wake time is in the future — expired entries are
 * ignored everywhere and pruned by the sweep.
 *
 * Every function takes `now` (epoch ms) instead of reading the clock, so
 * all of this is deterministic and unit-testable with plain Node.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const MORNING_HOUR = 9; // when a "next day" snooze lands
const EVENING_HOUR = 18; // when "this evening" lands

/**
 * The snooze menu. Presets only, deliberately: you are choosing roughly when
 * to be nagged again, and a free-form picker offered minute precision nobody
 * needs (and which no <input type="datetime-local"> will step sensibly).
 *
 * `available` hides a preset whose label would be a lie — "This evening" is
 * meaningless at 9pm. Presets without one are always offered.
 */
export const SNOOZE_PRESETS = [
  { id: '1h', label: '1 hour' },
  { id: 'evening', label: 'This evening', available: (now) => new Date(now).getHours() < EVENING_HOUR },
  { id: 'tomorrow', label: 'Tomorrow 9am' },
  { id: '3d', label: '3 days' },
  { id: 'monday', label: 'Next Monday' },
  { id: '1w', label: '1 week' },
];

/** The presets worth showing right now, in menu order. */
export function availablePresets(now = Date.now()) {
  return SNOOZE_PRESETS.filter((p) => !p.available || p.available(now));
}

/**
 * Epoch ms a preset wakes at. Always strictly in the future, including for
 * presets whose `available` window has passed — a stale popup must never be
 * able to ask for a wake time in the past.
 */
export function presetWakeTime(presetId, now = Date.now()) {
  switch (presetId) {
    case '1h':
      return now + HOUR;
    case '3d':
      return now + 3 * DAY;
    case '1w':
      return now + 7 * DAY;
    case 'evening': {
      const d = new Date(now);
      d.setHours(EVENING_HOUR, 0, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1); // already evening
      return d.getTime();
    }
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(MORNING_HOUR, 0, 0, 0);
      return d.getTime();
    }
    case 'monday': {
      const d = new Date(now);
      // getDay(): Sun 0 … Sat 6. On a Monday this means the NEXT one, not today.
      d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
      d.setHours(MORNING_HOUR, 0, 0, 0);
      return d.getTime();
    }
    default:
      throw new Error(`unknown snooze preset: ${presetId}`);
  }
}

/* --- custom "snooze until" picker -------------------------------------- *
 *
 * A date input plus a generated time <select>, rather than a datetime-local:
 * `step` on datetime-local only drives validation and stepUp()/stepDown(),
 * so its minute field cannot be coarsened, and half-hour granularity is all
 * the alarm can honestly deliver anyway — a one-shot chrome alarm fires late
 * if Chrome was closed at the appointed moment.
 */

/** Granularity of the time dropdown. 48 slots a day. */
export const SNOOZE_TIME_STEP_MINUTES = 30;

const pad = (n) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD" for an <input type="date"> value or min. */
export function toDateValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Epoch ms for a date + time pair off the picker.
 *
 * Built field-by-field rather than by parsing "YYYY-MM-DDTHH:MM": a date-only
 * string parses as UTC while a date-time string parses as local, and that
 * inconsistency is exactly the kind of thing that silently shifts a wake time
 * by the timezone offset.
 */
export function wakeFromParts(dateValue, timeValue) {
  const [y, m, d] = dateValue.split('-').map(Number);
  const [hh, mm] = timeValue.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * The "HH:MM" slots to offer for a given local date, past ones dropped. A
 * date already gone returns []; today returns only what is still ahead, so
 * the dropdown can never produce a wake time in the past.
 */
export function timeSlots(dateValue, now = Date.now(), stepMinutes = SNOOZE_TIME_STEP_MINUTES) {
  const slots = [];
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    const value = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
    if (wakeFromParts(dateValue, value) > now) slots.push(value);
  }
  return slots;
}

/**
 * The date the picker should open on: today while it still has a slot left,
 * otherwise tomorrow — so a late-night snooze never opens on an empty list.
 */
export function defaultPickerDate(now = Date.now(), stepMinutes = SNOOZE_TIME_STEP_MINUTES) {
  const today = toDateValue(now);
  if (timeSlots(today, now, stepMinutes).length) return today;
  return toDateValue(now + DAY);
}

/** The wake time for one conversation, or 0 if it has none. */
export function wakeAt(snoozes, platform, id) {
  return snoozes?.[platform]?.[id] ?? 0;
}

/** True if this conversation has an unexpired snooze. */
export function isSnoozed(snoozes, platform, id, now) {
  return wakeAt(snoozes, platform, id) > now;
}

/** A copy of `snoozes` with one conversation's wake time set. */
export function withSnooze(snoozes, platform, id, wake) {
  return { ...snoozes, [platform]: { ...(snoozes?.[platform] ?? {}), [id]: wake } };
}

/** A copy of `snoozes` with one conversation's snooze removed. */
export function withoutSnooze(snoozes, platform, id) {
  const forPlatform = { ...(snoozes?.[platform] ?? {}) };
  delete forPlatform[id];
  const next = { ...snoozes, [platform]: forPlatform };
  if (Object.keys(forPlatform).length === 0) delete next[platform];
  return next;
}

/**
 * The soonest unexpired wake time across every platform, or null if nothing
 * is snoozed. Drives the chained one-shot 'snooze-wake' alarm.
 */
export function earliestWake(snoozes, now) {
  const wakes = Object.values(snoozes ?? {}).flatMap((byId) =>
    Object.values(byId).filter((w) => w > now)
  );
  return wakes.length ? Math.min(...wakes) : null;
}

/**
 * Split the popup's waiting items into { waiting, snoozed }. Items carry
 * { platform, id, ... } as built by the orchestrator's listWaiting. Snoozed
 * items gain a wakeAt field and are sorted soonest-first.
 */
export function partitionBySnooze(items, snoozes, now) {
  const waiting = [];
  const snoozed = [];
  for (const item of items) {
    if (isSnoozed(snoozes, item.platform, item.id, now)) {
      snoozed.push({ ...item, wakeAt: wakeAt(snoozes, item.platform, item.id) });
    } else {
      waiting.push(item);
    }
  }
  snoozed.sort((a, b) => a.wakeAt - b.wakeAt);
  return { waiting, snoozed };
}

/**
 * Drop expired snoozes and snoozes for chats no longer worth tracking.
 * `keepByPlatform` is { [platform]: Set<id> } of chats still in the list
 * window AND still 🔴 — the sweep builds one Set per adapter as it goes.
 * Platforms that end up empty are dropped, so storage stays bounded the same
 * way the sweep's `seen` prune does.
 *
 * A platform absent from `keepByPlatform` is left ALONE, not cleared: an
 * adapter whose list() threw this sweep must not lose its snoozes.
 */
export function pruneSnoozes(snoozes, keepByPlatform, now) {
  const next = {};
  for (const [platform, byId] of Object.entries(snoozes ?? {})) {
    const keep = keepByPlatform[platform];
    const kept = Object.entries(byId).filter(
      ([id, wake]) => wake > now && (keep === undefined || keep.has(id))
    );
    if (kept.length) next[platform] = Object.fromEntries(kept);
  }
  return next;
}

/**
 * Short human wake time for the popup: "in 45 min", "today 17:30",
 * "tomorrow 09:00", "Mon 09:00", "Mon 21 Jul, 09:00". Uses the default
 * locale so 12/24-hour clock follows the OS.
 */
export function formatWake(wakeMs, now = Date.now()) {
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  if (wakeMs - now < HOUR) return `in ${Math.max(1, Math.round((wakeMs - now) / MIN))} min`;

  const wake = new Date(wakeMs);
  const daysAhead = calendarDaysBetween(new Date(now), wake);
  if (daysAhead === 0) return `today ${time.format(wake)}`;
  if (daysAhead === 1) return `tomorrow ${time.format(wake)}`;
  if (daysAhead < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    return `${weekday.format(wake)} ${time.format(wake)}`;
  }
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date.format(wake)}, ${time.format(wake)}`;
}

/** Whole local-calendar-days from a to b (0 = same day). */
function calendarDaysBetween(a, b) {
  const startOfDay = (d) => new Date(d).setHours(0, 0, 0, 0);
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}
