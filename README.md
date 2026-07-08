# Backrooms Field Manual

A fast, mobile-first companion web app for **Escape the Backrooms**
(Fancy Games, Steam) — browse levels, follow spoiler-gated walkthroughs, look
up entities, and track your progress. Styled as a field manual recovered from
inside the Backrooms.

Static Astro site, no backend. Progress lives in your browser (localStorage)
with JSON export/import. Content is scraped from the
[Escape the Backrooms Wiki](https://escapethebackrooms.fandom.com) into clean
JSON (see [LICENSE-CONTENT.md](LICENSE-CONTENT.md)).

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
