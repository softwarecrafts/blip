/**
 * content.js — runs on https://claude.ai/*
 *
 * Closes the lag between "Claude posts a 🔴/✅ reply" and "the sidebar title
 * updates." The background sweep is the cross-device backstop; this gives the
 * chat you're actively viewing a near-instant update without a navigation.
 *
 * It owns no classify/rename logic — it just:
 *   1. notices the active conversation settled (reply finished / navigated),
 *   2. asks the service worker to re-check that conversation,
 *   3. paints the returned title into the sidebar DOM.
 *
 * DOM selectors here are deliberately defensive: claude.ai markup changes, and
 * a missed paint only means you wait for the next navigation/sweep — never an
 * error. The server-side rename (done by the worker) is the source of truth.
 */
const UUID_RE = /\/chat\/([0-9a-f-]{36})/i;
const DEBOUNCE_MS = 1800;

function currentUuid() {
  const m = location.pathname.match(UUID_RE);
  return m ? m[1] : null;
}

// Coarse change signal: which chat + how much text is on screen. Changes when
// a reply lands or you navigate; stable while idle.
function signature(uuid) {
  const main = document.querySelector('main') || document.body;
  return `${uuid}:${main.innerText?.length ?? 0}`;
}

let lastSignature = '';
let timer = null;

function scheduleCheck() {
  // Debounce: streaming fires constant mutations, so we only act ~1.8s after
  // the last one — i.e. once the reply (and its trailing marker) has settled.
  clearTimeout(timer);
  timer = setTimeout(runCheck, DEBOUNCE_MS);
}

async function runCheck() {
  const uuid = currentUuid();
  if (!uuid) return;
  const sig = signature(uuid);
  if (sig === lastSignature) return;
  lastSignature = sig;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'check-conversation', uuid });
    if (res?.ok && res.name) paintSidebar(uuid, res.name);
  } catch {
    // Worker asleep/reloading, or extension context invalidated on reload.
    // The periodic sweep is the backstop; stay silent.
  }
}

function paintSidebar(uuid, name) {
  for (const link of document.querySelectorAll(`a[href*="/chat/${uuid}"]`)) {
    // The title is almost always the longest text-only leaf inside the link
    // (timestamps, badges and icons are shorter). Pick that, defensively.
    const leaves = [...link.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && el.textContent.trim()
    );
    const titleEl =
      leaves.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length)[0] || link;
    if (titleEl.textContent.trim() !== name) titleEl.textContent = name;
  }
}

// React may re-render the sidebar and revert our paint; that same mutation
// re-triggers this observer, so we re-apply (idempotently) until it sticks.
new MutationObserver(scheduleCheck).observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

scheduleCheck(); // initial load
