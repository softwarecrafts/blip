# Landing page

Static marketing site for Blip. No build step, no dependencies —
just `index.html` + `styles.css` + `main.js` (fonts load from Google Fonts).

## Preview locally

```sh
cd landing
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy (GitHub Pages)

Point Pages at this folder, or copy its contents to the Pages root. Any static
host works (Netlify, Cloudflare Pages, etc.) — there's no server side.

## Before launch — fill in the placeholders

Links currently marked TBD (hover shows the placeholder label):

- **GitHub URL** — the repo link (nav, hero, final CTA, footer)
- **Chrome Web Store URL** — once the listing is live (remove the `soon` badge)
- **Privacy** footer link — point at the hosted `PRIVACY.md`

The preference prompt appears in two places — the page (`main.js`, `FULL_PROMPT`)
and the extension (`extension/onboarding.html`). Keep them in sync if you tweak
the wording.

## Design

"Instrument / Scope" — a radar motif: dark phosphor grounds for signature
moments (hero, privacy, final CTA), phosphor green (`#2fd6a6`) as the primary
accent, and a hot contact-red (`#ff5a4d`) reserved strictly for the "waiting on
you" state — mirroring the extension's radar icon. JetBrains Mono carries the
operator voice; Fraunces adds warmth in display; Hanken Grotesk reads long-form.
Fully responsive; reveal-on-scroll is progressive enhancement with a safety-net
fallback so content never stays hidden.
