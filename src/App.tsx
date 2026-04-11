/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * SportFlow Elite — Vertical Sport News Feed
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, Search, X, Heart, Share2, Globe, ChevronDown,
  Volume2, VolumeX, Play, LayoutGrid, UserCircle2,
  UserPlus, ChevronUp, LogIn, LogOut, Zap, ArrowLeft,
  BookOpen, ExternalLink, Send, Shield, Settings,
  Plus, Save, Trash2, RefreshCw, Key, Calendar, MapPin, Clock
} from 'lucide-react';
import {
  auth, db, signInWithGoogle, logout, onAuthStateChanged,
  User as FirebaseUser, handleFirestoreError, OperationType
} from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const stripHtml = (html: string) => {
  const tmp = document.createElement("DIV");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface NewsItem {
  id: string; title: string; link: string; pubDate: string;
  content: string; source: string; image: string | null;
  video?: string | null; category?: string;
}

interface Source {
  id: string;
  url: string;
  cat: string;
  name: string;
  active?: boolean;
}

// ─── Sport Categories ─────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'all',       label: 'Tutti',   icon: '🏆', color: '#10b981' },
  { id: 'calcio',    label: 'Calcio',  icon: '⚽', color: '#10b981' },
  { id: 'motori',    label: 'Motori',  icon: '🏎️', color: '#f59e0b' },
  { id: 'tennis',    label: 'Tennis',  icon: '🎾', color: '#84cc16' },
  { id: 'basket',    label: 'Basket',  icon: '🏀', color: '#f97316' },
  { id: 'favorites', label: 'Salvati', icon: '❤️', color: '#ef4444' },
];

const classifyCat = (item: NewsItem) => {
  const t = (item.title || '').toLowerCase();
  const s = (item.source || '').toLowerCase();
  if (s.includes('inter') || s.includes('milan') || s.includes('juve') || s.includes('gazzetta') || s.includes('tuttosport') || s.includes('sky sport') || s.includes('bbc sport') || t.includes('serie a') || t.includes('calcio') || t.includes('goal') || t.includes('gol')) return 'calcio';
  if (t.includes('f1') || t.includes('formula 1') || t.includes('motogp') || t.includes('ferrari') || s.includes('f1-world')) return 'motori';
  if (t.includes('tennis') || t.includes('sinner') || t.includes('djokovic') || t.includes('atp') || s.includes('tennis')) return 'tennis';
  if (t.includes('basket') || t.includes('nba') || t.includes('euroleague')) return 'basket';
  return (item.category || 'all').toLowerCase();
};

// ─── FAB Speed Dial ───────────────────────────────────────────────────────────
interface FABAction {
  id: string; icon: React.ReactNode; label: string;
  color: string; onClick: () => void;
}
const FAB = ({ categories, actions, isOpen, onToggle, onSelectCategory, selectedCategory }: 
  { categories: string[]; actions: FABAction[]; isOpen: boolean; onToggle: () => void; onSelectCategory: (cat: string) => void; selectedCategory: string }) => (
  <div className="fixed bottom-10 right-5 z-50 flex items-center justify-center pointer-events-none">
    <div className="relative pointer-events-auto">
      
      {/* VERTICAL CATEGORIES (Going Up) */}
      <div className="absolute bottom-[72px] right-2 flex flex-col-reverse items-end gap-3">
        <AnimatePresence>
          {isOpen && categories.map((cat, i) => (
            <motion.div
              key={cat}
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 20 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
              className="flex items-center gap-3"
            >
              <div className="bg-zinc-900/90 text-white/50 text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border border-white/5 backdrop-blur-md">
                {cat === 'all' ? 'Tutte' : cat}
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => { onSelectCategory(cat); onToggle(); }}
                className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${selectedCategory === cat ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-zinc-900/80 border-white/10 text-white/70'}`}
              >
                <div className="text-[10px] font-black uppercase">{cat[0]}</div>
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* HORIZONTAL ACTIONS (Going Left) */}
      <div className="absolute right-[72px] bottom-2 flex flex-row-reverse items-center gap-3">
        <AnimatePresence>
          {isOpen && actions.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, scale: 0.5, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5, x: 20 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
              className="group flex flex-col items-center gap-2"
            >
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => { a.onClick(); onToggle(); }}
                className="w-12 h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 text-white/80 transition-all bg-zinc-900/80 hover:bg-zinc-800"
                style={{ boxShadow: `0 0 15px ${a.color}22` }}
              >
                {a.icon}
              </motion.button>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-black text-white text-[9px] font-bold px-2 py-1 rounded whitespace-nowrap">
                {a.label}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Trigger (Soccer Ball) */}
      <motion.button
        whileTap={{ scale: 0.8 }}
        onClick={onToggle}
        className="relative w-16 h-16 rounded-full flex items-center justify-center text-white z-20 shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden bg-zinc-900 border-2 border-white/5"
      >
        <motion.img 
          src="/iconpalla.png"
          alt="Menu"
          className="w-11 h-11 object-contain"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        />
        {isOpen && (
           <motion.div 
             initial={{ opacity: 0 }} 
             animate={{ opacity: 1 }} 
             className="absolute inset-0 bg-emerald-500/10 backdrop-blur-sm flex items-center justify-center"
           >
             <div className="text-emerald-400 font-bold text-xs uppercase tracking-widest">Close</div>
           </motion.div>
        )}
      </motion.button>
    </div>
  </div>
);

// ─── NewsCard ─────────────────────────────────────────────────────────────────
const NewsCard = ({ item, isActive, isFavorite, onToggleFavorite, onReadMore }:
  { item: NewsItem; isActive: boolean; isFavorite: boolean; onToggleFavorite: () => void; onReadMore: () => void }
) => {
  const [muted, setMuted] = useState(true);

  return (
    <div className="relative w-full h-full snap-start overflow-hidden bg-black">
      {/* ── Background (Reduced 40% from bottom for better text contrast) ── */}
      <div className="absolute top-0 left-0 right-0 bottom-[45%] z-0 overflow-hidden bg-black">
        {item.video ? (
          <div className="w-full h-full">
            {item.video.includes('embed') ? (
              <iframe
                src={`${item.video}?autoplay=${isActive ? 1 : 0}&mute=${muted ? 1 : 0}&loop=1&controls=0&modestbranding=1`}
                className="w-full h-full scale-[1.5] pointer-events-none"
                allow="autoplay; encrypted-media"
              />
            ) : (
              <video src={item.video} autoPlay={isActive} muted={muted} loop playsInline className="w-full h-full object-cover" />
            )}
            {/* Deep vignette to black */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />
          </div>
        ) : item.image ? (
          <div className="w-full h-full">
            <img 
              src={item.image} 
              className="w-full h-full object-cover select-none" 
              alt="" 
              referrerPolicy="no-referrer" 
            />
            {/* Smooth gradient transition to deep black bottom */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
          </div>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-black flex items-center justify-center">
            <Trophy size={80} className="text-zinc-800" />
          </div>
        )}
      </div>

      {/* ── Swipe Hint (first card) ── */}
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ repeat: 3, duration: 2, repeatType: 'loop' }}
          className="absolute top-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1"
        >
          <ChevronUp size={22} className="text-white/40" />
          <div className="text-[9px] font-black text-white/30 uppercase tracking-[0.3em]">Scorri</div>
        </motion.div>
      )}

      {/* ── Content ── */}
      <div className="absolute inset-0 z-10 flex flex-col justify-end px-5 pb-28 pt-20">
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={isActive ? { y: 0, opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {/* Source + Time badge — top */}
          <div className="flex items-center gap-2 mb-3">
            <span className="px-3 py-1 bg-white/10 backdrop-blur border border-white/20 rounded-full text-[9px] font-black uppercase tracking-widest text-white/90 font-stats">
              {item.source}
            </span>
            <span className="text-[9px] font-bold text-white/40 font-stats">
              {new Date(item.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-2xl md:text-5xl font-extrabold text-white/95 leading-[1.15] tracking-tight mb-4 drop-shadow-2xl">
            {stripHtml(item.title)}
          </h2>

          {/* Excerpt */}
          <p className="text-sm text-white/70 font-medium line-clamp-2 leading-relaxed mb-5">
            {stripHtml(item.content)}
          </p>

          {/* Bottom row: CTA + volume */}
          <div className="flex items-center gap-3">
            <button
              onClick={onReadMore}
              className="px-6 py-3 bg-white text-black font-black text-[11px] uppercase tracking-widest rounded-full flex items-center gap-2 active:scale-95 transition-all shadow-lg"
            >
              <BookOpen size={14} /> Leggi
            </button>
            {item.video && (
              <button
                onClick={(e) => { e.stopPropagation(); setMuted(!muted); }}
                className="w-11 h-11 rounded-full border border-white/20 flex items-center justify-center text-white bg-white/10 backdrop-blur"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Top-right: favorite only (small) ── */}

    </div>
  );
};

// ─── Reader Modal ─────────────────────────────────────────────────────────────
const ReaderModal = ({ item, onClose }: { item: NewsItem; onClose: () => void }) => (
  <AnimatePresence>
    {item && (
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 200 }}
        className="fixed inset-0 z-[200] bg-white flex flex-col"
      >
        {/* Header */}
        <div className="h-14 bg-white border-b border-zinc-100 flex items-center justify-between px-4 flex-shrink-0 shadow-sm">
          <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center text-black bg-zinc-100 active:scale-90 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 truncate max-w-[60%] text-center">{item.source}</div>
          <a href={item.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="w-10 h-10 rounded-full flex items-center justify-center text-emerald-600 bg-emerald-50">
            <ExternalLink size={18} />
          </a>
        </div>

        {/* Content */}
        <div className="flex-1 relative">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-300 pointer-events-none z-0 gap-2">
            <BookOpen size={36} className="opacity-30 animate-pulse" />
            <p className="text-xs opacity-40">Caricamento...</p>
          </div>
          <iframe
            src={`/api/proxy?url=${encodeURIComponent(item.link)}`}
            className="relative z-10 w-full h-full border-none"
            title={item.title}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          />
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

// ─── Search Overlay ───────────────────────────────────────────────────────────
const SearchOverlay = ({ news, onClose, onSelect, favorites }: { news: NewsItem[]; onClose: () => void; onSelect: (i: number) => void; favorites: string[] }) => {
  const [q, setQ] = useState('');
  const results = useMemo(() => !q.trim() ? [] : news.filter(n => n.title.toLowerCase().includes(q.toLowerCase()) || n.source.toLowerCase().includes(q.toLowerCase())).slice(0, 20), [q, news]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-xl flex flex-col"
    >
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <Search size={18} className="text-white/40 shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Cerca notizie, squadre, campioni..."
          className="flex-1 bg-transparent text-white placeholder-white/30 text-base font-medium outline-none"
        />
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && q.length === 0 && (
          <div className="p-8 text-center text-white/20 text-sm font-medium">Inizia a digitare…</div>
        )}
        {results.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => { onSelect(idx); onClose(); }}
            className="w-full flex items-start gap-3 p-4 border-b border-white/5 text-left hover:bg-white/5 transition-colors"
          >
            {item.image && <img src={item.image} className="w-16 h-12 object-cover rounded-lg flex-shrink-0 opacity-80" alt="" referrerPolicy="no-referrer" />}
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-sm line-clamp-2 leading-snug">{item.title}</div>
              <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider mt-1">{item.source}</div>
            </div>
          </button>
        ))}
        {results.length === 0 && q.length > 0 && (
          <div className="p-8 text-center text-white/30 text-sm">Nessun risultato per "<strong>{q}</strong>"</div>
        )}
      </div>
    </motion.div>
  );
};

// ─── Profile Drawer ───────────────────────────────────────────────────────────
const ProfileDrawer = ({ user, onClose, onLogin, onLogout, favorites, news }: {
  user: FirebaseUser | null; onClose: () => void;
  onLogin: () => void; onLogout: () => void;
  favorites: string[]; news: NewsItem[];
}) => {
  const savedItems = news.filter(n => favorites.includes(n.id));
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 w-full max-w-sm bg-zinc-950 z-[150] flex flex-col border-l border-white/5"
    >
      <div className="flex items-center justify-between p-5 border-b border-white/5">
        <h2 className="font-black text-white text-lg tracking-tight">Profilo</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-white/60"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {user ? (
          <>
            <div className="flex items-center gap-4 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
              {user.photoURL ? (
                <img src={user.photoURL} className="w-14 h-14 rounded-full border-2 border-emerald-500" alt="avatar" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500/30 flex items-center justify-center">
                  <UserCircle2 size={28} className="text-emerald-400" />
                </div>
              )}
              <div>
                <div className="font-black text-white text-base">{user.displayName || 'Atleta'}</div>
                <div className="text-white/40 text-[11px] mt-0.5">{user.email}</div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-3">Notizie Salvate ({savedItems.length})</div>
              {savedItems.length === 0 ? (
                <div className="text-white/30 text-sm p-4 text-center bg-white/3 rounded-xl border border-white/5">Nessuna notizia salvata ancora.</div>
              ) : (
                <div className="space-y-2">
                  {savedItems.slice(0, 10).map(item => (
                    <div key={item.id} className="flex items-start gap-3 p-3 bg-white/3 rounded-xl border border-white/5">
                      {item.image && <img src={item.image} className="w-12 h-9 object-cover rounded-lg flex-shrink-0 opacity-80" alt="" referrerPolicy="no-referrer" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs font-semibold line-clamp-2 leading-snug">{item.title}</div>
                        <div className="text-white/30 text-[10px] mt-1 font-bold uppercase">{item.source}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onLogout}
              className="w-full p-3 flex items-center gap-3 text-red-400 hover:text-red-300 hover:bg-red-500/5 rounded-xl transition-all"
            >
              <LogOut size={18} />
              <span className="text-sm font-bold">Disconnetti</span>
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-6 py-10">
            <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <UserCircle2 size={44} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <div className="text-white font-black text-xl mb-2">Accedi a SportFlow</div>
              <div className="text-white/40 text-sm leading-relaxed">Salva le notizie che ami e accedi da qualsiasi dispositivo.</div>
            </div>
            <button
              onClick={onLogin}
              className="w-full py-4 bg-white text-black font-black text-sm uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all"
            >
              <LogIn size={18} /> Accedi con Google
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ─── Admin Panel ──────────────────────────────────────────────────────────────
const AdminPanel = ({ onClose }: { onClose: () => void }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sources').then(r => r.json()).then(data => {
      setSources(data);
      setLoading(false);
    });
  }, []);

  const saveSources = async (newSources: Source[]) => {
    setSources(newSources);
    await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSources)
    });
  };

  const addSource = () => {
    const s: Source = { id: Date.now().toString(), name: 'Nuova Fonte', url: '', cat: 'Calcio', active: true };
    saveSources([...sources, s]);
  };

  const updateSource = (id: string, field: keyof Source, val: any) => {
    saveSources(sources.map(s => s.id === id ? { ...s, [field]: val } : s));
  };

  const removeSource = (id: string) => {
    saveSources(sources.filter(s => s.id !== id));
  };

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-2xl flex flex-col p-6"
    >
      <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <Shield className="text-emerald-400" size={24} />
          <h2 className="text-xl font-black text-white uppercase tracking-tighter">Pannello SportFlow Admin</h2>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/50"><X /></button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Gestione RSS News</h3>
            <button onClick={addSource} className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-black rounded-lg flex items-center gap-1.5 uppercase">
              <Plus size={14} /> Aggiungi
            </button>
          </div>
          <div className="space-y-3">
            {sources.map(s => (
              <div key={s.id} className="p-4 bg-white/5 rounded-2xl border border-white/5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <input
                    value={s.name}
                    onChange={(e) => updateSource(s.id, 'name', e.target.value)}
                    className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white flex-1 font-bold"
                  />
                  <select
                    value={s.cat}
                    onChange={(e) => updateSource(s.id, 'cat', e.target.value)}
                    className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/60 font-medium"
                  >
                    {CATEGORIES.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
                  </select>
                  <button onClick={() => removeSource(s.id)} className="text-red-500/50 hover:text-red-500 p-2"><Trash2 size={16} /></button>
                </div>
                <input
                  value={s.url}
                  onChange={(e) => updateSource(s.id, 'url', e.target.value)}
                  placeholder="URL del feed RSS..."
                  className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/40 font-mono w-full"
                />
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 bg-white/5 border border-white/5 rounded-2xl">
            <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-4">Impostazioni SEO</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Titolo App</label>
                <input defaultValue="SportFlow Elite" className="w-full bg-zinc-900 border border-white/5 rounded-lg px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Meta Descrizione</label>
                <textarea defaultValue="Il tuo hub per le ultime notizie sportive e highlights." className="w-full bg-zinc-900 border border-white/5 rounded-lg px-3 py-2 text-xs text-white" rows={2} />
              </div>
            </div>
          </div>
          <div className="p-5 bg-white/5 border border-white/5 rounded-2xl">
            <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-4">Analytics & Proprietà</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-black text-white/20 uppercase mb-1 block">Google Analytics ID</label>
                <input placeholder="G-XXXXXXXXXX" className="w-full bg-zinc-900 border border-white/5 rounded-lg px-3 py-2 text-xs text-white" />
              </div>
              <div className="pt-2">
                <div className="flex items-center gap-2 text-emerald-400">
                  <RefreshCw size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Servizio Live</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 border-t border-white/10 pt-6 flex items-center justify-between">
        <p className="text-[10px] text-white/20 font-medium">Versione 1.5.0 Build 2024</p>
        <button onClick={onClose} className="px-10 py-3 bg-emerald-500 text-white font-black text-xs uppercase tracking-widest rounded-full shadow-lg">Chiudi Pannello</button>
      </div>
    </motion.div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isFABOpen, setIsFABOpen] = useState(false);
  const [hasNewNews, setHasNewNews] = useState(false);
  const [lastCheckId, setLastCheckId] = useState<string | null>(null);
  const [readerItem, setReaderItem] = useState<NewsItem | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [isStandingsOpen, setIsStandingsOpen] = useState(false);
  const [isEventsOpen, setIsEventsOpen] = useState(false);
  const [standingsTab, setStandingsTab] = useState<'f1' | 'seriea' | 'basket'>('seriea');
  const mainRef = useRef<HTMLElement>(null);

  // – Auth
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, 'users', u.uid));
          if (snap.exists()) setFavorites(snap.data().favorites || []);
        } catch {}
      } else {
        const saved = localStorage.getItem('sf_favorites');
        setFavorites(saved ? JSON.parse(saved) : []);
      }
    });
  }, []);

  // – Fetch news
  const fetchNews = async () => {
    try {
      const res = await fetch('/api/news');
      const data = await res.json();
      setNews(data);
      if (data.length > 0) setLastCheckId(data[0].id);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  // – Background Background Fetch (2 minutes)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!lastCheckId || hasNewNews) return;
      try {
        const res = await fetch('/api/news');
        const latest = await res.json();
        if (latest.length > 0 && latest[0].id !== lastCheckId) {
          setHasNewNews(true);
        }
      } catch {}
    }, 120000);
    return () => clearInterval(timer);
  }, [lastCheckId, hasNewNews]);

  // – Filtered news
  const filteredNews = useMemo(() => {
    if (selectedCategory === 'favorites') return news.filter(n => favorites.includes(n.id));
    if (selectedCategory === 'all') return news;
    return news.filter(n => classifyCat(n) === selectedCategory);
  }, [news, selectedCategory, favorites]);

  // – Scroll handler
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const t = e.currentTarget;
    if (t.clientHeight === 0) return;
    const idx = Math.round(t.scrollTop / t.clientHeight);
    if (idx !== currentIndex) setCurrentIndex(idx);
  };

  // – Scroll to index
  const scrollTo = (idx: number) => {
    if (!mainRef.current || idx < 0 || idx >= filteredNews.length) return;
    mainRef.current.scrollTo({ top: idx * mainRef.current.clientHeight, behavior: 'smooth' });
  };

  // – Favorite toggle
  const toggleFav = async (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(next);
    if (user) {
      try { await updateDoc(doc(db, 'users', user.uid), { favorites: next }); } catch {}
    } else {
      localStorage.setItem('sf_favorites', JSON.stringify(next));
    }
  };

  // – Categories for FAB
  const fabCategories = useMemo(() => CATEGORIES.filter(c => c.id !== 'favorites').map(c => c.id), []);

  // – Login / Logout
  const handleLogin = async () => { try { await signInWithGoogle(); } catch {} };
  const handleLogout = async () => { try { await logout(); setFavorites([]); } catch {} };

  const fabActions: FABAction[] = [
    { id: 'search',  icon: <Search size={20} />, label: 'Cerca', color: '#10b981', onClick: () => setIsSearchOpen(true) },
    { id: 'standings', icon: <Trophy size={20} />, label: 'Classifiche', color: '#f59e0b', onClick: () => setIsStandingsOpen(true) },
    { id: 'events', icon: <Calendar size={20} />, label: 'Eventi', color: '#8b5cf6', onClick: () => setIsEventsOpen(true) },
    { id: 'favs',    icon: <Heart size={20} />,  label: 'Salvati', color: '#ef4444', onClick: () => { setSelectedCategory('favorites'); setCurrentIndex(0); if(mainRef.current) mainRef.current.scrollTop = 0; } },
    { id: 'profile', icon: <UserCircle2 size={20} />, label: 'Profilo', color: '#3b82f6', onClick: () => setIsProfileOpen(true) },
    { id: 'admin',   icon: <Shield size={20} />, label: 'Admin', color: '#f59e0b', onClick: () => setIsAdminLoginOpen(true) },
  ];

  // ── Loading screen
  if (loading) return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-6">
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6], rotate: 360 }}
        transition={{ scale: { repeat: Infinity, duration: 1.5 }, rotate: { repeat: Infinity, duration: 3, ease: 'linear' } }}
        className="w-24 h-24 rounded-full flex items-center justify-center p-4 overflow-hidden"
        style={{ background: 'white', boxShadow: '0 0 60px rgba(16,185,129,0.4)', border: '4px solid #10b981' }}
      >
        <img src="/iconpalla.png" className="w-full h-full object-contain shadow-lg" alt="Loading" />
      </motion.div>
      <div className="text-white/30 text-[11px] font-black uppercase tracking-[0.4em] animate-pulse">Caricamento…</div>
    </div>
  );

  // ── Main render
  return (
    <div className="fixed inset-0 bg-black text-white font-sans select-none">

      {/* ─── Header ─── */}
      <header className="fixed top-0 left-0 right-0 z-40 h-[68px] flex items-center justify-between px-5 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="w-10 h-10" /> {/* Spacer */}

        <div className="flex flex-col items-center pointer-events-auto">
          <span className="text-xl font-black italic tracking-tighter" style={{ color: '#10b981', filter: 'drop-shadow(0 0 12px rgba(16,185,129,0.6))' }}>
            SPORTFLOW
          </span>
          <span className="text-[8px] font-bold text-white/30 uppercase tracking-[0.3em]">
            {CATEGORIES.find(c => c.id === selectedCategory)?.label}
          </span>
        </div>

        <div className="w-10 h-10" /> {/* Spacer */}
      </header>

      {/* ─── New News Notification ─── */}
      <AnimatePresence>
        {hasNewNews && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 80, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
          >
            <button
              onClick={() => {
                setHasNewNews(false);
                setLoading(true);
                fetchNews().then(() => {
                  setCurrentIndex(0);
                  mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                });
              }}
              className="pointer-events-auto px-5 py-2.5 bg-emerald-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full shadow-[0_10px_30px_rgba(16,185,129,0.4)] flex items-center gap-2 animate-bounce border border-emerald-400/50"
            >
              <RefreshCw size={14} className="animate-spin-slow" /> Nuovi Aggiornamenti
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Main Vertical Feed ─── */}
      <main
        ref={mainRef}
        onScroll={handleScroll}
        className="w-full h-full overflow-y-auto snap-y snap-mandatory custom-scrollbar"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {filteredNews.length > 0 ? filteredNews.map((item, idx) => (
          <div key={item.id} className="w-full h-full flex-shrink-0">
            <NewsCard
              item={item}
              isActive={idx === currentIndex}
              isFavorite={favorites.includes(item.id)}
              onToggleFavorite={() => toggleFav(item.id)}
              onReadMore={() => setReaderItem(item)}
            />
          </div>
        )) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 p-12 text-center">
            <Trophy size={50} className="text-zinc-800" />
            <p className="text-white/30 font-medium">Nessuna notizia in questa categoria.</p>
            <button onClick={() => { setSelectedCategory('all'); setCurrentIndex(0); }}
              className="px-6 py-2 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-black uppercase tracking-wider">
              Torna a Tutti
            </button>
          </div>
        )}
      </main>

      {/* ─── FAB L-Shape ─── */}
      {!isMenuOpen && !isSearchOpen && !isProfileOpen && !readerItem && !isStandingsOpen && !isEventsOpen && (
        <FAB 
          categories={fabCategories}
          actions={fabActions} 
          isOpen={isFABOpen} 
          onToggle={() => setIsFABOpen(p => !p)} 
          onSelectCategory={(cat) => {
            setSelectedCategory(cat);
            setCurrentIndex(0);
            setTimeout(() => mainRef.current?.scrollTo({ top: 0 }), 100);
          }}
          selectedCategory={selectedCategory}
        />
      )}

      {/* ─── Tap to close FAB ─── */}
      {isFABOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsFABOpen(false)} />
      )}

      {/* ─── Categories Drawer ─── */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-[82%] max-w-[300px] bg-zinc-950 z-[101] flex flex-col border-r border-white/5"
            >
              <div className="flex items-center justify-between p-6 pt-14 border-b border-white/5">
                <span className="font-black text-emerald-400 text-lg italic tracking-tighter">SPORTFLOW</span>
                <button onClick={() => setIsMenuOpen(false)} className="text-white/40"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {CATEGORIES.map(cat => {
                  const active = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setSelectedCategory(cat.id); setIsMenuOpen(false); setCurrentIndex(0); setTimeout(() => mainRef.current?.scrollTo({ top: 0 }), 50); }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all text-left ${active ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-white/5 border border-transparent'}`}
                    >
                      <span className="text-2xl">{cat.icon}</span>
                      <span className={`font-bold text-sm ${active ? 'text-emerald-400' : 'text-white/70'}`}>{cat.label}</span>
                      {active && <Zap size={14} className="ml-auto fill-emerald-400 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>

              <div className="p-4 border-t border-white/5">
                <button
                  onClick={() => { setIsMenuOpen(false); setIsProfileOpen(true); }}
                  className="w-full p-4 flex items-center gap-3 text-white/50 hover:text-white rounded-xl hover:bg-white/5 transition-all"
                >
                  <UserCircle2 size={18} />
                  <span className="text-xs font-bold uppercase tracking-widest">{user ? 'Il mio Profilo' : 'Accedi'}</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Search Overlay ─── */}
      <AnimatePresence>
        {isSearchOpen && (
          <SearchOverlay
            news={news}
            favorites={favorites}
            onClose={() => setIsSearchOpen(false)}
            onSelect={(idx) => {
              const item = news.filter(n => {
                const q = ''; // already filtered in component
                return true;
              })[idx];
              // Find the correct index in filteredNews
              setSelectedCategory('all');
              setIsSearchOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ─── Profile Drawer ─── */}
      <AnimatePresence>
        {isProfileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsProfileOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[140]" />
            <ProfileDrawer
              user={user}
              onClose={() => setIsProfileOpen(false)}
              onLogin={handleLogin}
              onLogout={handleLogout}
              favorites={favorites}
              news={news}
            />
          </>
        )}
      </AnimatePresence>

      {/* ─── Reader Modal ─── */}
      <AnimatePresence>
        {readerItem && <ReaderModal item={readerItem} onClose={() => setReaderItem(null)} />}
      </AnimatePresence>

      {/* ─── Admin Login ─── */}
      <AnimatePresence>
        {isAdminLoginOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-sm bg-zinc-950 border border-white/10 rounded-[32px] p-8">
              <div className="flex flex-col items-center gap-4 mb-8">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Shield size={32} className="text-emerald-400" />
                </div>
                <h2 className="text-white font-black text-xl uppercase tracking-tighter">Accesso Scudetto</h2>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-white/20 uppercase ml-2 tracking-widest">Utente</label>
                  <input value={adminUser} onChange={e => setAdminUser(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-emerald-500/50 transition-all font-bold" />
                </div>
                <div className="space-y-1.5 text-left">
                  <label className="text-[9px] font-black text-white/20 uppercase ml-2 tracking-widest">Password</label>
                  <input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-emerald-500/50 transition-all font-bold" />
                </div>
                <button
                  onClick={() => {
                    if (adminUser === 'admin' && adminPass === 'accesso') {
                      setIsAdminLoginOpen(false);
                      setIsAdminOpen(true);
                      setAdminUser(''); setAdminPass('');
                    } else { alert('Credenziali Errate'); }
                  }}
                  className="w-full py-4 bg-emerald-500 text-white font-black text-sm uppercase tracking-[0.2em] rounded-2xl mt-4 active:scale-95 transition-all shadow-[0_10px_30px_rgba(16,185,129,0.3)]"
                >
                  Sblocca Pannello
                </button>
                <button onClick={() => setIsAdminLoginOpen(false)} className="w-full py-2 text-white/30 text-[10px] font-bold uppercase tracking-widest mt-2 hover:text-white/50">Annulla</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Admin Panel ─── */}
      <AnimatePresence>
        {isAdminOpen && <AdminPanel onClose={() => setIsAdminOpen(false)} />}
      </AnimatePresence>

      {/* ─── Standings Overlay ─── */}
      <AnimatePresence>
        {isStandingsOpen && (
          <StandingsOverlay 
            onClose={() => setIsStandingsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ─── Events Overlay ─── */}
      <AnimatePresence>
        {isEventsOpen && (
          <EventsOverlay 
            onClose={() => setIsEventsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── StandingsOverlay ─────────────────────────────────────────────────────────
const StandingsOverlay = ({ onClose }: { 
  onClose: () => void;
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/standings/seriea')
      .then(r => r.json())
      .then(res => {
        setData(res.map((s: any) => ({
          position: s.position,
          name: s.team,
          info: 'Serie A',
          points: s.points,
          extra: `P: ${s.played} | W: ${s.won}`,
          logo: s.logo
        })));
        setLoading(false);
      }).catch(() => setLoading(false));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[250] bg-black/95 backdrop-blur-3xl flex flex-col p-4 md:p-8"
    >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <Trophy className="text-amber-400" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tighter leading-none">Classifiche Live</h2>
              <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-1">Aggiornamento in tempo reale</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">
            <X size={20} />
          </button>
        </div>

        {/* Only Serie A Standings */}
        <div className="flex bg-white/5 p-1 rounded-2xl mb-6 border border-white/5">
          <div className="flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white text-black shadow-xl flex items-center justify-center gap-2">
            <span>⚽</span> Serie A
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-64 gap-3"
              >
                <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Sincronizzazione API...</p>
              </motion.div>
            ) : (
              <motion.div 
                key="seriea"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                className="space-y-3 pb-10"
              >
                {data?.map((item: any, idx: number) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    key={idx} 
                    className="flex items-center gap-4 p-4 bg-white/5 hover:bg-white/[0.08] transition-colors rounded-2xl border border-white/5 group"
                  >
                    <div className="w-8 text-center text-lg font-black italic text-white/10 group-hover:text-emerald-500/30 transition-colors">
                      {item.position}
                    </div>
                    
                    {item.logo && (
                      <div className="w-10 h-10 rounded-full bg-white/5 p-1.5 flex-shrink-0">
                        <img src={item.logo} className="w-full h-full object-contain" alt="" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white text-sm md:text-base uppercase tracking-tight truncate">{item.name}</span>
                        <span className="text-[8px] font-black text-white/20 uppercase bg-white/5 px-2 py-0.5 rounded-full border border-white/5">{item.info}</span>
                      </div>
                      <div className="text-[10px] text-white/30 font-bold uppercase tracking-wider">{item.extra}</div>
                    </div>

                    <div className="text-right">
                      <div className={`text-sm md:text-lg font-black ${idx < 3 ? 'text-amber-400' : 'text-emerald-400'}`}>{item.points}</div>
                      <div className="text-[8px] font-bold text-white/20 uppercase">Record</div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
            <p className="text-[8px] text-white/20 font-bold uppercase tracking-[0.2em]">Dati: Sky Sport / Ergast API • 2026</p>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[8px] text-emerald-500/60 font-black uppercase tracking-widest">Dati Live</span>
            </div>
        </div>
    </motion.div>
  );
};

// ─── EventsOverlay ────────────────────────────────────────────────────────────
const EventsOverlay = ({ onClose }: { onClose: () => void }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/events/seriea')
      .then(r => r.json())
      .then(data => {
        setEvents(data);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[250] bg-black/95 backdrop-blur-3xl flex flex-col p-4 md:p-8"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-violet-500/20 flex items-center justify-center border border-violet-500/30">
            <Calendar className="text-violet-400" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tighter leading-none">Eventi Live</h2>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-1">Calendario Serie A</p>
          </div>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <AnimatePresence mode="wait">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <div className="w-12 h-12 border-4 border-violet-500/20 border-t-violet-500 rounded-full animate-spin" />
              <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Caricamento calendario...</p>
            </div>
          ) : (
            <div className="space-y-4 pb-10">
              {events.map((event, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  key={event.id || idx}
                  className="bg-white/5 border border-white/5 rounded-[24px] overflow-hidden"
                >
                  <div className="bg-white/[0.03] px-5 py-3 flex items-center justify-between border-b border-white/5">
                    <div className="flex items-center gap-2">
                       <Calendar size={12} className="text-violet-400" />
                       <span className="text-[10px] font-black text-white/60 uppercase tracking-wider">{event.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <Clock size={12} className="text-violet-400" />
                       <span className="text-[10px] font-black text-white/60 uppercase tracking-wider">{event.time}</span>
                    </div>
                  </div>
                  
                  <div className="p-6 flex flex-col items-center gap-4">
                    <div className="flex items-center justify-center w-full gap-4">
                      <div className="flex-1 text-right font-black text-sm md:text-base uppercase tracking-tight text-white">{event.homeTeam}</div>
                      <div className="px-3 py-1 bg-white/10 rounded-lg text-[10px] font-black text-white/40">VS</div>
                      <div className="flex-1 text-left font-black text-sm md:text-base uppercase tracking-tight text-white">{event.awayTeam}</div>
                    </div>
                    
                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/5 border border-emerald-500/10 rounded-full">
                       <MapPin size={12} className="text-emerald-400" />
                       <span className="text-[9px] font-bold text-emerald-400/80 uppercase tracking-widest">{event.venue}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
          <p className="text-[8px] text-white/20 font-bold uppercase tracking-[0.2em]">Fonte: Corriere dello Sport Official Data</p>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse`} />
            <span className="text-[8px] text-emerald-500/60 font-black uppercase tracking-widest">Live Feed</span>
          </div>
      </div>
    </motion.div>
  );
};
