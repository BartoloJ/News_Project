# Daily Wrap

A one-page site showing:

- Today's top headlines, grouped by source (BBC, NPR, AP News, Reuters,
  WSJ), each collapsible independently — so one source with a big feed
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
step and no API keys.

- **Headlines** come from `headlines.json`, a file regenerated every 30
  minutes by a scheduled GitHub Actions workflow
  (`.github/workflows/update-headlines.yml`, running
  `scripts/fetch-headlines.js`). That script fetches BBC, NPR, and WSJ RSS
  directly, and AP News/Reuters via a Google News site-search (both retired
  their own public RSS years ago), then commits the result back to the repo.
  Fetching happens **server-side, in the Actions runner**, not in the
  visitor's browser — earlier this ran client-side through free CORS
  proxies (browsers block direct cross-origin RSS reads), but all of them
  turned out to be unreliable in practice (403s, dead DNS, 5xx errors,
  timeouts), so headline fetching moved server-side where CORS doesn't
  apply and proxies aren't needed at all. The tradeoff: headlines are up to
  ~30 minutes stale rather than fetched live on every page load. If a feed
  fails on a given run, the workflow keeps the previous successful data for
  that source instead of publishing an empty section.
- **Scores and schedules** still come from ESPN's public (unofficial,
  unauthenticated) scoreboard API, fetched directly from the browser each
  time the page loads, since it already allows cross-origin requests. A CORS
  proxy fallback (`api.allorigins.win`, `api.codetabs.com`) remains in
  `app.js` for the rare direct failure.

If a section fails to load, it shows an inline error instead of breaking the
rest of the page.

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

A second workflow (`.github/workflows/update-headlines.yml`) runs every 30
minutes (and on manual dispatch), regenerates `headlines.json`, and commits
it back to the branch if it changed — which in turn triggers the deploy
workflow above, so the published site picks up the new headlines.
