# History Pagination + Brand Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep the full claude.ai conversation history so a 🔴 chat never falls out of the popup queue, the badge, or its snooze; and render the three extension pages in the bliptracker type system from locally bundled fonts.

**Architecture:** Pagination is confined to the Claude service adapter — a new pure `lib/paginate.js` walks `offset` pages until a short page, and `adapters/claude.js` calls it, so `list()` keeps its no-arg signature and the adapter interface is unchanged. The resulting wider window would otherwise trigger a ~137-conversation `get()` stampede on the first sweep, so `lib/orchestrator.js` gains one positional rule: a never-seen chat below `SEED_DEPTH` is recorded in `seen` rather than fetched, which is safe because the list is `updated_at`-descending and a reply lifts a chat to position 0. The fonts are eight local woff2 files behind a new shared `extension/ui/brand.css`.

**Tech Stack:** Vanilla ES modules, Chrome MV3 (service worker `"type": "module"`), Node's built-in `node --test` runner, `curl` + `bash` for the one-off font fetch. No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-07-26-pagination-and-brand-fonts-design.md`

## Global Constraints

- **Zero runtime dependencies.** `package.json` gains nothing. No `node_modules` is ever installed or committed.
- **No build step.** `scripts/fetch-fonts.sh` is run once by hand; its output is committed.
- **Node ≥ 20** for `node --test`.
- **All work commits directly to `main`.** Do not create a branch.
- **User-facing copy uses "blip", never "contact."**
- Console log prefix stays `[bliptracker:<adapterId>]`.
- Badge colours are unchanged: waiting `#e23f33`, failure `#777`.
- `adapter.list()` keeps its **no-argument signature**. Pagination is an implementation detail of the Claude adapter; `lib/orchestrator.js` and `adapters/index.js` must not learn about pages.
- Run `npm test` before every commit. It must pass.

**Commit granularity.** The spec proposes three commits. This plan commits per task (six). That preserves the spec's actual requirement — the pagination work (Tasks 1–3) and the font work (Tasks 4–6) stay independently revertible along the same seam — while keeping each commit small enough to review.

---

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `extension/lib/paginate.js` | Create | Pure offset-walker with an injected page fetcher. Knows nothing about claude.ai, `fetch`, or `chrome`. |
| `tests/paginate.test.mjs` | Create | Drives `paginate()` with a fake page source. |
| `extension/adapters/claude.js` | Modify | `list()` walks pages via `paginate()`. Still the only file that knows a claude.ai URL. |
| `extension/lib/orchestrator.js` | Modify | Adds `SEED_DEPTH` and the record-don't-fetch rule inside `sweep()`'s list loop. |
| `tests/orchestrator.test.mjs` | Modify | Four cases for the seed-depth rule. |
| `README.md` | Modify | Endpoint table documents `offset`. |
| `extension/manifest.json` | Modify | Version `0.2.0` → `0.3.0`. |
| `scripts/fetch-fonts.sh` | Create | Downloads the eight latin-subset woff2 + three OFL licences. Provenance record; run once. |
| `extension/fonts/` | Create | Eight committed woff2 files + three `OFL-*.txt`. |
| `extension/ui/brand.css` | Create | The eight `@font-face` rules, the three type tokens, and base typography. |
| `extension/onboarding.html` | Modify | Links `ui/brand.css`; body/heading/textarea families use the tokens. |
| `extension/options.html` | Modify | Links `ui/brand.css`; body/heading/number-input families use the tokens. |
| `extension/popup.html` | Modify | Links `ui/brand.css`, preloads two faces; body/heading/count/wake families use the tokens. |
| `ROADMAP.md` | Modify | Both items move from "Future features" to "Shipped". |

---

## Task 1: The pure offset-walker

**Files:**
- Create: `extension/lib/paginate.js`
- Test: `tests/paginate.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `paginate(fetchPage, { pageSize, maxPages })` → `Promise<Array>`. `fetchPage` is called as `fetchPage({ offset, limit })` and must resolve to an array. Returns every item from every page, concatenated in order.

- [ ] **Step 1: Write the failing test**

Create `tests/paginate.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../extension/lib/paginate.js';

/**
 * Fake page source over a fixed array, recording the calls it received.
 * Mirrors the real endpoint: slicing past the end yields a short/empty page.
 */
function pageSource(items) {
  const calls = [];
  return {
    calls,
    fetchPage: async ({ offset, limit }) => {
      calls.push({ offset, limit });
      return items.slice(offset, offset + limit);
    },
  };
}

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

test('paginate: stops at the first short page', async () => {
  const src = pageSource(items(187));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 187);
  assert.equal(out[0].id, 'c0');
  assert.equal(out[186].id, 'c186');
  assert.deepEqual(src.calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
  ]);
});

test('paginate: an exactly-full final page costs one extra empty request', async () => {
  // The endpoint gives no total, so a full last page is indistinguishable from
  // "more to come" — the walker MUST ask again and stop on the empty page.
  const src = pageSource(items(200));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 200);
  assert.equal(src.calls.length, 3);
  assert.deepEqual(src.calls[2], { offset: 200, limit: 100 });
});

test('paginate: a single short page issues exactly one request', async () => {
  const src = pageSource(items(12));
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.equal(out.length, 12);
  assert.equal(src.calls.length, 1);
});

test('paginate: an empty first page returns empty and stops', async () => {
  const src = pageSource([]);
  const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 20 });

  assert.deepEqual(out, []);
  assert.equal(src.calls.length, 1);
});

test('paginate: respects maxPages and warns when the cap is hit', async () => {
  const src = pageSource(items(1000));
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const out = await paginate(src.fetchPage, { pageSize: 100, maxPages: 3 });
    assert.equal(out.length, 300);
    assert.equal(src.calls.length, 3);
  } finally {
    console.warn = realWarn;
  }
  // The cap silently truncating history would be invisible in production.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /page cap/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../extension/lib/paginate.js'`

- [ ] **Step 3: Write the implementation**

Create `extension/lib/paginate.js`:

```js
/**
 * Walk an offset-paged endpoint until it runs out.
 *
 * Pure and I/O-free: the caller injects `fetchPage`, so this is testable
 * without stubbing `fetch` or `chrome`. Same split as classify/titleTransform/
 * snooze — real logic here, the I/O boundary in the adapter.
 *
 * STOP CONDITIONS, in order:
 *  1. A page shorter than `pageSize`. Confirmed by recon (2026-07-26) to be
 *     the endpoint's clean end-of-list signal: past the end it returns [],
 *     not an error. A page that is exactly full is indistinguishable from
 *     "more to come", so a full final page costs one extra empty request.
 *  2. `maxPages`. A runaway guard, not a feature — if the endpoint ever stops
 *     short-paging, an unguarded loop would hammer it forever. It warns rather
 *     than throwing, so a truncated history degrades to the old narrow-window
 *     behaviour instead of breaking the sweep.
 *
 * @param {(p: {offset: number, limit: number}) => Promise<Array>} fetchPage
 * @param {{pageSize: number, maxPages: number}} opts
 * @returns {Promise<Array>} every item from every page, in order
 */
export async function paginate(fetchPage, { pageSize, maxPages }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage({ offset: page * pageSize, limit: pageSize });
    out.push(...batch);
    if (batch.length < pageSize) return out;
  }
  console.warn(`[bliptracker] page cap hit at ${maxPages} pages — history may be truncated`);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 `paginate` tests green, and the pre-existing suites still green.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/paginate.js tests/paginate.test.mjs
git commit -m "feat: add a pure offset-paginate helper

Injected page-fetcher so the walk is testable without stubbing fetch or
chrome. Stops on a short page (the endpoint's confirmed end-of-list signal)
with a maxPages runaway guard that warns rather than throwing."
```

---

## Task 2: Paginate the Claude adapter

**Files:**
- Modify: `extension/adapters/claude.js:16` (the `LIST_LIMIT` constant) and `:56-63` (`list()`)
- Modify: `README.md:121` (endpoint table)
- Modify: `extension/manifest.json:4` (version)

**Interfaces:**
- Consumes: `paginate(fetchPage, { pageSize, maxPages })` from Task 1.
- Produces: no signature change. `claudeAdapter.list()` still takes no arguments and still resolves to `Array<{id, name, updatedAt, isStarred}>`.

- [ ] **Step 1: Replace the limit constant**

In `extension/adapters/claude.js`, delete the line `const LIST_LIMIT = 50;` and put in its place:

```js
// Page size is deliberately well below the observed ceiling: at 187
// conversations this takes two requests, so the paging path runs on every real
// sweep instead of lying dormant until someone crosses 1000 and finds out it
// never worked. Recon (2026-07-26) saw no server-side cap below limit=1000.
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // runaway guard: 2000 conversations
```

- [ ] **Step 2: Add the import**

At the top of `extension/adapters/claude.js`, below the existing docblock, add to the imports:

```js
import { paginate } from '../lib/paginate.js';
```

(The file currently has no imports; this becomes its first one, placed immediately after the closing `*/` of the header comment and before `const API = ...`.)

- [ ] **Step 3: Rewrite `list()`**

Replace the whole `async list()` method with:

```js
  /**
   * Recent conversations as normalized summaries.
   *
   * Walks the full history rather than a fixed window: a 🔴 chat that drifts
   * below the window would otherwise vanish from the popup queue and the badge
   * and lose its snooze. `offset` paging confirmed by recon 2026-07-26.
   */
  async list() {
    const orgId = await getOrgId();
    const convos = await paginate(
      ({ offset, limit }) =>
        api(`/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`),
      { pageSize: PAGE_SIZE, maxPages: MAX_PAGES }
    );
    return convos
      .filter((c) => !c.is_temporary)
      .map((c) => ({ id: c.uuid, name: c.name, updatedAt: c.updated_at, isStarred: c.is_starred }));
  },
```

- [ ] **Step 4: Update the docblock endpoint list**

In the header comment of `extension/adapters/claude.js`, change the line:

```
 *   GET  /api/organizations/{org}/chat_conversations?limit=N
```

to:

```
 *   GET  /api/organizations/{org}/chat_conversations?limit=N&offset=M
```

- [ ] **Step 5: Update the README endpoint table**

In `README.md`, change the row:

```
| GET | `/chat_conversations?limit=N` | list (incl. `updated_at`, `is_starred`) |
```

to:

```
| GET | `/chat_conversations?limit=N&offset=M` | list, `updated_at` desc (incl. `is_starred`); a short page means end-of-list |
```

- [ ] **Step 6: Bump the version**

In `extension/manifest.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS. Nothing here is directly covered — `list()` talks to `fetch`, which the suite deliberately does not stub — so this step is a regression check that the new import did not break module loading.

- [ ] **Step 8: Verify the walk against the live API by hand**

Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → `extension/`), open the service worker console, and run:

```js
const { claudeAdapter } = await import('./adapters/claude.js');
const all = await claudeAdapter.list();
console.log(all.length, all.filter((c) => c.name.startsWith('🔴') || c.name.startsWith('💤🔴')).length);
```

Expected: roughly `187 19` (the recon numbers, allowing for drift since 2026-07-26). If the count comes back at 100 or 50, the paging is not working — stop and diagnose before committing.

- [ ] **Step 9: Commit**

```bash
git add extension/adapters/claude.js README.md extension/manifest.json
git commit -m "feat: sweep the full claude.ai history instead of the last 50

A 🔴 chat leaves the old 50-item window once 50 other chats are touched after
it, taking it off the popup queue and the badge and dropping its snooze. Recon
measured the live account at 187 conversations with the deepest 🔴 at index 42.

Paging stays inside the adapter, so list() keeps its no-arg signature."
```

---

## Task 3: Stop the first-sweep fetch stampede

**Files:**
- Modify: `extension/lib/orchestrator.js:31-32` (constants) and `:197-216` (the sweep's list loop)
- Test: `tests/orchestrator.test.mjs` (append a new section)

**Interfaces:**
- Consumes: `claudeAdapter.list()` from Task 2, now returning the full history.
- Produces: no exported signature change. `createOrchestrator({ adapters, snoozeStore })` is unchanged.

**Why this is required, not an optimisation.** `seen` is pruned to listed ids every sweep, so today it holds at most 50 entries. Widening the list to 187 makes the next sweep find ~137 conversations it has never seen and call `adapter.get()` on each — and `get()` pulls that chat's entire `chat_messages` array. Without this task, upgrading to Task 2 ships a multi-hundred-megabyte first sweep that classifies nothing (those chats have no marker, so `titleTransform` returns them unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `tests/orchestrator.test.mjs`. Note the file already defines `settings()`, `WAITING` and `RESOLVED` at the top and imports `makeChromeStub`, `makeFakeAdapter`, `conv`, `makeFakeSnoozeStore` and `createOrchestrator` — reuse those, do not redeclare them.

```js
// ── seed depth: never-seen chats below the depth are recorded, not fetched ──

/** N unmarked filler conversations, in list order. */
function filler(n) {
  return Array.from({ length: n }, (_, i) => conv(`f${i}`, `Filler ${i}`));
}

test('sweep: a never-seen chat below SEED_DEPTH is recorded without a get()', async () => {
  const deep = conv('deep', 'An old chat', { lastAssistantText: WAITING });
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.ok(!a.calls.get.includes('deep'), 'must not fetch a chat below the seed depth');
  assert.equal(chrome.store.seen.claude.deep, deep.updatedAt, 'must still be recorded as seen');
  assert.deepEqual(a.calls.rename, [], 'and must not be renamed');
});

test('sweep: a deep chat already titled 🔴 still counts toward the badge', async () => {
  const deep = conv('deep', '🔴 Old blip');
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.equal(chrome.badge.text, '1', 'skipping the fetch must not skip the count');
  assert.ok(!a.calls.get.includes('deep'));
});

test('sweep: a never-seen chat above SEED_DEPTH is still fetched and renamed', async () => {
  const a = makeFakeAdapter('claude', [
    conv('c1', 'Chat one', { lastAssistantText: WAITING }),
    ...filler(60),
  ]);
  globalThis.chrome = makeChromeStub({ settings: settings(['claude']) });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.deepEqual(a.calls.rename, [['c1', '🔴 Chat one']]);
});

test('sweep: a SEEN chat below SEED_DEPTH whose updatedAt changed is still fetched', async () => {
  // The rule keys off "never seen", not depth alone — a chat we are already
  // tracking must keep converging no matter how far it has drifted down.
  const deep = conv('deep', 'Old chat', { updatedAt: 'T2', lastAssistantText: WAITING });
  const a = makeFakeAdapter('claude', [...filler(50), deep]);
  globalThis.chrome = makeChromeStub({
    settings: settings(['claude']),
    seen: { claude: { deep: 'T1' } },
  });

  const { sweep } = createOrchestrator({
    adapters: { claude: a },
    snoozeStore: makeFakeSnoozeStore(),
  });
  await sweep();

  assert.ok(a.calls.get.includes('deep'));
  assert.deepEqual(a.calls.rename, [['deep', '🔴 Old chat']]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the first two new tests FAIL. Test 1 fails on `a.calls.get.includes('deep')` being true (the current code fetches everything unseen). Tests 3 and 4 pass already — they encode behaviour that must **not** regress.

- [ ] **Step 3: Add the constant**

In `extension/lib/orchestrator.js`, below the existing badge colour constants (`BADGE_WAITING` / `BADGE_FAILED`), add:

```js
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
```

- [ ] **Step 4: Make the sweep loop positional**

In `sweep()`, change the loop header from:

```js
          for (const c of list) {
```

to:

```js
          for (const [index, c] of list.entries()) {
```

- [ ] **Step 5: Add the record-don't-fetch branch**

Immediately after the `staleZzz` line, change:

```js
            if (seenP[c.id] !== c.updatedAt || staleZzz) {
```

to:

```js
            // A never-seen chat this far down cannot have a fresh marker (see
            // SEED_DEPTH). Record it so the next sweep treats it as converged,
            // rather than paying a full get() to learn nothing. staleZzz still
            // wins, so a title whose 💤 disagrees with the schedule is fixed
            // even if storage was cleared underneath it.
            if (!(c.id in seenP) && index >= SEED_DEPTH && !staleZzz) {
              seenP[c.id] = c.updatedAt;
            } else if (seenP[c.id] !== c.updatedAt || staleZzz) {
```

The body of that `else if` and everything after it is unchanged — in particular the `if (isWaitingTitle(name))` block still runs, which is what keeps the badge and the waiting set correct for skipped chats.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all four new tests green, and every pre-existing orchestrator test still green. Pay attention to the pre-existing `seen`-cache and snooze-pruning tests: if any of those broke, the branch is in the wrong place.

- [ ] **Step 7: Commit**

```bash
git add extension/lib/orchestrator.js tests/orchestrator.test.mjs
git commit -m "fix: don't fetch never-seen chats below the seed depth

Widening the list window to the full history would otherwise make the next
sweep get() ~137 conversations, each pulling its entire chat_messages array,
to classify chats that have no marker and will not be renamed.

The list is updated_at-descending and a reply lifts a chat to position 0, so a
never-seen chat below index 50 provably has not changed in weeks. Record it
instead. Its title still feeds the badge, the waiting set and snooze pruning."
```

---

## Task 4: Vendor the brand fonts

**Files:**
- Create: `scripts/fetch-fonts.sh`
- Create: `extension/fonts/` (8 × `.woff2`, 3 × `OFL-*.txt`)

**Interfaces:**
- Consumes: nothing.
- Produces: these exact filenames, which Task 5's `@font-face` rules reference:
  `chakra-petch-600.woff2`, `chakra-petch-600-italic.woff2`, `chakra-petch-700.woff2`,
  `hanken-grotesk-400.woff2`, `hanken-grotesk-400-italic.woff2`, `hanken-grotesk-600.woff2`,
  `jetbrains-mono-400.woff2`, `jetbrains-mono-700.woff2`.

- [ ] **Step 1: Write the fetch script**

Create `scripts/fetch-fonts.sh`:

```bash
#!/usr/bin/env bash
#
# Download the bliptracker brand faces into extension/fonts/.
#
# An extension cannot use the Google Fonts CDN the way landing/ does, so the
# files are bundled. This script exists for provenance and reproducibility —
# the .woff2 files are committed, so you do NOT need to run it to build or
# load the extension. Re-run it only to refresh or add a face.
#
# It asks the Google Fonts CSS API for one face at a time and pulls the woff2
# from the @font-face block whose unicode-range covers latin (U+0000-00FF),
# rather than hardcoding hashed URLs that rotate.
#
# Usage:  bash scripts/fetch-fonts.sh
set -euo pipefail

# A modern desktop UA is required — the CSS API serves ttf to unknown clients.
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
DEST="$(cd "$(dirname "$0")/.." && pwd)/extension/fonts"
mkdir -p "$DEST"

# family_query  weight  style  outfile
fetch_face() {
  local family=$1 weight=$2 style=$3 out=$4
  local ital=0
  [ "$style" = italic ] && ital=1
  local url="https://fonts.googleapis.com/css2?family=${family}:ital,wght@${ital},${weight}&display=swap"

  local css src
  css=$(curl -sfL -A "$UA" "$url")
  src=$(printf '%s\n' "$css" \
    | awk -v RS='}' '/U\+0000-00FF/ { print }' \
    | grep -o 'https://[^)]*\.woff2' \
    | head -1)

  if [ -z "$src" ]; then
    echo "FAILED: no latin woff2 found for ${family} ${weight} ${style}" >&2
    exit 1
  fi

  curl -sfL -o "${DEST}/${out}" "$src"
  printf '%-34s <- %s\n' "$out" "$src"
}

fetch_face 'Chakra+Petch'   600 normal chakra-petch-600.woff2
fetch_face 'Chakra+Petch'   600 italic chakra-petch-600-italic.woff2
fetch_face 'Chakra+Petch'   700 normal chakra-petch-700.woff2
fetch_face 'Hanken+Grotesk' 400 normal hanken-grotesk-400.woff2
fetch_face 'Hanken+Grotesk' 400 italic hanken-grotesk-400-italic.woff2
fetch_face 'Hanken+Grotesk' 600 normal hanken-grotesk-600.woff2
fetch_face 'JetBrains+Mono' 400 normal jetbrains-mono-400.woff2
fetch_face 'JetBrains+Mono' 700 normal jetbrains-mono-700.woff2

# All three families are OFL-1.1; shipping the fonts obliges shipping this.
fetch_ofl() {
  curl -sfL -o "${DEST}/OFL-$2.txt" \
    "https://raw.githubusercontent.com/google/fonts/main/ofl/$1/OFL.txt"
  printf '%-34s <- google/fonts/ofl/%s\n' "OFL-$2.txt" "$1"
}

fetch_ofl chakrapetch   Chakra-Petch
fetch_ofl hankengrotesk Hanken-Grotesk
fetch_ofl jetbrainsmono JetBrains-Mono

echo
echo "Done. ${DEST}"
ls -lh "$DEST"
```

- [ ] **Step 2: Run it**

Run: `bash scripts/fetch-fonts.sh`
Expected: eleven lines of `file <- url`, then a listing. Each woff2 should be roughly 15–30KB.

If a `fetch_ofl` call 404s, the family's directory name in `google/fonts` differs from the guess — find the right one at `https://github.com/google/fonts/tree/main/ofl` and fix the script before continuing. Do not skip the licence files; shipping OFL fonts without them is a licence violation.

- [ ] **Step 3: Verify the files are real woff2, not an error page**

Run:

```bash
cd /Users/andrew/src/claude-tasks/claude-chat-status
file extension/fonts/*.woff2
du -ch extension/fonts/*.woff2 | tail -1
head -3 extension/fonts/OFL-Chakra-Petch.txt
```

Expected: every woff2 reports `Web Open Font Format (Version 2)`; the total is roughly 120–200KB; the OFL file starts with a `Copyright` line. A woff2 of a few hundred bytes is an HTML error page — re-run Step 2.

- [ ] **Step 4: Confirm the italics are genuinely different files**

Run:

```bash
md5 extension/fonts/chakra-petch-600.woff2 extension/fonts/chakra-petch-600-italic.woff2
md5 extension/fonts/hanken-grotesk-400.woff2 extension/fonts/hanken-grotesk-400-italic.woff2
```

Expected: the two hashes in each pair differ. Identical hashes mean the `ital` axis was ignored and the upright face was downloaded twice — which would leave the browser synthesizing obliques, the exact failure the italics were added to prevent.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-fonts.sh extension/fonts/
git commit -m "chore: vendor the brand fonts for extension pages

Chakra Petch 600/600-italic/700, Hanken Grotesk 400/400-italic/600 and
JetBrains Mono 400/700, latin subset, plus the three OFL-1.1 licences an
extension shipping these is obliged to carry.

An extension cannot use the Google Fonts CDN that landing/ uses, so these are
bundled. fetch-fonts.sh records provenance; the files are committed, so it
never needs running to load or build the extension."
```

---

## Task 5: The shared stylesheet, onboarding and options

**Files:**
- Create: `extension/ui/brand.css`
- Modify: `extension/onboarding.html:6-45` (the `<style>` block) and `:3-6` (`<head>`)
- Modify: `extension/options.html:6-28` (the `<style>` block) and `:3-6` (`<head>`)

**Interfaces:**
- Consumes: the eight font filenames from Task 4.
- Produces: three CSS custom properties on `:root`, which Task 6 also uses:
  `--font-display`, `--font-body`, `--font-mono`.

**Cascade warning, read before starting.** All three pages set their body font with the `font:` *shorthand* (e.g. `font: 15px/1.6 -apple-system, system-ui, sans-serif`). The shorthand resets `font-family`, and the pages' inline `<style>` comes after the linked stylesheet, so it wins. Linking `brand.css` alone changes nothing — each page's own `font:` shorthand must be edited to use the token. That is why every page task below edits the `body` rule explicitly.

- [ ] **Step 1: Create the stylesheet**

Create `extension/ui/brand.css`:

```css
/**
 * bliptracker brand type system for extension pages.
 *
 * Linked by popup.html, options.html and onboarding.html. Mirrors the type
 * roles in landing/styles.css — Chakra Petch for uppercase display, Hanken
 * Grotesk for body, JetBrains Mono for data — but bundles the faces locally,
 * because an extension page cannot reach the Google Fonts CDN.
 *
 * TYPE ONLY. Colours, `color-scheme: light dark`, and every component style
 * stay in the pages themselves. This file must not introduce a colour.
 *
 * Tokens are deliberately NOT named --serif/--sans/--mono as landing/ does:
 * Chakra Petch under a `--serif` name is actively misleading, and nothing
 * shares a stylesheet between the two surfaces.
 *
 * Every stack keeps the previous system font as its tail, so a missing or
 * corrupt woff2 degrades to how these pages looked before, not to Times.
 */

/* Each italic face MUST declare font-style: italic. Omit it and the browser
   ignores the file and shears the upright face into a fake oblique instead —
   very visible in a squared-off techno face like Chakra Petch. */

@font-face {
  font-family: 'Chakra Petch';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('../fonts/chakra-petch-600.woff2') format('woff2');
}
@font-face {
  font-family: 'Chakra Petch';
  font-style: italic;
  font-weight: 600;
  font-display: swap;
  src: url('../fonts/chakra-petch-600-italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Chakra Petch';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/chakra-petch-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Hanken Grotesk';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/hanken-grotesk-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Hanken Grotesk';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/hanken-grotesk-400-italic.woff2') format('woff2');
}
@font-face {
  font-family: 'Hanken Grotesk';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('../fonts/hanken-grotesk-600.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('../fonts/jetbrains-mono-400.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('../fonts/jetbrains-mono-700.woff2') format('woff2');
}

:root {
  --font-display: 'Chakra Petch', system-ui, sans-serif;
  --font-body: 'Hanken Grotesk', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}

/* Base typography. Component styles stay with their page — the popup's
   borderless buttons and onboarding's bordered ones are genuinely different
   things and must not be merged into a shared primitive. */
h1, h2, h3 {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
em { font-style: italic; }
code, kbd, samp { font-family: var(--font-mono); }
```

- [ ] **Step 2: Link it from onboarding and switch the body font**

In `extension/onboarding.html`, add inside `<head>`, immediately before the `<style>` tag:

```html
    <link rel="stylesheet" href="ui/brand.css" />
```

Then in its `<style>` block change:

```css
        font: 15px/1.6 -apple-system, system-ui, sans-serif;
```

to:

```css
        font: 15px/1.6 var(--font-body);
```

and change the textarea rule from:

```css
        font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
```

to:

```css
        font: 13px/1.5 var(--font-mono);
```

and change:

```css
      code { font-family: ui-monospace, Menlo, monospace; }
```

to:

```css
      code { font-family: var(--font-mono); }
```

- [ ] **Step 3: Link it from options and switch the body font**

In `extension/options.html`, add inside `<head>`, immediately before the `<style>` tag:

```html
    <link rel="stylesheet" href="ui/brand.css" />
```

Then in its `<style>` block change:

```css
        font: 14px/1.5 -apple-system, system-ui, sans-serif;
```

to:

```css
        font: 14px/1.5 var(--font-body);
```

and change the number input rule from:

```css
      input[type='number'] { width: 56px; font: inherit; padding: 3px 6px; }
```

to:

```css
      input[type='number'] { width: 56px; font: inherit; font-family: var(--font-mono); padding: 3px 6px; }
```

Leave `options.html`'s existing `h2` rule alone — it already sets `text-transform: uppercase` and `letter-spacing: 0.05em`, and being later in the cascade its letter-spacing correctly overrides `brand.css`.

- [ ] **Step 4: Verify both pages visually**

Load the unpacked extension, then open both pages and check them in light **and** dark mode (macOS System Settings → Appearance, or DevTools → Rendering → "Emulate prefers-color-scheme"):

```
chrome-extension://<id>/onboarding.html
chrome-extension://<id>/options.html
```

Confirm:
- Headings render in Chakra Petch, uppercase. If they look like plain system sans, the font files did not load — check DevTools → Network for 404s on `../fonts/*.woff2`.
- Body text is Hanken Grotesk, noticeably rounder than the previous `-apple-system`.
- The onboarding preference-prompt textarea is JetBrains Mono, and the 🔴/✅ emoji inside it still render as colour emoji.
- The onboarding "Copy prompt" button still copies (`onboarding.js` is untouched, but the textarea rule changed).
- The options number input is mono and still 56px wide without clipping "10".

- [ ] **Step 5: Check the italics are real**

In DevTools on `onboarding.html`, run in the console:

```js
document.querySelector('h2').insertAdjacentHTML('beforeend', ' <em>italic check</em>');
document.querySelector('p').insertAdjacentHTML('beforeend', ' <em>italic check</em>');
```

Then inspect each `<em>` → Computed → "Rendered Fonts". Expected: `Chakra Petch` and `Hanken Grotesk` respectively. If either says the font name followed by a synthetic-oblique indication, or falls back to a system font, the corresponding `@font-face` is missing its `font-style: italic` descriptor. Reload the page afterwards to discard the injected markup.

- [ ] **Step 6: Commit**

```bash
git add extension/ui/brand.css extension/onboarding.html extension/options.html
git commit -m "feat: brand type system for the onboarding and options pages

Adds extension/ui/brand.css — the eight @font-face rules plus
--font-display/--font-body/--font-mono — and switches both pages onto it.

Each page's body font had to change explicitly rather than inherit: they set
the font shorthand, which resets font-family and, being inline, wins over the
linked stylesheet.

Type only; colours and color-scheme are untouched."
```

---

## Task 6: The popup, and close out the roadmap

**Files:**
- Modify: `extension/popup.html:3-5` (`<head>`), `:8` (body font), `:19-20` (`h1`, `#count`), `:110` (`.wake`)
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: `--font-display`, `--font-body`, `--font-mono` from Task 5.
- Produces: nothing.

**Note on the popup `h1`.** The design doc calls this "the wordmark". It is not — the markup is `<h1>Waiting on you</h1>`, a section heading. Treat it as a display heading; uppercased it reads `WAITING ON YOU`, which matches the landing page's heading treatment.

- [ ] **Step 1: Add the head links**

`extension/popup.html` currently has no `<link>` and no `<title>`. Inside `<head>`, immediately before the `<style>` tag, add:

```html
    <link rel="preload" href="fonts/chakra-petch-600.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="fonts/hanken-grotesk-400.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="ui/brand.css" />
```

The popup is created and destroyed on every toolbar click, so a flash of fallback text is far more noticeable here than on a full page. `crossorigin` is required on font preloads even for same-origin files; without it the browser fetches the font twice.

- [ ] **Step 2: Switch the body font**

Change:

```css
        font: 13px/1.4 -apple-system, system-ui, sans-serif;
```

to:

```css
        font: 13px/1.4 var(--font-body);
```

- [ ] **Step 3: Switch the header and data faces**

Change:

```css
      h1 { font-size: 13px; font-weight: 600; margin: 0; }
      #count { opacity: 0.6; font-variant-numeric: tabular-nums; }
```

to:

```css
      h1 { font-size: 13px; font-weight: 600; margin: 0; }
      #count {
        opacity: 0.6;
        font-family: var(--font-mono);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
```

(`h1` needs no family — `brand.css` already gives `h1` the display face and uppercase.)

Then change:

```css
      .wake { font-size: 11px; opacity: 0.6; white-space: nowrap; }
```

to:

```css
      .wake { font-size: 11px; opacity: 0.6; white-space: nowrap; font-family: var(--font-mono); }
```

- [ ] **Step 4: Verify the popup, especially density**

Reload the extension and open the popup. This is the highest-risk page in the whole plan: it is fixed at 320px wide with 13px rows, and Hanken Grotesk sets narrower than `-apple-system`.

Confirm, in light and dark:
- `WAITING ON YOU` renders in Chakra Petch uppercase and does not collide with the count.
- Chat titles still ellipsis cleanly and no row wraps to two lines.
- 🔴/💤🔴/✅ prefixes still render as colour emoji at the start of each row.
- The snooze panel opens; preset pills, the date input, the time `<select>` and "Set" all still fit on their rows without overflowing 320px. These inherit via `font: inherit`, so they changed family too.
- Wake times in the Snoozed section are mono and do not wrap.

If any row wraps or the snooze panel overflows, the fallback is to revert the `body` font on this page only (leave `h1` and `#count` branded) and note it — the two full pages are unaffected.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. No test covers HTML, so this is a regression check only.

- [ ] **Step 6: Update the roadmap**

In `ROADMAP.md`, delete these two bullets from "🔭 Future features":

```
- **History pagination** — currently only the most recent ~50 chats are swept;
  paginate for full-history coverage if needed.
- **Extension-page brand fonts** — adopt Chakra Petch in onboarding/options
  (needs the font bundled locally for the extension, not a CDN link).
```

and add to the end of "✅ Shipped":

```
- **Full-history sweep** — `list()` walks every conversation via `offset`
  paging instead of the most recent 50, so a 🔴 chat can no longer drift out of
  the popup queue and lose its snooze. Never-seen chats below a seed depth are
  recorded rather than fetched, which keeps the first sweep cheap.
- **Extension brand type** — Chakra Petch / Hanken Grotesk / JetBrains Mono
  bundled locally (no CDN is reachable from an extension page) behind a shared
  `extension/ui/brand.css`, across popup, options and onboarding.
```

- [ ] **Step 7: Commit**

```bash
git add extension/popup.html ROADMAP.md
git commit -m "feat: brand type in the popup, and close both roadmap items

Preloads the two faces the popup uses — it is rebuilt on every toolbar click,
so a flash of fallback text shows more here than on a full page."
```

---

## Done when

- `npm test` passes, with 5 new `paginate` tests and 4 new orchestrator tests.
- The service-worker console shows `claudeAdapter.list()` returning the full history (~187), not 50 or 100.
- A sweep on an already-installed profile does **not** fetch every conversation: watch the Network tab of the service worker during one sweep and confirm the `chat_conversations/{uuid}` requests number in the low tens, not the hundreds.
- All three pages render in Chakra Petch / Hanken Grotesk / JetBrains Mono in both light and dark, with real italics and working colour emoji.
- The popup still fits 320px with no wrapped rows.
- `ROADMAP.md` lists both items under Shipped, and `manifest.json` reads `0.3.0`.
