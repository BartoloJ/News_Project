# Daily Wrap

A one-page site showing:

- Today's top headlines
- Yesterday's sports results
- Today's scheduled games and local start times

Sports are grouped by category (Football, Basketball, Baseball, Hockey,
Soccer) covering NFL, NBA, MLB, NHL, NCAA football, NCAA men's basketball,
the Premier League, Champions League, and MLS — every category is always
shown, even on days when only one sport has games. Each of the three main
sections can be collapsed/expanded by clicking its header.

## How it works

This is a static site (`index.html` / `style.css` / `app.js`) with no build
step and no API keys. All data is fetched client-side, in the visitor's
browser, each time the page loads:

- **Headlines** come from public RSS feeds (Google News, BBC, NPR, and
  AP News/Reuters via Google News site-search), fetched through a CORS
  proxy — trying a direct fetch first, then falling back through
  `api.allorigins.win`, `corsproxy.io`, and `api.codetabs.com` (whichever
  responds first) — since browsers block direct cross-origin RSS reads.
- **Scores and schedules** come from ESPN's public (unofficial, unauthenticated)
  scoreboard API, fetched directly since it already allows cross-origin
  requests.

Because everything runs in the browser, there's no server to keep running
and no secrets to manage — but it does depend on those third-party services
staying up and reachable. If a section fails to load, it shows an inline
error instead of breaking the rest of the page, and each visit re-fetches
fresh data (nothing is generated at build time).

## Running locally

Just serve the folder, e.g.:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Deploying

A GitHub Actions workflow (`.github/workflows/deploy.yml`) publishes the site
to GitHub Pages on every push to this repo's default branch. To enable it:
in the repo's **Settings → Pages**, set **Source** to "GitHub Actions".
