# Daily Wrap

A one-page site showing:

- Today's top headlines, grouped by source (BBC, NPR, WSJ), each
  collapsible independently — so one source with a big feed doesn't crowd
  out the others
- Yesterday's sports results
- Today's scheduled games and local start times
- Tomorrow's scheduled games (collapsed by default, to keep the page from
  getting crowded)

Sports are grouped by category — Football, Basketball, Baseball, Hockey,
Soccer, Combat Sports — covering NFL, NCAA football, NBA, WNBA, NCAA men's
basketball, MLB, NHL, the Premier League, Champions League, Europa League,
La Liga, Serie A, Bundesliga, Ligue 1, MLS, and UFC. Every category is
always shown, but one with no games/fights that day auto-collapses to a
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

- **Headlines** come from BBC, NPR, and WSJ's own direct RSS feeds (all
  `https://` — a plain `http://` feed on an `https://` page gets blocked by
  the browser as mixed content, independent of CORS). Each request tries a
  direct fetch first, and only falls back to racing `api.allorigins.win`,
  `api.codetabs.com`, and `thingproxy.freeboard.io` if that fails — it
  doesn't race all of them from the start, since ESPN's ~30 scoreboard
  requests per page load succeed direct and would otherwise hit the proxies
  with pointless parallel requests, eating into their rate limits right when
  the headline feeds (which always need a proxy) need them most. A feed
  that fails, or returns zero parsed items, logs a warning to the browser
  console for debugging and collapses to a one-line header instead of
  breaking the page.

  **AP News and Reuters are not included.** Both retired their public RSS
  feeds years ago, and were tried here as a Google News site-search instead
  (`news.google.com/rss/search?q=site:apnews.com...`) — including routing
  BBC and WSJ through the same mechanism, since a Google News search link
  redirects through Google, and paywalled/gated sites often grant access to
  that referred traffic even when the direct URL is blocked. In practice,
  every variant of this (plain aggregator feed, keyword search, topic feed,
  per-site search) was unreliable through free CORS proxies. Browser console
  evidence (2026-07-28) narrowed it down: `corsproxy.io` was rejecting
  everything with 403s, and separately, every request to `news.google.com`
  failed through the *other* proxies too, while non-Google domains (ESPN,
  NPR) worked fine through those same proxies — consistent with Google
  itself blocking/rate-limiting proxy traffic specifically to
  news.google.com, not a bad query. `corsproxy.io` was removed from the
  proxy list as dead weight. Getting AP News, Reuters, or the Google
  paywall-redirect trick back reliably would need a paid news API (e.g.
  NewsData.io, NewsAPI.org) instead of free anonymous proxies — a real
  architecture change from this site's current no-keys design, not
  something fixable with another query tweak.
- Boxing was tried under Combat Sports alongside UFC but removed: ESPN's
  API returns a genuine 400 for the `boxing/boxing` path (confirmed via
  browser console — not a proxy problem), and the correct path isn't
  verified.
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
