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
      ['image', 'image'],
      ['enclosure', 'enclosure'],
      ['thumb', 'thumb'],
      ['content:encoded', 'contentEncoded'],
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
        { "url": "https://www.gazzetta.it/rss/calcio.xml", "name": "Gazzetta Calcio", "active": true },
        { "url": "https://www.tuttonapoli.net/rss/", "name": "TuttoNapoli", "active": true },
        { "url": "https://www.skysports.com/rss/12040", "name": "Sky Sport", "active": true }
      ];
    }
    return sources;
  } catch (e) { return []; }
}

function extractImage(item: any) {
  try {
    const content = item.contentEncoded || item.content || item.description || "";
    // Priority 1: Media tags
    const mediaTags = ["media:content", "media:thumbnail", "enclosure", "image"];
    for (const tag of mediaTags) {
      const data = item[tag];
      if (data) {
        if (Array.isArray(data)) return data[0].$.url || data[0].url;
        if (data.url) return data.url;
        if (data.$ && data.$.url) return data.$.url;
      }
    }
    // Priority 2: HTML
    const imgMatch = content.match(/<img[^>]+src=["']([^"'>\s]+)["']/i);
    if (imgMatch) return imgMatch[1];
  } catch (e) {}
  return null;
}

function extractVideo(item: any) {
  try {
    const content = item.contentEncoded || item.content || "";
    const ytMatch = content.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
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
        return feed.items.slice(0, 20).map(item => ({
          id: item.guid || item.link || Math.random().toString(),
          title: item.title,
          link: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          content: item.contentSnippet || item.content,
          source: source.name,
          category: source.cat || 'Sport',
          image: extractImage(item),
          video: extractVideo(item)
        }));
      } catch (e) { return []; }
    });
    const results = await Promise.all(feedPromises);
    const finalResult = results.flat().filter(i => i.title).sort((a,b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    newsCache = finalResult; lastFetchTime = now;
    res.json(finalResult);
  } catch (e) { res.status(500).json([]); }
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
