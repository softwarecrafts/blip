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

export const SNOOZE_PRESETS = [
  { id: '1h', label: '1 hour' },
  { id: 'tomorrow', label: 'Tomorrow 9am' },
  { id: '3d', label: '3 days' },
  { id: '1w', label: '1 week' },
];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Epoch ms a preset wakes at. 'tomorrow' = next calendar day 09:00 local. */
export function presetWakeTime(presetId, now = Date.now()) {
  switch (presetId) {
    case '1h':
      return now + HOUR;
    case '3d':
      return now + 3 * DAY;
    case '1w':
      return now + 7 * DAY;
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }
    default:
      throw new Error(`unknown snooze preset: ${presetId}`);
  }
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
