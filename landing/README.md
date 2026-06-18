# Landing page

Static marketing site for Claude Chat Status. No build step, no dependencies —
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

"Editorial Triage" — warm paper (`#f4f1ea`), signal red (`#e5484d`), warm dark
(`#211f1c`), matching the extension icon. Fraunces (display) / Hanken Grotesk
(body) / JetBrains Mono (markers & code). The red status dot recurs as the motif
throughout. Fully responsive; reveal-on-scroll is progressive enhancement with a
safety-net fallback so content never stays hidden.
