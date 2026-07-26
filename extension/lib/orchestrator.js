/**
 * Orchestrator — platform-agnostic status sweep.
 *
 * Periodic role (every settings.pollMinutes): for each enabled platform
 * adapter, list recent conversations and, for any changed since the last
 * sweep, read the last assistant message, classify its 🔴/✅ marker, and rename
 * the title. The cross-device backstop.
 *
 * On-demand role: content.js messages the worker (with its platform) the
 * moment the chat you're viewing settles, so the rename happens instantly.
 *
 * UI role: popup.js asks for the "waiting on you" queue (split into waiting vs
 * snoozed) and to sweep, snooze, or wake a chat now.
 *
 * Snooze role: a snoozed chat keeps its 🔴 but wears a 💤 and is held back from
 * the badge until its wake time. The schedule itself lives behind snoozeStore;
 * this file only asks "is this one snoozed" and "prune to what's still waiting".
 *
 * All platform specifics live in adapters/*; this file only knows the generic
 * adapter interface (list/get/rename/setStarred/conversationUrl/capabilities).
 * Both the adapter registry and the snooze store are injectable so tests can
 * drive them with fakes.
 */
import { classify } from './classify.js';
import { titleTransform } from './titleTransform.js';
import { getSettings } from './settings.js';
import { isSnoozed, partitionBySnooze } from './snooze.js';
import { createSnoozeStore } from './snoozeStore.js';
import { ADAPTERS, enabledAdapters } from '../adapters/index.js';

const BADGE_WAITING = '#e23f33'; // contact-red
const BADGE_FAILED = '#777';

/** Classify a normalized conversation by its last assistant message. */
export function statusOf(conv) {
  return conv.lastAssistantText ? classify(conv.lastAssistantText) : null;
}

/**
 * A title that means "waiting on you", snoozed or not. Snoozed chats keep
 * their 🔴 (they do need you, just not yet), so anything matching this is
 * still queue/badge-eligible before the snooze filter is applied.
 */
export function isWaitingTitle(name) {
  return name.startsWith('🔴') || name.startsWith('💤🔴');
}

/**
 * The single place that decides what the toolbar badge shows.
 *
 * `waitingCount` is always the UNSNOOZED count — a snoozed chat is still 🔴
 * and still in the popup, but the whole point of snoozing is to take it off
 * your number until it wakes.
 *
 * Both sweep() and listWaiting() call this, so the badge re-syncs the moment
 * the popup does anything, rather than waiting for the next poll.
 */
function setBadge({ activeCount, okCount, waitingCount }) {
  if (activeCount && okCount === 0) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_FAILED });
    chrome.action.setBadgeText({ text: '!' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_WAITING });
    chrome.action.setBadgeText({ text: waitingCount ? String(waitingCount) : '' });
  }
}

export function createOrchestrator({ adapters = ADAPTERS, snoozeStore } = {}) {
  let sweeping = false;
  const snoozeState = snoozeStore ?? createSnoozeStore();

  /**
   * Apply status to a normalized conversation via its adapter: rename if
   * needed, and (optionally, if the platform supports stars) mirror the star.
   * Returns the resulting title. Single source of truth for the sweep and the
   * on-demand checker.
   */
  async function applyStatus(adapter, conv, settings, snoozed = false) {
    const status = statusOf(conv);
    let name = conv.name;

    const newTitle = titleTransform(name, status, snoozed);
    if (newTitle && newTitle !== name) {
      console.log(`[bliptracker:${adapter.id}] "${name}" -> "${newTitle}"`);
      await adapter.rename(conv.id, newTitle);
      name = newTitle; // titleTransform is idempotent, so a re-check no-ops.
    }

    if (settings.mirrorStar && adapter.capabilities?.star) {
      const wantStar = status === 'waiting' ? true : status === 'resolved' ? false : null;
      if (wantStar !== null && wantStar !== conv.isStarred) {
        await adapter.setStarred(conv.id, wantStar);
      }
    }

    return name;
  }

  // ── seen cache: { [platform]: { [id]: updatedAt } } ───────────────────────
  async function loadSeen() {
    let seen = (await chrome.storage.local.get('seen')).seen ?? {};
    // One-time migration from the old flat { [id]: updatedAt } shape.
    if (Object.values(seen).some((v) => typeof v !== 'object' || v === null)) seen = {};
    return seen;
  }

  /** On-demand re-check of one conversation on one platform (ignores `seen`). */
  async function checkConversation(platform, id) {
    const settings = await getSettings();
    if (!settings.enabled || settings.platforms?.[platform] !== true) return null;
    const adapter = adapters[platform];
    if (!adapter) return null;

    const conv = await adapter.get(id);
    if (conv.isTemporary) return conv.name;
    const snoozed = isSnoozed(await snoozeState.load(), platform, id, Date.now());
    const name = await applyStatus(adapter, conv, settings, snoozed);

    const seen = await loadSeen();
    seen[platform] = { ...(seen[platform] ?? {}), [id]: conv.updatedAt };
    await chrome.storage.local.set({ seen });
    return name;
  }

  /**
   * The current queue for popup.js, split into { waiting, snoozed }.
   *
   * Prunes here as well as in the sweep so a snooze that expired since the
   * last sweep is already back under "waiting" by the time the popup opens —
   * the popup never has to reason about expiry itself.
   */
  async function listWaiting() {
    const settings = await getSettings();
    if (!settings.enabled) {
      chrome.action.setBadgeText({ text: '' });
      return { waiting: [], snoozed: [] };
    }
    const now = Date.now();
    const items = [];
    const keepByPlatform = {};
    const active = enabledAdapters(settings, adapters);
    let okCount = 0;
    for (const adapter of active) {
      try {
        const waitingIds = new Set();
        for (const c of await adapter.list()) {
          if (isWaitingTitle(c.name)) {
            waitingIds.add(c.id);
            items.push({
              platform: adapter.id,
              id: c.id,
              name: c.name,
              url: adapter.conversationUrl(c.id),
              updatedAt: c.updatedAt,
            });
          }
        }
        // Only adapters that listed successfully contribute a keep-set;
        // a thrown list() must not prune that platform's snoozes away.
        keepByPlatform[adapter.id] = waitingIds;
        okCount++;
      } catch (e) {
        console.error(`[bliptracker:${adapter.id}] list failed:`, e);
      }
    }
    const pruned = await snoozeState.prune(keepByPlatform, now);
    const queue = partitionBySnooze(items, pruned, now);
    // Snoozing from the popup never runs a sweep, so without this the badge
    // would keep the pre-snooze count until the next poll (up to pollMinutes).
    setBadge({ activeCount: active.length, okCount, waitingCount: queue.waiting.length });
    return queue;
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    try {
      const settings = await getSettings();
      if (!settings.enabled) {
        chrome.action.setBadgeText({ text: '' });
        return;
      }

      const active = enabledAdapters(settings, adapters);
      const seen = await loadSeen();
      const snoozes = await snoozeState.load();
      const now = Date.now();
      const keepByPlatform = {};
      let waitingCount = 0;
      let okCount = 0;

      for (const adapter of active) {
        try {
          const list = await adapter.list();
          const seenP = seen[adapter.id] ?? {};
          const stillWaiting = new Set();
          for (const c of list) {
            let name = c.name;
            const snoozed = isSnoozed(snoozes, adapter.id, c.id, now);
            // A title whose 💤 disagrees with the schedule — typically an
            // expired snooze on an otherwise-quiet chat — must be re-applied
            // even though updatedAt hasn't changed, because the `seen`
            // shortcut below would otherwise keep the stale 💤 forever.
            const staleZzz = isWaitingTitle(name) && name.startsWith('💤') !== snoozed;
            if (seenP[c.id] !== c.updatedAt || staleZzz) {
              const conv = await adapter.get(c.id);
              if (!conv.isTemporary) {
                name = await applyStatus(adapter, conv, settings, snoozed);
                seenP[c.id] = c.updatedAt;
              }
            }
            if (isWaitingTitle(name)) {
              stillWaiting.add(c.id);
              if (!snoozed) waitingCount++; // snoozed chats stay off the badge
            }
          }
          // Keep seen-state only for chats still in the list window.
          const listed = new Set(list.map((c) => c.id));
          seen[adapter.id] = Object.fromEntries(
            Object.entries(seenP).filter(([id]) => listed.has(id))
          );
          // Snoozes survive only while the chat is still 🔴 and still listed:
          // one that flipped to ✅ (or fell out of the window) loses its snooze.
          keepByPlatform[adapter.id] = stillWaiting;
          okCount++;
        } catch (e) {
          console.error(`[bliptracker:${adapter.id}] sweep failed:`, e);
        }
      }

      await chrome.storage.local.set({ seen });
      // Also re-arms the 'snooze-wake' alarm for the next wake time.
      await snoozeState.prune(keepByPlatform, now);

      setBadge({ activeCount: active.length, okCount, waitingCount });
    } finally {
      sweeping = false;
    }
  }

  /**
   * Mute a chat until `wake` (epoch ms). Re-checks the conversation straight
   * after so the 💤 lands on the title immediately rather than at next sweep.
   */
  async function snooze(platform, id, wake) {
    await snoozeState.snooze(platform, id, wake);
    await checkConversation(platform, id);
  }

  /** Wake a chat now, stripping the 💤 immediately. */
  async function unsnooze(platform, id) {
    await snoozeState.unsnooze(platform, id);
    await checkConversation(platform, id);
  }

  return { sweep, checkConversation, listWaiting, snooze, unsnooze };
}
