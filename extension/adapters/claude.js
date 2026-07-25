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
 *   GET  /api/organizations/{org}/chat_conversations?limit=N
 *   GET  /api/organizations/{org}/chat_conversations/{uuid}   (incl. chat_messages)
 *   PUT  /api/organizations/{org}/chat_conversations/{uuid}   {"name"} | {"is_starred"}
 */
const API = 'https://claude.ai/api';
const LIST_LIMIT = 50;
const ORG_KEY = 'claude:orgId';

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
  const stored = (await chrome.storage.local.get(ORG_KEY))[ORG_KEY];
  if (stored) return stored;
  const orgs = await api('/organizations');
  const org = orgs.find((o) => o.capabilities?.includes('chat')) ?? orgs[0];
  await chrome.storage.local.set({ [ORG_KEY]: org.uuid });
  return org.uuid;
}

/** Pure: extract the text of the last assistant message. Exported for tests. */
export function lastAssistantText(full) {
  const msgs = full.chat_messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender === 'assistant') return msgs[i].text ?? '';
  }
  return '';
}

export const claudeAdapter = {
  id: 'claude',
  label: 'Claude',
  capabilities: { star: true },

  conversationUrl(id) {
    return `https://claude.ai/chat/${id}`;
  },

  /** Recent conversations as normalized summaries. */
  async list() {
    const orgId = await getOrgId();
    const convos = await api(`/organizations/${orgId}/chat_conversations?limit=${LIST_LIMIT}`);
    return convos
      .filter((c) => !c.is_temporary)
      .map((c) => ({ id: c.uuid, name: c.name, updatedAt: c.updated_at, isStarred: c.is_starred }));
  },

  /** One conversation, normalized, with the last assistant message's text. */
  async get(id) {
    const orgId = await getOrgId();
    const full = await api(`/organizations/${orgId}/chat_conversations/${id}`);
    return {
      id: full.uuid,
      name: full.name,
      isStarred: full.is_starred,
      updatedAt: full.updated_at,
      isTemporary: !!full.is_temporary,
      lastAssistantText: lastAssistantText(full),
    };
  },

  async rename(id, name) {
    const orgId = await getOrgId();
    await api(`/organizations/${orgId}/chat_conversations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async setStarred(id, isStarred) {
    const orgId = await getOrgId();
    await api(`/organizations/${orgId}/chat_conversations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_starred: isStarred }),
    });
  },
};
