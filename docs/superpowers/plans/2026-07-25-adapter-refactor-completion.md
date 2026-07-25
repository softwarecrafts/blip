# Adapter Refactor Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the in-flight service/DOM adapter refactor as a behaviour-preserving Claude-only patch release, with a zero-dependency test suite covering the parts that can break real users.

**Architecture:** Extract the orchestration half of `background.js` into `extension/lib/orchestrator.js` behind a `createOrchestrator({ adapters })` factory, leaving `background.js` as thin Chrome event wiring. Tests assign a fake `globalThis.chrome` and inject fake adapters through that one seam. No second platform lands; the `settings.platforms` data model ships while its Options UI is deferred.

**Tech Stack:** Vanilla ES modules, Chrome MV3 (service worker `"type": "module"`), Node's built-in `node --test` runner. No dependencies, no build step.

## Global Constraints

- **Zero runtime dependencies.** `package.json` contains only `name`, `private`, `type`, `engines`, and a `test` script. No `node_modules` is ever installed or committed.
- **Node ≥ 20** for `node --test <dir>` directory discovery. Local machine is v23.10.0.
- **Behaviour-preserving.** No user-visible change ships in this release. If a test reveals a genuine defect, fix it in commit 2 and note it — do not silently change behaviour in commit 1.
- **User-facing copy uses "blip", never "contact".** (Existing repo convention; the `#e23f33` badge colour comment currently reads `// contact-red` in code, which is an internal comment and stays as-is.)
- **All work commits directly to `main`.** Do not create a branch.
- **Three commits exactly**, in the order given by Tasks 1, 4, and 5.
- Console log prefix stays `[bliptracker:<adapterId>]`.
- Badge colours: waiting `#e23f33`, failure `#777`.

---

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `extension/lib/orchestrator.js` | Create | All platform-agnostic orchestration: `applyStatus`, `loadSeen`, `checkConversation`, `listWaiting`, `sweep`. Exposed via `createOrchestrator({ adapters })`. |
| `extension/background.js` | Modify (shrink to ~45 lines) | Chrome event wiring only: install/startup/alarm/storage-change listeners, `resetAlarm`, and the `onMessage` router. |
| `extension/adapters/index.js` | Modify | `enabledAdapters(settings, registry = ADAPTERS)` — accept an injectable registry so the filter rule lives in one place. |
| `extension/options.html` | Modify | Remove the `Platforms` section. Keep the `Behaviour` heading and the `h2` style rule. |
| `extension/options.js` | Modify | Remove `platformClaude` field, its `init()` line, and its change listener. |
| `package.json` | Create | `test` script only. |
| `tests/helpers/chrome-stub.mjs` | Create | Fake `chrome.storage.local`, `chrome.action`, and inert listener registries. |
| `tests/helpers/fake-adapter.mjs` | Create | Configurable in-memory adapter that records calls. |
| `tests/classify.test.mjs` | Create | Marker matching. |
| `tests/titleTransform.test.mjs` | Create | Prefix policy and idempotence. |
| `tests/claude-adapter.test.mjs` | Create | `lastAssistantText` extraction. |
| `tests/orchestrator.test.mjs` | Create | Seen migration, namespacing, error isolation, badge states, convergence, capabilities, gating, pruning, `listWaiting` URLs. |
| `README.md` | Modify | Architecture / endpoints / development sections. |
| `ROADMAP.md` | Modify | Amend the platform-toggle line; record the latent temporary-conversation issue. |
| `extension/manifest.json` | Modify | Version `0.1.0` → `0.1.1`. |

**Ordering note.** Task 1 is a mechanical code move with no test of its own — its safety net is Tasks 2–4, which land immediately after. This ordering is deliberate and was approved: commit 1 must be a pure refactor so it can be reverted independently of the tests that describe it.

---

### Task 1: Extract the orchestrator and slim `background.js`

**Files:**
- Create: `extension/lib/orchestrator.js`
- Modify: `extension/background.js` (replace entirely)
- Modify: `extension/adapters/index.js:19-21`
- Modify: `extension/options.html:46-57`
- Modify: `extension/options.js:12`, `:28`, `:45-49`

**Interfaces:**
- Consumes: `ADAPTERS` and `enabledAdapters` from `extension/adapters/index.js`; `classify`, `titleTransform`, `getSettings` from `extension/lib/`.
- Produces: `createOrchestrator({ adapters }) -> { sweep, checkConversation, listWaiting }` and a named export `statusOf(conv)`. Tasks 2–4 import both from `extension/lib/orchestrator.js`.

- [ ] **Step 1: Make the adapter registry injectable**

In `extension/adapters/index.js`, replace the `enabledAdapters` function:

```js
/** Adapters the user has switched on (settings.platforms[id] === true). */
export function enabledAdapters(settings, registry = ADAPTERS) {
  return Object.values(registry).filter((a) => settings.platforms?.[a.id] === true);
}
```

- [ ] **Step 2: Create `extension/lib/orchestrator.js`**

```js
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
```

- [ ] **Step 3: Replace `extension/background.js` entirely**

```js
/**
 * background.js — Chrome event wiring.
 *
 * This file translates Chrome's event surface into orchestrator calls and
 * does nothing else. All classify/rename/sweep logic lives in
 * lib/orchestrator.js; all platform specifics live in adapters/*.
 */
import { getSettings } from './lib/settings.js';
import { createOrchestrator } from './lib/orchestrator.js';

const { sweep, checkConversation, listWaiting } = createOrchestrator();

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

// Recreate the alarm when the poll cadence (or any setting) changes.
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
    'check-conversation': () => checkConversation(msg.platform, msg.id).then((name) => ({ name })),
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
```

- [ ] **Step 4: Remove the Platforms section from `extension/options.html`**

Delete these lines (currently 46–57), leaving the `Enabled` row followed directly by `<h2>Behaviour</h2>`:

```html
    <h2>Platforms</h2>
    <div class="row">
      <div>
        <label for="platform-claude">Claude</label>
        <div class="desc">claude.ai — label chats from the 🔴 / ✅ markers Claude leaves.</div>
      </div>
      <div class="control"><input type="checkbox" id="platform-claude" /></div>
    </div>
    <p class="desc">
      More platforms (e.g. ChatGPT) are planned — each will request access only
      when you switch it on.
    </p>
```

Keep the `h2 { ... }` style rule added at line 27 — `<h2>Behaviour</h2>` still uses it.

- [ ] **Step 5: Remove the Platforms wiring from `extension/options.js`**

Three deletions:

1. Remove from the `fields` object: `  platformClaude: document.getElementById('platform-claude'),`
2. Remove from `init()`: `  fields.platformClaude.checked = s.platforms?.claude === true;`
3. Remove the whole listener:

```js
fields.platformClaude.addEventListener('change', async (e) => {
  const s = await getSettings();
  await setSettings({ platforms: { ...s.platforms, claude: e.target.checked } });
  flashSaved();
});
```

- [ ] **Step 6: Verify every module still parses**

Run:
```bash
cd extension && for f in background.js content.js popup.js options.js onboarding.js adapters/*.js lib/*.js; do node --check "$f" || echo "FAILED: $f"; done; cd ..
```
Expected: no `FAILED:` lines.

- [ ] **Step 7: Verify no orchestration logic was left behind in `background.js`**

Run:
```bash
grep -nE 'classify|titleTransform|applyStatus|loadSeen|adapter\.' extension/background.js
```
Expected: no output. `background.js` must not reference adapters or classification at all.

- [ ] **Step 8: Verify platform specifics are still confined to the Claude adapter**

Run:
```bash
grep -rln -e 'claude\.ai' -e 'chat_conversations' extension/
```
Expected exactly two paths: `extension/adapters/claude.js` and `extension/content.js` (the DOM adapter's host key). `background.js`, `lib/orchestrator.js`, and `popup.js` must not appear.

- [ ] **Step 9: Commit (commit 1 of 3)**

```bash
git add extension/adapters extension/background.js extension/content.js extension/lib extension/options.html extension/options.js extension/popup.js ROADMAP.md
git commit -m "refactor: split platform logic into service + DOM adapters

Service adapters (adapters/*.js) own endpoints, auth and parsing in the
worker; DOM adapters (content.js) own selectors in the page. Orchestration
moves to lib/orchestrator.js behind createOrchestrator({adapters}), leaving
background.js as Chrome event wiring. The seen cache is namespaced per
platform with a one-time migration from the old flat shape.

Behaviour-preserving: Claude remains the only platform. The settings.platforms
data model ships; its Options UI waits until a second platform exists.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LkzDNBmR9yK6Dd1Czsoh7f"
```

Verify `extension/adapters/` is tracked:
```bash
git ls-files extension/adapters
```
Expected: `extension/adapters/claude.js` and `extension/adapters/index.js`.

---

### Task 2: Test harness — `package.json` and helpers

**Files:**
- Create: `package.json`
- Create: `tests/helpers/chrome-stub.mjs`
- Create: `tests/helpers/fake-adapter.mjs`

**Interfaces:**
- Produces: `makeChromeStub({ settings, seen }) -> stub` where `stub.badge` is `{ text, color }` and `stub.store` is the raw backing object. `makeFakeAdapter(id, conversations, opts) -> adapter` where `adapter.calls` is `{ list: number, get: string[], rename: [id,name][], setStarred: [id,bool][] }`. Tasks 3 and 4 import both.
- Conversation fixture shape (used by every later task): `{ id, name, updatedAt, isStarred, isTemporary, lastAssistantText }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "bliptracker",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `tests/helpers/chrome-stub.mjs`**

```js
/**
 * Minimal fake of the chrome APIs the orchestrator touches.
 *
 * The orchestrator reads chrome.storage.local (settings + seen cache) and
 * writes chrome.action (badge). Everything else exists only so that importing
 * a module which registers listeners doesn't throw.
 *
 * Usage: globalThis.chrome = makeChromeStub({ settings: {...} }) BEFORE the
 * module under test is imported.
 */
export function makeChromeStub({ settings, seen } = {}) {
  const store = {};
  if (settings !== undefined) store.settings = settings;
  if (seen !== undefined) store.seen = seen;

  const badge = { text: null, color: null };
  const noop = { addListener() {} };

  return {
    store,
    badge,
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
          return { ...store };
        },
        async set(obj) {
          Object.assign(store, structuredClone(obj));
        },
      },
      onChanged: noop,
    },
    action: {
      setBadgeText({ text }) {
        badge.text = text;
      },
      setBadgeBackgroundColor({ color }) {
        badge.color = color;
      },
    },
    alarms: { create() {}, onAlarm: noop },
    runtime: {
      onInstalled: noop,
      onStartup: noop,
      onMessage: noop,
      getURL: (p) => p,
    },
    tabs: { create() {} },
  };
}
```

- [ ] **Step 3: Create `tests/helpers/fake-adapter.mjs`**

```js
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
```

- [ ] **Step 4: Verify the runner starts with zero tests**

Run: `npm test`
Expected: exits 0, reporting `# tests 0` (no test files exist yet). If it errors on the missing `tests/` glob, the helpers directory exists so this should not happen — investigate before continuing.

- [ ] **Step 5: No commit yet**

Task 2's files are committed together with Tasks 3 and 4 as commit 2. Continue to Task 3.

---

### Task 3: Pure-function tests

**Files:**
- Create: `tests/classify.test.mjs`
- Create: `tests/titleTransform.test.mjs`
- Create: `tests/claude-adapter.test.mjs`

**Interfaces:**
- Consumes: `classify` from `extension/lib/classify.js`; `titleTransform`, `stripPrefix` from `extension/lib/titleTransform.js`; `lastAssistantText` from `extension/adapters/claude.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `tests/classify.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../extension/lib/classify.js';

test('classify: 🔴 marker -> waiting', () => {
  assert.equal(classify('Some reply.\n\n🔴 Waiting on you: pick a name'), 'waiting');
});

test('classify: ✅ marker -> resolved', () => {
  assert.equal(classify('All done.\n\n✅ Resolved — safe to archive this chat.'), 'resolved');
});

test('classify: no marker -> null', () => {
  assert.equal(classify('Just a normal reply with no status line.'), null);
});

test('classify: empty or missing text -> null', () => {
  assert.equal(classify(''), null);
  assert.equal(classify(undefined), null);
});

test('classify: tolerates trailing artifacts after the marker', () => {
  const text = 'Reply.\n\n🔴 Waiting on you: decide\n\nEdit\nRetry';
  assert.equal(classify(text), 'waiting');
});

test('classify: reads the LAST marker when a reply quotes an earlier one', () => {
  const text = '🔴 Waiting on you: old\n\nActually done now.\n\n✅ Resolved — safe to archive this chat.';
  assert.equal(classify(text), 'resolved');
});
```

- [ ] **Step 2: Write `tests/titleTransform.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { titleTransform, stripPrefix } from '../extension/lib/titleTransform.js';

test('titleTransform: null status leaves the title untouched', () => {
  assert.equal(titleTransform('Plan the launch', null), 'Plan the launch');
  assert.equal(titleTransform('🔴 Plan the launch', null), '🔴 Plan the launch');
});

test('titleTransform: adds the waiting prefix', () => {
  assert.equal(titleTransform('Plan the launch', 'waiting'), '🔴 Plan the launch');
});

test('titleTransform: adds the resolved prefix', () => {
  assert.equal(titleTransform('Plan the launch', 'resolved'), '✅ Plan the launch');
});

test('titleTransform: swaps an existing prefix rather than stacking', () => {
  assert.equal(titleTransform('🔴 Plan the launch', 'resolved'), '✅ Plan the launch');
  assert.equal(titleTransform('✅ Plan the launch', 'waiting'), '🔴 Plan the launch');
});

test('titleTransform: is idempotent (the sweep depends on this)', () => {
  for (const status of ['waiting', 'resolved']) {
    const once = titleTransform('Plan the launch', status);
    assert.equal(titleTransform(once, status), once);
  }
});

test('stripPrefix: removes stacked prefixes left by any earlier bug', () => {
  assert.equal(stripPrefix('🔴 ✅ 🔴 Plan the launch'), 'Plan the launch');
});
```

- [ ] **Step 3: Write `tests/claude-adapter.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { lastAssistantText } from '../extension/adapters/claude.js';

test('lastAssistantText: returns the final assistant message', () => {
  const full = {
    chat_messages: [
      { sender: 'assistant', text: 'first' },
      { sender: 'human', text: 'a question' },
      { sender: 'assistant', text: 'second' },
    ],
  };
  assert.equal(lastAssistantText(full), 'second');
});

test('lastAssistantText: ignores a trailing human turn', () => {
  const full = {
    chat_messages: [
      { sender: 'assistant', text: 'the answer' },
      { sender: 'human', text: 'thanks' },
    ],
  };
  assert.equal(lastAssistantText(full), 'the answer');
});

test('lastAssistantText: missing chat_messages -> empty string', () => {
  assert.equal(lastAssistantText({}), '');
});

test('lastAssistantText: no assistant turns -> empty string', () => {
  assert.equal(lastAssistantText({ chat_messages: [{ sender: 'human', text: 'hi' }] }), '');
});

test('lastAssistantText: assistant message with no text field -> empty string', () => {
  assert.equal(lastAssistantText({ chat_messages: [{ sender: 'assistant' }] }), '');
});
```

- [ ] **Step 4: Run the pure-function tests**

Run: `npm test`
Expected: all tests in these three files PASS. `extension/adapters/claude.js` imports nothing that touches `chrome` at module scope, so no stub is needed here.

If `lastAssistantText` is not exported, add `export` to it in `extension/adapters/claude.js` — the plan assumes the existing `export function lastAssistantText` stays.

- [ ] **Step 5: No commit yet**

Continue to Task 4; these files commit together as commit 2.

---

### Task 4: Orchestrator tests

**Files:**
- Create: `tests/orchestrator.test.mjs`

**Interfaces:**
- Consumes: `makeChromeStub` from `tests/helpers/chrome-stub.mjs`; `makeFakeAdapter`, `conv` from `tests/helpers/fake-adapter.mjs`; `createOrchestrator` from `extension/lib/orchestrator.js`.
- Produces: nothing consumed by later tasks.

**Note on module import order.** `extension/lib/settings.js` calls `chrome.storage.local` at *call* time, not import time, so a dynamic `await import()` after assigning `globalThis.chrome` is not strictly required. A static top-level import is used for readability; each test assigns a fresh `globalThis.chrome` before invoking the orchestrator.

- [ ] **Step 1: Write `tests/orchestrator.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChromeStub } from './helpers/chrome-stub.mjs';
import { makeFakeAdapter, conv } from './helpers/fake-adapter.mjs';
import { createOrchestrator } from '../extension/lib/orchestrator.js';

const WAITING = '🔴 Waiting on you: your move';
const RESOLVED = '✅ Resolved — safe to archive this chat.';

/** Settings with every platform in `ids` switched on. */
function settings(ids, extra = {}) {
  return {
    enabled: true,
    mirrorStar: false,
    pollMinutes: 10,
    platforms: Object.fromEntries(ids.map((id) => [id, true])),
    ...extra,
  };
}

// ── seen-cache migration ────────────────────────────────────────────────────

test('sweep: discards the old flat seen shape', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat one')]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { c1: '2026-07-01T00:00:00Z' }, // old flat shape: string values
  });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.deepEqual(Object.keys(chrome.store.seen), ['claude']);
  assert.equal(a.calls.get.length, 1, 'migration must force a re-check');
});

test('sweep: preserves an existing namespaced seen shape', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat one')]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { c1: '2026-07-01T00:00:00Z' } },
  });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(a.calls.get.length, 0, 'unchanged conversation must not be re-fetched');
});

test('sweep: namespaces seen per platform', async () => {
  const a = makeFakeAdapter('alpha', [conv('x1', 'Alpha chat')]);
  const b = makeFakeAdapter('beta', [conv('y1', 'Beta chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['alpha', 'beta']) });
  await createOrchestrator({ adapters: { alpha: a, beta: b } }).sweep();

  assert.deepEqual(Object.keys(chrome.store.seen).sort(), ['alpha', 'beta']);
  assert.deepEqual(Object.keys(chrome.store.seen.alpha), ['x1']);
  assert.deepEqual(Object.keys(chrome.store.seen.beta), ['y1']);
});

// ── error isolation and badge states ────────────────────────────────────────

test('sweep: one adapter failing does not stop the others', async () => {
  const bad = makeFakeAdapter('alpha', [conv('x1', 'Alpha')], { listThrows: true });
  const good = makeFakeAdapter('beta', [conv('y1', WAITING + ' chat')]);
  good.calls.list = 0;
  globalThis.chrome = makeChromeStub({ settings: settings(['alpha', 'beta']) });
  await createOrchestrator({ adapters: { alpha: bad, beta: good } }).sweep();

  assert.equal(good.calls.list, 1, 'healthy adapter still swept');
  assert.equal(chrome.badge.color, '#e23f33', 'partial failure is not the failure badge');
});

test('sweep: every adapter failing shows the failure badge', async () => {
  const bad = makeFakeAdapter('claude', [conv('c1', 'Chat')], { listThrows: true });
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: bad } }).sweep();

  assert.equal(chrome.badge.text, '!');
  assert.equal(chrome.badge.color, '#777');
});

test('sweep: zero enabled platforms clears the badge, not an error state', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings([]) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '');
  assert.notEqual(chrome.badge.color, '#777');
  assert.equal(a.calls.list, 0);
});

test('sweep: master switch off touches nothing', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude'], { enabled: false }) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '');
  assert.equal(a.calls.list, 0);
  assert.equal(a.calls.get.length, 0);
});

test('sweep: badge counts waiting chats', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'One', { lastAssistantText: WAITING }),
    conv('c2', 'Two', { lastAssistantText: RESOLVED }),
    conv('c3', 'Three', { lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.equal(chrome.badge.text, '2');
});

// ── rename behaviour ────────────────────────────────────────────────────────

test('sweep: renames a waiting chat and converges on the second pass', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Plan the launch', { lastAssistantText: WAITING })]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a } });

  await o.sweep();
  assert.deepEqual(a.calls.rename, [['c1', '🔴 Plan the launch']]);

  await o.sweep();
  assert.equal(a.calls.rename.length, 1, 'second sweep must not rename again');
});

test('sweep: a chat with no marker is never renamed', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Plan the launch', { lastAssistantText: 'no marker here' })]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  await createOrchestrator({ adapters: { claude: a } }).sweep();

  assert.deepEqual(a.calls.rename, []);
});

test('sweep: mirrorStar is skipped when the adapter lacks the capability', async () => {
  const withStar = makeFakeAdapter('alpha', [conv('x1', 'A', { lastAssistantText: WAITING })]);
  const noStar = makeFakeAdapter('beta', [conv('y1', 'B', { lastAssistantText: WAITING })], {
    capabilities: {},
  });
  globalThis.chrome = makeChromeStub({
    settings: settings(['alpha', 'beta'], { mirrorStar: true }),
  });
  await createOrchestrator({ adapters: { alpha: withStar, beta: noStar } }).sweep();

  assert.deepEqual(withStar.calls.setStarred, [['x1', true]]);
  assert.deepEqual(noStar.calls.setStarred, []);
});

// ── seen pruning ────────────────────────────────────────────────────────────

test('sweep: prunes seen entries for chats that left the list window', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'One'), conv('c2', 'Two')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const o = createOrchestrator({ adapters: { claude: a } });

  await o.sweep();
  assert.deepEqual(Object.keys(chrome.store.seen.claude).sort(), ['c1', 'c2']);

  a.drop('c2');
  await o.sweep();
  assert.deepEqual(Object.keys(chrome.store.seen.claude), ['c1']);
});

// ── checkConversation ───────────────────────────────────────────────────────

test('checkConversation: returns null and calls nothing for a disabled platform', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings([]) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation('claude', 'c1');

  assert.equal(name, null);
  assert.equal(a.calls.get.length, 0);
});

test('checkConversation: returns null for an unknown platform', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Chat')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude', 'ghost']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation('ghost', 'c1');

  assert.equal(name, null);
});

test('checkConversation: renames and records the chat in seen', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', 'Plan', { lastAssistantText: WAITING })]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation('claude', 'c1');

  assert.equal(name, '🔴 Plan');
  assert.deepEqual(Object.keys(chrome.store.seen.claude), ['c1']);
});

test('checkConversation: leaves a temporary chat completely alone', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Temp', { isTemporary: true, lastAssistantText: WAITING }),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const name = await createOrchestrator({ adapters: { claude: a } }).checkConversation('claude', 'c1');

  assert.equal(name, 'Temp');
  assert.deepEqual(a.calls.rename, []);
});

// ── listWaiting ─────────────────────────────────────────────────────────────

test('listWaiting: returns only 🔴 chats, with adapter-supplied URLs', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', '🔴 Waiting one'),
    conv('c2', '✅ Done'),
    conv('c3', 'Untouched'),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const { waiting } = await createOrchestrator({ adapters: { claude: a } }).listWaiting();

  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, 'c1');
  assert.equal(waiting[0].url, 'https://claude.test/chat/c1');
  assert.equal(waiting[0].platform, 'claude');
});

test('listWaiting: master switch off returns an empty queue', async () => {
  const a = makeFakeAdapter('claude', [conv('c1', '🔴 Waiting one')]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude'], { enabled: false }) });
  const { waiting } = await createOrchestrator({ adapters: { claude: a } }).listWaiting();

  assert.deepEqual(waiting, []);
  assert.equal(a.calls.list, 0);
});

test('listWaiting: a failing adapter yields an empty queue, not a throw', async () => {
  const bad = makeFakeAdapter('claude', [conv('c1', '🔴 Waiting')], { listThrows: true });
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });
  const { waiting } = await createOrchestrator({ adapters: { claude: bad } }).listWaiting();

  assert.deepEqual(waiting, []);
});
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: every test passes.

If any test fails, it has found a real defect in the orchestrator, not a bad test. Fix the orchestrator (not the assertion) before continuing, and record the fix in the commit message for commit 2. The one deviation permitted: if `structuredClone` on the `seen` object trips over something, relax `chrome-stub.mjs` `set()` to `Object.assign(store, obj)` — the tests never mutate stored objects after writing them.

- [ ] **Step 3: Confirm the suite actually exercises the code**

Run:
```bash
node --test --experimental-test-coverage tests/ 2>&1 | grep -E 'orchestrator|classify|titleTransform|claude\.js'
```
Expected: `lib/orchestrator.js` shows meaningful line coverage (>80%). This is a sanity check that the stub isn't short-circuiting the code under test; it is not a gate to enforce going forward.

- [ ] **Step 4: Commit (commit 2 of 3)**

```bash
git add package.json tests
git commit -m "test: add zero-dep suite for orchestrator + adapters

Node's built-in runner, a ~50-line chrome stub and an in-memory fake
adapter — no dependencies, no build step. Covers the seen-cache migration
and per-platform namespacing, adapter error isolation and badge states,
rename convergence, capability gating for mirrorStar, seen pruning, and
the pure classify/titleTransform/lastAssistantText helpers.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LkzDNBmR9yK6Dd1Czsoh7f"
```

---

### Task 5: Documentation and release prep

**Files:**
- Modify: `README.md` (Architecture, Confirmed endpoints, Development sections)
- Modify: `ROADMAP.md`
- Modify: `extension/manifest.json:4`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Rewrite the README "Architecture" section**

Replace the existing four bullets with:

```markdown
## Architecture

Three layers, each with one job:

- **Orchestrator** (`extension/lib/orchestrator.js`) — platform-agnostic. Owns
  the sweep, the on-demand re-check, the `seen` cache and the badge. Knows only
  the adapter interface, never an endpoint.
- **Service adapters** (`extension/adapters/*.js`) — one per platform, running
  in the service worker. Own endpoints, auth and response parsing, and
  normalise everything to `{id, name, isStarred, updatedAt, lastAssistantText,
  isTemporary}`. Registered in `adapters/index.js`.
- **DOM adapters** (the `DOM_ADAPTERS` map in `extension/content.js`) — one
  entry per host, running in the page. Own selectors: `currentId(location)` and
  `titleNodes(id)`.

The split follows a process boundary, not just a file boundary: service
adapters need the worker's cookie context, DOM adapters need the page. That's
why `content.js` carries its own map rather than importing the registry.

Beyond the layering:

- **Two triggers, one brain.** `content.js` (instant, the chat you're viewing)
  and the alarm sweep (periodic, all chats incl. mobile-finished) both funnel
  through `checkConversation`/`applyStatus` in the orchestrator. No classify or
  rename logic is duplicated in the content script.
- **Idempotent renames.** Renaming bumps a chat's `updated_at`, so the next
  sweep re-checks it — `titleTransform()` is idempotent, so the re-check is a
  no-op. Convergence by design, no bookkeeping.
- **Best-effort DOM paint.** The instant sidebar update writes to the page's
  DOM; if React reverts it, the resulting mutation re-triggers our observer and
  we re-apply. The server-side rename is the source of truth regardless.
- **No backend.** All requests go directly to the platform with your own
  session; nothing is sent anywhere else. See [PRIVACY.md](PRIVACY.md).
```

- [ ] **Step 2: Scope the README endpoints table to the adapter**

Change the section heading and intro line from:

```markdown
## Confirmed endpoints (recon 2026-06-12)

All under `/api/organizations/{orgId}`:
```

to:

```markdown
## Confirmed endpoints (recon 2026-06-12)

Used only by the Claude service adapter (`extension/adapters/claude.js`); no
other module references them. All under `/api/organizations/{orgId}`:
```

- [ ] **Step 3: Update the README "Development" section**

Replace the section body with:

```markdown
Pure JS, no build step, no dependencies. Load `extension/` unpacked at
`chrome://extensions`.

Tests use Node's built-in runner (Node ≥ 20):

```sh
npm test          # node --test tests/
```

`tests/helpers/` holds a ~50-line `chrome` stub and an in-memory fake adapter,
so the orchestrator can be driven without a browser. Adding a platform means
writing a service adapter and a DOM adapter — see
[ROADMAP.md](ROADMAP.md#adding-a-platform-the-adapter-recipe).
```

- [ ] **Step 4: Amend `ROADMAP.md`**

In the "Decisions for the next platform (ChatGPT/Gemini)" list, replace the
explicit-toggles bullet with:

```markdown
- **Explicit per-platform toggles** in Options (`settings.platforms[id]`); new
  platforms default **off** until enabled. The data model shipped in 0.1.1; the
  Options UI is deliberately absent until there is a second platform to choose
  between (a lone Claude toggle would just duplicate the master switch).
```

Then add this bullet to the same list, recording the latent issue found while
writing the tests:

```markdown
- **Temporary chats must be filtered in `list()`**, as the Claude adapter does.
  The orchestrator skips a conversation whose `isTemporary` is true but does not
  record it in `seen`, so an adapter that surfaces temporary chats would refetch
  them on every sweep. Harmless today; fix the orchestrator if a future adapter
  can't filter them adapter-side.
```

- [ ] **Step 5: Bump the manifest version**

In `extension/manifest.json`, change `"version": "0.1.0"` to `"version": "0.1.1"`.

- [ ] **Step 6: Verify the release artifact would contain the adapters**

This is the single highest ship risk — the worker `import`s `adapters/`, so a
zip built from a stale file list ships a dead service worker to every existing
user.

```bash
rm -f bliptracker-0.1.1.zip
zip -r bliptracker-0.1.1.zip extension -x '*.DS_Store'
unzip -l bliptracker-0.1.1.zip | grep -E 'adapters/|orchestrator'
```
Expected: three lines — `extension/adapters/claude.js`, `extension/adapters/index.js`, `extension/lib/orchestrator.js`. If any is missing, stop and fix before shipping.

- [ ] **Step 7: Confirm the tests still pass and nothing is untracked**

```bash
npm test && git status --short
```
Expected: tests pass; `git status --short` shows only the Task 5 doc/manifest edits (the zip is covered by the `*.zip` gitignore rule).

- [ ] **Step 8: Commit (commit 3 of 3)**

```bash
git add README.md ROADMAP.md extension/manifest.json
git commit -m "docs: update README/ROADMAP for the adapter architecture

Rewrites Architecture as three layers (orchestrator / service adapters /
DOM adapters), scopes the endpoints table to the Claude adapter, and points
Development at npm test. Records the deferred Platforms UI and the latent
temporary-chat refetch issue against the next platform. Bumps to 0.1.1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LkzDNBmR9yK6Dd1Czsoh7f"
```

- [ ] **Step 9: Produce the manual smoke checklist**

Print this for the maintainer to run at `chrome://extensions` before submitting
to the Web Store. Do not attempt to automate it — loading an unpacked extension
cannot be driven from this session.

1. **Fresh install** — remove the extension, Load unpacked `extension/`. The
   onboarding tab opens. Visit claude.ai; a chat ending in a 🔴 marker gains the
   prefix within ~2s.
2. **Upgrade path** — before reloading, run this in the worker console to
   simulate an existing install's old cache:
   `chrome.storage.local.set({seen: {'some-uuid': '2026-06-01T00:00:00Z'}})`
   Reload the extension, trigger a sweep from the popup, and confirm no error
   appears in the worker console and `chrome.storage.local.get('seen')` now
   shows the `{claude: {...}}` shape.
3. **Master switch off** — Options → Enabled off. Sweep from the popup; badge
   clears and no chats are touched. Confirm the Options page shows no
   "Platforms" section.
4. **Network failure** — go offline, sweep. Badge turns grey `!`. Go back
   online, sweep. Badge returns to the red count.
5. **Popup links** — a 🔴 chat in the popup opens the correct conversation.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: module boundaries and the
test seam → Task 1; the test plan table → Tasks 3 and 4 (all eleven rows
covered); documentation changes → Task 5 Steps 1–4; release → Task 5 Steps 5–6
and 9; commit sequence → Tasks 1, 4, 5. The spec's "Options UI removal" detail
(all three pieces, keeping the `Behaviour` heading and `h2` rule) → Task 1
Steps 4–5. Non-goals are not implemented anywhere, as intended.

**Placeholder scan.** No TBD/TODO. Every code step contains complete runnable
code; every verification step names the exact command and expected output.

**Type consistency.** `createOrchestrator({ adapters })` returns
`{ sweep, checkConversation, listWaiting }` in Task 1 and is destructured that
way in Task 1 Step 3 and called that way throughout Task 4. `makeFakeAdapter`'s
`calls` shape declared in Task 2 matches every assertion in Task 4
(`calls.list` number, `calls.get` array, `calls.rename` / `calls.setStarred`
pair-arrays). `conv()`'s fixture fields match what the orchestrator reads
(`lastAssistantText`, `isTemporary`, `isStarred`, `updatedAt`).
`enabledAdapters(settings, registry)` is defined in Task 1 Step 1 and called
with two arguments in Task 1 Step 2.
