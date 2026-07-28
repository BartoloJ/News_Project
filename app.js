// Daily Wrap — headlines, yesterday's scores, today's games.
// No API keys required: news comes from public RSS feeds (routed through a
// CORS proxy since browsers block direct cross-origin RSS reads), and sports
// data comes from ESPN's public scoreboard API.

const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

const RSS_FEEDS = [
  { name: 'Google News', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en' },
  { name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
];

const LEAGUES = [
  { id: 'nfl', name: 'NFL', path: 'football/nfl', group: 'Major U.S. Pro' },
  { id: 'nba', name: 'NBA', path: 'basketball/nba', group: 'Major U.S. Pro' },
  { id: 'mlb', name: 'MLB', path: 'baseball/mlb', group: 'Major U.S. Pro' },
  { id: 'nhl', name: 'NHL', path: 'hockey/nhl', group: 'Major U.S. Pro' },
  { id: 'ncaaf', name: 'College Football', path: 'football/college-football', group: 'College' },
  { id: 'ncaab', name: 'College Basketball', path: 'basketball/mens-college-basketball', group: 'College' },
  { id: 'epl', name: 'Premier League', path: 'soccer/eng.1', group: 'Soccer' },
  { id: 'ucl', name: 'Champions League', path: 'soccer/uefa.champions', group: 'Soccer' },
  { id: 'mls', name: 'MLS', path: 'soccer/usa.1', group: 'Soccer' },
];

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

function pad(n) { return String(n).padStart(2, '0'); }
function toYYYYMMDD(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function longDate(d) { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

async function fetchWithFallback(url, { asText = false } = {}) {
  let lastErr;
  for (const makeProxyUrl of CORS_PROXIES) {
    try {
      const res = await fetch(makeProxyUrl(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asText ? await res.text() : await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All proxies failed');
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

  const yStr = yesterday.toDateString();
  let selected = items.filter((it) => it.pubDate && new Date(it.pubDate).toDateString() === yStr);
  let usedFallback = false;
  if (selected.length < 6) {
    usedFallback = true;
    selected = items;
  }

  const deduped = dedupeByTitle(selected).slice(0, 15);

  sub.textContent = usedFallback
    ? `Most recent top stories (not enough dated to ${longDate(yesterday)} in the source feeds)`
    : longDate(yesterday);

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
  } catch {
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

function renderLeagueGroups(container, leagueResults, renderGame) {
  const withGames = leagueResults.filter((r) => r.events && r.events.length > 0);

  if (leagueResults.every((r) => r.events === null)) {
    container.innerHTML = '<p class="error">Couldn\'t load sports data right now. Try refreshing the page.</p>';
    return;
  }
  if (withGames.length === 0) {
    container.innerHTML = '<p class="empty">No games found.</p>';
    return;
  }

  const byGroup = groupBy(withGames, (r) => r.league.group);
  container.innerHTML = '';
  for (const [groupName, leagues] of byGroup) {
    const groupEl = document.createElement('div');
    groupEl.className = 'league-group';
    let groupHtml = `<h3>${groupName}</h3>`;
    for (const { league, events } of leagues) {
      groupHtml += `<div class="league-block"><ul class="game-list">`;
      groupHtml += events.map((ev) => renderGame(ev, league)).join('');
      groupHtml += `</ul></div>`;
    }
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
  renderLeagueGroups(container, results, renderYesterdayGame);
}

async function loadTodayGames() {
  document.getElementById('today-date').textContent = longDate(today);
  const container = document.getElementById('today-games-list');
  const results = await Promise.all(LEAGUES.map(async (league) => {
    const events = await fetchScoreboard(league, today);
    return { league, events };
  }));
  renderLeagueGroups(container, results, renderTodayGame);
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
