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
 * UI role: popup.js asks for the "waiting on you" queue and to sweep now.
 *
 * All platform specifics live in adapters/*; this file only knows the generic
 * adapter interface (list/get/rename/setStarred/conversationUrl/capabilities).
 * The adapter registry is injectable so tests can drive it with fakes.
 */
import { classify } from './classify.js';
import { titleTransform } from './titleTransform.js';
import { getSettings } from './settings.js';
import { ADAPTERS, enabledAdapters } from '../adapters/index.js';

const BADGE_WAITING = '#e23f33'; // contact-red
const BADGE_FAILED = '#777';

/** Classify a normalized conversation by its last assistant message. */
export function statusOf(conv) {
  return conv.lastAssistantText ? classify(conv.lastAssistantText) : null;
}

export function createOrchestrator({ adapters = ADAPTERS } = {}) {
  let sweeping = false;

  /**
   * Apply status to a normalized conversation via its adapter: rename if
   * needed, and (optionally, if the platform supports stars) mirror the star.
   * Returns the resulting title. Single source of truth for the sweep and the
   * on-demand checker.
   */
  async function applyStatus(adapter, conv, settings) {
    const status = statusOf(conv);
    let name = conv.name;

    const newTitle = titleTransform(name, status);
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
    const name = await applyStatus(adapter, conv, settings);

    const seen = await loadSeen();
    seen[platform] = { ...(seen[platform] ?? {}), [id]: conv.updatedAt };
    await chrome.storage.local.set({ seen });
    return name;
  }

  /** The current "waiting on you" queue across enabled platforms, for popup.js. */
  async function listWaiting() {
    const settings = await getSettings();
    if (!settings.enabled) return { waiting: [] };
    const waiting = [];
    for (const adapter of enabledAdapters(settings, adapters)) {
      try {
        for (const c of await adapter.list()) {
          if (c.name.startsWith('🔴')) {
            waiting.push({
              platform: adapter.id,
              id: c.id,
              name: c.name,
              url: adapter.conversationUrl(c.id),
              updatedAt: c.updatedAt,
            });
          }
        }
      } catch (e) {
        console.error(`[bliptracker:${adapter.id}] list failed:`, e);
      }
    }
    return { waiting };
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
      let waitingCount = 0;
      let okCount = 0;

      for (const adapter of active) {
        try {
          const list = await adapter.list();
          const seenP = seen[adapter.id] ?? {};
          for (const c of list) {
            let name = c.name;
            if (seenP[c.id] !== c.updatedAt) {
              const conv = await adapter.get(c.id);
              if (!conv.isTemporary) {
                name = await applyStatus(adapter, conv, settings);
                seenP[c.id] = c.updatedAt;
              }
            }
            if (name.startsWith('🔴')) waitingCount++;
          }
          // Keep seen-state only for chats still in the list window.
          const listed = new Set(list.map((c) => c.id));
          seen[adapter.id] = Object.fromEntries(
            Object.entries(seenP).filter(([id]) => listed.has(id))
          );
          okCount++;
        } catch (e) {
          console.error(`[bliptracker:${adapter.id}] sweep failed:`, e);
        }
      }

      await chrome.storage.local.set({ seen });

      if (active.length && okCount === 0) {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_FAILED });
        chrome.action.setBadgeText({ text: '!' });
      } else {
        chrome.action.setBadgeBackgroundColor({ color: BADGE_WAITING });
        chrome.action.setBadgeText({ text: waitingCount ? String(waitingCount) : '' });
      }
    } finally {
      sweeping = false;
    }
  }

  return { sweep, checkConversation, listWaiting };
}
