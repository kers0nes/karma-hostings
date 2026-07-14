// server.js
// Karma Protection v6.5 - Gold Edition

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  PresenceUpdateStatus,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

// ============ ENVIRONMENT VARIABLES ============
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_PATH = process.env.DATABASE_PATH || './data.sqlite';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://luarmor-bot-1-0yt4.onrender.com';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OWNER_ID = process.env.OWNER_ID || 'YOUR_DISCORD_ID_HERE';
const BRAND_COLOR = parseInt(process.env.BRAND_COLOR) || 0xD4AF37;
const PREFIX = process.env.PREFIX || '/';

const SESSION_SIGNING_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  console.error('Set it with: export DISCORD_TOKEN=your_token_here');
  process.exit(1);
}

console.log('✨ Karma Protection v6.5 - Gold Edition starting...');
console.log(`📁 Database: ${DATABASE_PATH}`);
console.log(`🌐 Base URL: ${PUBLIC_BASE_URL}`);

// ---------------- Database ----------------
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE,
  username TEXT,
  avatar TEXT,
  access_token TEXT,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  version TEXT DEFAULT '1.0.0',
  status TEXT DEFAULT 'active',
  ffa_mode INTEGER DEFAULT 0,
  compress_mode INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  hwid TEXT,
  note TEXT,
  expires_at TEXT,
  resettable TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY(script_id) REFERENCES scripts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS banned_hwids (
  hwid TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  channel_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  hwid_cooldown INTEGER DEFAULT 180,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(script_id) REFERENCES scripts(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS whitelist (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  discord_id TEXT NOT NULL,
  username TEXT,
  hwid TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(script_id) REFERENCES scripts(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// ---------------- Helper Functions ----------------
function makeId(prefix = 'script') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'KARMA-';
  for (let i = 0; i < 4; i++) {
    if (i > 0) result += '-';
    for (let j = 0; j < 4; j++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return result;
}

function maskKey(key) {
  if (!key) return 'Invalid';
  return 'KARMA-****-****-' + key.slice(-4).toUpperCase();
}

function addHours(hours) {
  if (!hours || hours <= 0) return null;
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function isExpired(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || 3000}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSessionUser(req) {
  return req.session.user || null;
}

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

function timeRemaining(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'Permanent';
  const d = new Date(expiresAt);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

// ---------------- Express App ----------------
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SIGNING_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: PUBLIC_BASE_URL && PUBLIC_BASE_URL.startsWith('https'), maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ---------------- API Routes ----------------
app.get('/api/data', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json({ error: 'Not authenticated' });
  
  const scripts = db.prepare('SELECT * FROM scripts WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const panels = db.prepare('SELECT * FROM panels WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const keys = db.prepare('SELECT * FROM keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const banned = db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC').all();
  const whitelist = db.prepare('SELECT * FROM whitelist WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  
  res.json({
    scripts,
    panels,
    keys,
    bannedHWIDs: banned,
    whitelist,
    serverTime: Date.now()
  });
});

app.post('/api/create-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { name, code, compressMode } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Missing name or code' });
  
  const id = makeId('script');
  db.prepare(`
    INSERT INTO scripts (id, user_id, name, code, version, status, compress_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.id, name, code, '1.0.0', 'active', compressMode ? 1 : 0);
  
  res.json({ success: true, id });
});

app.post('/api/update-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id, name, code } = req.body;
  if (!id || !name || !code) return res.status(400).json({ error: 'Missing fields' });
  
  const existing = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!existing) return res.status(404).json({ error: 'Script not found' });
  
  db.prepare('UPDATE scripts SET name = ?, code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(name, code, id, user.id);
  
  res.json({ success: true });
});

app.put('/api/scripts/:id/toggle', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.params;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  const newStatus = script.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE scripts SET status = ? WHERE id = ? AND user_id = ?')
    .run(newStatus, id, user.id);
  
  res.json({ success: true, status: newStatus });
});

app.put('/api/scripts/:id/ffa', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.params;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  const newFfa = script.ffa_mode ? 0 : 1;
  db.prepare('UPDATE scripts SET ffa_mode = ? WHERE id = ? AND user_id = ?')
    .run(newFfa, id, user.id);
  
  res.json({ success: true, ffa_mode: newFfa });
});

app.post('/api/delete-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.body;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  db.prepare('DELETE FROM scripts WHERE id = ? AND user_id = ?').run(id, user.id);
  res.json({ success: true });
});

app.post('/api/create-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { name, description, channelId, scriptId, hwidCooldown } = req.body;
  if (!name || !channelId || !scriptId) return res.status(400).json({ error: 'Missing fields' });
  
  const id = makeId('panel');
  db.prepare(`
    INSERT INTO panels (id, user_id, name, description, channel_id, script_id, hwid_cooldown)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.id, name, description || '', channelId, scriptId, hwidCooldown || 180);
  
  res.json({ success: true, id });
});

app.post('/api/delete-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.body;
  db.prepare('DELETE FROM panels WHERE id = ? AND user_id = ?').run(id, user.id);
  res.json({ success: true });
});

app.post('/api/send-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { panelId } = req.body;
  const panel = db.prepare('SELECT * FROM panels WHERE id = ? AND user_id = ?').get(panelId, user.id);
  if (!panel) return res.status(404).json({ error: 'Panel not found' });
  
  res.json({ success: true });
});

app.post('/api/generate-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { panelId, durationHours, note } = req.body;
  if (!panelId) return res.status(400).json({ error: 'Panel ID required' });
  
  const panel = db.prepare('SELECT * FROM panels WHERE id = ? AND user_id = ?').get(panelId, user.id);
  if (!panel) return res.status(404).json({ error: 'Panel not found' });
  
  const key = generateKey();
  const expiresAt = durationHours > 0 ? addHours(durationHours) : null;
  const id = makeId('key');
  
  db.prepare(`
    INSERT INTO keys (id, script_id, user_id, key, note, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, panel.script_id, user.id, key, note || '', expiresAt);
  
  res.json({ success: true, key });
});

app.post('/api/delete-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { key } = req.body;
  db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(key, user.id);
  res.json({ success: true });
});

app.post('/api/add-time-all', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { hours } = req.body;
  if (!hours || isNaN(hours)) return res.status(400).json({ error: 'Invalid hours' });
  
  const keys = db.prepare('SELECT * FROM keys WHERE user_id = ? AND expires_at IS NOT NULL').all(user.id);
  for (const k of keys) {
    const currentExpiry = new Date(k.expires_at);
    currentExpiry.setHours(currentExpiry.getHours() + parseInt(hours));
    db.prepare('UPDATE keys SET expires_at = ? WHERE key = ?').run(currentExpiry.toISOString(), k.key);
  }
  
  res.json({ success: true });
});

app.post('/api/ban-hwid', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { hwid } = req.body;
  if (!hwid) return res.status(400).json({ error: 'HWID required' });
  
  db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, banned_by) VALUES (?, ?)')
    .run(hwid, user.id);
  
  res.json({ success: true });
});

app.post('/api/unban-hwid', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { hwid } = req.body;
  if (!hwid) return res.status(400).json({ error: 'HWID required' });
  
  db.prepare('DELETE FROM banned_hwids WHERE hwid = ?').run(hwid);
  res.json({ success: true });
});

app.post('/api/delete-whitelist', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  
  const entry = db.prepare('SELECT * FROM whitelist WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!entry) return res.status(404).json({ error: 'Whitelist entry not found' });
  
  db.prepare('DELETE FROM whitelist WHERE id = ? AND user_id = ?').run(id, user.id);
  db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(entry.key, user.id);
  
  res.json({ success: true });
});

// ---------------- Discord Auth Routes ----------------
app.get('/api/auth/discord', (req, res) => {
  const state = crypto.randomBytes(18).toString('hex');
  req.session.oauth_state = state;
  
  const redirectUri = `${publicBaseUrl()}/api/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state
  });
  
  console.log('🔑 OAuth Redirect URI:', redirectUri);
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code || !state || state !== req.session.oauth_state) {
    return res.status(400).send('Invalid OAuth state');
  }
  
  try {
    const redirectUri = `${publicBaseUrl()}/api/auth/discord/callback`;
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: DISCORD_TOKEN,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri
      })
    });
    
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error('Failed to get token');
    
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userResponse.json();
    
    let dbUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(user.id);
    if (!dbUser) {
      const id = `user_${crypto.randomBytes(8).toString('hex')}`;
      db.prepare(`
        INSERT INTO users (id, discord_id, username, avatar, access_token, provider)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, user.id, user.username, user.avatar || '', tokenData.access_token, 'discord');
      dbUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(user.id);
    } else {
      db.prepare('UPDATE users SET username = ?, avatar = ?, access_token = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?')
        .run(user.username, user.avatar || '', tokenData.access_token, user.id);
    }
    
    req.session.user = {
      id: dbUser.id,
      discord_id: user.id,
      username: user.username,
      global_name: user.global_name,
      avatar: user.avatar
    };
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ---------------- Health Check ----------------
app.get('/health', (req, res) => {
  res.json({ ok: true, name: 'Karma Protection v6.5 Gold' });
});

// ---------------- Website Routes - Gold Theme ----------------
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Protection | Gold Edition</title>
  <style>
    :root {
      --bg-color: #0a0a0a;
      --card-bg: rgba(18, 18, 20, 0.85);
      --primary: #d4af37;
      --primary-hover: #e8c84a;
      --primary-gradient: linear-gradient(135deg, #d4af37, #f5d76e, #d4af37);
      --discord: #5865F2;
      --discord-hover: #4752C4;
      --text-main: #f8fafc;
      --text-muted: #b0a8a0;
      --border: rgba(212, 175, 55, 0.2);
      --glow: rgba(212, 175, 55, 0.25);
      --shadow: 0 0 60px rgba(212, 175, 55, 0.08);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-image: radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.06) 0%, transparent 70%);
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; width: 100%; }
    
    .glass-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 460px;
      width: 100%;
      margin: 0 auto;
      box-shadow: var(--shadow), inset 0 0 0 1px rgba(212, 175, 55, 0.05);
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .glass-card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: conic-gradient(from 0deg, transparent, rgba(212, 175, 55, 0.03), transparent, rgba(212, 175, 55, 0.03), transparent);
      animation: rotate 20s linear infinite;
      pointer-events: none;
    }
    @keyframes rotate { 100% { transform: rotate(360deg); } }
    
    .logo { margin-bottom: 24px; position: relative; z-index: 1; }
    .logo svg { width: 56px; height: 56px; color: var(--primary); filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.3)); }
    h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
      position: relative;
      z-index: 1;
    }
    h1 span { 
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { color: var(--text-muted); font-size: 14px; margin-bottom: 28px; position: relative; z-index: 1; }
    
    .btn-discord {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 16px 24px;
      background: var(--primary-gradient);
      color: #0a0a0a;
      border: none;
      border-radius: 14px;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.3s ease;
      text-decoration: none;
      position: relative;
      z-index: 1;
      box-shadow: 0 4px 30px rgba(212, 175, 55, 0.3);
    }
    .btn-discord:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 40px rgba(212, 175, 55, 0.5);
    }
    .btn-discord svg { width: 22px; height: 22px; fill: #0a0a0a; }
    
    .footer-links {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 20px;
      justify-content: center;
      flex-wrap: wrap;
      position: relative;
      z-index: 1;
    }
    .footer-links button {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 13px;
      cursor: pointer;
      transition: color 0.2s;
      font-weight: 500;
    }
    .footer-links button:hover { color: var(--primary); }
    
    .hidden { display: none !important; }
    .fade-in { animation: fadeIn 0.5s ease-out forwards; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
    
    .feature-list { text-align: left; position: relative; z-index: 1; }
    .feature-list .item {
      display: flex;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
    }
    .feature-list .item:last-child { border-bottom: none; }
    .feature-list .icon { color: var(--primary); flex-shrink: 0; margin-top: 2px; font-size: 20px; }
    .feature-list .title { font-weight: 600; font-size: 14px; margin-bottom: 2px; color: var(--text-main); }
    .feature-list .desc { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 20px;
      padding: 12px 24px;
      background: rgba(212, 175, 55, 0.08);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-main);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
      justify-content: center;
      position: relative;
      z-index: 1;
    }
    .back-btn:hover { border-color: var(--primary); color: var(--primary); background: rgba(212, 175, 55, 0.12); }
    
    .terms-content {
      max-height: 300px;
      overflow-y: auto;
      text-align: left;
      padding-right: 10px;
      position: relative;
      z-index: 1;
    }
    .terms-content::-webkit-scrollbar { width: 4px; }
    .terms-content::-webkit-scrollbar-thumb { background: var(--primary); border-radius: 4px; }
    .terms-content h4 { color: var(--primary); margin: 16px 0 6px; font-size: 14px; }
    .terms-content p { color: var(--text-muted); font-size: 13px; line-height: 1.6; margin-bottom: 12px; }
    
    .gold-badge {
      display: inline-block;
      padding: 4px 14px;
      border: 1px solid var(--primary);
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      color: var(--primary);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
      position: relative;
      z-index: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="login-view" class="glass-card fade-in">
      <div class="logo">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7v4m8-4v4"></path>
        </svg>
      </div>
      <div class="gold-badge">✦ Premium Protection ✦</div>
      <h1>Karma <span>Protection</span></h1>
      <p class="subtitle">HWID-locked key system with gold-standard security</p>
      <a href="/api/auth/discord" class="btn-discord">
        <svg viewBox="0 0 127.14 96.36">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91.08,65.69,84.69,65.69Z"/>
        </svg>
        Login with Discord
      </a>
      <div class="footer-links">
        <button onclick="showView('features')">✦ Features</button>
        <button onclick="showView('terms')">📜 Terms</button>
      </div>
    </div>

    <div id="features-view" class="glass-card hidden">
      <h2 style="text-align:left;font-size:20px;margin-bottom:16px;color:var(--primary);">✦ Protection Systems</h2>
      <div class="feature-list">
        <div class="item">
          <div class="icon">🔐</div>
          <div><div class="title">Self-Decrypting Architecture</div><div class="desc">Your script dynamically self-decrypts at runtime using proprietary instructions.</div></div>
        </div>
        <div class="item">
          <div class="icon">🔑</div>
          <div><div class="title">HWID Locked Key System</div><div class="desc">Keys bind to hardware IDs. Reset available with 24h cooldown.</div></div>
        </div>
        <div class="item">
          <div class="icon">🛡️</div>
          <div><div class="title">Anti-Dump Hardening</div><div class="desc">Detects dumping tools and refuses to reveal your code.</div></div>
        </div>
        <div class="item">
          <div class="icon">👥</div>
          <div><div class="title">Whitelist Management</div><div class="desc">Auto-generate keys when whitelisting users.</div></div>
        </div>
      </div>
      <button class="back-btn" onclick="showView('login')">← Return to Login</button>
    </div>

    <div id="terms-view" class="glass-card hidden">
      <h2 style="text-align:left;font-size:18px;margin-bottom:16px;color:var(--primary);">Legal Terms</h2>
      <div class="terms-content">
        <h4>1. Acceptance of Service</h4>
        <p>By using our services, you agree to these terms. If you do not agree, do not use the panel.</p>
        <h4>2. Key and HWID Usage</h4>
        <p>Licenses are strictly personal and non-transferable. Any attempt at bypassing will result in an immediate HWID Ban.</p>
        <h4>3. Security & Leaks</h4>
        <p>In the event of a vulnerability, our team will patch it immediately to ensure script integrity.</p>
        <h4>4. Intellectual Property</h4>
        <p>We do not claim ownership of your scripts. Malicious content is strictly prohibited.</p>
        <h4>5. System Availability</h4>
        <p>We strive for 99.9% uptime but are not responsible for revenue loss due to maintenance.</p>
      </div>
      <button class="back-btn" onclick="showView('login')">← I understand, go back</button>
    </div>
  </div>

  <script>
    function showView(view) {
      var views = ['login', 'features', 'terms'];
      views.forEach(function(id) {
        var el = document.getElementById(id + '-view');
        if (id === view) {
          el.classList.remove('hidden');
          el.classList.add('fade-in');
        } else {
          el.classList.add('hidden');
          el.classList.remove('fade-in');
        }
      });
    }
  </script>
</body>
</html>`);
});

app.get('/dashboard', requireAuth, (req, res) => {
  const user = req.session.user;
  const escapedUsername = escapeHtml(user.global_name || user.username);
  const avatarUrl = user.avatar ? 'https://cdn.discordapp.com/avatars/' + user.discord_id + '/' + user.avatar + '.png?size=128' : 'https://cdn.discordapp.com/embed/avatars/0.png';
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Protection | Gold Dashboard</title>
  <style>
    :root {
      --bg-color: #0a0a0a;
      --card-bg: rgba(18, 18, 20, 0.85);
      --primary: #d4af37;
      --primary-hover: #e8c84a;
      --primary-gradient: linear-gradient(135deg, #d4af37, #f5d76e, #d4af37);
      --discord: #5865F2;
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
      --text-main: #f8fafc;
      --text-muted: #b0a8a0;
      --border: rgba(212, 175, 55, 0.15);
      --glow: rgba(212, 175, 55, 0.12);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
      background-image: radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.04) 0%, transparent 70%);
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar .brand {
      font-size: 20px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .topbar .brand span { 
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .topbar .user {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .topbar .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--primary);
    }
    .topbar .username { font-weight: 600; font-size: 14px; }
    .topbar .logout {
      color: var(--text-muted);
      cursor: pointer;
      font-size: 13px;
      transition: color 0.2s;
    }
    .topbar .logout:hover { color: var(--danger); }
    
    .dashboard {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 0;
      min-height: calc(100vh - 72px);
    }
    .sidebar {
      background: var(--card-bg);
      border-right: 1px solid var(--border);
      padding: 20px 16px;
      overflow-y: auto;
    }
    .sidebar .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 10px;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 4px;
    }
    .sidebar .nav-item:hover { background: rgba(212, 175, 55, 0.08); color: white; }
    .sidebar .nav-item.active {
      background: rgba(212, 175, 55, 0.12);
      color: var(--primary);
      border: 1px solid rgba(212, 175, 55, 0.2);
    }
    .sidebar .nav-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      padding: 12px 14px 6px;
      font-weight: 700;
    }
    
    .main-content { padding: 24px 32px; overflow-y: auto; }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
    }
    .card h2 { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    .card h2 span { color: var(--primary); }
    .card .sub { color: var(--text-muted); font-size: 14px; margin-bottom: 16px; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .stat {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      transition: all 0.3s;
    }
    .stat:hover { border-color: var(--primary); box-shadow: 0 0 30px rgba(212, 175, 55, 0.05); }
    .stat .num { 
      font-size: 28px; 
      font-weight: 900; 
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .stat .label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    
    input, textarea, select {
      width: 100%;
      background: rgba(0,0,0,0.4);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 14px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      transition: all 0.2s;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--glow);
    }
    textarea { min-height: 120px; font-family: monospace; resize: vertical; }
    select { appearance: none; background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23d4af37%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 16px top 50%; background-size: 12px auto; }
    
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }
    .btn-primary { 
      background: var(--primary-gradient); 
      color: #0a0a0a; 
      box-shadow: 0 4px 20px rgba(212, 175, 55, 0.25);
      font-weight: 700;
    }
    .btn-primary:hover { 
      transform: translateY(-2px); 
      box-shadow: 0 8px 30px rgba(212, 175, 55, 0.35);
    }
    .btn-danger { background: rgba(239,68,68,0.12); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }
    .btn-danger:hover { background: rgba(239,68,68,0.2); }
    .btn-success { background: rgba(16,185,129,0.12); color: var(--success); border: 1px solid rgba(16,185,129,0.2); }
    .btn-success:hover { background: rgba(16,185,129,0.2); }
    .btn-outline { 
      background: rgba(0,0,0,0.2); 
      border: 1px solid var(--border); 
      color: var(--text-main); 
    }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); background: rgba(212, 175, 55, 0.05); }
    
    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s;
      width: fit-content;
    }
    .checkbox-container:hover { border-color: var(--primary); color: var(--primary); }
    .checkbox-container input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary); margin: 0; }
    
    .scripts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .script-card {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      transition: all 0.3s;
    }
    .script-card:hover { border-color: var(--primary); transform: translateY(-3px); box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
    .script-card .title { font-weight: 600; font-size: 15px; margin-bottom: 8px; }
    .script-card .meta { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
    .script-card .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .script-card .actions .btn { flex: 1; padding: 8px 12px; font-size: 12px; }
    
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-success { background: rgba(16,185,129,0.15); color: var(--success); border: 1px solid rgba(16,185,129,0.15); }
    .badge-danger { background: rgba(239,68,68,0.15); color: var(--danger); border: 1px solid rgba(239,68,68,0.15); }
    .badge-warning { background: rgba(245,158,11,0.15); color: var(--warning); border: 1px solid rgba(245,158,11,0.15); }
    .badge-primary { background: rgba(212, 175, 55, 0.15); color: var(--primary); border: 1px solid rgba(212, 175, 55, 0.15); }
    
    .view-section { display: none; }
    .view-section.active { display: block; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    
    .actions-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    
    .gold-text { color: var(--primary); }
    
    @media (max-width: 768px) {
      .dashboard { grid-template-columns: 1fr; }
      .sidebar { display: none; position: fixed; top: 0; left: 0; width: 260px; height: 100vh; z-index: 100; }
      .sidebar.open { display: block; }
      .main-content { padding: 16px; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .scripts-grid { grid-template-columns: 1fr; }
      .topbar .brand { font-size: 16px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">⚡ Karma <span>Protection</span></div>
    <div class="user">
      <span class="username">${escapedUsername}</span>
      <img class="avatar" src="${avatarUrl}" alt="Avatar">
      <span class="logout" onclick="window.location.href='/logout'">Logout</span>
    </div>
  </header>
  
  <div class="dashboard">
    <aside class="sidebar" id="sidebar">
      <div class="nav-label">✦ Navigation</div>
      <div class="nav-item active" onclick="switchView('overview', this)">📊 Overview</div>
      <div class="nav-item" onclick="switchView('scripts', this)">📄 Scripts</div>
      <div class="nav-item" onclick="switchView('panels', this)">📋 Panels</div>
      <div class="nav-item" onclick="switchView('keys', this)">🔑 Keys</div>
      <div class="nav-item" onclick="switchView('whitelist', this)">👥 Whitelist</div>
      <div class="nav-item" onclick="switchView('hwids', this)">🚫 HWID Bans</div>
    </aside>
    
    <main class="main-content" id="mainContent">
      <!-- Overview -->
      <div id="view-overview" class="view-section active">
        <div class="card">
          <h2>Welcome, <span>${escapedUsername}</span></h2>
          <p class="sub">Manage your scripts, panels, and keys from one place.</p>
          <div class="stats-grid" id="statsGrid">
            <div class="stat"><div class="num" id="statScripts">0</div><div class="label">Scripts</div></div>
            <div class="stat"><div class="num" id="statPanels">0</div><div class="label">Panels</div></div>
            <div class="stat"><div class="num" id="statKeys">0</div><div class="label">Keys</div></div>
            <div class="stat"><div class="num" id="statWhitelist">0</div><div class="label">Whitelisted</div></div>
            <div class="stat"><div class="num" id="statBanned">0</div><div class="label">Banned HWIDs</div></div>
          </div>
        </div>
      </div>
      
      <!-- Scripts -->
      <div id="view-scripts" class="view-section">
        <div class="card">
          <h2>Your <span>Scripts</span></h2>
          <p class="sub">Create and manage your protected scripts.</p>
          <div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="scriptName" placeholder="Script name" style="flex:1;min-width:200px;margin:0;">
            <label class="checkbox-container">
              <input type="checkbox" id="ffaMode"> FFA Mode
            </label>
            <label class="checkbox-container">
              <input type="checkbox" id="compressMode"> Compress
            </label>
            <button class="btn btn-primary" onclick="createScript()">✦ Create</button>
          </div>
          <textarea id="scriptCode" rows="8" placeholder="-- Paste your Lua code here..."></textarea>
        </div>
        <div id="scriptsList" class="scripts-grid"></div>
      </div>
      
      <!-- Panels -->
      <div id="view-panels" class="view-section">
        <div class="card">
          <h2>Discord <span>Panels</span></h2>
          <p class="sub">Create panels to send to your Discord server.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <input type="text" id="panelName" placeholder="Panel name">
            <input type="text" id="panelChannel" placeholder="Discord Channel ID">
          </div>
          <textarea id="panelDesc" rows="3" placeholder="Panel description..."></textarea>
          <select id="panelScript"><option value="">Select script...</option></select>
          <input type="number" id="panelCooldown" placeholder="HWID cooldown (seconds)" value="180">
          <button class="btn btn-primary" onclick="createPanel()">✦ Create Panel</button>
        </div>
        <div id="panelsList" class="scripts-grid"></div>
      </div>
      
      <!-- Keys -->
      <div id="view-keys" class="view-section">
        <div class="card">
          <h2>Generate <span>Keys</span></h2>
          <p class="sub">Generate license keys for your panels.</p>
          <select id="keyPanel"><option value="">Select panel...</option></select>
          <input type="number" id="keyDuration" placeholder="Duration (hours, 0 = permanent)" value="0">
          <input type="text" id="keyNote" placeholder="Note (optional)">
          <div class="actions-row">
            <button class="btn btn-primary" onclick="generateKey()">✦ Generate Key</button>
            <button class="btn btn-outline" onclick="addTimeAll()">+ Add Time to All</button>
          </div>
        </div>
        <div id="keysList" class="scripts-grid"></div>
      </div>
      
      <!-- Whitelist -->
      <div id="view-whitelist" class="view-section">
        <div class="card">
          <h2>Whitelist <span>Management</span></h2>
          <p class="sub">Users you've whitelisted with auto-generated keys.</p>
        </div>
        <div id="whitelistList" class="scripts-grid"></div>
      </div>
      
      <!-- HWIDs -->
      <div id="view-hwids" class="view-section">
        <div class="card">
          <h2>Ban <span>HWID</span></h2>
          <p class="sub">Ban a hardware ID from accessing your scripts.</p>
          <div style="display:flex;gap:12px;">
            <input type="text" id="banHwidInput" placeholder="Enter HWID to ban" style="flex:1;margin:0;">
            <button class="btn btn-danger" onclick="banHwid()">Ban</button>
          </div>
        </div>
        <div id="hwidsList" class="scripts-grid"></div>
      </div>
    </main>
  </div>
  
  <script>
    var currentData = { scripts: [], panels: [], keys: [], bannedHWIDs: [], whitelist: [] };
    var serverTime = Date.now();
    
    function getHeaders() {
      return { 'Content-Type': 'application/json' };
    }
    
    async function loadData() {
      try {
        var res = await fetch('/api/data');
        var data = await res.json();
        if (data.error) return;
        
        currentData = data;
        serverTime = data.serverTime || Date.now();
        renderAll();
      } catch (e) { console.error(e); }
    }
    
    function renderAll() {
      renderStats();
      renderScripts();
      renderPanels();
      renderKeys();
      renderWhitelist();
      renderHwids();
      updateSelects();
    }
    
    function renderStats() {
      document.getElementById('statScripts').textContent = currentData.scripts.length;
      document.getElementById('statPanels').textContent = currentData.panels.length;
      document.getElementById('statKeys').textContent = currentData.keys.length;
      document.getElementById('statWhitelist').textContent = currentData.whitelist ? currentData.whitelist.length : 0;
      document.getElementById('statBanned').textContent = currentData.bannedHWIDs.length;
    }
    
    function renderScripts() {
      var container = document.getElementById('scriptsList');
      if (currentData.scripts.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No scripts yet. Create one above.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < currentData.scripts.length; i++) {
        var s = currentData.scripts[i];
        var statusBadge = s.status === 'active' ? 'badge-success' : 'badge-danger';
        var statusText = s.status === 'active' ? 'Active' : 'Disabled';
        var ffaBadge = s.ffa_mode ? '<span class="badge badge-warning">FFA</span>' : '';
        var compressBadge = s.compress_mode ? '<span class="badge badge-primary">Compressed</span>' : '';
        var toggleText = s.status === 'active' ? 'Disable' : 'Enable';
        var ffaText = s.ffa_mode ? 'Disable FFA' : 'Enable FFA';
        var date = new Date(s.created_at).toLocaleDateString();
        html += '<div class="script-card">' +
          '  <div class="title">' + escapeHtml(s.name) + '</div>' +
          '  <div class="meta">' +
          '    <span class="badge ' + statusBadge + '">' + statusText + '</span>' +
          '    ' + ffaBadge + ' ' + compressBadge +
          '    <span style="margin-left:8px;">' + date + '</span>' +
          '  </div>' +
          '  <div class="actions">' +
          '    <button class="btn btn-outline" onclick="toggleScript(\'' + s.id + '\')">' + toggleText + '</button>' +
          '    <button class="btn btn-outline" onclick="toggleFfa(\'' + s.id + '\')">' + ffaText + '</button>' +
          '    <button class="btn btn-danger" onclick="deleteScript(\'' + s.id + '\')">Delete</button>' +
          '  </div>' +
          '</div>';
      }
      container.innerHTML = html;
    }
    
    function renderPanels() {
      var container = document.getElementById('panelsList');
      if (currentData.panels.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No panels yet. Create one above.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < currentData.panels.length; i++) {
        var p = currentData.panels[i];
        var desc = p.description || 'No description';
        html += '<div class="script-card">' +
          '  <div class="title">' + escapeHtml(p.name) + '</div>' +
          '  <div class="meta">' + escapeHtml(desc) + '</div>' +
          '  <div class="actions">' +
          '    <button class="btn btn-success" onclick="sendPanel(\'' + p.id + '\')">Send to Discord</button>' +
          '    <button class="btn btn-danger" onclick="deletePanel(\'' + p.id + '\')">Delete</button>' +
          '  </div>' +
          '</div>';
      }
      container.innerHTML = html;
    }
    
    function renderKeys() {
      var container = document.getElementById('keysList');
      if (currentData.keys.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No keys generated yet.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < currentData.keys.length; i++) {
        var k = currentData.keys[i];
        var isExpired = k.expires_at && new Date(k.expires_at).getTime() < serverTime;
        var status = 'Active';
        var badgeClass = 'badge-success';
        if (isExpired) { status = 'Expired'; badgeClass = 'badge-danger'; }
        else if (k.hwid) { status = '🔒 HWID Locked'; badgeClass = 'badge-warning'; }
        var noteHtml = k.note ? '<span style="margin-left:8px;">' + escapeHtml(k.note) + '</span>' : '';
        html += '<div class="script-card">' +
          '  <div class="title" style="font-family:monospace;font-size:13px;color:var(--primary);">' + escapeHtml(k.key) + '</div>' +
          '  <div class="meta">' +
          '    <span class="badge ' + badgeClass + '">' + status + '</span>' +
          '    ' + noteHtml +
          '  </div>' +
          '  <div class="actions">' +
          '    <button class="btn btn-danger" onclick="deleteKey(\'' + k.key + '\')">Delete</button>' +
          '  </div>' +
          '</div>';
      }
      container.innerHTML = html;
    }
    
    function renderWhitelist() {
      var container = document.getElementById('whitelistList');
      var wl = currentData.whitelist || [];
      if (wl.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No users whitelisted yet.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < wl.length; i++) {
        var w = wl[i];
        var isExpired = w.expires_at && new Date(w.expires_at).getTime() < serverTime;
        var status = isExpired ? '⛔ Expired' : '✅ Active';
        var hwidStatus = w.hwid ? '🔒 HWID Set' : '🔓 No HWID';
        html += '<div class="script-card">' +
          '  <div class="title">👤 ' + escapeHtml(w.username || w.discord_id) + '</div>' +
          '  <div class="meta">' +
          '    <span class="badge badge-primary">' + status + '</span>' +
          '    <span class="badge badge-warning">' + hwidStatus + '</span>' +
          '    <span style="margin-left:8px;">Key: ' + escapeHtml(w.key) + '</span>' +
          '  </div>' +
          '  <div class="actions">' +
          '    <button class="btn btn-outline" onclick="removeWhitelist(\'' + w.id + '\')">Remove</button>' +
          '  </div>' +
          '</div>';
      }
      container.innerHTML = html;
    }
    
    function renderHwids() {
      var container = document.getElementById('hwidsList');
      if (currentData.bannedHWIDs.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No banned HWIDs.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < currentData.bannedHWIDs.length; i++) {
        var h = currentData.bannedHWIDs[i];
        var date = new Date(h.created_at).toLocaleDateString();
        html += '<div class="script-card">' +
          '  <div class="title" style="font-family:monospace;font-size:13px;color:var(--danger);">🚫 ' + escapeHtml(h.hwid) + '</div>' +
          '  <div class="meta">Banned ' + date + '</div>' +
          '  <div class="actions">' +
          '    <button class="btn btn-outline" onclick="unbanHwid(\'' + h.hwid + '\')">Unban</button>' +
          '  </div>' +
          '</div>';
      }
      container.innerHTML = html;
    }
    
    function updateSelects() {
      var panelScript = document.getElementById('panelScript');
      panelScript.innerHTML = '<option value="">Select script...</option>';
      for (var i = 0; i < currentData.scripts.length; i++) {
        var s = currentData.scripts[i];
        panelScript.innerHTML += '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
      }
      
      var keyPanel = document.getElementById('keyPanel');
      keyPanel.innerHTML = '<option value="">Select panel...</option>';
      for (var i = 0; i < currentData.panels.length; i++) {
        var p = currentData.panels[i];
        keyPanel.innerHTML += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
      }
    }
    
    function switchView(view, el) {
      var sections = document.querySelectorAll('.view-section');
      for (var i = 0; i < sections.length; i++) {
        sections[i].classList.remove('active');
      }
      var navItems = document.querySelectorAll('.nav-item');
      for (var i = 0; i < navItems.length; i++) {
        navItems[i].classList.remove('active');
      }
      document.getElementById('view-' + view).classList.add('active');
      if (el) el.classList.add('active');
    }
    
    // Script functions
    async function createScript() {
      var name = document.getElementById('scriptName').value.trim();
      var code = document.getElementById('scriptCode').value;
      var compressMode = document.getElementById('compressMode').checked;
      
      if (!name || !code) return alert('Please enter a name and code.');
      
      await fetch('/api/create-script', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: name, code: code, compressMode: compressMode })
      });
      
      document.getElementById('scriptName').value = '';
      document.getElementById('scriptCode').value = '';
      document.getElementById('ffaMode').checked = false;
      document.getElementById('compressMode').checked = false;
      loadData();
    }
    
    async function toggleScript(id) {
      await fetch('/api/scripts/' + id + '/toggle', { method: 'PUT', headers: getHeaders() });
      loadData();
    }
    
    async function toggleFfa(id) {
      await fetch('/api/scripts/' + id + '/ffa', { method: 'PUT', headers: getHeaders() });
      loadData();
    }
    
    async function deleteScript(id) {
      if (!confirm('Delete this script?')) return;
      await fetch('/api/delete-script', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ id: id })
      });
      loadData();
    }
    
    // Panel functions
    async function createPanel() {
      var name = document.getElementById('panelName').value.trim();
      var description = document.getElementById('panelDesc').value;
      var channelId = document.getElementById('panelChannel').value.trim();
      var scriptId = document.getElementById('panelScript').value;
      var hwidCooldown = parseInt(document.getElementById('panelCooldown').value) || 180;
      
      if (!name || !channelId || !scriptId) return alert('Please fill in all required fields.');
      
      await fetch('/api/create-panel', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name: name, description: description, channelId: channelId, scriptId: scriptId, hwidCooldown: hwidCooldown })
      });
      
      document.getElementById('panelName').value = '';
      document.getElementById('panelDesc').value = '';
      document.getElementById('panelChannel').value = '';
      document.getElementById('panelCooldown').value = '180';
      loadData();
    }
    
    async function sendPanel(id) {
      await fetch('/api/send-panel', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ panelId: id })
      });
      alert('Panel sent to Discord!');
    }
    
    async function deletePanel(id) {
      if (!confirm('Delete this panel?')) return;
      await fetch('/api/delete-panel', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ id: id })
      });
      loadData();
    }
    
    // Key functions
    async function generateKey() {
      var panelId = document.getElementById('keyPanel').value;
      var durationHours = parseInt(document.getElementById('keyDuration').value) || 0;
      var note = document.getElementById('keyNote').value.trim();
      
      if (!panelId) return alert('Please select a panel.');
      
      await fetch('/api/generate-key', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ panelId: panelId, durationHours: durationHours, note: note })
      });
      
      document.getElementById('keyNote').value = '';
      loadData();
    }
    
    async function deleteKey(key) {
      if (!confirm('Delete this key?')) return;
      await fetch('/api/delete-key', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ key: key })
      });
      loadData();
    }
    
    async function addTimeAll() {
      var hours = prompt('How many hours to add to all keys?');
      if (!hours || isNaN(hours)) return;
      await fetch('/api/add-time-all', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hours: parseInt(hours) })
      });
      loadData();
    }
    
    // Whitelist functions
    async function removeWhitelist(id) {
      if (!confirm('Remove this user from whitelist?')) return;
      await fetch('/api/delete-whitelist', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ id: id })
      });
      loadData();
    }
    
    // HWID functions
    async function banHwid() {
      var hwid = document.getElementById('banHwidInput').value.trim();
      if (!hwid) return alert('Enter an HWID to ban.');
      await fetch('/api/ban-hwid', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hwid: hwid })
      });
      document.getElementById('banHwidInput').value = '';
      loadData();
    }
    
    async function unbanHwid(hwid) {
      if (!confirm('Unban this HWID?')) return;
      await fetch('/api/unban-hwid', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hwid: hwid })
      });
      loadData();
    }
    
    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Load data on page load
    loadData();
  </script>
</body>
</html>`);
});

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
  presence: {
    status: PresenceUpdateStatus.Online,
    activities: [{ name: '✨ Gold Protection | /help', type: ActivityType.Watching }],
  },
});

client.once('ready', () => {
  console.log(`✨ Karma Gold Bot online as ${client.user.tag}`);
});

// ---------------- Message Commands ----------------
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const args = parts;

  try {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(msg.author.id);
    
    if (cmd === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('✨ Karma Gold - Commands')
        .setDescription([
          '**✦ General Commands**',
          `${PREFIX}setup - Create account or view info`,
          `${PREFIX}scripts - List your scripts`,
          `${PREFIX}keys - List all your keys`,
          '',
          '**✦ Key Management**',
          `${PREFIX}createkey <script> [hours] - Generate a key`,
          `${PREFIX}revoke <key> - Revoke a key`,
          `${PREFIX}reset-hwid <key> - Reset HWID (24h cooldown)`,
          '',
          '**✦ Whitelist**',
          `${PREFIX}whitelist <script> <@user> [hours] - Whitelist with auto-key`,
          `${PREFIX}removewhitelist <@user> - Remove from whitelist`,
          `${PREFIX}whitelistlist - List all whitelisted users`,
          '',
          '**✦ Panels**',
          `${PREFIX}panelsetup <script> - Spawn panel for a script`,
          '',
          '**✦ Owner Only**',
          `${PREFIX}ban <hwid> - Ban a HWID`,
          `${PREFIX}unban <hwid> - Unban a HWID`,
          `${PREFIX}checkhwid <hwid> - Check if HWID is banned`
        ].join('\n'))
        .setFooter({ text: 'Karma Gold v6.5' })
        .setTimestamp();
      
      try {
        await msg.author.send({ embeds: [helpEmbed] });
        await msg.reply({ embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Help Sent').setDescription('Check your DMs. ✨')] });
      } catch {
        await msg.reply({ embeds: [helpEmbed] });
      }
      return;
    }

    // ============ WHITELIST COMMAND ============
    if (cmd === 'whitelist') {
      if (!user) return msg.reply('❌ Use /setup first.');
      
      const scriptName = args[0];
      const mention = args[1];
      const hours = parseInt(args[2]) || 0;
      
      if (!scriptName || !mention) {
        return msg.reply('Usage: /whitelist <script> <@user> [hours]');
      }
      
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`❌ No script found matching "${scriptName}"`);
      
      const targetId = mention.replace(/[<@!>]/g, '');
      if (!targetId) return msg.reply('❌ Invalid user mention.');
      
      let targetUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(targetId);
      if (!targetUser) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        const targetMember = await msg.guild?.members.fetch(targetId).catch(() => null);
        const username = targetMember ? targetMember.user.username : 'Unknown';
        db.prepare(`
          INSERT INTO users (id, discord_id, username, provider)
          VALUES (?, ?, ?, ?)
        `).run(id, targetId, username, 'discord');
        targetUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(targetId);
      }
      
      const key = generateKey();
      const expiresAt = hours > 0 ? addHours(hours) : null;
      const id = makeId('wl');
      
      const existing = db.prepare('SELECT * FROM whitelist WHERE script_id = ? AND discord_id = ?').get(script.id, targetId);
      if (existing) {
        return msg.reply(`❌ <@${targetId}> is already whitelisted for this script.`);
      }
      
      db.prepare(`
        INSERT INTO whitelist (id, script_id, user_id, key, discord_id, username, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, script.id, user.id, key, targetId, targetUser.username, expiresAt);
      
      const keyId = makeId('key');
      db.prepare(`
        INSERT INTO keys (id, script_id, user_id, key, note, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(keyId, script.id, user.id, key, `Whitelisted for ${targetUser.username}`, expiresAt);
      
      const expiryText = hours > 0 ? `Expires in ${hours} hours` : 'Permanent';
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('✨ User Whitelisted')
        .setDescription([
          `**Script:** ${script.name}`,
          `**User:** <@${targetId}> (${targetUser.username})`,
          `**Key:** \`${key}\``,
          `**Status:** ${expiryText}`,
          `**HWID Lock:** Required on first use`
        ].join('\n'))
        .setFooter({ text: 'Karma Gold v6.5' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      
      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('🔑 You\'ve Been Whitelisted! ✨')
          .setDescription([
            `**Script:** ${script.name}`,
            `**Your Key:** \`${key}\``,
            `**Expires:** ${hours > 0 ? formatExpiry(expiresAt) : 'Permanent'}`,
            '',
            '⚠️ **Important:** This key is tied to your HWID.',
            'If you try to use it on another device, you will be kicked.',
            'To reset HWID, use `/reset-hwid <key>` (24h cooldown)'
          ].join('\n'))
          .setColor(BRAND_COLOR)
          .setFooter({ text: 'Karma Gold' })
          .setTimestamp();
        
        const targetUserDM = await client.users.fetch(targetId);
        await targetUserDM.send({ embeds: [dmEmbed] });
      } catch (e) {
        console.log('Could not DM user:', e);
      }
      return;
    }

    // ============ REMOVE WHITELIST ============
    if (cmd === 'removewhitelist' || cmd === 'unwhitelist') {
      if (!user) return msg.reply('❌ Use /setup first.');
      
      const mention = args[0];
      if (!mention) return msg.reply('Usage: /removewhitelist <@user>');
      
      const targetId = mention.replace(/[<@!>]/g, '');
      if (!targetId) return msg.reply('❌ Invalid user mention.');
      
      const entries = db.prepare('SELECT * FROM whitelist WHERE discord_id = ? AND user_id = ?').all(targetId, user.id);
      if (entries.length === 0) {
        return msg.reply(`❌ <@${targetId}> is not whitelisted on any of your scripts.`);
      }
      
      for (const entry of entries) {
        db.prepare('DELETE FROM whitelist WHERE id = ?').run(entry.id);
        db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(entry.key, user.id);
      }
      
      await msg.reply(`✅ Removed <@${targetId}> from all whitelists.`);
      return;
    }

    // ============ LIST WHITELIST ============
    if (cmd === 'whitelistlist' || cmd === 'wllist') {
      if (!user) return msg.reply('❌ Use /setup first.');
      
      const entries = db.prepare('SELECT * FROM whitelist WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (entries.length === 0) {
        return msg.reply('📋 No users whitelisted.');
      }
      
      const lines = entries.map(e => {
        const expiry = e.expires_at ? formatExpiry(e.expires_at) : 'Permanent';
        const status = e.expires_at && new Date(e.expires_at).getTime() < Date.now() ? '⛔ Expired' : '✅ Active';
        const hwid = e.hwid ? '🔒' : '🔓';
        return `${status} ${hwid} <@${e.discord_id}> - ${e.username} - Expires: ${expiry}`;
      });
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`📋 Whitelist (${entries.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Karma Gold' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      return;
    }

    if (cmd === 'setup') {
      let dbUser = user;
      if (!dbUser) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        db.prepare(`
          INSERT INTO users (id, discord_id, username, avatar, provider)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, msg.author.id, msg.author.username, msg.author.displayAvatarURL() || '', 'discord');
        dbUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(msg.author.id);
      }
      
      const scriptCount = db.prepare('SELECT COUNT(*) as count FROM scripts WHERE user_id = ?').get(dbUser.id).count;
      const keyCount = db.prepare('SELECT COUNT(*) as count FROM keys WHERE user_id = ?').get(dbUser.id).count;
      const wlCount = db.prepare('SELECT COUNT(*) as count FROM whitelist WHERE user_id = ?').get(dbUser.id).count;
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('✨ Karma Gold - Setup Complete')
        .setDescription(`Account ${dbUser ? 'loaded' : 'created'}!`)
        .addFields(
          { name: 'Scripts', value: String(scriptCount), inline: true },
          { name: 'Keys', value: String(keyCount), inline: true },
          { name: 'Whitelisted', value: String(wlCount), inline: true }
        )
        .setFooter({ text: 'Karma Gold v6.5' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      return;
    }

    if (cmd === 'scripts') {
      if (!user) return msg.reply('Use /setup first.');
      
      const scripts = db.prepare('SELECT * FROM scripts WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (!scripts.length) {
        return msg.reply('No scripts found.');
      }
      
      const lines = scripts.map((s, i) => 
        `${i+1}. ${s.name} - v${s.version || '1.0.0'} - ${s.status === 'active' ? '✅ Active' : '⛔ Disabled'} - ID: ${s.id}`
      );
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`Your Scripts (${scripts.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Karma Gold' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      return;
    }

    if (cmd === 'createkey') {
      if (!user) return msg.reply('Use /setup first.');
      
      const scriptName = args[0];
      if (!scriptName) return msg.reply('Usage: /createkey <script> [hours]');
      
      let hours = null;
      if (args.length >= 2) {
        const parsed = parseInt(args[1]);
        if (!isNaN(parsed)) hours = parsed;
      }
      
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`No script found matching "${scriptName}"`);
      
      const key = generateKey();
      const expiresAt = hours > 0 ? addHours(hours) : null;
      const id = makeId('key');
      
      db.prepare(`
        INSERT INTO keys (id, script_id, user_id, key, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, script.id, user.id, key, expiresAt);
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle('✨ Key Generated')
        .setDescription([
          `**Script:** ${script.name}`,
          `**Key:** \`${key}\``,
          hours > 0 ? `**Expires:** ${formatExpiry(expiresAt)}` : '**Duration:** Permanent'
        ].join('\n'))
        .setFooter({ text: 'Karma Gold' })
        .setTimestamp();
      
      try {
        await msg.author.send({ embeds: [embed] });
        await msg.reply(`Key for ${script.name} sent to your DMs. ✨`);
      } catch {
        await msg.reply({ embeds: [embed] });
      }
      return;
    }

    if (cmd === 'keys') {
      if (!user) return msg.reply('Use /setup first.');
      
      const keys = db.prepare('SELECT * FROM keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (!keys.length) {
        return msg.reply('No keys found.');
      }
      
      const lines = keys.map(k => {
        const isExpired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
        const status = isExpired ? '⛔' : '✅';
        const hwid = k.hwid ? '🔒' : '🔓';
        const expiry = k.expires_at ? formatExpiry(k.expires_at) : 'Permanent';
        return `${status} ${hwid} ${maskKey(k.key)} - ${expiry}`;
      });
      
      const embed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`Your Keys (${keys.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Karma Gold' })
        .setTimestamp();
      
      await msg.reply({ embeds: [embed] });
      return;
    }

    if (cmd === 'revoke') {
      if (!user) return msg.reply('Use /setup first.');
      
      const rawKey = args[0];
      if (!rawKey) return msg.reply('Usage: /revoke <key>');
      
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (!keyRecord) return msg.reply('Key not found.');
      
      db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(rawKey, user.id);
      db.prepare('DELETE FROM whitelist WHERE key = ? AND user_id = ?').run(rawKey, user.id);
      
      await msg.reply(`✅ Key ${maskKey(rawKey)} revoked.`);
      return;
    }

    if (cmd === 'reset-hwid') {
      if (!user) return msg.reply('Use /setup first.');
      
      const rawKey = args[0];
      if (!rawKey) return msg.reply('Usage: /reset-hwid <key>');
      
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (!keyRecord) return msg.reply('Key not found.');
      
      if (keyRecord.resettable) {
        const elapsed = Date.now() - new Date(keyRecord.resettable).getTime();
        if (elapsed < COOLDOWN_MS) {
          return msg.reply(`⏳ Cooldown active. Try again in ${timeRemaining(COOLDOWN_MS - elapsed)}.`);
        }
      }
      
      db.prepare('UPDATE keys SET hwid = NULL, resettable = CURRENT_TIMESTAMP WHERE key = ?').run(rawKey);
      
      const wlEntry = db.prepare('SELECT * FROM whitelist WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (wlEntry) {
        db.prepare('UPDATE whitelist SET hwid = NULL WHERE id = ?').run(wlEntry.id);
      }
      
      await msg.reply(`✅ HWID reset for ${maskKey(rawKey)}. You can now use it on a new device.`);
      return;
    }

    if (cmd === 'panelsetup') {
      if (!user) return msg.reply('Use /setup first.');
      
      const scriptName = args.join(' ');
      if (!scriptName) return msg.reply('Usage: /panelsetup <script name>');
      
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`No script found matching "${scriptName}"`);
      
      const panelEmbed = new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(`✨ ${script.name}`)
        .setDescription('Use the buttons below to manage your key.')
        .setFooter({ text: 'Karma Gold' })
        .setTimestamp();
      
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pv_${script.id}`).setLabel('View Script').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pr_${script.id}`).setLabel('Redeem Key').setStyle(ButtonStyle.Success)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pi_${script.id}`).setLabel('Key Info').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`pl_${script.id}`).setLabel('Get Loader').setStyle(ButtonStyle.Secondary)
      );
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ph_${script.id}`).setLabel('Reset HWID').setStyle(ButtonStyle.Danger)
      );
      
      await msg.reply({ embeds: [panelEmbed], components: [row1, row2, row3] });
      return;
    }

    // Owner only commands
    if (cmd === 'ban' && msg.author.id === OWNER_ID) {
      const hwid = args[0];
      if (!hwid) return msg.reply('Usage: /ban <hwid>');
      db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, banned_by) VALUES (?, ?)').run(hwid, msg.author.id);
      await msg.reply(`✅ HWID ${hwid} banned.`);
      return;
    }

    if (cmd === 'unban' && msg.author.id === OWNER_ID) {
      const hwid = args[0];
      if (!hwid) return msg.reply('Usage: /unban <hwid>');
      db.prepare('DELETE FROM banned_hwids WHERE hwid = ?').run(hwid);
      await msg.reply(`✅ HWID ${hwid} unbanned.`);
      return;
    }

    if (cmd === 'checkhwid' && msg.author.id === OWNER_ID) {
      const hwid = args[0];
      if (!hwid) return msg.reply('Usage: /checkhwid <hwid>');
      const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid);
      if (banned) {
        await msg.reply(`🚫 HWID ${hwid} is BANNED.`);
      } else {
        await msg.reply(`✅ HWID ${hwid} is NOT banned.`);
      }
      return;
    }

  } catch (e) {
    console.error('Command error:', e);
    await msg.reply('❌ Something went wrong.');
  }
});

// ---------------- Button Handler ----------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  const customId = interaction.customId;
  const action = customId[1];
  const scriptId = customId.substring(3);
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
    if (!user) {
      return interaction.reply({ content: 'Use /setup first.', ephemeral: true });
    }
    
    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(scriptId, user.id);
    if (!script) {
      return interaction.reply({ content: 'Script not found.', ephemeral: true });
    }
    
    switch (action) {
      case 'v': {
        const keyCount = db.prepare('SELECT COUNT(*) as count FROM keys WHERE script_id = ? AND user_id = ?').get(scriptId, user.id).count;
        const wlCount = db.prepare('SELECT COUNT(*) as count FROM whitelist WHERE script_id = ? AND user_id = ?').get(scriptId, user.id).count;
        const embed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle(script.name)
          .addFields(
            { name: 'Version', value: script.version || '1.0.0', inline: true },
            { name: 'Status', value: script.status === 'active' ? '✅ Active' : '⛔ Disabled', inline: true },
            { name: 'Keys', value: String(keyCount), inline: true },
            { name: 'Whitelisted', value: String(wlCount), inline: true },
            { name: 'ID', value: script.id, inline: true }
          )
          .setFooter({ text: 'Karma Gold' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
      
      case 'r': {
        const modal = new ModalBuilder()
          .setCustomId(`rm_${scriptId}`)
          .setTitle('Redeem Key');
        const input = new TextInputBuilder()
          .setCustomId('key_input')
          .setLabel('Enter your license key')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        break;
      }
      
      case 'i': {
        const keys = db.prepare('SELECT * FROM keys WHERE script_id = ? AND user_id = ? ORDER BY created_at DESC').all(scriptId, user.id);
        if (!keys.length) {
          return interaction.reply({ content: 'No keys found.', ephemeral: true });
        }
        const lines = keys.map(k => {
          const isExpired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
          const status = isExpired ? '⛔ Expired' : '✅ Active';
          const expiry = k.expires_at ? formatExpiry(k.expires_at) : 'Permanent';
          const hwid = k.hwid ? '🔒 HWID Locked' : '🔓 No HWID';
          return `${status} | ${maskKey(k.key)} | ${hwid} | ${expiry}`;
        });
        const embed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle('Key Info')
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Karma Gold' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
      
      case 'l': {
        const key = db.prepare('SELECT * FROM keys WHERE script_id = ? AND user_id = ? ORDER BY created_at DESC').get(scriptId, user.id);
        if (!key) {
          return interaction.reply({ content: 'No active key found.', ephemeral: true });
        }
        const loadstring = `loadstring(game:HttpGet("${publicBaseUrl()}/loader/${scriptId}?key=${key.key}"))()`;
        await interaction.reply({ content: `\`\`\`lua\n${loadstring}\n\`\`\``, ephemeral: true });
        break;
      }
      
      case 'h': {
        const modal = new ModalBuilder()
          .setCustomId(`hm_${scriptId}`)
          .setTitle('Reset HWID');
        const input = new TextInputBuilder()
          .setCustomId('key_input')
          .setLabel('Enter your license key')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        break;
      }
    }
  } catch (e) {
    console.error('Button error:', e);
    await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
  }
});

// ---------------- Modal Handler ----------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  
  const customId = interaction.customId;
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
    if (!user) {
      return interaction.reply({ content: 'Use /setup first.', ephemeral: true });
    }
    
    if (customId.startsWith('rm_')) {
      const scriptId = customId.substring(3);
      const keyVal = interaction.fields.getTextInputValue('key_input').toUpperCase();
      
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ? AND user_id = ?').get(keyVal, scriptId, user.id);
      if (!keyRecord) {
        return interaction.reply({ content: 'Invalid key.', ephemeral: true });
      }
      if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) {
        return interaction.reply({ content: 'This key has expired.', ephemeral: true });
      }
      
      db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(keyVal);
      await interaction.reply({ content: '✅ Key redeemed successfully! ✨', ephemeral: true });
    }
    
    if (customId.startsWith('hm_')) {
      const scriptId = customId.substring(3);
      const keyVal = interaction.fields.getTextInputValue('key_input').toUpperCase();
      
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ? AND user_id = ?').get(keyVal, scriptId, user.id);
      if (!keyRecord) {
        return interaction.reply({ content: 'Invalid key.', ephemeral: true });
      }
      
      if (keyRecord.resettable) {
        const elapsed = Date.now() - new Date(keyRecord.resettable).getTime();
        if (elapsed < COOLDOWN_MS) {
          return interaction.reply({ content: `⏳ Cooldown active. Try again in ${timeRemaining(COOLDOWN_MS - elapsed)}.`, ephemeral: true });
        }
      }
      
      db.prepare('UPDATE keys SET hwid = NULL, resettable = CURRENT_TIMESTAMP WHERE key = ?').run(keyVal);
      
      const wlEntry = db.prepare('SELECT * FROM whitelist WHERE key = ? AND user_id = ?').get(keyVal, user.id);
      if (wlEntry) {
        db.prepare('UPDATE whitelist SET hwid = NULL WHERE id = ?').run(wlEntry.id);
      }
      
      await interaction.reply({ content: '🔄 HWID reset successfully! You can now use the key on a new device. ✨', ephemeral: true });
    }
  } catch (e) {
    console.error('Modal error:', e);
    await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
  }
});

// ---------------- Loader Routes - HWID Protected ----------------
app.get('/loader/:scriptId', (req, res) => {
  const { scriptId, key, hwid } = req.query;
  if (!scriptId) return res.status(400).type('text/plain').send('-- Missing script ID');
  
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  
  if (script.status === 'disabled') {
    return res.status(403).type('text/plain').send('-- Script is disabled');
  }
  
  if (!key) {
    return res.status(403).type('text/plain').send('-- Missing key parameter');
  }
  
  const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ?').get(key, scriptId);
  if (!keyRecord) {
    return res.status(403).type('text/plain').send('-- Invalid key');
  }
  
  if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) {
    return res.status(403).type('text/plain').send('-- Key expired');
  }
  
  if (hwid) {
    const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid);
    if (banned) {
      return res.status(403).type('text/plain').send('-- HWID is banned');
    }
  }
  
  if (hwid && !keyRecord.hwid) {
    db.prepare('UPDATE keys SET hwid = ?, last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(hwid, key);
    const wlEntry = db.prepare('SELECT * FROM whitelist WHERE key = ?').get(key);
    if (wlEntry) {
      db.prepare('UPDATE whitelist SET hwid = ? WHERE id = ?').run(hwid, wlEntry.id);
    }
  }
  
  if (hwid && keyRecord.hwid && keyRecord.hwid !== hwid) {
    return res.status(403).type('text/plain').send('-- HWID mismatch. Use /reset-hwid <key> to reset (24h cooldown)');
  }
  
  db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  
  const baseUrl = publicBaseUrl();
  const loadstring = `loadstring(game:HttpGet("${baseUrl}/script/${scriptId}?hwid=${hwid || ''}&key=${key}"))()`;
  
  res.type('text/plain').send(`--[[ ✨ Karma Gold Loader v6.5 ✨ ]]\n-- HWID Protected\nreturn (function()\n  local url = "${baseUrl}/script/${scriptId}?hwid=${hwid || ''}&key=${key}"\n  local src = game:HttpGet(url)\n  if not src or #src < 10 then error("Invalid script payload") end\n  local func, err = loadstring(src, "@KarmaGold")\n  if not func then error(err) end\n  return func()\nend)()`);
});

app.get('/script/:scriptId', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.scriptId);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  
  if (script.status === 'disabled') {
    return res.status(403).type('text/plain').send('-- Script is disabled');
  }
  
  if (script.ffa_mode) {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code || '-- Empty script');
  }
  
  const { key, hwid } = req.query;
  if (!key) {
    return res.status(403).type('text/plain').send('-- Missing key');
  }
  
  const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ?').get(key, req.params.scriptId);
  if (!keyRecord) {
    return res.status(403).type('text/plain').send('-- Invalid key');
  }
  
  if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) {
    return res.status(403).type('text/plain').send('-- Key expired');
  }
  
  if (hwid) {
    const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid);
    if (banned) {
      return res.status(403).type('text/plain').send('-- HWID is banned');
    }
  }
  
  if (hwid && keyRecord.hwid && keyRecord.hwid !== hwid) {
    return res.status(403).type('text/plain').send('-- HWID mismatch. Use /reset-hwid <key> to reset');
  }
  
  if (hwid && !keyRecord.hwid) {
    db.prepare('UPDATE keys SET hwid = ?, last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(hwid, key);
    const wlEntry = db.prepare('SELECT * FROM whitelist WHERE key = ?').get(key);
    if (wlEntry) {
      db.prepare('UPDATE whitelist SET hwid = ? WHERE id = ?').run(hwid, wlEntry.id);
    }
  }
  
  db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain').send(script.code || '-- Empty script');
});

// ---------------- Start Server ----------------
const port = Number(process.env.PORT || 3000);

async function deployCommands() {
  if (!CLIENT_ID) {
    console.log('CLIENT_ID missing, skipping slash command deploy.');
    return;
  }

  const rest = new (require('@discordjs/rest')).REST({ version: '10' }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(
      require('discord-api-types/v10').Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: [] }
    );
    console.log('Cleared guild commands.');
  }
}

(async () => {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Command deploy failed:', error);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`✨ Karma Gold v6.5 running on port ${port}`);
    console.log(`🌐 Website: ${publicBaseUrl()}`);
    console.log(`📱 Bot: ${client.user ? client.user.tag : 'starting...'}`);
  });
  
  await client.login(DISCORD_TOKEN);
})();
