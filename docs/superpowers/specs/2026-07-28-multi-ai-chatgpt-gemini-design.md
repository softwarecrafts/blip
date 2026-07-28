# Multi-AI: ChatGPT and Gemini adapters — design

**Date:** 2026-07-28
**Status:** approved, ready for implementation planning
**Roadmap item:** "Multi-AI — ChatGPT, Gemini adapters"

## Goal

Track ChatGPT and Gemini chats alongside Claude: same 🔴/✅ title labelling, same
popup queue, same snooze. Each new platform is opt-in, off by default, and asks
for its host permission only when the user enables it.

## Non-goals

- No status store. The server-side title remains the single source of truth on
  every platform, which is what makes labels sync to mobile for free.
- No platform ships without a working server-side rename. A read-only "tracked
  locally" tier was considered and rejected: it would split the product promise
  and introduce a second place to look for a chat's status.
- No changes to the marker contract. `classify.js` stays platform-agnostic and
  the 🔴/✅ strings are identical everywhere.

## Context

The 2026-06-22 adapter refactor already made the orchestrator
platform-agnostic: it loops `enabledAdapters(settings)`, namespaces the `seen`
cache per platform, keys snoozes per platform, and guards starring on
`capabilities.star`. `settings.platforms[id]` shipped in 0.1.1. The generic half
of multi-AI is done; what remains is platform-specific work plus the
enablement plumbing.

### Endpoint research (desk, 2026-07-28)

**ChatGPT** — high confidence, community-documented:

| Need | Endpoint |
| --- | --- |
| list | `GET /backend-api/conversations?offset=&limit=&order=updated` → `{items, total}` |
| get | `GET /backend-api/conversation/{id}` → `mapping` (message tree) |
| rename | `PATCH /backend-api/conversation/{id}` `{title}` → `{success:true}` |
| star | none exists |

Auth is a bearer token from `GET /api/auth/session`, not ambient cookies.

**Gemini** — everything goes through
`POST /_/BardChatUi/data/batchexecute` with obfuscated RPC ids and JSPB
(positional-array) payloads. A maintained community library
(`HanaokaYuzu/Gemini-API`) publishes `LIST_CHATS = "MaZiqc"` (returns `cid`,
`title`, `is_pinned`, `timestamp`) and `READ_CHAT = "hNvQHb"`. **No rename rpcid
is published anywhere.** Rename exists in the Gemini UI, so an id exists, but
finding it needs live network capture.

## Design

### 1. Orchestrator

One change: `listWaiting()` sorts items by `updatedAt` descending across all
platforms before `partitionBySnooze`. Items are currently pushed per adapter in
list order, so three adapters would produce a queue implicitly grouped by
platform rather than by recency.

A second change applies **only if Gemini ships** — see §7.

### 2. Adapter interface

Additive. The service adapter gains one field:

```js
{
  id, capabilities: { star },
  list, get, rename, setStarred, conversationUrl,
  origins: ['https://chatgpt.com/*'],   // NEW: permission request + script injection
}
```

`label` moves **out** of the adapter into a new `extension/lib/platforms.js`
holding presentation metadata only:

```js
export const PLATFORMS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    glyph: '<svg …>',                       // currentColor, matching popup ICONS
    origins: ['https://claude.ai/*'],
    onboarding: { settingsUrl: '…', where: 'personal preferences' },
  },
  // chatgpt, gemini
};
```

Popup, options and onboarding import `platforms.js`. None of them import
`adapters/index.js`: that module is loaded by the service worker where
`fetch(credentials:'include')` carries the user's session, and a UI page has no
business pulling a credentialed code path in just to render a label.

`origins` is duplicated between `platforms.js` (used by the Options UI) and the
adapter (used by the worker). The adapter reads its own value from
`PLATFORMS[id].origins` so there is one definition.

### 3. Manifest

- add `optional_host_permissions`: `https://chatgpt.com/*`,
  `https://gemini.google.com/*`
- add the `scripting` permission
- `content_scripts` stays Claude-only — a host that has not been granted cannot
  be declared statically
- description stops naming claude.ai exclusively; version bump

### 4. Platform enablement

Options grows a **Platforms** section: one row per registered adapter, bound to
`settings.platforms[id]`. Claude gets a row too. (The roadmap deferred this
because a lone Claude toggle duplicated the master switch; with three platforms
it earns its place.)

Enabling a platform:

1. `chrome.permissions.request({ origins })` — the Options click is the user
   gesture this requires
2. on grant → write `settings.platforms[id] = true`, then
   `chrome.scripting.registerContentScripts([{ id: 'cs-<platform>', matches,
   js: ['content.js'], runAt: 'document_idle' }])`
3. on deny → revert the checkbox, write nothing

Disabling reverses it: unregister the script, `chrome.permissions.remove`, set
`false`. Claude's origin is in the manifest and cannot be removed, so disabling
Claude only flips the setting.

Registered scripts and granted permissions are independent state that can
drift, so there are two repair paths:

- **startup / install** — diff `getRegisteredContentScripts()` against
  (granted permissions ∩ enabled settings) and register or unregister the
  difference
- **`chrome.permissions.onRemoved`** — a revoke from `chrome://extensions`
  flips the setting off and unregisters, so Options never claims a platform is
  active when it cannot reach it

The diff itself is a pure function (`desiredScripts(settings, granted)`) with
the chrome calls at the edge, matching the `paginate`/`classify` split.

### 5. Onboarding

One page, a section per platform, rendered for enabled platforms. Each section
supplies where the instruction goes and a deep link:

| Platform | Where the marker prompt goes |
| --- | --- |
| Claude | profile → personal preferences |
| ChatGPT | settings → personalisation → custom instructions |
| Gemini | settings → saved info |

The prompt text itself is shared and unchanged. Enabling a platform in Options
opens onboarding anchored to that platform's section, since that is the moment
the instruction needs pasting.

### 6. ChatGPT adapter

`extension/adapters/chatgpt.js`, `conversationUrl` → `https://chatgpt.com/c/{id}`,
`capabilities: { star: false }`.

**Auth.** `GET https://chatgpt.com/api/auth/session` → `accessToken`, sent as
`Authorization: Bearer`. Cached in worker memory only, never `chrome.storage`,
and refetched on 401 or worker restart. (`claude.js` caches an org id in
storage safely because an org id is not a credential; a bearer token is.)

**`list()`.** Reuses `lib/paginate.js` unchanged — the fetcher unwraps
`.items`, and `paginate` only requires the page resolve to an array. Filters
`is_archived`. Maps to `{id, name: title, updatedAt: update_time,
isStarred: false}`. Page size 100 mirroring Claude, verified against the
endpoint's cap during implementation; if it clamps, fall back to 28 (the value
the ChatGPT UI itself uses).

**`get()`.** The response is a message **tree**, not Claude's flat
`chat_messages[]`. `lastAssistantText(full)` — pure, exported for tests —
starts at `current_node` and walks `parent` upward, returning the first node
with `author.role === 'assistant'`, `content.content_type === 'text'` and a
non-empty `parts`.

Walking by timestamp instead would be wrong: regenerating a reply or editing a
prompt branches the tree, leaving orphaned assistant nodes that are newer than
the reply actually on screen. The parent chain from `current_node` is the only
definition of "the reply the user can see".

**`rename()`.** `PATCH /backend-api/conversation/{id}` `{title}`; treat a
missing `success: true` as a failure.

**Temporary chats.** ChatGPT temporary chats are never persisted to history, so
they cannot appear in `list()` and `isTemporary` is always false. This
satisfies the roadmap's requirement that adapters filter temporary chats
adapter-side.

**DOM adapter.** Host `chatgpt.com`; `currentId` from `/c/<uuid>`;
`titleNodes` → `a[href*="/c/<id>"]`.

**Failure mode.** A Cloudflare challenge on `/backend-api/*` surfaces as a
thrown `list()`, which `sweep()` already catches and logs per platform. The
badge only shows `!` when *every* enabled adapter fails, so one broken platform
degrades rather than breaking the queue.

### 7. Gemini — gated on a Phase 0 spike

**The gate.** A timeboxed 2–3 hour spike. It passes only if all three hold:

1. the rename rpcid and its JSPB payload are captured off `batchexecute`
2. the call replays successfully from the console against a throwaway chat
3. it still works after a page reload, proving it is not bound to ephemeral
   page state beyond the scrapeable `at` token

**If the gate fails**, Gemini is not registered in `ADAPTERS`, no Gemini row
appears in Options, ROADMAP records exactly what was tried and where it
stopped, and ChatGPT ships alone. Phases 1–4 do not depend on the gate's
result, so a spike that overruns blocks nothing.

**If the gate passes**, `extension/adapters/gemini.js` needs:

- a `batchexecute` helper: `f.req` envelope, `)]}'` prefix stripping, `SNlM0e`
  (`at`) token scraped from `https://gemini.google.com/app` and cached
- `list()` via `MaZiqc` (both the pinned and unpinned payload variants),
  `get()` via `hNvQHb`, `rename()` via the captured rpcid
- `capabilities: { star: false, fullHistory: false }` — Gemini's `is_pinned` is
  readable and would make a plausible star equivalent, but no pin/unpin rpcid
  is published either, so star mirroring stays off
- **defensive parsing** that `claude.js` never needed: a `pick(arr, path)`
  accessor returning `undefined` rather than throwing, plus a shape check that
  refuses to rename when the parsed title or reply text fails validation. JSON
  fails loudly; JSPB mis-parses silently, and a mis-parse renames chats wrongly.

**The `fullHistory` orchestrator change.** `MaZiqc` takes a count, not an
offset cursor, so Gemini cannot guarantee it has seen the whole history. Left
alone, this reintroduces the bug the 0.1.1 pagination work fixed: a 🔴 chat
below the window loses its snooze. For an adapter with
`capabilities.fullHistory === false`, the orchestrator never prunes a snooze
because the chat was *absent* from `list()` — only because the chat is listed
and no longer 🔴. Snooze entries for chats outside the window are retained; a
snooze for a chat that cannot be seen does nothing until it reappears.

### 8. Popup

- global recency sort (§1)
- a leading platform glyph per row, `currentColor` SVG matching the existing
  `ICONS` treatment; same for the snoozed list
- **fallback:** if the glyph crowds a 300px row, switch to adaptive group
  headings — an uppercase platform heading, shown only when more than one
  platform has blips, so a single-platform user sees today's popup unchanged

### 9. Tests

Zero-dep `node --test`, following the existing chrome stub and fake adapters.

- `tests/chatgpt-adapter.test.mjs` — `lastAssistantText` against a **branched**
  fixture (asserts the parent chain from `current_node`, not newest-by-time);
  tool and hidden nodes skipped; empty conversation → `''`
- `tests/platforms.test.mjs` — `desiredScripts(settings, granted)` as pure
  logic: enable, disable, permission granted but setting off, setting on but
  permission revoked
- `tests/orchestrator.test.mjs` — extended to two fake adapters: per-platform
  `seen` isolation, global recency sort, one adapter throwing not pruning the
  other's snoozes, and (if Gemini ships) `fullHistory: false` snooze retention
- Gemini parse tests against captured fixtures, only if the gate passes

### 10. Docs

- README: per-platform endpoint tables, architecture note on the
  presentation/service split
- PRIVACY: requests go only to platforms the user enables; the ChatGPT access
  token is held in memory and never stored
- ROADMAP: record the gate outcome; move Multi-AI out of "Future features"
- manifest description, store listing, version bump

## Sequence

| Phase | Work | Gated |
| --- | --- | --- |
| 0 | Gemini rename spike (2–3h timebox) | — |
| 1 | `lib/platforms.js`, popup glyph + global sort | no |
| 2 | Optional permissions, Options Platforms section, script registration + reconciliation | no |
| 3 | Per-platform onboarding | no |
| 4 | ChatGPT adapter + DOM entry + tests | no |
| 5 | Gemini adapter + tests | **on Phase 0** |
| 6 | Docs, privacy, store listing, version | no |

Phase 1 ships value with a single platform enabled. Phase 2 is the largest new
chunk and is entirely platform-agnostic.

## Risks

| Risk | Mitigation |
| --- | --- |
| Gemini rename unreachable | Phase 0 gate; hold Gemini back, ship ChatGPT |
| Gemini JSPB indices reshuffle silently | defensive `pick()` + shape validation before any rename |
| ChatGPT Cloudflare challenge on `/backend-api/*` | per-adapter failure already isolated in `sweep()`; badge `!` only when all adapters fail |
| ChatGPT branched-tree mis-parse | parent-chain walk from `current_node`, covered by a branched fixture test |
| Users revoke a host permission out-of-band | `permissions.onRemoved` + startup reconciliation |
| Three platforms × full-history sweep cost | unchanged per-platform cost; `seen` short-circuit and `SEED_DEPTH` already bound it |
