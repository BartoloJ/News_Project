# Daily Wrap

A one-page site showing:

- Today's top headlines, grouped by source (Google News, BBC, NPR, AP News,
  Reuters), each collapsible independently — so one source with a big feed
  (looking at you, Reuters) doesn't crowd out the others
- Yesterday's sports results
- Today's scheduled games and local start times
- Tomorrow's scheduled games (collapsed by default, to keep the page from
  getting crowded)

Sports are grouped by category — Football, Basketball, Baseball, Hockey,
Soccer, Combat Sports — covering NFL, NCAA football, NBA, WNBA, NCAA men's
basketball, MLB, NHL, the Premier League, Champions League, Europa League,
La Liga, Serie A, Bundesliga, Ligue 1, MLS, UFC, and boxing. Every category
is always shown, but one with no games/fights that day auto-collapses to a
single-line header instead of taking up space; categories with action stay
expanded. Each of the four main sections can also be collapsed/expanded by
clicking its header.

Team and fighter names show their full name (e.g. "New York Yankees", not
just "Yankees") and link out to that team's/fighter's real ESPN.com page for
full stats, roster, and schedule — rather than this site trying to build
and keep a second copy of that in sync.

Golf, tennis, and motorsports are intentionally not included: those are
multi-day leaderboard/tournament formats (ranked fields, no single "final
score" pair), fundamentally different from the daily match schedule this
site is built around, and would need their own leaderboard-style UI to do
properly.

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
