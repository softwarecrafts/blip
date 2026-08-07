# Landing page

Static marketing site for bliptracker. No build step, no dependencies —
just `index.html` + `styles.css` + `main.js`, plus bundled fonts in `fonts/`.
The page makes **no third-party requests at all**; keep it that way, since
"nothing leaves your browser" is the product's central claim. Refresh the
faces with `bash scripts/fetch-fonts.sh`.

## Preview locally

```sh
cd landing
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Netlify, configured by `netlify.toml` at the repo root (`publish = "landing"`,
no build command). Any static host works — there's no server side.

## Keep in sync

- The **preference prompt** appears in two places — the page (`main.js`,
  `FULL_PROMPT`) and the extension (`extension/onboarding.html`). Keep them in
  sync if you tweak the wording.
- **Feature copy** — the features section and FAQ should track what's actually
  shipped in `ROADMAP.md`. Snooze and Ignore are covered in the "Quiet the blips
  you can't act on" card.

## Design

"Instrument / Scope" — a radar motif: dark phosphor grounds for signature
moments (hero, privacy, final CTA), phosphor green (`#2fd6a6`) as the primary
accent, and a hot contact-red (`#ff5a4d`) reserved strictly for the "waiting on
you" state — mirroring the extension's radar icon. JetBrains Mono carries the
operator voice; Chakra Petch sets display; Hanken Grotesk reads long-form.
Fully responsive; reveal-on-scroll is progressive enhancement with a safety-net
fallback so content never stays hidden.
