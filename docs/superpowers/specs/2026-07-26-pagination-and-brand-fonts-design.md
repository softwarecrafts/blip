# History pagination + extension brand fonts — design

**Date:** 2026-07-26
**Status:** approved, ready for implementation planning
**Scope:** two independent roadmap items shipped as one release (v0.3.0)

## Problem

Two "Future features" from `ROADMAP.md`, unrelated to each other except that
both are small enough to ship together.

### 1. The 50-item list window silently drops blips

`adapters/claude.js` lists conversations with a hardcoded `?limit=50`. The
orchestrator derives *everything* from that list:

- `listWaiting()` builds the popup queue purely from listed titles, so a 🔴 chat
  outside the window is not in the queue.
- `sweep()` counts the badge from listed titles, so it is not on the badge
  either.
- `sweep()` prunes `seen` to listed ids (`orchestrator.js:218-221`), so its
  change-detection state is discarded.
- `sweep()` prunes snoozes to chats still listed and still 🔴
  (`orchestrator.js:222-224`), so **it loses its snooze**, and on returning to
  the window would wake early.

The list is sorted `updated_at` descending, so a chat leaves the window when 50
other chats are touched after it. That means the blips most likely to disappear
are precisely the ones that have gone unanswered longest.

Recon on 2026-07-26 (`recon/pagination-recon.js`) measured the live account:

| Measurement | Value |
| --- | --- |
| Total conversations | 187 (entire history, 2025-03-11 → 2026-07-26) |
| Sorted by `updated_at` desc | yes |
| `updated_at` at index 49 | 2026-06-03 — the window is ~7.6 weeks deep |
| Titles currently 🔴 / 💤🔴 | 19 (1 snoozed) |
| Titles currently ✅ | 23 |
| Titles unmarked | 145 |
| **Deepest 🔴 position** | **42** |
| 🔴 chats already beyond index 50 | 0 |

Nothing has been lost yet, but a blip sits eight positions from the cliff. This
is a correctness fix landing just ahead of the bug.

### 2. Extension pages do not use the brand type

`onboarding.html`, `options.html` and `popup.html` each carry their own inline
`<style>` block using `-apple-system, system-ui, sans-serif`. The landing page
and the store assets use Chakra Petch (display, uppercase), Hanken Grotesk
(body) and JetBrains Mono (labels/data). The extension — the thing users
actually look at every day — does not match its own brand. The landing page
pulls those families from the Google Fonts CDN, which an extension cannot do:
the files must be bundled locally.

## Goal

1. A 🔴 chat stays in the queue, on the badge, and keeps its snooze regardless of
   how far it has drifted down the history — without a costly first sweep.
2. `onboarding.html`, `options.html` and `popup.html` use the bliptracker type
   system, from locally bundled font files.

## Non-goals

- **Retroactive classification of old chats.** `titleTransform` returns the
  title unchanged when `status === null` (`titleTransform.js:58`), and
  `classify` only returns non-null when Claude left a 🔴/✅ marker. Chats
  predating the preference prompt have no marker, so walking back to them
  classifies exactly zero of them. This matches the promise already made in
  `onboarding.html`: "existing chats stay untouched until Claude leaves a marker
  in them."
- **A persistent waiting index.** Decoupling the queue from the list window
  entirely (storing known-waiting chats in `chrome.storage.local` and serving
  the popup from that) is a real design, and the right one if listing the full
  history were expensive. It is not: the full walk is two HTTP requests. Not
  worth the state.
- **Changing the adapter interface.** `list()` keeps its no-arg signature.
  Pagination depth is an implementation detail of the Claude adapter, so the
  orchestrator, `adapters/index.js` and the existing orchestrator tests are
  untouched by it.
- **The scope colour palette in extension pages.** Type only. `color-scheme:
  light dark` and every current colour stay exactly as they are. Adopting the
  dark phosphor-green surfaces from the landing page is a separate decision.
- **Touching `background.js`.** Neither feature needs it.
- **Chrome Web Store submission**, which is a manual maintainer step.

## Confirmed API behaviour (recon 2026-07-26)

Read-only probes against `/api/organizations/{org}/chat_conversations`:

| Probe | Result |
| --- | --- |
| `?limit=50` | 200, bare array, 50 items |
| `?limit=200` | 200, bare array, **187** items |
| `?limit=1000` | 200, bare array, **187** items |
| `?limit=50&offset=50` | 200, 50 items, **zero overlap with page 0** |
| `?limit=50&offset=1000000` | 200, **empty array** |
| `?limit=50&before=<iso>` | 200, 50 items (does not appear to filter) |
| `?limit=50&page=2` | 200, 50 items (param ignored) |

Conclusions the design relies on:

- **`offset` paginates correctly**, with disjoint pages.
- **A short page is a clean end-of-list signal**; past the end returns `[]`, not
  an error.
- **No server-side `limit` cap was observed below 1000.** The design does not
  depend on this — it is the reason a single large `limit` would work today, and
  the reason we choose not to rely on it.
- **`before=` and `page=` are not honoured.** `offset` is the only working
  mechanism, so there is no fallback to design for.

Response items carry `uuid`, `name`, `updated_at`, `is_starred`, `is_temporary`
among others — everything `list()` already normalises. No shape change.

## Design — 1. Pagination

### `extension/lib/paginate.js` (new)

A pure offset-walker with an injected page-fetcher, so the loop is testable
without stubbing `fetch` or `chrome`:

```js
export async function paginate(fetchPage, { pageSize, maxPages }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage({ offset: page * pageSize, limit: pageSize });
    out.push(...batch);
    if (batch.length < pageSize) return out;   // clean end-of-list signal
  }
  console.warn('[bliptracker] page cap hit — history may be truncated');
  return out;
}
```

It lives in `lib/` rather than inside `claude.js` for two reasons: the roadmap's
ChatGPT/Gemini adapters will want the same walker, and it keeps the tested
surface pure, matching how `classify`, `titleTransform` and `snooze` are already
factored.

### `extension/adapters/claude.js` (modify)

Replace `LIST_LIMIT = 50` with:

```js
const PAGE_SIZE = 100;   // 187 conversations today -> 2 requests
const MAX_PAGES = 20;    // runaway guard: 2000 conversations
```

`list()` calls `paginate()`, then applies the existing `is_temporary` filter and
normalisation to the combined result. Everything else in the adapter is
unchanged.

**Why 100 and not 1000.** A page size of 100 means the paging path executes on
every real sweep rather than lying dormant until someone crosses 1000 and
discovers it never worked. It also bounds each response payload, and it does not
bet on an undocumented absence of a server-side cap.

**Why `MAX_PAGES` at all.** The stop condition depends on the server returning a
short page. If that ever changes, an unguarded loop hammers claude.ai
indefinitely. The guard warns rather than throwing, so a truncated history
degrades to today's behaviour instead of breaking the sweep.

### `extension/lib/orchestrator.js` (modify)

Widening the window from 50 to 187 exposes a first-sweep problem. `seen` is
pruned to the listed window every sweep, so it currently holds at most 50
entries. Listing 187 makes the next sweep find 137 conversations it has never
seen and call `adapter.get()` on each — and `get()` pulls that chat's entire
`chat_messages` array. That is a very large first sweep, spent classifying 145
unmarked chats that `titleTransform` will refuse to touch.

The fix relies on the confirmed sort order. A chat becomes 🔴 only when Claude
replies, which bumps `updated_at` and lifts it to position 0. Therefore **a
conversation below the seed depth that we have never seen has not changed in
weeks, and fetching it cannot reveal a recent marker.** Record it instead:

`SEED_DEPTH` is a module-level constant in `orchestrator.js`, alongside
`BADGE_WAITING` / `BADGE_FAILED`. The sweep's inner loop is currently
`for (const c of list)` and must become indexed — `list.entries()` or a plain
counter — because the rule is positional:

```js
const SEED_DEPTH = 50;   // how deep a cold cache will classify

// inside the sweep's list loop, where `index` is the chat's position in
// the adapter's `updated_at`-descending list:
const isNew = !(c.id in seenP);
if (isNew && index >= SEED_DEPTH) {
  seenP[c.id] = c.updatedAt;                    // record, do not fetch
} else if (seenP[c.id] !== c.updatedAt || staleZzz) {
  const conv = await adapter.get(c.id);
  // ...existing applyStatus path, unchanged...
}
```

The chat's existing title still flows into `stillWaiting` and `waitingCount`, so
the badge, the popup queue and snooze pruning stay correct on that sweep. Only
the fetch-and-rename half is skipped.

This is an invariant, not a migration: no version flag, no `chrome.runtime`
install/update branch, and it is self-correcting because anything that genuinely
changes gets a new `updated_at` and is processed normally.

`SEED_DEPTH = 50` preserves today's fresh-install behaviour exactly — a new
install still classifies the most recent 50 chats — while capping cold-cache
cost at 50 fetches rather than 187.

### Accepted trade-off

A chat replied to while the extension was uninstalled or disabled, which has
since drifted past index 50, keeps an unmarked title until it next changes. This
is the same class of gap as the documented "existing chats stay untouched"
behaviour, and it is exactly the backfill established as worthless above.

### Cost

Per sweep, at 187 conversations and the default `pollMinutes: 10`: two list
requests instead of one, ~288/day instead of 144. Opening the popup calls
`listWaiting()`, which also lists — so that costs two requests instead of one
as well. `get()` volume is unchanged in steady state, because `seen` gates it
exactly as before. `seen` grows from ≤50 to ≤187 entries per platform — a few
kilobytes against a 10MB quota.

### Tests

`tests/paginate.test.mjs` (new), driving `paginate()` with a fake page-fetcher:

- stops at a short page and returns the accumulated items
- an exactly-full final page followed by an empty page terminates correctly
  (the off-by-one that would otherwise cost one wasted request forever)
- respects `maxPages` and does not call `fetchPage` again after the cap
- single page shorter than `pageSize` issues exactly one call

`tests/orchestrator.test.mjs` (extend), using the existing fake adapter with a
list longer than `SEED_DEPTH`:

- a never-seen conversation at index ≥ `SEED_DEPTH` is recorded in `seen`
  without `get()` being called
- its title still contributes to the badge count and the waiting set
- a never-seen conversation above `SEED_DEPTH` is still fetched and renamed
- a *previously seen* conversation below `SEED_DEPTH` whose `updatedAt` changed
  is still fetched (the depth rule applies only to unseen chats)

## Design — 2. Brand fonts

### `extension/fonts/` (new)

Eight woff2 files, `latin` subset only (not `latin-ext`) — all extension copy is
English, and any stray character outside the subset falls through to the system
tail of the stack. ~160KB total:

| File | Role |
| --- | --- |
| `chakra-petch-600.woff2` | display, headings |
| `chakra-petch-600-italic.woff2` | `<em>` inside headings |
| `chakra-petch-700.woff2` | wordmark |
| `hanken-grotesk-400.woff2` | body |
| `hanken-grotesk-400-italic.woff2` | `<em>` in prose |
| `hanken-grotesk-600.woff2` | labels, buttons |
| `jetbrains-mono-400.woff2` | data, code, timestamps |
| `jetbrains-mono-700.woff2` | counts |

All three families are OFL-1.1, which obliges shipping the licence text:
`OFL-Chakra-Petch.txt`, `OFL-Hanken-Grotesk.txt`, `OFL-JetBrains-Mono.txt`
alongside the fonts.

Chakra Petch is **not** a variable font, so each weight *and* each italic is a
separate file; this is why the set is trimmed to the specific faces used rather
than mirroring the landing page's full range.

**Why italics are in scope at all**, given no extension page currently contains
an `<em>`: without a real italic file the browser does not fall back to another
family, it synthesizes an oblique by shearing the upright glyphs. Chakra Petch
is a squarish techno face with flat terminals, where that shear is conspicuous.
Shipping the faces means the first `<em>` anyone adds renders correctly instead
of quietly wrong.

The two italic weights are fixed by the landing page's usage, not chosen freely:
`.hero h1 em` (`landing/styles.css:181`) sits inside an `h1` at weight 600, and
prose `<em>` (`landing/index.html:275`) sits in 400 body text. JetBrains Mono
ships upright-only — its roles here are a textarea, a badge count and
timestamps, none of which will be italic.

### `scripts/fetch-fonts.sh` (new)

A ~15-line `curl` script recording the exact source URLs, for provenance and
reproducibility. It adds no npm dependency and no build step — the woff2 files
are committed, so nobody needs to run it.

### `extension/ui/brand.css` (new)

Contains the eight `@font-face` rules (`font-display: swap`), the type tokens, and
the primitives currently duplicated across three inline `<style>` blocks
(`button`/`a.btn`, `.desc`, `.note`, `code`).

Tokens are named `--font-display` / `--font-body` / `--font-mono`, not the
landing page's `--serif` / `--sans` / `--mono`. Chakra Petch under a `--serif`
name is actively misleading, and nothing shares a stylesheet between the two
surfaces.

Every fallback stack keeps the current system fonts as its tail, so a missing or
corrupt font file degrades to today's appearance rather than to Times.

### Page changes

Each page links `ui/brand.css` and keeps its page-specific rules inline.

| Page | Display (Chakra Petch, uppercase) | Body (Hanken Grotesk) | Mono (JetBrains Mono) |
| --- | --- | --- | --- |
| `onboarding.html` | `h1` wordmark, `h2` | paragraphs, buttons | preference-prompt `textarea`, `code` |
| `options.html` | `h1`, `h2` section labels | rows, `.desc` | `input[type=number]` |
| `popup.html` | `h1` wordmark | list rows, buttons | `#count`, `.wake` |

`options.html`'s `h2` already applies `text-transform: uppercase` and
`letter-spacing: 0.05em`, so it only changes family.

`popup.html` gets `<link rel="preload" as="font" type="font/woff2" crossorigin>`
for the two faces it uses, because the popup is opened and destroyed constantly
and a flash of fallback text there is more noticeable than on a full page.
(`crossorigin` is required on font preloads even same-origin.)

### CSP and manifest

None needed. MV3's default `extension_pages` CSP constrains only `script-src`
and `object-src`, so a self-hosted `@font-face` in an extension page's own CSS
loads normally. `web_accessible_resources` is not required either — that governs
access from other origins, and `content.js` uses no fonts. The manifest changes
only its `version`.

### Verification

Presentational, so no unit tests. Before calling it done, screenshot all three
pages in both light and dark, and specifically confirm:

- **Popup density.** Rows are 13px in a narrow popup, and Hanken Grotesk is
  slightly narrower than `-apple-system`. Check nothing wraps or clips.
- **Emoji fallback.** None of the three families carry 🔴 ✅ 💤, so those glyphs
  must fall through to the system emoji font cleanly, in titles and in the
  popup list.
- **Onboarding textarea.** The preference prompt contains emoji inside a mono
  block; check line height and that the copy button still works.
- **Italics are real, not synthesized.** Each italic `@font-face` must declare
  `font-style: italic` in its descriptor block — omit it and the browser ignores
  the file and shears the upright face instead, which is the exact failure the
  italics were added to prevent. Verify by temporarily dropping an `<em>` into a
  heading and a paragraph and comparing against the landing page.

## Sequencing

Three commits, directly on `main` (no feature branch, per repo convention):

1. **docs** — this spec plus `recon/pagination-recon.js`.
2. **pagination** — `lib/paginate.js`, `adapters/claude.js`, `lib/orchestrator.js`,
   tests, README endpoint table gains `offset`.
3. **fonts** — `extension/fonts/`, `scripts/fetch-fonts.sh`, `extension/ui/brand.css`,
   the three pages.

`manifest.json` goes `0.2.0` → `0.3.0` in commit 2, and `ROADMAP.md` moves both
items from "Future features" to "Shipped" in commit 3.

The two features are independent and touch disjoint files. If pagination needs
to be reverted after release, the font commit is unaffected, and vice versa.

## Constraints carried from the repo

- Zero runtime dependencies; no build step; no `node_modules`.
- Node ≥ 20 for `node --test`.
- Console log prefix stays `[bliptracker:<adapterId>]`.
- User-facing copy says **blip**, never "contact".
- All work commits directly to `main`.
