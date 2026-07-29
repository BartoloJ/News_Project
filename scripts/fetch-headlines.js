// Fetches headline RSS feeds server-side (in the GitHub Actions runner, where
// CORS doesn't apply) and writes headlines.json for the static site to read
// same-origin. Replaces the old client-side proxy-fetching approach, which
// depended on free public CORS proxies that turned out to be unreliable
// (corsproxy.io 403s, thingproxy dead DNS, codetabs 522s, allorigins 408/500s).
//
// If a feed fails this run, its previous entry in headlines.json is kept
// as-is (stale beats empty) and marked ok: false.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'headlines.json');
const HEADLINES_PER_SOURCE = 8;
const FETCH_TIMEOUT_MS = 15000;

const FEEDS = [
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  // AP News and Reuters retired their own public RSS years ago; Google News'
  // site-search RSS is the workaround.
  { name: 'AP News', url: 'https://news.google.com/rss/search?q=site:apnews.com+when:2d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com+when:2d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'WSJ', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml' },
];

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DailyWrapBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1]) : null;
}

function parseRssItems(xmlText, sourceName) {
  const items = [];
  const itemBlocks = xmlText.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) items.push({ title, link, pubDate, source: sourceName });
  }
  return items;
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

function loadPrevious() {
  try {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const bySource = new Map();
    for (const s of parsed.sources || []) bySource.set(s.name, s);
    return bySource;
  } catch {
    return new Map();
  }
}

async function main() {
  const previous = loadPrevious();
  const sources = [];

  for (const feed of FEEDS) {
    const prev = previous.get(feed.name);
    try {
      const xmlText = await fetchWithTimeout(feed.url);
      const items = dedupeByTitle(parseRssItems(xmlText, feed.name))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, HEADLINES_PER_SOURCE);
      if (items.length === 0) throw new Error('parsed 0 items');
      sources.push({ name: feed.name, items, ok: true, updatedAt: new Date().toISOString() });
      console.log(`${feed.name}: ${items.length} items`);
    } catch (err) {
      console.warn(`${feed.name} failed: ${err.message}`);
      if (prev) {
        sources.push({ ...prev, ok: false });
      } else {
        sources.push({ name: feed.name, items: [], ok: false, updatedAt: null });
      }
    }
  }

  const output = { generatedAt: new Date().toISOString(), sources };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
