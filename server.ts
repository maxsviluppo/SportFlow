import express from "express";
import { createServer as createViteServer } from "vite";
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
    firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8"));
  }
} catch (e) {
  console.error("Firebase config not found. Please set FIREBASE_CONFIG env or provide firebase-applet-config.json");
}

const firebaseApp = firebaseConfig ? initializeApp(firebaseConfig) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;

// Constants
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const app = express();
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8'
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
      ['dc:date', 'pubDate'], // RDF compatibility
      ['dc:creator', 'creator'],
    ],
  },
});

// Cache mechanism
let newsCache: any[] = [];
let lastFetchTime = 0;

app.use(cors());
app.use(express.json());

// Helper to load sources from Firestore
async function loadSources() {
  if (!db) return [];
  try {
    const querySnapshot = await getDocs(collection(db, "rss_sources"));
    const sources = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    if (sources.length === 0) {
      const DEFAULT_SOURCES = [
        { "url": "https://www.gazzetta.it/rss/calcio.xml", "cat": "Calcio", "name": "Gazzetta Calcio", "active": true },
        { "url": "https://www.gazzetta.it/rss/motori/f1.xml", "cat": "F1", "name": "Gazzetta F1", "active": true },
        { "url": "https://www.gazzetta.it/rss/tennis.xml", "cat": "Tennis", "name": "Gazzetta Tennis", "active": true },
        { "url": "https://www.tuttosport.com/rss/calcio", "cat": "Calcio", "name": "TuttoSport", "active": true },
        { "url": "https://www.tuttonapoli.net/rss/", "cat": "Calcio", "name": "TuttoNapoli", "active": true },
        { "url": "https://www.skysports.com/rss/12040", "cat": "Calcio", "name": "Sky Sports UK", "active": true },
        { "url": "https://push.api.bbci.co.uk/morph/items/it/sport/football/rss.xml", "cat": "Calcio", "name": "BBC Sport", "active": true },
        { "url": "https://www.f1-world.it/feed/", "cat": "F1", "name": "F1 World", "active": true },
        { "url": "https://www.milannews.it/rss/", "cat": "Calcio", "name": "Milan News", "active": true },
        { "url": "https://www.tuttojuve.com/rss/", "cat": "Calcio", "name": "Juve News", "active": true }
      ];
      // Seed if empty
      for (const s of DEFAULT_SOURCES) {
        const docRef = doc(collection(db, "rss_sources"));
        await setDoc(docRef, s);
      }
      return DEFAULT_SOURCES;
    }
    return sources;
  } catch (e) {
    console.error("Error loading sources:", e);
    return [];
  }
}

// Endpoints for admin
app.get("/api/sources", async (req, res) => {
  res.json(await loadSources());
});

app.post("/api/sources", async (req, res) => {
  if (!db) return res.status(500).json({ error: "DB not initialized" });
  try {
    const sources = req.body;
    // Overwrite all (simple way for this app)
    // In production, you'd match by ID or update individually
    for (const s of sources) {
      const id = s.id || doc(collection(db, "rss_sources")).id;
      await setDoc(doc(db, "rss_sources", id), s);
    }
    lastFetchTime = 0; // Clear cache
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to save sources" });
  }
});

function extractImage(item: any) {
  try {
    const contentEncoded = item.contentEncoded || item.content || item.description || "";
    const link = (item.link || '').toLowerCase();

    // High quality preference for sport sites
    const isItalianSport = link.includes('sempreinter') || link.includes('milannews') || link.includes('tuttojuve') || link.includes('tuttosport') || link.includes('calciomercato') || link.includes('tuttonapoli');
    if (isItalianSport && contentEncoded) {
      // Prioritize large uploads
      const wpMatchLarge = contentEncoded.match(/https?:\/\/[^"'\s<>]+wp-content\/uploads\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi);
      if (wpMatchLarge) {
        // Find largest one (usually the last or the one without resizing dims like -300x200)
        const bestImg = wpMatchLarge.find(u => !u.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i)) || wpMatchLarge[0];
        return bestImg;
      }
    }

    // 1. Specific for ESPN and International Sources
    if (link.includes('espn.com') || link.includes('bbc.co.uk') || link.includes('skysports.com')) {
      // Look for large image patterns in content
      const espnCdnMatch = contentEncoded.match(/https?:\/\/[^"'\s<>]+espncdn\.com\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi);
      if (espnCdnMatch) return espnCdnMatch[0];
      
      // Check for 'image' property which rss-parser sometimes populates for ESPN
      if (item.image && typeof item.image === 'string') return item.image;
      if (item.image && item.image.url) return item.image.url;
    }

    if (item.enclosure && item.enclosure.url) {
      if (item.enclosure.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
    }
    
    // 2. Media tags priority (more robust check)
    const mediaTags = ["media:content", "media:thumbnail", "media:group", "image", "enclosure", "thumb"];
    for (const tag of mediaTags) {
      const content = item[tag];
      if (content) {
        if (Array.isArray(content)) {
          // Sort by width descending to get best quality
          const sorted = [...content].sort((a, b) => parseInt(b.$?.width || '0') - parseInt(a.$?.width || '0'));
          const url = sorted[0].$?.url || sorted[0].url || (typeof sorted[0] === 'string' ? sorted[0] : null);
          if (url && typeof url === 'string' && url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return url;
        }
        if (content.$ && content.$.url) return content.$.url;
        if (content.url) return content.url;
        if (typeof content === 'string' && content.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content;
      }
    }
    
    const imgMatches = contentEncoded.matchAll(/<img[^>]+(?:src|data-src|srcset)=["']([^"'>\s]+)["']/gi);
    for (const match of imgMatches) {
      const url = match[1];
      if (!url.includes('pixel') && !url.includes('analytics') && !url.includes('spacer') && url.match(/\.(jpg|jpeg|png|webp)/i)) {
        return url;
      }
    }
  } catch (e) { return null; }
  return null;
}

function extractVideo(item: any) {
  try {
    const contentEncoded = item.contentEncoded || item.content || item.description || "";
    const link = (item.link || '').toLowerCase();
    
    // Search for YouTube
    const ytId = contentEncoded.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    if (ytId) return `https://www.youtube.com/embed/${ytId[1]}`;

    // Search for generic video formats
    const videoMatch = contentEncoded.match(/https?:\/\/[^"'\s<> ]+\.(?:mp4|webm|m3u8)/i);
    if (videoMatch) return videoMatch[0];

    // Search for iframes (dailymotion, vimeo, etc)
    const iframeMatch = contentEncoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch && (iframeMatch[1].includes('vimeo') || iframeMatch[1].includes('dailymotion') || iframeMatch[1].includes('video'))) return iframeMatch[1];
  } catch (e) { return null; }
  return null;
}

async function fetchMetaInfo(url: string) {
  if (!url) return { image: null, video: null };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000); // 7 seconds timeout
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      } 
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { image: null, video: null };
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let image = $('meta[property="og:image"]').attr('content') || 
                $('meta[name="twitter:image"]').attr('content') ||
                $('meta[property="og:image:secure_url"]').attr('content') ||
                $('meta[name="thumbnail"]').attr('content');
                   
    // Source-specific image improvements
    if (image) {
      if (url.includes('gamestar.de')) {
        // GameStar often uses small teaser images, try to get full resolution
        image = image.replace(/_teaser_\d+x\d+\./, '_full.');
      }
      if (url.includes('hdblog.it')) {
        // HD Blog images can be low res in OG, look for better ones if possible
        const betterImg = $('meta[property="og:image:width"]').attr('content');
        if (betterImg && parseInt(betterImg) < 600) {
           const bodyImg = $('article img').first().attr('src');
           if (bodyImg) image = bodyImg;
        }
      }
    }

    let video = $('meta[property="og:video:url"]').attr('content') ||
                $('meta[property="og:video:secure_url"]').attr('content') ||
                $('meta[property="og:video"]').attr('content') ||
                $('meta[name="twitter:player"]').attr('content');
    
    // Improved Video Detection for VGC, GameSpot, GameSource
    if (!video) {
        // Look for common video containers or iframes
        const ytEmbed = $('iframe[src*="youtube.com"], iframe[src*="youtu.be"], iframe[src*="vgc.com"], iframe[src*="gamespot.com"], .video-container iframe').attr('src');
        if (ytEmbed) {
            video = ytEmbed;
        } else {
          // Direct HTML search for YouTube IDs
          const ytMatch = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
          if (ytMatch) video = `https://www.youtube.com/embed/${ytMatch[1]}`;
        }
    }

    // Clean up YouTube URLs to standard embed format
    if (video && (video.includes('youtube.com') || video.includes('youtu.be'))) {
      const ytId = video.match(/(?:v=|embed\/|youtu\.be\/|v\/)([a-zA-Z0-9_-]{11})/i)?.[1];
      if (ytId) video = `https://www.youtube.com/embed/${ytId}`;
    }
    
    let finalImage = image || null;
    if (finalImage && !finalImage.startsWith('http')) {
      try { finalImage = new URL(finalImage, url).href; } catch { finalImage = null; }
    }
    return { image: finalImage, video: video || null };
  } catch (e) {
    return { image: null, video: null };
  }
}

app.get("/api/proxy", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).send("URL is required");
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      }
    });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    let html = await response.text();
    const baseUrl = new URL(url).origin;
    const baseTag = `<base href="${baseUrl}/">`;
    if (url.includes('engadget.com') || url.includes('yahoo.com') || url.includes('techcrunch.com')) {
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    }
    html = html.includes("<head>") ? html.replace("<head>", `<head>${baseTag}`) : `${baseTag}${html}`;
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    res.status(500).send("Failed to load content");
  }
});

app.get("/api/news", async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  if (!forceRefresh && newsCache.length > 0 && (now - lastFetchTime < CACHE_DURATION)) {
    return res.json(newsCache);
  }
  try {
    const sources = (await loadSources()).filter((s: any) => s.active !== false);
    const feedPromises = sources.map(async (source: any) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); 
      try {
        const fetchUrl = source.url + (source.url.includes('?') ? '&' : '?') + `_gp_refresh=${now}`;
        
        const response = await fetch(fetchUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Cache-Control': 'no-cache'
          }
        });
        clearTimeout(timeoutId);
        if (!response.ok) return [];
        let xml = await response.text();
        const feed = await parser.parseString(xml);
        
        return await Promise.all(feed.items.slice(0, 30).map(async (item) => {
          let image = extractImage(item);
          let video = extractVideo(item);
          
          // Specific extraction for feeds known to have good meta info but poor RSS media
          const isGematsu = (source.name || "").toLowerCase().includes('gematsu') || (item.link && item.link.includes('gematsu.com'));
          const is4Gamer = (source.name || "").toLowerCase().includes('4gamer') || (item.link && item.link.includes('4gamer.net'));
          
          if ((!image || (isGematsu && !video)) && (isGematsu || is4Gamer) && item.link) {
            try {
              // Increase timeout for 4Gamer as it can be slow
              const meta = await fetchMetaInfo(item.link);
              if (!image && meta.image) image = meta.image;
              if (!video && meta.video) video = meta.video;
              
              // Fallback for 4Gamer specifically if no og:image is found
              if (is4Gamer && !image) {
                // Sometimes 4Gamer uses a specific image naming convention or local path
                // But og:image is usually reliable if not blocked
              }
            } catch (metaErr) {
              console.warn(`Meta fetch failed for ${item.link}`);
            }
          }

          return {
            id: item.guid || item.link || `${source.id}-${Math.random()}`,
            title: item.title,
            link: item.link,
            pubDate: item.pubDate || new Date().toISOString(),
            content: item.contentSnippet || item.content,
            source: source.name,
            category: source.cat || 'General',
            image,
            video,
          };
        }));
      } catch (e) { 
        clearTimeout(timeoutId);
        return []; 
      }
    });
    
    const results = await Promise.all(feedPromises);
    const allItems = results.flat().filter(item => item.title && item.link);
    const shuffleArray = (array: any[]) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    const todayItems = allItems.filter(item => new Date(item.pubDate).getTime() >= todayTimestamp);
    const olderItems = allItems.filter(item => new Date(item.pubDate).getTime() < todayTimestamp);
    const shuffledToday = shuffleArray([...todayItems]);
    const sortedOlder = olderItems.sort((a, b) => {
      const dA = new Date(a.pubDate).getTime();
      const dB = new Date(b.pubDate).getTime();
      return (isNaN(dB) ? 0 : dB) - (isNaN(dA) ? 0 : dA);
    });
    const finalResult = [...shuffledToday, ...sortedOlder].slice(0, 1000);
    newsCache = finalResult;
    lastFetchTime = Date.now();
    res.json(finalResult);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

// Config endpoints
app.get("/api/config/:type", async (req, res) => {
  const { type } = req.params;
  if (!db) return res.json({});
  try {
    const configDoc = await getDoc(doc(db, "configs", type));
    res.json(configDoc.exists() ? configDoc.data() : {});
  } catch (e) {
    res.status(500).json({ error: "Failed to load config" });
  }
});

app.post("/api/config/:type", async (req, res) => {
  const { type } = req.params;
  if (!db) return res.status(500).json({ error: "DB not initialized" });
  try {
    await setDoc(doc(db, "configs", type), req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to save config" });
  }
});

// Dynamic ads.txt route for Google AdSense
app.get("/ads.txt", async (req, res) => {
  try {
    const adsenseDoc = await getDoc(doc(db, "configs", "adsense"));
    const adsenseData = adsenseDoc.exists() ? adsenseDoc.data() : null;

    if (adsenseData && adsenseData.adsTxt) {
      res.setHeader("Content-Type", "text/plain");
      return res.send(adsenseData.adsTxt);
    }
    
    // Fallback search in public folder
    const publicAdsTxt = path.join(process.cwd(), "public", "ads.txt");
    if (fs.existsSync(publicAdsTxt)) {
      res.setHeader("Content-Type", "text/plain");
      return res.send(fs.readFileSync(publicAdsTxt, 'utf8'));
    }
    res.status(404).send("ads.txt not configured");
  } catch (e) {
    res.status(500).send("Error fetching ads.txt");
  }
});

export default app;

async function startServer() {
  const PORT = 3011;
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SportFlow running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}

