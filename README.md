# Backrooms Field Manual

**Live: https://moscovium0894.github.io/backrooms-wiki/**

A fast, mobile-first companion web app for **Escape the Backrooms**
(Fancy Games, Steam), styled as a field manual recovered from inside the
Backrooms. Static Astro site, no backend; content scraped from the
[Escape the Backrooms Wiki](https://escapethebackrooms.fandom.com)
(see [LICENSE-CONTENT.md](LICENSE-CONTENT.md)).

Highlights:

- **Route map** — vertical subway-style map of all 27 main levels + secret
  branches; traveled path paints green, the current leg animates, secrets
  stay "?" until discovered, press-and-hold marks a level cleared
- **Level case-files** — at-a-glance dossier, spoiler-redacted walkthroughs
  and maps (tap-to-reveal), expandable threat rows, escape-log checklists
  with a CLEARED stamp, per-level death tally and private field notes
- **Threat registry** — DO/DON'T survival cards, danger filters, a personal
  bestiary of sighted entities
- **Progress log** — stats, per-content-drop bars, a canvas-drawn expedition
  report card for sharing, and progress transfer via JSON or a single link
- **Feels like an app** — home-screen installable, works offline mid-game,
  fuzzy search (`/`), swipe navigation, hover states on desktop
- **Self-updating** — a nightly workflow re-scrapes the wiki and redeploys
  only when validated content changed

## Develop

```sh
npm install
npm run dev        # dev server
npm run build      # static build to dist/
npm run preview    # serve the build at /backrooms-wiki/
```

## Refresh content

```sh
pip install -r requirements.txt
npm run fetch      # scrape wiki -> src/data/*.json + public/images/ (cached, ~1 req/s)
npm run validate   # integrity checks; must pass before committing
```

Scraped JSON and images are committed, so the site builds hermetically —
no Python needed in CI.

## Deploy

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`
(repo Settings → Pages → Source: GitHub Actions).
