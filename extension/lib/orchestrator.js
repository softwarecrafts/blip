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
 * Ignore role: a chat taken off the radar wears a 🔕 in its title and is never
 * classified, re-labelled, badged, or queued. Unlike snooze, ignore has no
 * store — the marker lives entirely in the (synced) title, so the sweep just
 * reads isIgnored(name) and skips the chat.
 *
 * Health role: platforms change their private APIs without notice, and the
 * failure mode used to be total silence — titles just stopped updating. Every
 * sweep and on-demand check now records, per platform, the last error and
 * whether replies came back unreadable (see recordHealth). The badge turns '!'
 * and the popup explains, until a later sweep proves the problem is gone.
 *
 * All platform specifics live in adapters/*; this file only knows the generic
 * adapter interface (list/get/rename/setStarred/conversationUrl/capabilities).
 * Both the adapter registry and the snooze store are injectable so tests can
 * drive them with fakes.
 */
import { classify } from './classify.js';
import { titleTransform, isIgnored, stripPrefix } from './titleTransform.js';
import { getSettings } from './settings.js';
import { isSnoozed, partitionBySnooze } from './snooze.js';
import { createSnoozeStore } from './snoozeStore.js';
import { ADAPTERS, enabledAdapters } from '../adapters/index.js';

const BADGE_WAITING = '#e23f33'; // contact-red
const BADGE_FAILED = '#777';

/**
 * How deep a cold `seen` cache will classify.
 *
 * The list is updated_at-descending and a chat only becomes 🔴 when Claude
 * replies — which bumps updated_at and lifts it to position 0. So a chat below
 * this depth that we have NEVER seen provably has not changed in weeks, and
 * fetching it cannot reveal a recent marker. Recording it instead is what keeps
 * the first sweep after the full-history change from pulling every chat's
 * entire message array.
 *
 * 50 preserves the pre-pagination fresh-install behaviour exactly: a new
 * install still classifies the 50 most recent chats.
 */
const SEED_DEPTH = 50;

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
function setBadge({ activeCount, okCount, waitingCount, problem = false }) {
  // A recorded problem only takes the badge when there is no count to show:
  // "titles silently stopped updating" usually looks like a count of zero, and
  // a real count must never be hidden by a partial failure. The popup always
  // spells the problem out either way.
  if ((activeCount && okCount === 0) || (problem && !waitingCount)) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_FAILED });
    chrome.action.setBadgeText({ text: '!' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_WAITING });
    chrome.action.setBadgeText({ text: waitingCount ? String(waitingCount) : '' });
  }
}

/** Pure: true if any platform's health record carries an unresolved problem. */
export function hasProblem(health = {}) {
  return Object.values(health).some((h) => h?.error || h?.unreadableAt);
}

/**
 * Pure: the popup's warning lines for a health record. `labels` maps platform
 * id -> display name. Separate from the popup so the wording is testable.
 */
export function healthProblems(health = {}, labels = {}) {
  const out = [];
  for (const [platform, h] of Object.entries(health)) {
    const label = labels[platform] ?? platform;
    if (h?.unreadableAt) {
      out.push({
        platform,
        message: `Couldn't read ${label} replies — the site may have changed, so titles won't update.`,
      });
    }
    if (h?.error) out.push({ platform, message: `${label}: ${h.error}` });
  }
  return out;
}

const errText = (e) => String(e?.message ?? e);

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

  /**
   * Merge one observation into the stored per-platform health record.
   *
   * - `error`: set on any failure; cleared only by `sweepClean` (a sweep with no
   *   failures), because failed chats are not marked seen and so are retried
   *   every sweep — a clean sweep really does mean the error is gone.
   * - `unreadableAt`: sticky. Set when a reply came back with no readable text,
   *   cleared only once a reply IS read. It can't be cleared by a clean sweep,
   *   because unreadable chats are marked seen and won't be re-fetched.
   */
  async function recordHealth(platform, { error, sawReadable, sawUnreadable, sweepClean }) {
    const all = (await chrome.storage.local.get('health')).health ?? {};
    const h = { ...(all[platform] ?? {}) };
    const at = Date.now();
    if (error) Object.assign(h, { error, errorAt: at });
    else if (sweepClean) {
      delete h.error;
      delete h.errorAt;
    }
    if (sawUnreadable) h.unreadableAt = at;
    else if (sawReadable) delete h.unreadableAt;
    all[platform] = h;
    await chrome.storage.local.set({ health: all });
    return all;
  }

  /** Readability observation for one fetched conversation. */
  const readability = (conv) => ({
    sawUnreadable: !!conv.unreadable,
    sawReadable: !conv.unreadable && !!conv.lastAssistantText,
  });

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

    let conv;
    try {
      conv = await adapter.get(id);
    } catch (e) {
      await recordHealth(platform, { error: errText(e) });
      throw e;
    }
    if (conv.isTemporary) return conv.name;
    await recordHealth(platform, readability(conv));

    // Ignored chats are off the radar: never classified or re-labelled. Keep
    // the 🔕 title normalised (strip any stale 🔴/💤🔴/✅) but do no more.
    let name;
    if (isIgnored(conv.name)) {
      name = titleTransform(conv.name, null, false, true);
      if (name !== conv.name) await adapter.rename(id, name);
    } else {
      const snoozed = isSnoozed(await snoozeState.load(), platform, id, Date.now());
      try {
        name = await applyStatus(adapter, conv, settings, snoozed);
      } catch (e) {
        await recordHealth(platform, { error: errText(e) });
        throw e;
      }
    }

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
      return { waiting: [], snoozed: [], ignored: [], problems: [] };
    }
    const now = Date.now();
    const listErrors = [];
    const items = [];
    const ignoredItems = [];
    const keepByPlatform = {};
    const active = enabledAdapters(settings, adapters);
    let okCount = 0;
    for (const adapter of active) {
      try {
        const waitingIds = new Set();
        for (const c of await adapter.list()) {
          // Ignored chats never enter the queue or the keep-set (so a stale
          // snooze on a now-ignored chat is pruned away). They get their own
          // section in the popup instead.
          if (isIgnored(c.name)) {
            ignoredItems.push({
              platform: adapter.id,
              id: c.id,
              name: c.name,
              url: adapter.conversationUrl(c.id),
              updatedAt: c.updatedAt,
            });
            continue;
          }
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
        listErrors.push({ platform: adapter.id, message: `${adapter.label}: ${errText(e)}` });
      }
    }
    const health = (await chrome.storage.local.get('health')).health ?? {};
    const pruned = await snoozeState.prune(keepByPlatform, now);
    const queue = partitionBySnooze(items, pruned, now);
    // Snoozing from the popup never runs a sweep, so without this the badge
    // would keep the pre-snooze count until the next poll (up to pollMinutes).
    // Only report health for platforms that are still switched on.
    const activeHealth = Object.fromEntries(
      active.filter((a) => health[a.id]).map((a) => [a.id, health[a.id]])
    );
    const labels = Object.fromEntries(active.map((a) => [a.id, a.label]));
    const problems = [...listErrors, ...healthProblems(activeHealth, labels)];
    setBadge({
      activeCount: active.length,
      okCount,
      waitingCount: queue.waiting.length,
      problem: hasProblem(activeHealth),
    });
    return { ...queue, ignored: ignoredItems, problems };
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
      let health = {};

      for (const adapter of active) {
        const obs = { error: null, sawReadable: false, sawUnreadable: false };
        try {
          const list = await adapter.list();
          const seenP = seen[adapter.id] ?? {};
          const stillWaiting = new Set();
          for (const [index, c] of list.entries()) {
            let name = c.name;
            // Off the radar: skip classification entirely. Keep the 🔕 title
            // normalised, record it as converged, and leave it out of the
            // badge/queue. Read from the listed title, so no get() is needed.
            if (isIgnored(name)) {
              const norm = titleTransform(name, null, false, true);
              if (norm !== name) await adapter.rename(c.id, norm);
              seenP[c.id] = c.updatedAt;
              continue;
            }
            const snoozed = isSnoozed(snoozes, adapter.id, c.id, now);
            // A title whose 💤 disagrees with the schedule — typically an
            // expired snooze on an otherwise-quiet chat — must be re-applied
            // even though updatedAt hasn't changed, because the `seen`
            // shortcut below would otherwise keep the stale 💤 forever.
            const staleZzz = isWaitingTitle(name) && name.startsWith('💤') !== snoozed;
            // A never-seen chat this far down cannot have a fresh marker (see
            // SEED_DEPTH). Record it so the next sweep treats it as converged,
            // rather than paying a full get() to learn nothing. staleZzz still
            // wins, so a title whose 💤 disagrees with the schedule is fixed
            // even if storage was cleared underneath it.
            if (!(c.id in seenP) && index >= SEED_DEPTH && !staleZzz) {
              seenP[c.id] = c.updatedAt;
            } else if (seenP[c.id] !== c.updatedAt || staleZzz) {
              // One chat failing (a 500, a rename the server refuses) must not
              // abort the rest of the sweep. It stays unseen, so it is retried
              // next sweep, and the error is surfaced via recordHealth.
              try {
                const conv = await adapter.get(c.id);
                if (!conv.isTemporary) {
                  const r = readability(conv);
                  obs.sawUnreadable ||= r.sawUnreadable;
                  obs.sawReadable ||= r.sawReadable;
                  name = await applyStatus(adapter, conv, settings, snoozed);
                  seenP[c.id] = c.updatedAt;
                }
              } catch (e) {
                console.error(`[bliptracker:${adapter.id}] check ${c.id} failed:`, e);
                obs.error ??= errText(e);
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
          obs.error ??= errText(e);
        }
        health = await recordHealth(adapter.id, { ...obs, sweepClean: !obs.error });
      }

      await chrome.storage.local.set({ seen });
      // Also re-arms the 'snooze-wake' alarm for the next wake time.
      await snoozeState.prune(keepByPlatform, now);

      const activeHealth = Object.fromEntries(active.map((a) => [a.id, health[a.id]]));
      setBadge({ activeCount: active.length, okCount, waitingCount, problem: hasProblem(activeHealth) });
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

  /**
   * Take a chat off the radar: prepend 🔕 and strip any 🔴/💤🔴/✅ so it looks
   * tidy at once. The marker lives in the (synced) title — there is no store to
   * write — and the next sweep will read isIgnored() and leave it alone.
   */
  async function ignore(platform, id) {
    const adapter = adapters[platform];
    if (!adapter) return;
    const conv = await adapter.get(id);
    const name = titleTransform(conv.name, null, false, true); // '🔕 ' + base
    if (name !== conv.name) await adapter.rename(id, name);
  }

  /**
   * Put a chat back on the radar: strip the 🔕, then re-check it so the current
   * 🔴/✅ marker is re-applied immediately rather than at the next sweep.
   */
  async function unignore(platform, id) {
    const adapter = adapters[platform];
    if (!adapter) return;
    const conv = await adapter.get(id);
    const base = stripPrefix(conv.name);
    if (base !== conv.name) await adapter.rename(id, base);
    await checkConversation(platform, id);
  }

  return { sweep, checkConversation, listWaiting, snooze, unsnooze, ignore, unignore };
}
