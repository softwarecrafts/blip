/**
 * Claude service adapter — everything claude.ai-specific lives here.
 *
 * Implements the bliptracker service-adapter interface so the background
 * orchestrator never sees a claude.ai endpoint, an org id, or a chat_messages
 * array. Add a new platform by writing a sibling file with the same shape and
 * registering it in index.js (plus a DOM entry in content.js).
 *
 * Endpoints confirmed by recon 2026-06-12:
 *   GET  /api/organizations
 *   GET  /api/organizations/{org}/chat_conversations?limit=N&offset=M
 *   GET  /api/organizations/{org}/chat_conversations/{uuid}   (incl. chat_messages)
 *   PUT  /api/organizations/{org}/chat_conversations/{uuid}   {"name"} | {"is_starred"}
 *
 * claude.ai changes without notice, so every read here tolerates more than one
 * response shape and every write verifies it landed (see update()).
 */
import { paginate } from '../lib/paginate.js';

const API = 'https://claude.ai/api';
// Page size is deliberately well below the observed ceiling: at 187
// conversations this takes two requests, so the paging path runs on every real
// sweep instead of lying dormant until someone crosses 1000 and finds out it
// never worked. Recon (2026-07-26) saw no server-side cap below limit=1000.
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // runaway guard: 2000 conversations
const ORG_KEY = 'claude:orgId';
// The query the claude.ai web app itself sends when opening a chat. Used as a
// fallback when the bare endpoint stops returning readable messages, so a
// server-side default change degrades to one extra request, not silence.
const RENDER_QUERY = '?tree=True&rendering_mode=messages&render_all_tools=true';

class HttpError extends Error {
  constructor(method, path, status) {
    super(`${method} ${path} -> HTTP ${status}`);
    this.status = status;
  }
}

async function api(path, init = {}) {
  const method = init.method ?? 'GET';
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
  if (!res.ok) throw new HttpError(method, path, res.status);
  // A 204, or any empty body, is a success with nothing to read — not a
  // JSON parse error that would make a working rename look broken.
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

async function getOrgId() {
  const stored = (await chrome.storage.local.get(ORG_KEY))[ORG_KEY];
  if (stored) return stored;
  const orgs = unwrapList(await api('/organizations'));
  const org = orgs.find((o) => o.capabilities?.includes('chat')) ?? orgs[0];
  if (!org?.uuid) throw new Error('GET /organizations -> no organization found');
  await chrome.storage.local.set({ [ORG_KEY]: org.uuid });
  return org.uuid;
}

/**
 * Run an org-scoped request. A cached org id can go stale (account switch, org
 * migration); the endpoints then answer 403/404 for every chat, forever. On
 * that answer, forget the cached id and retry once against a fresh lookup.
 */
async function withOrg(fn) {
  const orgId = await getOrgId();
  try {
    return await fn(orgId);
  } catch (e) {
    if (e.status !== 403 && e.status !== 404) throw e;
    await chrome.storage.local.remove(ORG_KEY);
    const fresh = await getOrgId();
    if (fresh === orgId) throw e;
    return fn(fresh);
  }
}

/** Pure: an array response, or the array inside a `{data|items|...}` wrapper. */
export function unwrapList(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['data', 'items', 'conversations', 'chat_conversations', 'results']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  throw new Error(`expected a list, got ${body === null ? 'null' : typeof body}`);
}

function isAssistant(msg) {
  return msg?.sender === 'assistant' || msg?.role === 'assistant';
}

/**
 * Pure: the visible text of one message, whatever shape it arrives in — the
 * legacy flat `text` string, or a `content` array of typed blocks where only
 * `text` blocks are prose (tool calls, thinking, etc. are skipped).
 */
export function messageText(msg) {
  if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text;
  const { content } = msg ?? {};
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b.text === 'string' && (b.type === 'text' || b.type === undefined))
    .map((b) => b.text)
    .join('\n');
}

/**
 * Pure: the messages on the branch the user is looking at, oldest first.
 *
 * With edits/retries a conversation is a tree, and the response may hold every
 * branch. Walk parent links up from `current_leaf_message_uuid` when the
 * response carries them; otherwise fall back to `index` order, then array order.
 */
export function currentBranch(full) {
  const msgs = full?.chat_messages ?? full?.messages ?? [];
  if (!Array.isArray(msgs)) return [];
  const leaf = full.current_leaf_message_uuid;
  const byId = new Map(msgs.filter((m) => m?.uuid).map((m) => [m.uuid, m]));
  if (leaf && byId.has(leaf)) {
    const path = [];
    for (let m = byId.get(leaf); m && path.length <= msgs.length; m = byId.get(m.parent_message_uuid)) {
      path.push(m);
    }
    return path.reverse();
  }
  if (msgs.every((m) => typeof m?.index === 'number')) {
    return [...msgs].sort((a, b) => a.index - b.index);
  }
  return msgs;
}

/** Pure: extract the text of the last assistant message. Exported for tests. */
export function lastAssistantText(full) {
  const branch = currentBranch(full);
  for (let i = branch.length - 1; i >= 0; i--) {
    if (isAssistant(branch[i])) return messageText(branch[i]);
  }
  return '';
}

/**
 * Pure: true when a response has assistant messages but none of them yields
 * text — the signature of claude.ai changing its message shape under us.
 */
export function isUnreadable(full) {
  const branch = currentBranch(full);
  const assistants = branch.filter(isAssistant);
  if (!Array.isArray(full?.chat_messages ?? full?.messages)) return true;
  return assistants.length > 0 && assistants.every((m) => !messageText(m).trim());
}

export const claudeAdapter = {
  id: 'claude',
  label: 'Claude',
  capabilities: { star: true },

  conversationUrl(id) {
    return `https://claude.ai/chat/${id}`;
  },

  /**
   * Recent conversations as normalized summaries.
   *
   * Walks the full history rather than a fixed window: a 🔴 chat that drifts
   * below the window would otherwise vanish from the popup queue and the badge
   * and lose its snooze. `offset` paging confirmed by recon 2026-07-26.
   */
  async list() {
    const convos = await withOrg((orgId) =>
      paginate(
        async ({ offset, limit }) =>
          unwrapList(
            await api(`/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`)
          ),
        { pageSize: PAGE_SIZE, maxPages: MAX_PAGES }
      )
    );
    return convos
      .filter((c) => !c.is_temporary)
      .map((c) => ({
        id: c.uuid ?? c.id,
        name: c.name ?? '',
        updatedAt: c.updated_at,
        isStarred: c.is_starred,
      }));
  },

  /**
   * One conversation, normalized, with the last assistant message's text.
   *
   * `unreadable` is set when the chat has assistant replies but no text could
   * be pulled from them even after the fallback query — the orchestrator
   * surfaces that as a "claude.ai may have changed" warning.
   */
  async get(id) {
    const full = await withOrg(async (orgId) => {
      const path = `/organizations/${orgId}/chat_conversations/${id}`;
      const plain = await api(path);
      if (!isUnreadable(plain)) return plain;
      try {
        const rendered = await api(path + RENDER_QUERY);
        return isUnreadable(rendered) ? plain : rendered;
      } catch {
        return plain;
      }
    });
    return {
      id: full.uuid ?? id,
      name: full.name ?? '',
      isStarred: full.is_starred,
      updatedAt: full.updated_at,
      isTemporary: !!full.is_temporary,
      lastAssistantText: lastAssistantText(full),
      unreadable: isUnreadable(full),
    };
  },

  async rename(id, name) {
    await update(id, { name }, (res) => res?.name === undefined || res.name === name);
  },

  async setStarred(id, isStarred) {
    await update(id, { is_starred: isStarred }, (res) =>
      res?.is_starred === undefined || res.is_starred === isStarred
    );
  },
};

/**
 * Write fields to a conversation. PUT is what recon saw; if claude.ai moves to
 * PATCH (405/404 on PUT), or answers 2xx but echoes back the old value, try
 * PATCH before giving up. Throws if neither verb applied the change, so a
 * silent no-op rename shows up as an error instead of "nothing happened".
 */
async function update(id, fields, applied) {
  await withOrg(async (orgId) => {
    const path = `/organizations/${orgId}/chat_conversations/${id}`;
    const body = JSON.stringify(fields);
    let putError = null;
    try {
      if (applied(await api(path, { method: 'PUT', body }))) return;
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      putError = e;
    }
    try {
      if (applied(await api(path, { method: 'PATCH', body }))) return;
    } catch (e) {
      throw putError && (e.status === 404 || e.status === 405) ? putError : e;
    }
    throw new Error(`update ${path} -> server ignored ${Object.keys(fields).join(', ')}`);
  });
}
