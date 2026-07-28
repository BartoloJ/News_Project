// Daily Wrap — headlines, yesterday's scores, today's games.
// No API keys required: news comes from public RSS feeds (routed through a
// CORS proxy since browsers block direct cross-origin RSS reads), and sports
// data comes from ESPN's public scoreboard API.

const CORS_PROXIES = [
  (url) => url, // try direct first — some APIs (e.g. ESPN's) already allow cross-origin fetches
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

const RSS_FEEDS = [
  { name: 'Google News', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en' },
  { name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'AP News', url: 'https://news.google.com/rss/search?q=site:apnews.com+when:2d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en' },
];

// Grouped by sport so the site stays organized even on days when only one
// sport has games (e.g. baseball-only stretches of the calendar). Covers the
// leagues with the heaviest US betting volume; a category with no games that
// day auto-collapses (see renderLeagueGroups) rather than disappearing.
const LEAGUES = [
  { id: 'nfl', name: 'NFL', path: 'football/nfl', group: 'Football' },
  { id: 'ncaaf', name: 'College Football', path: 'football/college-football', group: 'Football' },
  { id: 'nba', name: 'NBA', path: 'basketball/nba', group: 'Basketball' },
  { id: 'wnba', name: 'WNBA', path: 'basketball/wnba', group: 'Basketball' },
  { id: 'ncaab', name: 'College Basketball', path: 'basketball/mens-college-basketball', group: 'Basketball' },
  { id: 'mlb', name: 'MLB', path: 'baseball/mlb', group: 'Baseball' },
  { id: 'nhl', name: 'NHL', path: 'hockey/nhl', group: 'Hockey' },
  { id: 'epl', name: 'Premier League', path: 'soccer/eng.1', group: 'Soccer' },
  { id: 'ucl', name: 'Champions League', path: 'soccer/uefa.champions', group: 'Soccer' },
  { id: 'uel', name: 'Europa League', path: 'soccer/uefa.europa', group: 'Soccer' },
  { id: 'laliga', name: 'La Liga', path: 'soccer/esp.1', group: 'Soccer' },
  { id: 'seriea', name: 'Serie A', path: 'soccer/ita.1', group: 'Soccer' },
  { id: 'bundesliga', name: 'Bundesliga', path: 'soccer/ger.1', group: 'Soccer' },
  { id: 'ligue1', name: 'Ligue 1', path: 'soccer/fra.1', group: 'Soccer' },
  { id: 'mls', name: 'MLS', path: 'soccer/usa.1', group: 'Soccer' },
];

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

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

async function loadHeadlines() {
  const list = document.getElementById('headlines-list');
  const sub = document.getElementById('headlines-sub');
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchFeedItems));

  let items = [];
  results.forEach((r) => { if (r.status === 'fulfilled') items = items.concat(r.value); });

  if (items.length === 0) {
    list.innerHTML = '<li class="error">Couldn\'t load headlines right now. Try refreshing the page.</li>';
    sub.textContent = '';
    return;
  }

  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const deduped = dedupeByTitle(items).slice(0, 15);

  sub.textContent = longDate(today);

  list.innerHTML = '';
  deduped.forEach((it) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a>` +
      `<span class="headline-source">${it.source}</span>`;
    list.appendChild(li);
  });
}

// ---------- Sports ----------

function normalizeEvent(ev) {
  const comp = ev.competitions?.[0];
  const statusType = comp?.status?.type || {};
  const competitors = comp?.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  return {
    date: ev.date,
    state: statusType.state, // 'pre' | 'in' | 'post'
    completed: !!statusType.completed,
    statusDetail: statusType.shortDetail || statusType.detail || '',
    home: home ? { name: home.team?.shortDisplayName || home.team?.displayName || 'TBD', score: home.score } : null,
    away: away ? { name: away.team?.shortDisplayName || away.team?.displayName || 'TBD', score: away.score } : null,
  };
}

async function fetchScoreboard(league, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard?dates=${toYYYYMMDD(date)}`;
  try {
    const data = await fetchWithFallback(url);
    return (data.events || []).map(normalizeEvent);
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

function renderYesterdayGame(ev, league) {
  if (!ev.completed) return '';
  const away = ev.away, home = ev.home;
  return `<li class="game-row">
    <div class="game-teams">
      <div class="team-row"><span class="team-name">${league.name} · ${away.name}</span><span class="team-score">${away.score}</span></div>
      <div class="team-row"><span class="team-name">${home.name}</span><span class="team-score">${home.score}</span></div>
    </div>
    <span class="game-status">${ev.statusDetail || 'Final'}</span>
  </li>`;
}

function renderTodayGame(ev, league) {
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
      <div class="team-row"><span class="team-name">${league.name} · ${away.name}</span>${showScores ? `<span class="team-score">${away.score}</span>` : ''}</div>
      <div class="team-row"><span class="team-name">${home.name}</span>${showScores ? `<span class="team-score">${home.score}</span>` : ''}</div>
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

async function loadTodayGames() {
  document.getElementById('today-date').textContent = longDate(today);
  const container = document.getElementById('today-games-list');
  const results = await Promise.all(LEAGUES.map(async (league) => {
    const events = await fetchScoreboard(league, today);
    return { league, events };
  }));
  renderLeagueGroups(container, results, renderTodayGame, 'No games scheduled');
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
