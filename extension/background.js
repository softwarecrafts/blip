/**
 * Background poller + on-demand checker.
 *
 * Periodic role (every settings.pollMinutes): list recent conversations and,
 * for any whose updated_at changed since the last sweep, read the last
 * assistant message, classify its explicit 🔴/✅ marker, and rename the title.
 * This is the cross-device backstop — it catches chats you finished on mobile.
 *
 * On-demand role: content.js messages us the moment the chat you're viewing
 * changes, so the rename happens instantly instead of on the next sweep.
 *
 * UI roles: popup.js asks us for the current "waiting on you" list and to run
 * a sweep on demand. All classify/rename logic lives here.
 *
 * Endpoints confirmed by recon on 2026-06-12 (claude.ai internal API):
 *   GET    /api/organizations
 *   GET    /api/organizations/{org}/chat_conversations?limit=N
 *   GET    /api/organizations/{org}/chat_conversations/{uuid}   (incl. chat_messages)
 *   PUT    /api/organizations/{org}/chat_conversations/{uuid}   {"name": ...} or {"is_starred": ...}
 */
import { classify } from './lib/classify.js';
import { titleTransform } from './lib/titleTransform.js';
import { getSettings } from './lib/settings.js';

const API = 'https://claude.ai/api';
const LIST_LIMIT = 50;

chrome.runtime.onInstalled.addListener(async (details) => {
  await resetAlarm();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  sweep();
});
chrome.runtime.onStartup.addListener(() => {
  resetAlarm();
  sweep();
});
chrome.alarms.onAlarm.addListener((a) => a.name === 'sweep' && sweep());

// Recreate the alarm when the poll cadence changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) resetAlarm();
});

async function resetAlarm() {
  const { pollMinutes } = await getSettings();
  chrome.alarms.create('sweep', { periodInMinutes: Math.max(1, pollMinutes) });
}

// Messages from content.js (instant re-check) and popup.js (UI queries).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    'check-conversation': () => checkConversation(msg.uuid).then((name) => ({ name })),
    'get-waiting': () => listWaiting(),
    'run-sweep': () => sweep().then(() => listWaiting()),
  };
  const handler = handlers[msg?.type];
  if (!handler) return;
  handler()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function getOrgId() {
  const { orgId } = await chrome.storage.local.get('orgId');
  if (orgId) return orgId;
  const orgs = await api('/organizations');
  const org = orgs.find((o) => o.capabilities?.includes('chat')) ?? orgs[0];
  await chrome.storage.local.set({ orgId: org.uuid });
  return org.uuid;
}

/** Classify a fully-fetched conversation by its last assistant message. */
function statusOf(full) {
  const lastAssistant = [...(full.chat_messages ?? [])]
    .reverse()
    .find((m) => m.sender === 'assistant');
  return lastAssistant ? classify(lastAssistant.text) : null;
}

/**
 * Apply the status to a fully-fetched conversation: rename if needed and
 * (optionally) mirror the star. Returns the resulting title. Single source
 * of truth for the sweep and the on-demand checker.
 */
async function applyStatus(orgId, full, settings) {
  const status = statusOf(full);
  let name = full.name;

  const newTitle = titleTransform(name, status);
  if (newTitle && newTitle !== name) {
    console.log(`[claude-chat-status] "${name}" -> "${newTitle}"`);
    await api(`/organizations/${orgId}/chat_conversations/${full.uuid}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newTitle }),
    });
    name = newTitle; // titleTransform is idempotent, so a re-check no-ops.
  }

  if (settings.mirrorStar) {
    const wantStar = status === 'waiting' ? true : status === 'resolved' ? false : null;
    if (wantStar !== null && wantStar !== full.is_starred) {
      await api(`/organizations/${orgId}/chat_conversations/${full.uuid}`, {
        method: 'PUT',
        body: JSON.stringify({ is_starred: wantStar }),
      });
    }
  }

  return name;
}

/** On-demand re-check of one conversation (ignores the `seen` cache). */
async function checkConversation(uuid) {
  const settings = await getSettings();
  if (!settings.enabled) return null;
  const orgId = await getOrgId();
  const full = await api(`/organizations/${orgId}/chat_conversations/${uuid}`);
  if (full.is_temporary) return full.name;
  const name = await applyStatus(orgId, full, settings);
  const { seen = {} } = await chrome.storage.local.get('seen');
  seen[uuid] = full.updated_at;
  await chrome.storage.local.set({ seen });
  return name;
}

/** The current "waiting on you" queue, for the popup. */
async function listWaiting() {
  const orgId = await getOrgId();
  const convos = await api(`/organizations/${orgId}/chat_conversations?limit=${LIST_LIMIT}`);
  const waiting = convos
    .filter((c) => !c.is_temporary && c.name.startsWith('🔴'))
    .map((c) => ({ uuid: c.uuid, name: c.name, updated_at: c.updated_at }));
  return { waiting };
}

let sweeping = false;

async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const orgId = await getOrgId();
    const convos = await api(`/organizations/${orgId}/chat_conversations?limit=${LIST_LIMIT}`);
    const { seen = {} } = await chrome.storage.local.get('seen');

    for (const convo of convos) {
      if (convo.is_temporary) continue;
      if (seen[convo.uuid] === convo.updated_at) continue;
      const full = await api(`/organizations/${orgId}/chat_conversations/${convo.uuid}`);
      convo.name = await applyStatus(orgId, full, settings); // keep name fresh for the badge
      seen[convo.uuid] = convo.updated_at;
    }

    // Keep seen-state only for chats still in the list window.
    const listed = new Set(convos.map((c) => c.uuid));
    const pruned = Object.fromEntries(Object.entries(seen).filter(([id]) => listed.has(id)));
    await chrome.storage.local.set({ seen: pruned });

    const waiting = convos.filter((c) => c.name.startsWith('🔴')).length;
    chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
    chrome.action.setBadgeText({ text: waiting ? String(waiting) : '' });
  } catch (e) {
    console.error('[claude-chat-status] sweep failed:', e);
    chrome.action.setBadgeBackgroundColor({ color: '#777' });
    chrome.action.setBadgeText({ text: '!' });
  } finally {
    sweeping = false;
  }
}
