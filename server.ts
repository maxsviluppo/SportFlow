import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import Parser from "rss-parser";
import cors from "cors";
import * as cheerio from "cheerio";

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc } from "firebase/firestore";

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
const db = firebaseApp ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || "(default)") : null;

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
      ['yt:videoId', 'videoId'],
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
  const DEFAULT_SOURCES = [
    { "url": "https://www.gazzetta.it/rss/calcio.xml", "get_id": "gazzetta_calcio", "cat": "Calcio", "name": "Gazzetta Calcio", "active": true },
    { "url": "https://www.gazzetta.it/rss/motori/f1.xml", "get_id": "gazzetta_f1", "cat": "F1", "name": "Gazzetta F1", "active": true },
    { "url": "https://www.gazzetta.it/rss/tennis.xml", "get_id": "gazzetta_tennis", "cat": "Tennis", "name": "Gazzetta Tennis", "active": true },
    { "url": "https://www.tuttosport.com/rss/calcio", "get_id": "tuttosport", "cat": "Calcio", "name": "TuttoSport", "active": true },
    { "url": "https://www.tuttonapoli.net/rss/", "get_id": "tuttonapoli", "cat": "Calcio", "name": "TuttoNapoli", "active": true },
    { "url": "https://www.skysports.com/rss/12040", "get_id": "skysports", "cat": "Calcio", "name": "Sky Sports UK", "active": true },
    { "url": "https://push.api.bbci.co.uk/morph/items/it/sport/football/rss.xml", "get_id": "bbc", "cat": "Calcio", "name": "BBC Sport", "active": true },
    { "url": "https://www.f1-world.it/feed/", "get_id": "f1world", "cat": "F1", "name": "F1 World", "active": true },
    { "url": "https://www.milannews.it/rss/", "get_id": "milannews", "cat": "Calcio", "name": "Milan News", "active": true },
    { "url": "https://www.tuttojuve.com/rss/", "get_id": "tuttojuve", "cat": "Calcio", "name": "Juve News", "active": true },
    { "url": "https://www.tuttocampo.it/RSS/Notizie", "get_id": "tuttocampo", "cat": "Calcio", "name": "TuttoCampo", "active": true },
    { "url": "https://www.goal.com/it/feeds/news", "get_id": "goal", "cat": "Calcio", "name": "Goal.com", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCSeHNf0_0RNC08N7M6_6GzQ", "get_id": "yt_seriea", "cat": "Calcio", "name": "Serie A YouTube", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCuS_8v19P8Gxy_LlhX9-XyA", "get_id": "yt_skysport", "cat": "Calcio", "name": "Sky Sport YouTube", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCwJ39K4h3yC3y0n0t_9sS8g", "get_id": "yt_dazn", "cat": "Calcio", "name": "DAZN Italia YouTube", "active": true },
    { "url": "https://www.wtatennis.com/rss-videos.xml", "get_id": "wta_videos", "cat": "Tennis", "name": "WTA Videos", "active": true },
    { "url": "https://www.wtatennis.com/rss-news.xml", "get_id": "wta_news", "cat": "Tennis", "name": "WTA News", "active": true },
    { "url": "https://www.tennis.com/news/articles/rss-feeds", "get_id": "tennis_com", "cat": "Tennis", "name": "ATP News (Tennis.com)", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCigZ8YmIVX8pPqis_20U_3w", "get_id": "yt_atptour", "cat": "Tennis", "name": "YouTube (ATP Tour)", "active": true },
    { "url": "https://it.motorsport.com/rss/f1/news/", "get_id": "motorsport_it", "cat": "F1", "name": "Motorsport.com IT", "active": true },
    { "url": "https://www.autosport.com/rss/f1/news/", "get_id": "autosport_f1", "cat": "F1", "name": "Autosport F1", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UCB_qr75-ydFVKSF9Dmo6izg", "get_id": "yt_f1_official", "cat": "F1", "name": "F1 Official YouTube", "active": true },
    { "url": "https://www.skysports.com/rss/12433", "get_id": "skysports_f1", "cat": "F1", "name": "Sky Sports F1", "active": true },
    { "url": "https://push.api.bbci.co.uk/morph/feeds/settings/it-IT/sport/formula1/rss.xml", "get_id": "bbc_f1", "cat": "F1", "name": "BBC Sport F1", "active": true },
    { "url": "https://www.nba.com/news/rss.xml", "get_id": "nba_news", "cat": "Basket", "name": "NBA Official News", "active": true },
    { "url": "https://www.nba.com/news/category/top-stories/rss.xml", "get_id": "nba_top", "cat": "Basket", "name": "NBA Top Stories", "active": true },
    { "url": "https://www.youtube.com/feeds/videos.xml?channel_id=UC8InX6D_ZfjsZ8HjYfFvRPA", "get_id": "yt_euroleague_official", "cat": "Basket", "name": "Euroleague (YouTube)", "active": true },
    { "url": "https://www.legabasket.it/rss/news/1", "get_id": "lba_news", "cat": "Basket", "name": "Lega Basket (LBA)", "active": true },
    { "url": "https://basketnews.com/rss", "get_id": "basketnews", "cat": "Basket", "name": "BasketNews.com", "active": true },
    { "url": "https://www.oasport.it/feed/", "get_id": "oasport", "cat": "Generale", "name": "OA Sport (IT)", "active": true },
    { "url": "https://www.reutersagency.com/feed/?best-topics=sports&post_type=best", "get_id": "reuters_sports", "cat": "Generale", "name": "Reuters Sports", "active": true }
  ];

  if (!db) return DEFAULT_SOURCES;
  try {
    // Attempt Firestore fetch with 3s timeout
    const fetchPromise = getDocs(collection(db, "rss_sources"));
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
    
    const querySnapshot: any = await Promise.race([fetchPromise, timeoutPromise]);
    let sources = querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    if (sources.length === 0) {
      // Seed if empty
      for (const s of DEFAULT_SOURCES) {
        const docRef = doc(collection(db, "rss_sources"));
        await setDoc(docRef, s).catch(() => {});
      }
      return DEFAULT_SOURCES;
    }

    // Check for missing defaults and add them if possible
    for (const def of DEFAULT_SOURCES) {
      if (!sources.some((s: any) => s.url === def.url)) {
        try {
          const docRef = doc(collection(db, "rss_sources"));
          await setDoc(docRef, def).catch(() => {});
          sources.push({ id: docRef.id, ...def });
        } catch (e) { /* Ignore seed errors */ }
      }
    }

    // Debug and Cleanup
    const sourcesToReturn = sources.filter((s: any) => {
      const isTennisX = s.id === "H8J6on4RcOfbvBggYaEo" || 
                        String(s.get_id).toLowerCase().includes("tennisx") || 
                        String(s.name).toLowerCase().includes("tennis-x") || 
                        String(s.url).toLowerCase().includes("tennisx");
      return !isTennisX;
    });

    console.log(`Sources after filter: ${sourcesToReturn.length} (original: ${sources.length})`);
    if (sourcesToReturn.length === sources.length) {
       console.log("WARNING: Nothing filtered! IDs present:", sources.map(s => s.id).join(", "));
    }
    
    // Background cleanup
    sources.forEach(async (s: any) => {
      const isTennisX = s.id === "H8J6on4RcOfbvBggYaEo" || 
                        String(s.get_id).toLowerCase().includes("tennisx") || 
                        String(s.name).toLowerCase().includes("tennis-x") || 
                        String(s.url).toLowerCase().includes("tennisx");
      if (isTennisX) {
         console.log(`Deleting Tennis-X from Firestore ID: ${s.id}`);
         await deleteDoc(doc(db, "rss_sources", s.id)).catch((err) => console.error("Delete failed", err));
      }
    });

    return sourcesToReturn;
  } catch (e) {
    console.warn("Firestore unreachable or timed out, using defaults.", e);
    return DEFAULT_SOURCES;
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
    if (item.videoId) return `https://www.youtube.com/embed/${item.videoId}`;
    
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

    // Attempt to find .m3u8 or raw video in HTML if still no video
    if (!video) {
        const m3u8Match = html.match(/https?:\/\/[^"'\s<> ]+\.m3u8/i);
        if (m3u8Match) video = m3u8Match[0];
        
        const mp4Match = html.match(/https?:\/\/[^"'\s<> ]+\.mp4/i);
        if (mp4Match) video = mp4Match[0];

        // Specific for Twitter embeds (Serie A on Goal.com etc)
        const twitterMatch = html.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
        if (twitterMatch) {
            // We can treat this as a link for now, or use a Twitter player if the app supports it.
            // But usually we want a direct video or YT. 
        }
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
    console.error("Serie A API Error:", e);
    res.status(500).json({ error: "Failed to fetch Serie A standings" });
  }
});

app.get("/api/standings/nba", async (req, res) => {
  try {
    const apiURL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
    const response = await fetch(apiURL);
    const data = await response.json();
    
    // Process ESPN standings
    const standings: any[] = [];
    
    if (data.children) {
      data.children.forEach((conference: any) => {
        if (conference.standings && conference.standings.entries) {
          conference.standings.entries.forEach((entry: any) => {
            const team = entry.team;
            const stats = entry.stats;
            
            standings.push({
              position: entry.id, // Not exactly position, but team id
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

    // Sort by win percentage descending
    res.json(standings.sort((a, b) => parseFloat(b.winPct) - parseFloat(a.winPct)));
  } catch (e) {
    console.error("NBA API Error:", e);
    res.status(500).json({ error: "Failed to fetch NBA standings" });
  }
});

app.get("/api/standings/f1", async (req, res) => {
  try {
    const skyURL = 'https://sport.sky.it/formula-1/classifiche';
    const response = await fetch(skyURL);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const standings: any[] = [];
    
    // Sky Sport F1 table scraping
    $('.fb-sport-table__row, tr, .fb-sport-table__driver').each((i, el) => {
      const row = $(el);
      let pos = row.find('.fb-sport-table__position, td:first-child, .position').text().trim();
      let name = row.find('.fb-sport-table__player-name, td:nth-child(2), .name, .player-name').text().trim();
      let team = row.find('.fb-sport-table__team-name, td:nth-child(3), .team, .team-name').text().trim();
      let points = row.find('.fb-sport-table__points, td:last-child, .points').text().trim();
      
      // If table structure is different, look for common patterns in Sky
      if (!name) {
         name = row.find('a[href*="/piloti/"]').first().text().trim();
      }
      if (!team) {
         team = row.find('a[href*="/team-piloti/"]').first().text().trim();
      }

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

    if (standings.length > 0) {
      // Remove header if accidentally scraped
      const cleanStandings = standings.filter(s => !s.name.toLowerCase().includes('pilota') && !s.name.toLowerCase().includes('punti'));
      return res.json(cleanStandings.slice(0, 20));
    }

    // Fallback to Ergast if Sky scraping fails
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
  } catch (e) {
    // Ultimate fallback
    res.json([]);
  }
});
app.get("/api/events/seriea", async (req, res) => {
  try {
    const coriURL = 'https://www.corrieredellosport.it/live/calendario-serie-a';
    const response = await fetch(coriURL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const events: any[] = [];

    // Corriere structural scraping (More robust version)
    // Looking for links that contain times like 20:45 or scores like 1-0
    $('a').each((i, el) => {
      const row = $(el);
      const text = row.text().trim();
      const href = row.attr('href') || '';
      
      // Pattern 1: Team1HH:MMTeam2 (Common in Corriere)
      // e.g., Roma20:45Pisa
      const timeMatch = text.match(/^([A-Za-z\s]+)(\d{1,2}:\d{2})([A-Za-z\s]+)$/);
      
      // Pattern 2: Team1 - Team2 (Inside a container)
      // Pattern 3: Score like "1 - 0"
      const scoreMatch = text.match(/^([A-Za-z\s]+)\d+\s*-\s*\d+([A-Za-z\s]+)$/);

      if (timeMatch && (href.includes('/live/') || href.includes('/formazione/'))) {
        events.push({
          id: `cori-t-${i}`,
          date: 'Weekend 10-12 Apr',
          time: timeMatch[2],
          homeTeam: timeMatch[1].trim(),
          awayTeam: timeMatch[3].trim(),
          venue: 'Stadio'
        });
      } else if (scoreMatch && href.includes('/live/partita/')) {
         events.push({
          id: `cori-s-${i}`,
          date: 'Risultato',
          time: 'FIN',
          homeTeam: scoreMatch[1].trim(),
          awayTeam: scoreMatch[2].trim(),
          venue: 'Match Concluso'
        });
      }
    });

    if (events.length > 0) {
      // Filter out non-match strings that might have matched accidentally
      const cleanEvents = events.filter(e => e.homeTeam.length > 2 && e.awayTeam.length > 2);
      
      // Deduplicate by teams
      const seen = new Set();
      const finalEvents = [];
      for (const e of cleanEvents) {
        const key = `${e.homeTeam}-${e.awayTeam}`;
        if (!seen.has(key)) {
          seen.add(key);
          finalEvents.push(e);
        }
      }
      return res.json(finalEvents.slice(0, 15));
    }

    // Fallback if scraping fails (matches the current period)
    res.json([
      { id: '1', date: '10/04/2026', time: '20:45', homeTeam: 'Roma', awayTeam: 'Pisa', venue: 'Stadio Olimpico' },
      { id: '2', date: '11/04/2026', time: '15:00', homeTeam: 'Cagliari', awayTeam: 'Cremonese', venue: 'Unipol Domus' },
      { id: '3', date: '11/04/2026', time: '15:00', homeTeam: 'Torino', awayTeam: 'Verona', venue: 'Stadio Olimpico Grande Torino' },
      { id: '4', date: '11/04/2026', time: '18:00', homeTeam: 'Milan', awayTeam: 'Udinese', venue: 'San Siro' },
      { id: '5', date: '11/04/2026', time: '20:45', homeTeam: 'Atalanta', awayTeam: 'Juventus', venue: 'Gewiss Stadium' }
    ]);
  } catch (e) {
    res.json([{ id: 'err', date: '--', time: '--', homeTeam: 'Errore Corriere', awayTeam: 'Riprova', venue: 'Server Error' }]);
  }
});

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
    console.log(`SportFlow [v2-cleanup] running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}

