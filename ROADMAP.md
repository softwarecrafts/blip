# bliptracker — roadmap

Status of the project and what's planned. `bliptracker.xyz` · unofficial,
provider-neutral (Claude today, more later).

## ✅ Shipped

- **Core extension** (MV3): background sweep + instant content-script updates,
  deterministic 🔴/✅ classification from the marker Claude leaves in replies,
  idempotent title rename.
- **Star mirroring** (optional, off by default) — 🔴 ⇒ starred, ✅ ⇒ unstarred.
- **Popup queue** — toolbar icon shows the "waiting on you" list as deep links;
  badge shows the count.
- **Snooze** — per-chat mute from the popup: six presets, or a date + time on a
  half-hour grid. Snoozed chats leave the queue/badge, get a `💤🔴` title (syncs
  to mobile), and sit in a collapsed Snoozed section until a one-shot alarm
  wakes them. Wake schedule is local (`chrome.storage.local`), keyed per
  platform like `seen`.
- **Ignore** — take an ongoing chat (health log, journal) off the radar for
  good, from the popup. State lives entirely in the title as a `🔕` prefix (no
  store, no alarm — unlike snooze): the sweep reads `isIgnored(name)` and skips
  classifying, labelling, badging and queuing it. Syncs to mobile like any
  label, and is honoured even if the marker is typed by hand. A collapsed
  Ignored section restores it with **Track again**.
- **Settings page** — enabled / star mirroring / sweep interval.
- **Onboarding page** — opens on install: copy the preference prompt + deep link
  to Claude settings.
- **Brand** — name *bliptracker*, "Instrument / Scope" identity (radar icon,
  phosphor green + reserved contact-red), Chakra Petch uppercase display.
- **Landing page** (`landing/`) — static, GitHub-Pages-ready, radar hero.
- **Docs** — README, PRIVACY, MIT LICENSE, store-listing draft.
- **Full-history sweep** — `list()` walks every conversation via `offset`
  paging instead of the most recent 50, so a 🔴 chat can no longer drift out of
  the popup queue and lose its snooze. Never-seen chats below a seed depth are
  recorded rather than fetched, which keeps the first sweep cheap.
- **Extension brand type** — Chakra Petch / Hanken Grotesk / JetBrains Mono
  bundled locally (no CDN is reachable from an extension page) behind a shared
  `extension/ui/brand.css`, across popup, options and onboarding.

## ▶️ Next (build-side, mine)

- _(done)_ ~~Web Store screenshots~~, ~~listing polish~~, ~~landing placeholders~~,
  ~~adapter refactor~~ — all shipped.

### Adding a platform (the adapter recipe)

The refactor (2026-06-22) split every platform into two halves:

1. **Service adapter** — `extension/adapters/<id>.js`, registered in
   `adapters/index.js`. Implements `list()`, `get(id)` →
   `{name,isStarred,updatedAt,lastAssistantText,isTemporary}`, `rename(id,name)`,
   `setStarred(id,bool)`, `conversationUrl(id)`, `capabilities` (e.g. `star`).
   Runs in the background worker; owns all endpoints/auth/parsing.
2. **DOM adapter** — a host-keyed entry in `content.js` (`DOM_ADAPTERS`):
   `currentId(location)` + `titleNodes(id)`. Runs in the page; owns selectors.

The orchestrator (`background.js`) is platform-agnostic — it loops
`enabledAdapters(settings)`, namespaces the `seen` cache per platform, and
routes `check-conversation` by the `platform` the content script tags.

**Decisions for the next platform (ChatGPT/Gemini):**
- **Optional host permissions**, requested only when the user enables that
  platform in Options (needs `chrome.scripting.registerContentScripts` to
  inject the content script after the grant; manifest stays Claude-only by
  default).
- **Explicit per-platform toggles** in Options (`settings.platforms[id]`); new
  platforms default **off** until enabled. The data model shipped in 0.1.1; the
  Options UI is deliberately absent until there is a second platform to choose
  between (a lone Claude toggle would just duplicate the master switch).
- Per-platform **onboarding** copy (Claude preferences vs ChatGPT custom
  instructions vs Gemini saved info).
- Keep the interface **generic** — don't over-fit to one platform's quirks.
- **Temporary chats must be filtered in `list()`**, as the Claude adapter does.
  The orchestrator skips a conversation whose `isTemporary` is true but does not
  record it in `seen`, so an adapter that surfaces temporary chats would refetch
  them on every sweep. Harmless today; fix the orchestrator if a future adapter
  can't filter them adapter-side.

## 🔭 Future features

- **"Resolve" button in the popup** — per-blip button that closes a chat off
  with a resolution and flips it to ✅.
  - _Why it's not trivial:_ the title is *derived* from the chat's last marker
    every sweep, so a UI-only relabel would be reverted. The correct version
    **sends a wrap-up message** so Claude itself writes the resolution ending
    in `✅ Resolved`, which then propagates and syncs to mobile.
  - _Needs:_ recon of the claude.ai **completion endpoint** (streaming +
    message-tree params — more involved than the rename API we use today).
  - _Caveats:_ uses the user's usage quota; the chat's enabled MCP tools could
    fire on that turn, so the canned prompt must say "summarize only, no tools."
- **Bulk-archive ✅ chats** — sweep up resolved conversations in one action.
- **Multi-AI** — ChatGPT, Gemini adapters. Architecture is ready (see the
  adapter recipe above); each needs endpoint recon + its two adapter halves +
  optional-permission wiring + onboarding copy.

## Notes / constraints

- Unofficial; relies on undocumented claude.ai endpoints that can change.
- No server, no analytics — all processing is local / direct to claude.ai.
- Confirmed endpoints (recon 2026-06-12) are documented in `README.md`.
