/**
 * Phase 0 recon for the claude.ai chat-status renamer.
 *
 * HOW TO RUN:
 *   1. Open https://claude.ai in Chrome (logged in).
 *   2. Open DevTools (Cmd+Option+J) -> Console tab.
 *   3. Paste this entire file and hit Enter.
 *   4. Follow the printed instructions, then run: copyRecon()
 *      and paste the clipboard contents back into Claude Code.
 *
 * It is read-only except for the fetch spy, which only OBSERVES requests
 * that the claude.ai UI itself makes. Nothing is renamed or deleted by
 * this script.
 */
(async () => {
  const recon = { probes: {}, observed: [] };
  window.__recon = recon;

  const probe = async (label, url) => {
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      recon.probes[label] = {
        url,
        status: res.status,
        // Capture shape, not full content: keys + a single sample item.
        shape: Array.isArray(body)
          ? { type: 'array', length: body.length, itemKeys: body[0] ? Object.keys(body[0]) : [] , sample: body[0] ?? null }
          : { type: typeof body, keys: body ? Object.keys(body) : [], sample: body },
      };
      console.log(`✓ ${label}: HTTP ${res.status}`, recon.probes[label].shape);
      return body;
    } catch (e) {
      recon.probes[label] = { url, error: String(e) };
      console.warn(`✗ ${label} failed:`, e);
      return null;
    }
  };

  // --- Step 1: read probes -------------------------------------------------
  const orgs = await probe('organizations', '/api/organizations');
  const orgId = Array.isArray(orgs) ? (orgs.find(o => !o.name?.includes('api')) ?? orgs[0])?.uuid : null;
  recon.orgId = orgId;
  if (!orgId) { console.error('No org id found — stopping. Run copyRecon() and report back.'); }

  const convos = orgId
    ? await probe('conversation-list', `/api/organizations/${orgId}/chat_conversations?limit=30`)
    : null;

  const list = Array.isArray(convos) ? convos : convos?.data ?? convos?.conversations ?? [];
  const firstId = list[0]?.uuid ?? list[0]?.id;
  if (firstId) {
    await probe('single-conversation', `/api/organizations/${orgId}/chat_conversations/${firstId}`);
  }

  // --- Step 2: fetch spy ---------------------------------------------------
  // Wraps window.fetch so we can see the exact request the UI sends when YOU
  // rename / archive / delete a chat. Reload the page to remove the spy.
  const origFetch = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET').toUpperCase();
    if (method !== 'GET' && url.includes('/api/')) {
      const entry = { method, url, body: init.body ?? null };
      recon.observed.push(entry);
      console.log('👁 captured mutation:', entry);
    }
    return origFetch(input, init);
  };

  window.copyRecon = () => {
    const out = JSON.stringify(recon, null, 2);
    copy(out); // DevTools built-in: puts it on the clipboard
    console.log('Recon JSON copied to clipboard — paste it to Claude Code.');
  };

  console.log(
    '%cRecon armed. Now, IN THE claude.ai UI:\n' +
    '  1. Rename any chat (use a throwaway one)\n' +
    '  2. Archive a chat (if the option exists)\n' +
    '  3. Optionally delete a throwaway chat\n' +
    'Each action will print a "captured mutation" line.\n' +
    'When done, run: copyRecon()',
    'font-weight:bold'
  );
})();
