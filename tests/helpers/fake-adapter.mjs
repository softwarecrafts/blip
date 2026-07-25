/**
 * In-memory service adapter for orchestrator tests.
 *
 * Deliberately does NOT filter temporary conversations out of list() — the
 * real Claude adapter does, but the orchestrator must be tested against an
 * adapter that surfaces them, since that is what a future adapter might do.
 *
 * rename() bumps updatedAt the way the real API does, so convergence
 * (rename -> updated_at changes -> re-check -> no-op) is observable.
 */
export function makeFakeAdapter(id, conversations, opts = {}) {
  const calls = { list: 0, get: [], rename: [], setStarred: [] };
  const state = new Map(conversations.map((c) => [c.id, { ...c }]));

  return {
    id,
    label: id,
    capabilities: opts.capabilities ?? { star: true },
    calls,

    conversationUrl(cid) {
      return `https://${id}.test/chat/${cid}`;
    },

    async list() {
      calls.list++;
      if (opts.listThrows) throw new Error(`${id} list failed`);
      return [...state.values()].map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt,
        isStarred: c.isStarred,
      }));
    },

    async get(cid) {
      calls.get.push(cid);
      return { ...state.get(cid) };
    },

    async rename(cid, name) {
      calls.rename.push([cid, name]);
      const c = state.get(cid);
      c.name = name;
      c.updatedAt = `${c.updatedAt}+renamed`;
    },

    async setStarred(cid, isStarred) {
      calls.setStarred.push([cid, isStarred]);
      state.get(cid).isStarred = isStarred;
    },

    /** Test helper: drop a conversation from the list window. */
    drop(cid) {
      state.delete(cid);
    },
  };
}

/** Convenience fixture builder. */
export function conv(id, name, opts = {}) {
  return {
    id,
    name,
    updatedAt: opts.updatedAt ?? '2026-07-01T00:00:00Z',
    isStarred: opts.isStarred ?? false,
    isTemporary: opts.isTemporary ?? false,
    lastAssistantText: opts.lastAssistantText ?? '',
  };
}
