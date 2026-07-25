# Adapter refactor — completion design

**Date:** 2026-07-25
**Status:** approved, ready for implementation planning
**Scope:** close out the in-flight adapter refactor as a Claude-only patch release

## Problem

The working tree holds an unfinished refactor that splits every platform into a
service adapter (worker-side: endpoints, auth, parsing) and a DOM adapter
(page-side: selectors), leaving `background.js` platform-agnostic. The code
change is sound — every `uuid`, `orgId`, and claude.ai endpoint is now confined
to `extension/adapters/claude.js` — but it is not shippable:

- `extension/adapters/` is untracked, and the service worker `import`s it. A
  commit or zip build that omits it ships a dead worker.
- The riskiest new code (the `seen`-cache migration, multi-adapter error
  isolation) has no tests, and no test harness exists.
- `background.js` mixes Chrome event wiring with orchestration, so that code is
  not reachable from a test.
- README's "Architecture", "Confirmed endpoints", and "Development" sections
  describe the pre-refactor shape.
- The new Options "Platforms" section contains one toggle (Claude) that can only
  turn the sole platform off, duplicating the master "Enabled" switch.

The extension is live on the Chrome Web Store at v0.1.0 with real users, so this
is a shipping change, not greenfield work.

## Goal

Ship the refactor as a behaviour-preserving patch release. The architecture ends
up ready for a second platform; no second platform lands.

## Non-goals

Explicitly out of scope, deferred until a second platform is actually built:

- A ChatGPT or Gemini adapter, and any endpoint recon for one.
- Optional host permissions and `chrome.scripting.registerContentScripts`.
- The Options "Platforms" UI section (the data model ships; the UI does not).
- Cleaning up the orphaned `orgId` storage key left by existing installs. It is
  harmless — it costs one extra `/organizations` call per install, once — and a
  storage migration on a live extension is risk without reward.
- Chrome Web Store submission itself, which is a manual step the maintainer
  performs.

## Architecture

### Module boundaries

```
extension/
  background.js        ~35 lines — chrome event wiring only
  lib/
    orchestrator.js    NEW — sweep / checkConversation / listWaiting / applyStatus
    settings.js        + platforms
    classify.js        unchanged
    titleTransform.js  unchanged
  adapters/
    index.js           ADAPTERS registry + enabledAdapters(settings)
    claude.js          all claude.ai specifics
  content.js           host-keyed DOM_ADAPTERS map
```

`background.js` retains only what touches Chrome's event surface:
`runtime.onInstalled`, `runtime.onStartup`, `alarms.onAlarm`,
`storage.onChanged` → `resetAlarm()`, and the `runtime.onMessage` router.
Everything it currently does after dispatch moves into the orchestrator.

The split follows a process boundary, not merely a file boundary: service
adapters run in the MV3 worker where cookies and `credentials: 'include'` work;
DOM adapters run in the page's isolated world. This is why `content.js` keeps
its own map rather than importing the registry.

### Test seam

`getSettings()` reads `chrome.storage.local` directly, so tests need a global
`chrome` stub regardless. Injecting storage as well would be redundant plumbing.
The orchestrator therefore injects only the adapter registry:

```js
export function createOrchestrator({ adapters = ADAPTERS } = {}) {
  return { sweep, checkConversation, listWaiting };
}
```

`background.js` calls `createOrchestrator()` with no arguments. Tests assign
`globalThis.chrome = makeChromeStub()` before importing, then pass fake
adapters. One injection point, no test framework.

### Data flow

Unchanged. Both triggers funnel through a single path; only the file location
moves.

```
alarm sweep ─┐                                  ┌─ adapter.list()
             ├→ orchestrator.applyStatus ──────→┤   adapter.get()
content.js ──┘   (classify → titleTransform)    └─ adapter.rename() / setStarred()
```

### Error handling

These rules already hold in the working-tree code. This spec codifies them and
the test suite pins them:

- One adapter throwing must never abort the sweep for other adapters.
- The badge shows the grey `!` state only when **every enabled adapter failed**,
  never when zero adapters are enabled.
- `mirrorStar` is skipped unless the adapter declares `capabilities.star`.
- A missed DOM paint is silent. The server-side rename is the source of truth.

### Known accepted behaviour: rename convergence

`applyStatus` renames a chat, which bumps its server-side `updated_at`, but
`seen` stores the pre-rename timestamp from the `list()` call. The next sweep
therefore re-fetches that conversation once. Because `titleTransform` is
idempotent, the re-check performs no rename and the state converges.

This is intended ("convergence by design" in the README), not a defect. The test
suite asserts the convergence property rather than changing the behaviour.

### Settings

`DEFAULT_SETTINGS.platforms = { claude: true }` ships. `getSettings()` shallow
merges defaults over stored settings, which produces the desired behaviour for
future platforms: once a user writes any setting, their stored `platforms`
object shadows the default entirely, so a later `chatgpt` key is absent →
`undefined !== true` → off by default. New platforms opt in rather than out,
enforced by merge semantics rather than by explicit code.

The Options UI for platforms is removed in this change and returns when a second
platform gives the toggle meaning. Concretely, this means dropping all three
pieces added in the working tree: the `<h2>Platforms</h2>` section and its
checkbox in `options.html`, the `platformClaude` entry in the `fields` map and
its `init()` line in `options.js`, and the change listener that writes
`platforms`. The `<h2>Behaviour</h2>` heading and the `h2` style rule stay,
since they improve the existing page independently.

## Test plan

Zero dependencies: Node's built-in runner, invoked as `node --test tests/`. A
`package.json` is added containing only a `test` script — no `node_modules`, no
build step, preserving the repo's "jump straight in" promise.

```
tests/
  helpers/chrome-stub.mjs   # storage.local, alarms, action
  helpers/fake-adapter.mjs  # list / get / rename / setStarred, configurable
  classify.test.mjs
  titleTransform.test.mjs
  claude-adapter.test.mjs
  orchestrator.test.mjs
```

Assertions, targeting risk rather than coverage percentage:

| Area | Assertions |
| --- | --- |
| `seen` migration | old flat `{uuid: iso}` discarded; nested shape preserved; `{}` untouched |
| namespacing | two fake platforms keep independent `seen` maps |
| error isolation | adapter A throws on `list()` → B still sweeps; badge shows B's count |
| badge states | all adapters fail → grey `!`; zero enabled → badge cleared, not `!`; master switch off → zero adapter calls |
| convergence | sweeping twice issues no `rename()` on the second pass |
| capabilities | fake adapter without `capabilities.star` → `setStarred` never called |
| gating | `checkConversation` on a disabled platform returns `null` and calls no adapter |
| pruning | a chat that falls out of the list window is dropped from `seen` |
| `lastAssistantText` | returns the last assistant message; ignores human turns; missing `chat_messages` → `''` |
| `classify` | 🔴 marker, ✅ marker, and no marker |
| `titleTransform` | prefix add, prefix swap, and idempotence under double application |

## Documentation changes

- **README** — rewrite "Architecture" as three layers (orchestrator, service
  adapters, DOM adapters). Keep the endpoints table but scope it to the Claude
  adapter. Replace the `node --input-type=module -e ...` one-liner in
  "Development" with `node --test tests/`.
- **ROADMAP** — keep the adapter recipe already written in the working tree.
  Amend the per-platform-toggle line to record that the data model shipped while
  the UI waits for platform 2.

## Release

- `manifest.json` version `0.1.0` → `0.1.1`. No user-facing change, so patch.
- Rebuild the distribution zip and **assert `extension/adapters/` is present
  inside it**. This is the single highest ship risk: the worker `import`s that
  directory, so a zip built from a stale file list ships a dead service worker
  to every existing user.
- Produce a manual smoke checklist for the maintainer to run before submission:
  fresh install, upgrade from an install holding the old flat `seen` shape,
  master switch off, and network failure during a sweep.

## Commit sequence

Three commits, each independently revertible:

1. `refactor: split platform logic into service + DOM adapters` — the existing
   working-tree diff, plus `extension/adapters/`, plus the `lib/orchestrator.js`
   extraction, minus the Options "Platforms" UI. Behaviour preserving.
2. `test: add zero-dep suite for orchestrator + adapters` — `package.json` and
   `tests/`.
3. `docs: update README/ROADMAP for the adapter architecture` — plus the
   manifest version bump.

## Success criteria

- `node --test tests/` passes.
- `git status` is clean; no untracked file is imported by shipped code.
- The built zip contains `extension/adapters/index.js` and
  `extension/adapters/claude.js`.
- Loading the extension unpacked labels chats exactly as v0.1.0 did, and the
  popup queue links open the correct conversations.
- An install carrying the old flat `seen` shape upgrades without error.
