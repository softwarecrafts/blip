/**
 * content.js — instant active-chat update, platform-agnostic.
 *
 * Runs on every supported host (per manifest content_scripts). It picks the
 * matching DOM adapter for the current host, then runs one generic loop:
 *   1. notice the active conversation settled (reply finished / navigated),
 *   2. ask the worker to re-check it (tagging which platform),
 *   3. paint the returned title into the sidebar DOM.
 *
 * It owns no classify/rename logic. DOM selectors are deliberately defensive:
 * a missed paint just means you wait for the next sweep — never an error. The
 * server-side rename (done by the worker) is the source of truth.
 *
 * Adding a platform = add a host entry here (the DOM half) plus a service
 * adapter in adapters/ (the API half).
 */
const DOM_ADAPTERS = {
  'claude.ai': {
    id: 'claude',
    currentId() {
      const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
      return m ? m[1] : null;
    },
    titleNodes(id) {
      return document.querySelectorAll(`a[href*="/chat/${id}"]`);
    },
  },
};

function adapterForHost() {
  const host = location.host;
  for (const [domain, adapter] of Object.entries(DOM_ADAPTERS)) {
    if (host === domain || host.endsWith('.' + domain)) return adapter;
  }
  return null;
}

const adapter = adapterForHost();
const DEBOUNCE_MS = 1800;
let lastSignature = '';
let timer = null;

function signature(id) {
  const main = document.querySelector('main') || document.body;
  return `${id}:${main.innerText?.length ?? 0}`;
}

function scheduleCheck() {
  // Debounce: streaming fires constant mutations, so we only act ~1.8s after
  // the last one — once the reply (and its trailing marker) has settled.
  clearTimeout(timer);
  timer = setTimeout(runCheck, DEBOUNCE_MS);
}

async function runCheck() {
  const id = adapter.currentId();
  if (!id) return;
  const sig = signature(id);
  if (sig === lastSignature) return;
  lastSignature = sig;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'check-conversation',
      platform: adapter.id,
      id,
    });
    if (res?.ok && res.name) paint(id, res.name);
  } catch {
    // Worker asleep/reloading or context invalidated; the sweep is the backstop.
  }
}

function paint(id, name) {
  for (const link of adapter.titleNodes(id)) {
    // The title is almost always the longest text-only leaf inside the link
    // (timestamps, badges, icons are shorter). Pick that, defensively.
    const leaves = [...link.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent.trim()
    );
    const titleEl =
      leaves.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length)[0] || link;
    if (titleEl.textContent.trim() !== name) titleEl.textContent = name;
  }
}

if (adapter) {
  // React may re-render the sidebar and revert our paint; that same mutation
  // re-triggers this observer, so we re-apply (idempotently) until it sticks.
  new MutationObserver(scheduleCheck).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleCheck(); // initial load
}
