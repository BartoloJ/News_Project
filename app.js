// Daily Wrap — headlines, yesterday's scores, today's games.
// No API keys required: news comes from public RSS feeds (routed through a
// CORS proxy since browsers block direct cross-origin RSS reads), and sports
// data comes from ESPN's public scoreboard API.

// Fallback only — see fetchWithFallback, which tries the URL directly first
// and only reaches for these if that fails. That ordering matters a lot:
// ESPN allows cross-origin requests, so its ~51 scoreboard calls per load
// succeed direct and never touch these shared free proxies, leaving their
// capacity for the RSS feeds that genuinely need a proxy.
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  // corsproxy.io removed: returned 403 on every single request (confirmed in
  // a browser console log, 2026-07-29) — a guaranteed-failing branch.
];

// `url` may be a string, or a function evaluated per request when the URL
// needs to vary between loads. Every feed gets the localStorage fallback in
// loadHeadlines (stale-but-visible beats an empty section).
const RSS_FEEDS = [
  // Must be https: the page is served over https, and browsers hard-block
  // http subresources as mixed content before the request is even made.
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  {
    name: 'AP News',
    // Rotate the recency window so repeated refreshes don't hit Google with
    // the byte-identical URL every time. Windows are all >= the 2d known to
    // return a full result set, so varying can only widen results.
    url: () => {
      const windows = ['2d', '3d', '4d'];
      const when = windows[Math.floor(Math.random() * windows.length)];
      return `https://news.google.com/rss/search?q=site:apnews.com+when:${when}&hl=en-US&gl=US&ceid=US:en`;
    },
  },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
];

// Grouped by sport so the site stays organized even on days when only one
// sport has games (e.g. baseball-only stretches of the calendar). Covers the
// leagues with the heaviest US betting volume; a category with no games that
// day auto-collapses (see renderLeagueGroups) rather than disappearing.
// `siteSport` is the espn.com URL segment used to link team/fighter names to
// their real ESPN page (stats, roster, full schedule) instead of building a
// second copy of that here.
const LEAGUES = [
  { id: 'nfl', name: 'NFL', path: 'football/nfl', group: 'Football', siteSport: 'nfl' },
  { id: 'ncaaf', name: 'College Football', path: 'football/college-football', group: 'Football', siteSport: 'college-football' },
  { id: 'nba', name: 'NBA', path: 'basketball/nba', group: 'Basketball', siteSport: 'nba' },
  { id: 'wnba', name: 'WNBA', path: 'basketball/wnba', group: 'Basketball', siteSport: 'wnba' },
  { id: 'ncaab', name: 'College Basketball', path: 'basketball/mens-college-basketball', group: 'Basketball', siteSport: 'mens-college-basketball' },
  { id: 'mlb', name: 'MLB', path: 'baseball/mlb', group: 'Baseball', siteSport: 'mlb' },
  { id: 'nhl', name: 'NHL', path: 'hockey/nhl', group: 'Hockey', siteSport: 'nhl' },
  { id: 'epl', name: 'Premier League', path: 'soccer/eng.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'ucl', name: 'Champions League', path: 'soccer/uefa.champions', group: 'Soccer', siteSport: 'soccer' },
  { id: 'uel', name: 'Europa League', path: 'soccer/uefa.europa', group: 'Soccer', siteSport: 'soccer' },
  { id: 'laliga', name: 'La Liga', path: 'soccer/esp.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'seriea', name: 'Serie A', path: 'soccer/ita.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'bundesliga', name: 'Bundesliga', path: 'soccer/ger.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'ligue1', name: 'Ligue 1', path: 'soccer/fra.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'mls', name: 'MLS', path: 'soccer/usa.1', group: 'Soccer', siteSport: 'soccer' },
  { id: 'ufc', name: 'UFC', path: 'mma/ufc', group: 'Combat Sports', siteSport: 'mma' },
  // Boxing removed: ESPN returns a genuine HTTP 400 for the 'boxing/boxing'
  // path (direct, not via a proxy — confirmed in a browser console log), so
  // it only ever produced errors. No verified correct path to swap in.
];

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

function pad(n) { return String(n).padStart(2, '0'); }
function toYYYYMMDD(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function longDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

// A direct attempt either succeeds quickly or fails fast on CORS, so it gets
// a short leash. The free proxies are genuinely slow — an 8s cap on them was
// aborting requests that would have succeeded, which is what made most feeds
// fail with AbortError while one lucky feed loaded.
const DIRECT_TIMEOUT_MS = 6000;
const PROXY_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, timeoutMs = DIRECT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithFallback(url, { asText = false } = {}) {
  // Direct first, on its own. Racing this against the proxies meant every
  // ESPN scoreboard call — 17 leagues x 3 days — also fired a proxy request
  // it never needed, ~150 of them at once, swamping the shared free proxies
  // and starving the RSS feeds that have no direct option. Those feeds then
  // failed seemingly at random (whichever lost the race), which looked like
  // one source being singled out.
  try {
    const res = await fetchWithTimeout(url);
    return asText ? await res.text() : await res.json();
  } catch {
    // Expected for most RSS feeds (no CORS headers) — fall through.
  }

  const attempts = CORS_PROXIES.map((makeProxyUrl) =>
    fetchWithTimeout(makeProxyUrl(url), PROXY_TIMEOUT_MS)
      .then((res) => (asText ? res.text() : res.json()))
  );
  try {
    return await Promise.any(attempts);
  } catch (aggregateErr) {
    throw aggregateErr.errors?.[0] || aggregateErr;
  }
}

// ---------- Headlines ----------

async function fetchFeedItems(feed) {
  const url = typeof feed.url === 'function' ? feed.url() : feed.url;
  const xmlText = await fetchWithFallback(url, { asText: true });
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  return Array.from(doc.querySelectorAll('item')).map((item) => ({
    title: item.querySelector('title')?.textContent?.trim(),
    link: item.querySelector('link')?.textContent?.trim(),
    pubDate: item.querySelector('pubDate')?.textContent,
    source: feed.name,
  })).filter((it) => it.title && it.link);
}

// Last-good-result cache, for feeds where an intermittent upstream failure
// (throttling, a proxy hiccup) would otherwise show an empty section even
// though nothing is actually wrong. All localStorage access is best-effort:
// it throws in private-browsing modes and when the quota is full, and a
// missing cache is never worse than the no-cache behavior.
const HEADLINE_CACHE_PREFIX = 'dailywrap:headlines:';

function readCachedItems(feed) {
  try {
    const raw = localStorage.getItem(HEADLINE_CACHE_PREFIX + feed.name);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedItems(feed, items) {
  try {
    localStorage.setItem(
      HEADLINE_CACHE_PREFIX + feed.name,
      JSON.stringify({ savedAt: Date.now(), items })
    );
  } catch {
    // Caching is an optimization — never let it break the render.
  }
}

function relativeTime(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function dedupeByTitle(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

const HEADLINES_PER_SOURCE = 8;

function renderSourceBody(items, cachedAt) {
  if (items === null) return '<p class="empty">Couldn\'t load.</p>';
  if (items.length === 0) return '<p class="empty">No headlines found.</p>';
  const staleNote = cachedAt
    ? `<p class="empty">Saved copy from ${relativeTime(cachedAt)} — couldn't refresh just now.</p>`
    : '';
  return staleNote + '<ul class="headline-list">' + items.map((it) =>
    `<li><a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a></li>`
  ).join('') + '</ul>';
}

async function loadHeadlines() {
  const container = document.getElementById('headlines-list');
  const sub = document.getElementById('headlines-sub');
  sub.textContent = longDate(today);

  // Lay out every source up front, then fill each one in as its fetch
  // resolves. Fetching is sequential (below), so without this the page
  // would sit empty until the slowest feed finished.
  container.innerHTML = '';
  const sections = new Map();
  for (const feed of RSS_FEEDS) {
    const el = document.createElement('details');
    el.className = 'source-group';
    el.innerHTML = `<summary><h3>${feed.name}</h3></summary>` +
      `<div class="source-group-body"><p class="loading">Loading…</p></div>`;
    container.appendChild(el);
    sections.set(feed.name, el);
  }

  // One feed at a time. Firing all five at once meant ten simultaneous
  // requests against two shared free proxies, and they were too slow to
  // serve that — four of five feeds died on our own abort timer while a
  // single lucky one loaded. Sequential keeps it to two in flight.
  for (const feed of RSS_FEEDS) {
    let items = null;
    try {
      items = dedupeByTitle(await fetchFeedItems(feed))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, HEADLINES_PER_SOURCE);
      if (items.length === 0) {
        console.warn(`Headline feed for ${feed.name} returned 0 items — the response may not have been valid RSS.`);
      }
    } catch (err) {
      console.warn(`Headline fetch failed for ${feed.name}:`, err);
    }

    // Every feed now caches, not just AP News: the console log showed all
    // of them can lose the proxy race, so any of them can benefit from
    // falling back to the last good copy.
    let cachedAt = null;
    if (items && items.length > 0) {
      writeCachedItems(feed, items);
    } else {
      const cached = readCachedItems(feed);
      if (cached) {
        console.warn(`Showing cached headlines for ${feed.name} (saved ${relativeTime(cached.savedAt)}).`);
        items = cached.items;
        cachedAt = cached.savedAt;
      }
    }

    const el = sections.get(feed.name);
    el.querySelector('.source-group-body').innerHTML = renderSourceBody(items, cachedAt);
    if (items && items.length > 0) el.open = true;
  }
}

// ---------- Sports ----------

// A competitor is either a team (most sports) or an athlete (fights). Either
// way, link its name to the real ESPN page for that team/fighter — building
// and keeping our own stats/roster pages in sync would be its own project.
function extractParticipant(c, league) {
  const isAthlete = !!c.athlete && !c.team;
  const entity = c.team || c.athlete;
  const name = entity?.displayName || entity?.shortDisplayName || entity?.name || 'TBD';
  const link = entity?.id
    ? `https://www.espn.com/${league.siteSport}/${isAthlete ? 'player' : 'team'}/_/id/${entity.id}`
    : null;
  return { name, score: c.score, link };
}

function normalizeEvent(ev, league) {
  const comp = ev.competitions?.[0];
  const statusType = comp?.status?.type || {};
  const competitors = comp?.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1];
  return {
    date: ev.date,
    state: statusType.state, // 'pre' | 'in' | 'post'
    completed: !!statusType.completed,
    statusDetail: statusType.shortDetail || statusType.detail || '',
    home: home ? extractParticipant(home, league) : null,
    away: away ? extractParticipant(away, league) : null,
  };
}

async function fetchScoreboard(league, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${toYYYYMMDD(date)}`;
  try {
    const data = await fetchWithFallback(url);
    return (data.events || []).map((ev) => normalizeEvent(ev, league));
  } catch (err) {
    console.warn(`Scoreboard fetch failed for ${league.name}:`, err);
    return null; // signals a failed fetch, distinct from "no games"
  }
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function renderLeagueGroups(container, leagueResults, renderGame, emptyLabel) {
  if (leagueResults.every((r) => r.events === null)) {
    container.innerHTML = '<p class="error">Couldn\'t load sports data right now. Try refreshing the page.</p>';
    return;
  }

  const byGroup = groupBy(leagueResults, (r) => r.league.group);
  container.innerHTML = '';
  for (const [groupName, leagues] of byGroup) {
    const hasGames = leagues.some((r) => r.events && r.events.length > 0);
    const groupEl = document.createElement('details');
    groupEl.className = 'league-group';
    if (hasGames) groupEl.open = true;
    let groupHtml = `<summary><h3>${groupName}</h3></summary><div class="league-group-body"><ul class="game-list">`;
    for (const { league, events } of leagues) {
      if (events === null) {
        groupHtml += `<li class="game-row muted-row"><span class="team-name">${league.name}</span><span class="game-status">Couldn't load</span></li>`;
      } else if (events.length === 0) {
        groupHtml += `<li class="game-row muted-row"><span class="team-name">${league.name}</span><span class="game-status">${emptyLabel}</span></li>`;
      } else {
        groupHtml += events.map((ev) => renderGame(ev, league)).join('');
      }
    }
    groupHtml += `</ul></div>`;
    groupEl.innerHTML = groupHtml;
    container.appendChild(groupEl);
  }
}

function nameHtml(participant) {
  return participant.link
    ? `<a href="${participant.link}" target="_blank" rel="noopener noreferrer">${participant.name}</a>`
    : participant.name;
}

function renderYesterdayGame(ev, league) {
  if (!ev.completed) return '';
  const away = ev.away, home = ev.home;
  return `<li class="game-row">
    <div class="game-teams">
      <div class="team-row"><span class="team-name">${league.name} · ${nameHtml(away)}</span><span class="team-score">${away.score}</span></div>
      <div class="team-row"><span class="team-name">${nameHtml(home)}</span><span class="team-score">${home.score}</span></div>
    </div>
    <span class="game-status">${ev.statusDetail || 'Final'}</span>
  </li>`;
}

function renderScheduledGame(ev, league) {
  const away = ev.away, home = ev.home;
  const time = new Date(ev.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  let statusHtml;
  if (ev.state === 'in') {
    statusHtml = `<span class="game-status live">${ev.statusDetail || 'Live'}</span>`;
  } else if (ev.state === 'post') {
    statusHtml = `<span class="game-status">${ev.statusDetail || 'Final'}</span>`;
  } else {
    statusHtml = `<span class="game-status">${time}</span>`;
  }
  const showScores = ev.state !== 'pre';
  return `<li class="game-row">
    <div class="game-teams">
      <div class="team-row"><span class="team-name">${league.name} · ${nameHtml(away)}</span>${showScores ? `<span class="team-score">${away.score}</span>` : ''}</div>
      <div class="team-row"><span class="team-name">${nameHtml(home)}</span>${showScores ? `<span class="team-score">${home.score}</span>` : ''}</div>
    </div>
    ${statusHtml}
  </li>`;
}

async function loadYesterdayScores() {
  document.getElementById('yesterday-date').textContent = longDate(yesterday);
  const container = document.getElementById('yesterday-scores-list');
  const results = await Promise.all(LEAGUES.map(async (league) => {
    const events = await fetchScoreboard(league, yesterday);
    const completed = events ? events.filter((e) => e.completed) : null;
    return { league, events: completed };
  }));
  renderLeagueGroups(container, results, renderYesterdayGame, 'No games');
}

async function loadGamesFor(dateLabelId, listId, date) {
  document.getElementById(dateLabelId).textContent = longDate(date);
  const container = document.getElementById(listId);
  const results = await Promise.all(LEAGUES.map(async (league) => {
    const events = await fetchScoreboard(league, date);
    return { league, events };
  }));
  renderLeagueGroups(container, results, renderScheduledGame, 'No games scheduled');
}

async function loadTodayGames() {
  await loadGamesFor('today-date', 'today-games-list', today);
}

async function loadTomorrowGames() {
  await loadGamesFor('tomorrow-date', 'tomorrow-games-list', tomorrow);
}

// ---------- Init ----------

function setLastUpdated() {
  document.getElementById('last-updated').textContent =
    `Last checked ${today.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`;
}

setLastUpdated();
loadHeadlines();
loadYesterdayScores();
loadTodayGames();
loadTomorrowGames();
