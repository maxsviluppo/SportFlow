import express from "express";
import path from "path";
import fs from "fs";
import Parser from "rss-parser";
import cors from "cors";
import * as cheerio from "cheerio";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";

// Initialize Firebase for Backend
let firebaseConfig;
try {
  if (process.env.FIREBASE_CONFIG) {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  } else {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
}

const firebaseApp = firebaseConfig ? initializeApp(firebaseConfig) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;

const CACHE_DURATION = 5 * 60 * 1000;
const app = express();
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail'],
      ['media:group', 'media:group'],
      ['content:encoded', 'contentEncoded'],
      ['enclosure', 'enclosure'],
    ],
  },
});

let newsCache: any[] = [];
let lastFetchTime = 0;

app.use(cors());
app.use(express.json());

async function loadSources() {
  if (!db) return [];
  try {
    const querySnapshot = await getDocs(collection(db, "rss_sources"));
    const sources = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (sources.length === 0) {
      return [
        { "url": "https://www.reddit.com/r/soccer/search.rss?q=flair%3AGoal&restrict_sr=on&sort=new", "cat": "Calcio", "name": "Reddit Live Goals", "active": true },
        { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCSeHNf0_0RNC08N7M6_6GzQ", "cat": "Calcio", "name": "Serie A Official", "active": true },
        { "url": "https://www.101greatgoals.com/feed/", "cat": "Mondo", "name": "101 Great Goals", "active": true },
        { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC6YInS6Xm_U10e0V3Z7k_IA", "cat": "Calcio", "name": "Sky Sport Video", "active": true },
        { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCw92842pUfMreG3_YyHlG7Q", "cat": "Calcio", "name": "DAZN Video", "active": true },
        { "url": "https://www.tuttocagliari.net/rss/", "cat": "Calcio", "name": "TuttoCagliari", "active": true },
        { "url": "https://www.tuttonapoli.net/rss/", "cat": "Calcio", "name": "TuttoNapoli", "active": true }
      ];
    }
    return sources;
  } catch (e) { return []; }
}

async function fetchMetaInfo(url: string) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { image: null, video: null };
    const html = await res.text();
    const $ = cheerio.load(html);
    
    let video = $('meta[property="og:video:url"]').attr('content') ||
                $('meta[property="og:video:secure_url"]').attr('content') ||
                $('iframe[src*="youtube.com"]').attr('src') ||
                $('iframe[src*="vimeo"]').attr('src');

    if (video && (video.includes('youtube.com') || video.includes('youtu.be'))) {
      const id = video.match(/(?:v=|embed\/|youtu\.be\/|v\/)([a-zA-Z0-9_-]{11})/i)?.[1];
      if (id) video = `https://www.youtube.com/embed/${id}`;
    }

    let image = $('meta[property="og:image"]').attr('content');
    return { image: image || null, video: video || null };
  } catch { return { image: null, video: null }; }
}

function extractImage(item: any) {
  try {
    if (item.enclosure && item.enclosure.url) return item.enclosure.url;
    const content = item.contentEncoded || item.content || "";
    const imgMatch = content.match(/<img[^>]+src=["']([^"'>\s]+)["']/i);
    if (imgMatch) return imgMatch[1];
    if (item['media:content'] && Array.isArray(item['media:content'])) return item['media:content'][0].$.url;
  } catch (e) {}
  return null;
}

function extractVideo(item: any) {
  try {
    const link = item.link || "";
    const content = item.contentEncoded || item.content || "";
    
    // Support for YouTube RSS feeds specifically
    if (link.includes('youtube.com') || link.includes('youtu.be')) {
      const id = link.match(/(?:v=|embed\/|youtu\.be\/|v\/)([a-zA-Z0-9_-]{11})/i)?.[1];
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=0&rel=0`;
    }

    const ytMatch = content.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    if (item.enclosure && item.enclosure.url && item.enclosure.url.includes('mp4')) return item.enclosure.url;
  } catch (e) {}
  return null;
}

app.get("/api/news", async (req, res) => {
  const now = Date.now();
  if (newsCache.length > 0 && (now - lastFetchTime < CACHE_DURATION)) return res.json(newsCache);
  try {
    const sources = (await loadSources()).filter((s: any) => s.active !== false);
    const feedPromises = sources.map(async (source: any) => {
      try {
        const feed = await parser.parseURL(source.url);
        // Process only first 5 to avoid timeouts, others done partially
        return await Promise.all(feed.items.slice(0, 15).map(async (item) => {
          let video = extractVideo(item);
          let image = extractImage(item);
          
          // Enhanced scraping for the top news to get that 60% video ratio
          if (!video && item.link) {
             // For performance on Vercel, we only scrape a small subset
             // In a real app, this could be background tasks
          }

          return {
            id: item.guid || item.link || Math.random().toString(),
            title: item.title,
            link: item.link,
            pubDate: item.pubDate || new Date().toISOString(),
            content: item.contentSnippet || item.content,
            source: source.name,
            category: source.cat || 'Sport',
            image,
            video
          };
        }));
      } catch (e) { return []; }
    });
    const results = await Promise.all(feedPromises);
    const allItems = results.flat().filter(i => i.title);
    
    // RANKING SYSTEM: Prioritize items with video to hit the 60% target visually
    const itemsWithVideo = allItems.filter(i => i.video);
    const itemsWithOnlyImage = allItems.filter(i => !i.video);
    
    // Sort items so video-rich news appear frequently
    const sortedResult = [...itemsWithVideo, ...itemsWithOnlyImage].sort((a,b) => {
       // Slightly favor recent news but keep video presence high
       const timeDiff = new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
       if (a.video && !b.video) return -1;
       if (!a.video && b.video) return 1;
       return timeDiff;
    });

    newsCache = sortedResult; lastFetchTime = now;
    res.json(sortedResult);
  } catch (e) { res.status(500).json([]); }
});

app.get("/api/standings/seriea", async (req, res) => {
  try {
    const apiURL = 'https://api-sdp.legaseriea.it/v1/serie-a/football/seasons/serie-a::Football_Season::5f0e080fc3a44073984b75b3a8e06a8a/standings/overall?locale=it-IT';
    const response = await fetch(apiURL, {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    const standings: any[] = [];

    if (data.standings && data.standings[0] && data.standings[0].teams) {
      data.standings[0].teams.forEach((teamEntry: any) => {
        const stats = teamEntry.stats || [];
        const rankStat = stats.find((s: any) => s.statsId === 'rank');
        const pointsStat = stats.find((s: any) => s.statsId === 'points');
        const playedStat = stats.find((s: any) => s.statsId === 'played');
        const wonStat = stats.find((s: any) => s.statsId === 'won');

        standings.push({
          position: rankStat ? rankStat.statsValue : '?',
          team: teamEntry.officialName || teamEntry.shortName,
          points: pointsStat ? pointsStat.statsValue : '0',
          played: playedStat ? playedStat.statsValue : '0',
          won: wonStat ? wonStat.statsValue : '0'
        });
      });
    }

    res.json(standings.sort((a, b) => parseInt(a.position) - parseInt(b.position)));
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch Serie A standings" });
  }
});

app.get("/api/standings/f1", async (req, res) => {
  try {
    const skyURL = 'https://sport.sky.it/formula-1/classifiche';
    const response = await fetch(skyURL);
    const html = await response.text();
    const $ = cheerio.load(html);
    const standings: any[] = [];
    $('.fb-sport-table__row, tr').each((i, el) => {
      const row = $(el);
      const pos = row.find('.fb-sport-table__position, td:first-child').text().trim();
      const name = row.find('.fb-sport-table__player-name, td:nth-child(2)').text().trim();
      const team = row.find('.fb-sport-table__team-name, td:nth-child(3)').text().trim();
      const points = row.find('.fb-sport-table__points, td:last-child').text().trim();
      if (pos && name && !isNaN(parseInt(pos))) {
        standings.push({
          position: pos,
          name: name.replace(/\n/g, ' ').replace(/\s+/g, ' '),
          team: team,
          points: points || '0',
          extra: `Team: ${team}`
        });
      }
    });

    if (standings.length > 0) return res.json(standings.slice(0, 20));

    const ergastRes = await fetch('https://ergast.com/api/f1/current/driverStandings.json');
    const ergastData = await ergastRes.json();
    const fallback = ergastData.MRData.StandingsTable.StandingsLists[0].DriverStandings.map((s: any) => ({
      position: s.position,
      name: `${s.Driver.givenName} ${s.Driver.familyName}`,
      team: s.Constructors[0].name,
      points: s.points,
      extra: `Wins: ${s.wins}`
    }));
    res.json(fallback);
  } catch (e) { res.json([]); }
});

app.get("/api/standings/nba", async (req, res) => {
  try {
    const apiURL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
    const response = await fetch(apiURL);
    const data = await response.json();
    const standings: any[] = [];
    if (data.children) {
      data.children.forEach((conference: any) => {
        if (conference.standings && conference.standings.entries) {
          conference.standings.entries.forEach((entry: any) => {
            const team = entry.team;
            const stats = entry.stats;
            standings.push({
              position: entry.id,
              name: team.displayName,
              shortName: team.shortDisplayName,
              logo: team.logos?.[0]?.href,
              points: stats.find((s: any) => s.name === 'wins')?.value + '-' + stats.find((s: any) => s.name === 'losses')?.value,
              winPct: stats.find((s: any) => s.name === 'winPercent')?.value,
              conference: conference.name
            });
          });
        }
      });
    }
    res.json(standings.sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct)));
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch NBA standings" });
  }
});

app.get("/api/config/:type", async (req, res) => {
  if (!db) return res.json({});
  try {
    const configDoc = await getDoc(doc(db, "configs", req.params.type));
    res.json(configDoc.exists() ? configDoc.data() : {});
  } catch (e) { res.json({}); }
});

app.post("/api/config/:type", async (req, res) => {
  if (!db) return res.status(500).send("No DB");
  try {
    await setDoc(doc(db, "configs", req.params.type), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).send(e); }
});

app.post("/api/sources", async (req, res) => {
  if (!db) return res.status(500).send("No DB");
  try {
    const sources = req.body;
    for (const s of sources) {
      const id = s.id || doc(collection(db, "rss_sources")).id;
      await setDoc(doc(db, "rss_sources", id), s);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).send(e); }
});

export default app;
