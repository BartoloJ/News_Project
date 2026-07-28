// Daily Wrap — headlines, yesterday's scores, today's games.
// No API keys required: news comes from public RSS feeds (routed through a
// CORS proxy since browsers block direct cross-origin RSS reads), and sports
// data comes from ESPN's public scoreboard API.

// Proxies used only as a fallback (see fetchWithFallback) — not raced
// alongside the direct attempt, so ESPN's ~30 scoreboard requests per page
// load (which succeed direct) don't also hammer these with pointless
// parallel requests and starve the headline fetches that actually need them.
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  // corsproxy.io removed: confirmed (browser console, 2026-07-28) returning
  // 403 across the board — no longer usable for free/anonymous requests.
];

// Every news.google.com-based headline source (AP News, Reuters, and BBC/WSJ
// when routed through a Google News search for the paywall-redirect trick)
// was unreliable — not because of the specific query, but because Google
// appears to block/rate-limit requests to news.google.com coming from these
// free CORS proxies. ESPN and NPR's own domains aren't affected the same
// way, which is how this got isolated. BBC and WSJ are back on their own
// direct feeds (reliable, no Google dependency). AP News and Reuters don't
// have a working direct public RSS feed anymore (both retired theirs years
// ago) and can't be included reliably without a paid news API — see the
// README for that tradeoff.
const RSS_FEEDS = [
  // Must be https — the page itself loads over https, and browsers block
  // fetching plain http:// resources from an https:// page outright
  // ("mixed content"), independent of CORS or any proxy.
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
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
  // Boxing removed: 'boxing/boxing' returns a genuine 400 directly from
  // ESPN (confirmed via browser console, not a proxy issue) — the correct
  // API path for boxing isn't this one and I don't have a verified
  // alternative to swap in without live testing.
];

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

function pad(n) { return String(n).padStart(2, '0'); }
function toYYYYMMDD(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function longDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithFallback(url, { asText = false } = {}) {
  // Try a direct fetch first, alone. Some APIs (ESPN's) already allow
  // cross-origin requests, and trying this alone — instead of racing it
  // against the proxies every time — avoids sending pointless proxy
  // requests for the ~30 scoreboard calls per page load that succeed
  // direct anyway, which was likely starving the proxies' rate limits for
  // the headline feeds that actually need them.
  try {
    const res = await fetchWithTimeout(url);
    return asText ? await res.text() : await res.json();
  } catch {
    // Expected for most RSS feeds (no CORS headers) — fall through to proxies.
  }

  const attempts = CORS_PROXIES.map((makeProxyUrl) =>
    fetchWithTimeout(makeProxyUrl(url)).then((res) => (asText ? res.text() : res.json()))
  );
  try {
    return await Promise.any(attempts);
  } catch (aggregateErr) {
    throw aggregateErr.errors?.[0] || aggregateErr;
  }
}

// ---------- Headlines ----------

async function fetchFeedItems(feed) {
  const xmlText = await fetchWithFallback(feed.url, { asText: true });
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  return Array.from(doc.querySelectorAll('item')).map((item) => ({
    title: item.querySelector('title')?.textContent?.trim(),
    link: item.querySelector('link')?.textContent?.trim(),
    pubDate: item.querySelector('pubDate')?.textContent,
    source: feed.name,
  })).filter((it) => it.title && it.link);
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

async function loadHeadlines() {
  const container = document.getElementById('headlines-list');
  const sub = document.getElementById('headlines-sub');
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchFeedItems));

  const bySource = RSS_FEEDS.map((feed, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') {
      console.warn(`Headline fetch failed for ${feed.name}:`, r.reason);
      return { feed, items: null };
    }
    const items = dedupeByTitle(r.value)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, HEADLINES_PER_SOURCE);
    if (items.length === 0) {
      console.warn(`Headline feed for ${feed.name} returned 0 items — the proxy may have returned a non-XML response (e.g. a redirect/consent page) instead of the feed.`);
    }
    return { feed, items };
  });

  if (bySource.every((s) => s.items === null)) {
    container.innerHTML = '<p class="error">Couldn\'t load headlines right now. Try refreshing the page.</p>';
    sub.textContent = '';
    return;
  }

  sub.textContent = longDate(today);

  container.innerHTML = '';
  for (const { feed, items } of bySource) {
    const sourceEl = document.createElement('details');
    sourceEl.className = 'source-group';
    let bodyHtml;
    if (items === null) {
      bodyHtml = '<p class="empty">Couldn\'t load.</p>';
    } else if (items.length === 0) {
      bodyHtml = '<p class="empty">No headlines found.</p>';
    } else {
      sourceEl.open = true;
      bodyHtml = '<ul class="headline-list">' + items.map((it) =>
        `<li><a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a></li>`
      ).join('') + '</ul>';
    }
    sourceEl.innerHTML = `<summary><h3>${feed.name}</h3></summary><div class="source-group-body">${bodyHtml}</div>`;
    container.appendChild(sourceEl);
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
