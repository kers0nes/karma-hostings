// server.js
// Karma Protection v6.3 - LuauProtect Style UI
// Full Website with Bot Integration

require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  DATABASE_PATH = './data.sqlite',
  PUBLIC_BASE_URL = 'https://your-app-name.up.railway.app',
  OBFUSCATOR_API_URL = 'https://luarmor-bot-1-0yt4.onrender.com',
  SESSION_SECRET,
  DISCORD_INVITE_URL = 'https://discord.gg/your-invite',
  OWNER_ID = '1207803375807373415',
  RESET_COOLDOWN_HOURS = '24',
  MAX_SCRIPTS_PER_USER = '5'
} = process.env;

const SESSION_SIGNING_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = parseInt(MAX_SCRIPTS_PER_USER, 10) || 5;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// ---------------- Database ----------------
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT,
  name TEXT NOT NULL,
  code TEXT,
  api_secret_hash TEXT,
  api_secret_preview TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  ffa_mode INTEGER DEFAULT 0,
  compress_mode INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  guild_id TEXT,
  panel_id TEXT,
  discord_user_id TEXT,
  user_id TEXT,
  hwid TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  last_reset_at TEXT,
  reset_count INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS hosted_scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  source_code TEXT,
  linked_script_id TEXT,
  obfuscated INTEGER NOT NULL DEFAULT 0,
  obfuscation_level TEXT DEFAULT 'standard',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,
  guild_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  channel_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  hwid_cooldown INTEGER DEFAULT 180,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banned_hwids (
  hwid TEXT PRIMARY KEY,
  reason TEXT,
  banned_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);
`);

// ---------------- Express App ----------------
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: SESSION_SIGNING_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: PUBLIC_BASE_URL && PUBLIC_BASE_URL.startsWith('https'), maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ---------------- Helpers ----------------
function makeId(prefix = 'script') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function makeKey(prefix = 'PS') {
  const raw = crypto.randomBytes(18).toString('base64url').toUpperCase();
  return `${prefix}-${raw.match(/.{1,6}/g).join('-')}`;
}

function addDays(days) {
  if (!days || days <= 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function isExpired(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
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

// ---------------- Helper Functions for API ----------------
function getAllScripts(userId) {
  return db.prepare('SELECT * FROM scripts WHERE created_by = ? ORDER BY created_at DESC').all(userId);
}

function getAllPanels(userId) {
  return db.prepare('SELECT * FROM panels WHERE created_by = ? ORDER BY created_at DESC').all(userId);
}

function getAllKeys(userId) {
  return db.prepare('SELECT * FROM licenses WHERE created_by = ? ORDER BY created_at DESC').all(userId);
}

function getBannedHwids() {
  return db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC').all();
}

function getScriptById(id, userId) {
  return db.prepare('SELECT * FROM scripts WHERE id = ? AND created_by = ?').get(id, userId);
}

function getPanelById(id, userId) {
  return db.prepare('SELECT * FROM panels WHERE id = ? AND created_by = ?').get(id, userId);
}

// ---------------- API Routes ----------------
app.get('/api/data', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json({ error: 'Not authenticated' });
  
  const scripts = getAllScripts(user.id);
  const panels = getAllPanels(user.id);
  const keys = getAllKeys(user.id);
  const bannedHWIDs = getBannedHwids();
  
  res.json({
    scripts,
    panels,
    keys,
    bannedHWIDs,
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
    INSERT INTO scripts (id, name, code, compress_mode, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, code, compressMode ? 1 : 0, user.id);
  
  res.json({ success: true, id });
});

app.post('/api/update-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id, name, code, compressMode } = req.body;
  if (!id || !name || !code) return res.status(400).json({ error: 'Missing fields' });
  
  const existing = getScriptById(id, user.id);
  if (!existing) return res.status(404).json({ error: 'Script not found' });
  
  db.prepare(`
    UPDATE scripts SET name = ?, code = ?, compress_mode = ? WHERE id = ? AND created_by = ?
  `).run(name, code, compressMode ? 1 : 0, id, user.id);
  
  res.json({ success: true });
});

app.put('/api/scripts/:id/toggle', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.params;
  const script = getScriptById(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  const newStatus = script.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE scripts SET status = ? WHERE id = ? AND created_by = ?')
    .run(newStatus, id, user.id);
  
  res.json({ success: true, status: newStatus });
});

app.put('/api/scripts/:id/ffa', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.params;
  const script = getScriptById(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  const newFfa = script.ffa_mode ? 0 : 1;
  db.prepare('UPDATE scripts SET ffa_mode = ? WHERE id = ? AND created_by = ?')
    .run(newFfa, id, user.id);
  
  res.json({ success: true, ffa_mode: newFfa });
});

app.post('/api/delete-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.body;
  const script = getScriptById(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  db.prepare('DELETE FROM scripts WHERE id = ? AND created_by = ?').run(id, user.id);
  res.json({ success: true });
});

app.post('/api/create-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { name, description, channelId, scriptId, hwidCooldown } = req.body;
  if (!name || !channelId || !scriptId) return res.status(400).json({ error: 'Missing fields' });
  
  const id = makeId('panel');
  db.prepare(`
    INSERT INTO panels (id, name, description, channel_id, script_id, hwid_cooldown, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description || '', channelId, scriptId, hwidCooldown || 180, user.id);
  
  res.json({ success: true, id });
});

app.post('/api/update-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id, name, description, channelId, scriptId, hwidCooldown } = req.body;
  if (!id || !name || !channelId || !scriptId) return res.status(400).json({ error: 'Missing fields' });
  
  const existing = getPanelById(id, user.id);
  if (!existing) return res.status(404).json({ error: 'Panel not found' });
  
  db.prepare(`
    UPDATE panels SET name = ?, description = ?, channel_id = ?, script_id = ?, hwid_cooldown = ?
    WHERE id = ? AND created_by = ?
  `).run(name, description || '', channelId, scriptId, hwidCooldown || 180, id, user.id);
  
  res.json({ success: true });
});

app.post('/api/delete-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { id } = req.body;
  const panel = getPanelById(id, user.id);
  if (!panel) return res.status(404).json({ error: 'Panel not found' });
  
  db.prepare('DELETE FROM panels WHERE id = ? AND created_by = ?').run(id, user.id);
  res.json({ success: true });
});

app.post('/api/send-panel', async (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { panelId } = req.body;
  const panel = getPanelById(panelId, user.id);
  if (!panel) return res.status(404).json({ error: 'Panel not found' });
  
  const script = getScriptById(panel.script_id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  
  try {
    const channel = await client.channels.fetch(panel.channel_id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    
    const embed = new EmbedBuilder()
      .setTitle(panel.name)
      .setDescription(panel.description || 'Use the buttons below to manage your key')
      .setColor(0x6366f1)
      .setFooter({ text: 'Karma Protection • Powered by LuauProtect' });
    
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`panel_redeem_${panelId}`).setLabel('Redeem Key').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`panel_reset_${panelId}`).setLabel('Reset HWID').setStyle(ButtonStyle.Danger)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`panel_loader_${panelId}`).setLabel('Get Loader').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`panel_info_${panelId}`).setLabel('Key Info').setStyle(ButtonStyle.Secondary)
    );
    
    await channel.send({ embeds: [embed], components: [row1, row2] });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { durationHours, panelId, note } = req.body;
  if (!panelId) return res.status(400).json({ error: 'Panel ID required' });
  
  const panel = getPanelById(panelId, user.id);
  if (!panel) return res.status(404).json({ error: 'Panel not found' });
  
  const key = makeKey('KS');
  const expiresAt = durationHours > 0 ? addDays(durationHours / 24) : null;
  
  db.prepare(`
    INSERT INTO licenses (license_key, script_id, panel_id, expires_at, created_by, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, panel.script_id, panelId, expiresAt, user.id, note || '');
  
  res.json({ success: true, key });
});

app.post('/api/delete-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { key } = req.body;
  db.prepare('DELETE FROM licenses WHERE license_key = ? AND created_by = ?').run(key, user.id);
  res.json({ success: true });
});

app.post('/api/add-time-all', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  
  const { hours } = req.body;
  if (!hours || isNaN(hours)) return res.status(400).json({ error: 'Invalid hours' });
  
  const keys = db.prepare('SELECT * FROM licenses WHERE created_by = ? AND expires_at IS NOT NULL').all(user.id);
  for (const key of keys) {
    const currentExpiry = new Date(key.expires_at);
    currentExpiry.setHours(currentExpiry.getHours() + parseInt(hours));
    db.prepare('UPDATE licenses SET expires_at = ? WHERE license_key = ?').run(currentExpiry.toISOString(), key.license_key);
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
    
    req.session.user = {
      id: user.id,
      username: user.username,
      global_name: user.global_name,
      avatar: user.avatar
    };
    
    res.redirect('/dashboard');
  } catch (error) {
    res.status(500).send('Authentication failed');
  }
});

// ---------------- Main Website Routes ----------------
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Protection | Secure Dashboard</title>
  <style>
    :root {
      --bg-color: #09090b;
      --card-bg: rgba(18, 18, 20, 0.65);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --discord: #5865F2;
      --discord-hover: #4752C4;
      --text-main: #f8fafc;
      --text-muted: #9ca3af;
      --border: rgba(255, 255, 255, 0.08);
      --glow: rgba(99, 102, 241, 0.15);
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
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; width: 100%; }
    
    .glass-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      margin: 0 auto;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
      text-align: center;
    }
    .logo { margin-bottom: 20px; }
    .logo svg { width: 48px; height: 48px; color: var(--primary); }
    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    h1 span { color: var(--primary); }
    p { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
    
    .btn-discord {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 20px;
      background: var(--discord);
      color: white;
      border: none;
      border-radius: 12px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      transition: all 0.3s ease;
      text-decoration: none;
    }
    .btn-discord:hover {
      background: var(--discord-hover);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(88, 101, 242, 0.4);
    }
    .btn-discord svg { width: 20px; height: 20px; fill: currentColor; }
    
    .footer-links {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .footer-links button {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 13px;
      cursor: pointer;
      transition: color 0.2s;
    }
    .footer-links button:hover { color: white; }
    
    .hidden { display: none !important; }
    .fade-in { animation: fadeIn 0.4s ease-out forwards; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    
    .feature-list { text-align: left; }
    .feature-list .item {
      display: flex;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .feature-list .item:last-child { border-bottom: none; }
    .feature-list .icon { color: var(--primary); flex-shrink: 0; margin-top: 2px; }
    .feature-list .title { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
    .feature-list .desc { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 10px 20px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-main);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
      justify-content: center;
    }
    .back-btn:hover { border-color: var(--primary); color: var(--primary); }
    
    .terms-content {
      max-height: 300px;
      overflow-y: auto;
      text-align: left;
      padding-right: 10px;
    }
    .terms-content::-webkit-scrollbar { width: 4px; }
    .terms-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .terms-content h4 { color: var(--text-main); margin: 16px 0 6px; font-size: 14px; }
    .terms-content p { color: var(--text-muted); font-size: 13px; line-height: 1.6; margin-bottom: 12px; }
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
      <h1>Karma <span>Protection</span></h1>
      <p>Authenticates your hardware and scripts.</p>
      <a href="/api/auth/discord" class="btn-discord">
        <svg viewBox="0 0 127.14 96.36">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91.08,65.69,84.69,65.69Z"/>
        </svg>
        Login with Discord
      </a>
      <div class="footer-links">
        <button onclick="showView('features')">Features</button>
        <button onclick="showView('terms')">Terms</button>
      </div>
    </div>

    <div id="features-view" class="glass-card hidden">
      <h2 style="text-align:left;font-size:18px;margin-bottom:16px;">Protection Systems</h2>
      <div class="feature-list">
        <div class="item">
          <div class="icon">🔐</div>
          <div><div class="title">Self-Decrypting Architecture</div><div class="desc">Your script dynamically self-decrypts at runtime using proprietary instructions, making reverse engineering nearly impossible.</div></div>
        </div>
        <div class="item">
          <div class="icon">🔑</div>
          <div><div class="title">Key & License Manager</div><div class="desc">Generate keys tied to HWID, manage authorized users, and enforce bans from the panel.</div></div>
        </div>
        <div class="item">
          <div class="icon">🛡️</div>
          <div><div class="title">Anti-Dump Hardening</div><div class="desc">Detects dumping tools mid-run and refuses to reveal your code.</div></div>
        </div>
      </div>
      <button class="back-btn" onclick="showView('login')">← Return to Login</button>
    </div>

    <div id="terms-view" class="glass-card hidden">
      <h2 style="text-align:left;font-size:18px;margin-bottom:16px;">Legal Terms</h2>
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
      const views = ['login', 'features', 'terms'];
      views.forEach(id => {
        const el = document.getElementById(id + '-view');
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
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Protection | Dashboard</title>
  <style>
    :root {
      --bg-color: #09090b;
      --card-bg: rgba(18, 18, 20, 0.65);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --discord: #5865F2;
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
      --text-main: #f8fafc;
      --text-muted: #9ca3af;
      --border: rgba(255, 255, 255, 0.08);
      --glow: rgba(99, 102, 241, 0.15);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
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
    .topbar .brand span { color: var(--primary); }
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
      border: 2px solid var(--border);
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
    .sidebar .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
    .sidebar .nav-item.active {
      background: var(--glow);
      color: var(--primary);
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
    }
    .card h2 { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    .card .sub { color: var(--text-muted); font-size: 14px; margin-bottom: 16px; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .stat {
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .stat .num { font-size: 28px; font-weight: 900; color: var(--primary); }
    .stat .label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    
    input, textarea, select {
      width: 100%;
      background: rgba(0,0,0,0.3);
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
    select { appearance: none; background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22/%3E%3C/svg%3E");
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
    .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
    .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-danger { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }
    .btn-danger:hover { background: rgba(239,68,68,0.2); }
    .btn-success { background: rgba(16,185,129,0.1); color: var(--success); border: 1px solid rgba(16,185,129,0.2); }
    .btn-success:hover { background: rgba(16,185,129,0.2); }
    .btn-outline { background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text-main); }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); }
    
    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s;
      width: fit-content;
    }
    .checkbox-container:hover { border-color: var(--warning); color: var(--warning); }
    .checkbox-container input { width: 16px; height: 16px; cursor: pointer; accent-color: var(--warning); margin: 0; }
    
    .scripts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .script-card {
      background: rgba(0,0,0,0.2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      transition: all 0.3s;
    }
    .script-card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-2px); }
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
    .badge-success { background: rgba(16,185,129,0.2); color: var(--success); }
    .badge-danger { background: rgba(239,68,68,0.2); color: var(--danger); }
    .badge-warning { background: rgba(245,158,11,0.2); color: var(--warning); }
    .badge-primary { background: rgba(99,102,241,0.2); color: var(--primary); }
    
    .view-section { display: none; }
    .view-section.active { display: block; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    
    .actions-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    
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
      <span class="username">${escapeHtml(user.global_name || user.username)}</span>
      <img class="avatar" src="${user.avatar ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128' : 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar">
      <span class="logout" onclick="logout()">Logout</span>
    </div>
  </header>
  
  <div class="dashboard">
    <aside class="sidebar" id="sidebar">
      <div class="nav-label">Navigation</div>
      <div class="nav-item active" onclick="switchView('overview', this)">📊 Overview</div>
      <div class="nav-item" onclick="switchView('scripts', this)">📄 Scripts</div>
      <div class="nav-item" onclick="switchView('panels', this)">📋 Panels</div>
      <div class="nav-item" onclick="switchView('keys', this)">🔑 Keys</div>
      <div class="nav-item" onclick="switchView('hwids', this)">🚫 HWID Bans</div>
    </aside>
    
    <main class="main-content" id="mainContent">
      <!-- Overview -->
      <div id="view-overview" class="view-section active">
        <div class="card">
          <h2>Welcome, ${escapeHtml(user.global_name || user.username)}</h2>
          <p class="sub">Manage your scripts, panels, and keys from one place.</p>
          <div class="stats-grid" id="statsGrid">
            <div class="stat"><div class="num" id="statScripts">0</div><div class="label">Scripts</div></div>
            <div class="stat"><div class="num" id="statPanels">0</div><div class="label">Panels</div></div>
            <div class="stat"><div class="num" id="statKeys">0</div><div class="label">Keys</div></div>
            <div class="stat"><div class="num" id="statBanned">0</div><div class="label">Banned HWIDs</div></div>
          </div>
        </div>
      </div>
      
      <!-- Scripts -->
      <div id="view-scripts" class="view-section">
        <div class="card">
          <h2>Your Scripts</h2>
          <p class="sub">Create and manage your protected scripts.</p>
          <div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="scriptName" placeholder="Script name" style="flex:1;min-width:200px;margin:0;">
            <label class="checkbox-container">
              <input type="checkbox" id="ffaMode"> FFA Mode
            </label>
            <label class="checkbox-container">
              <input type="checkbox" id="compressMode"> Compress
            </label>
            <button class="btn btn-primary" onclick="createScript()">+ Create</button>
          </div>
          <textarea id="scriptCode" rows="8" placeholder="-- Paste your Lua code here..."></textarea>
        </div>
        <div id="scriptsList" class="scripts-grid"></div>
      </div>
      
      <!-- Panels -->
      <div id="view-panels" class="view-section">
        <div class="card">
          <h2>Discord Panels</h2>
          <p class="sub">Create panels to send to your Discord server.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <input type="text" id="panelName" placeholder="Panel name">
            <input type="text" id="panelChannel" placeholder="Discord Channel ID">
          </div>
          <textarea id="panelDesc" rows="3" placeholder="Panel description..."></textarea>
          <select id="panelScript"><option value="">Select script...</option></select>
          <input type="number" id="panelCooldown" placeholder="HWID cooldown (seconds)" value="180">
          <button class="btn btn-primary" onclick="createPanel()">+ Create Panel</button>
        </div>
        <div id="panelsList" class="scripts-grid"></div>
      </div>
      
      <!-- Keys -->
      <div id="view-keys" class="view-section">
        <div class="card">
          <h2>Generate Keys</h2>
          <p class="sub">Generate license keys for your panels.</p>
          <select id="keyPanel"><option value="">Select panel...</option></select>
          <input type="number" id="keyDuration" placeholder="Duration (hours, 0 = permanent)" value="0">
          <input type="text" id="keyNote" placeholder="Note (optional)">
          <div class="actions-row">
            <button class="btn btn-primary" onclick="generateKey()">Generate Key</button>
            <button class="btn btn-outline" onclick="addTimeAll()">+ Add Time to All</button>
          </div>
        </div>
        <div id="keysList" class="scripts-grid"></div>
      </div>
      
      <!-- HWIDs -->
      <div id="view-hwids" class="view-section">
        <div class="card">
          <h2>Ban HWID</h2>
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
    let currentData = { scripts: [], panels: [], keys: [], bannedHWIDs: [] };
    let serverTime = Date.now();
    
    function getHeaders() {
      return { 'Content-Type': 'application/json' };
    }
    
    function logout() {
      fetch('/logout').then(() => window.location.href = '/');
    }
    
    async function loadData() {
      try {
        const res = await fetch('/api/data');
        const data = await res.json();
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
      renderHwids();
      updateSelects();
    }
    
    function renderStats() {
      document.getElementById('statScripts').textContent = currentData.scripts.length;
      document.getElementById('statPanels').textContent = currentData.panels.length;
      document.getElementById('statKeys').textContent = currentData.keys.length;
      document.getElementById('statBanned').textContent = currentData.bannedHWIDs.length;
    }
    
    function renderScripts() {
      const container = document.getElementById('scriptsList');
      if (currentData.scripts.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No scripts yet. Create one above.</div>';
        return;
      }
      container.innerHTML = currentData.scripts.map(s => `
        <div class="script-card">
          <div class="title">${escapeHtml(s.name)}</div>
          <div class="meta">
            <span class="badge ${s.status === 'active' ? 'badge-success' : 'badge-danger'}">${s.status === 'active' ? 'Active' : 'Disabled'}</span>
            ${s.ffa_mode ? '<span class="badge badge-warning">FFA</span>' : ''}
            ${s.compress_mode ? '<span class="badge badge-primary">Compressed</span>' : ''}
            <span style="margin-left:8px;">${new Date(s.created_at).toLocaleDateString()}</span>
          </div>
          <div class="actions">
            <button class="btn btn-outline" onclick="toggleScript('${s.id}')">${s.status === 'active' ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-outline" onclick="toggleFfa('${s.id}')">${s.ffa_mode ? 'Disable FFA' : 'Enable FFA'}</button>
            <button class="btn btn-danger" onclick="deleteScript('${s.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    }
    
    function renderPanels() {
      const container = document.getElementById('panelsList');
      if (currentData.panels.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No panels yet. Create one above.</div>';
        return;
      }
      container.innerHTML = currentData.panels.map(p => `
        <div class="script-card">
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="meta">${escapeHtml(p.description || 'No description')}</div>
          <div class="actions">
            <button class="btn btn-success" onclick="sendPanel('${p.id}')">Send to Discord</button>
            <button class="btn btn-danger" onclick="deletePanel('${p.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    }
    
    function renderKeys() {
      const container = document.getElementById('keysList');
      if (currentData.keys.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No keys generated yet.</div>';
        return;
      }
      container.innerHTML = currentData.keys.map(k => {
        const isExpired = k.expires_at && new Date(k.expires_at).getTime() < serverTime;
        let status = 'Active';
        let badgeClass = 'badge-success';
        if (k.revoked) { status = 'Revoked'; badgeClass = 'badge-danger'; }
        else if (isExpired) { status = 'Expired'; badgeClass = 'badge-danger'; }
        else if (k.hwid) { status = 'HWID Locked'; badgeClass = 'badge-warning'; }
        else if (k.discord_user_id) { status = 'Claimed'; badgeClass = 'badge-primary'; }
        
        return `
          <div class="script-card">
            <div class="title" style="font-family:monospace;font-size:13px;">${escapeHtml(k.license_key)}</div>
            <div class="meta">
              <span class="badge ${badgeClass}">${status}</span>
              ${k.note ? `<span style="margin-left:8px;">${escapeHtml(k.note)}</span>` : ''}
            </div>
            <div class="actions">
              <button class="btn btn-danger" onclick="deleteKey('${k.license_key}')">Delete</button>
            </div>
          </div>
        `;
      }).join('');
    }
    
    function renderHwids() {
      const container = document.getElementById('hwidsList');
      if (currentData.bannedHWIDs.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);background:rgba(0,0,0,0.2);border-radius:12px;border:1px dashed var(--border);">No banned HWIDs.</div>';
        return;
      }
      container.innerHTML = currentData.bannedHWIDs.map(h => `
        <div class="script-card">
          <div class="title" style="font-family:monospace;font-size:13px;">${escapeHtml(h.hwid)}</div>
          <div class="meta">Banned ${new Date(h.created_at).toLocaleDateString()}</div>
          <div class="actions">
            <button class="btn btn-outline" onclick="unbanHwid('${h.hwid}')">Unban</button>
          </div>
        </div>
      `).join('');
    }
    
    function updateSelects() {
      const panelScript = document.getElementById('panelScript');
      panelScript.innerHTML = '<option value="">Select script...</option>';
      currentData.scripts.forEach(s => {
        panelScript.innerHTML += `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
      });
      
      const keyPanel = document.getElementById('keyPanel');
      keyPanel.innerHTML = '<option value="">Select panel...</option>';
      currentData.panels.forEach(p => {
        keyPanel.innerHTML += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
      });
    }
    
    function switchView(view, el) {
      document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      if (el) el.classList.add('active');
    }
    
    // Script functions
    async function createScript() {
      const name = document.getElementById('scriptName').value.trim();
      const code = document.getElementById('scriptCode').value;
      const compressMode = document.getElementById('compressMode').checked;
      
      if (!name || !code) return alert('Please enter a name and code.');
      
      await fetch('/api/create-script', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, code, compressMode })
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
        body: JSON.stringify({ id })
      });
      loadData();
    }
    
    // Panel functions
    async function createPanel() {
      const name = document.getElementById('panelName').value.trim();
      const description = document.getElementById('panelDesc').value;
      const channelId = document.getElementById('panelChannel').value.trim();
      const scriptId = document.getElementById('panelScript').value;
      const hwidCooldown = parseInt(document.getElementById('panelCooldown').value) || 180;
      
      if (!name || !channelId || !scriptId) return alert('Please fill in all required fields.');
      
      await fetch('/api/create-panel', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, description, channelId, scriptId, hwidCooldown })
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
        body: JSON.stringify({ id })
      });
      loadData();
    }
    
    // Key functions
    async function generateKey() {
      const panelId = document.getElementById('keyPanel').value;
      const durationHours = parseInt(document.getElementById('keyDuration').value) || 0;
      const note = document.getElementById('keyNote').value.trim();
      
      if (!panelId) return alert('Please select a panel.');
      
      await fetch('/api/generate-key', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ panelId, durationHours, note })
      });
      
      document.getElementById('keyNote').value = '';
      loadData();
    }
    
    async function deleteKey(key) {
      if (!confirm('Delete this key?')) return;
      await fetch('/api/delete-key', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ key })
      });
      loadData();
    }
    
    async function addTimeAll() {
      const hours = prompt('How many hours to add to all keys?');
      if (!hours || isNaN(hours)) return;
      await fetch('/api/add-time-all', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hours: parseInt(hours) })
      });
      loadData();
    }
    
    // HWID functions
    async function banHwid() {
      const hwid = document.getElementById('banHwidInput').value.trim();
      if (!hwid) return alert('Enter an HWID to ban.');
      await fetch('/api/ban-hwid', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hwid })
      });
      document.getElementById('banHwidInput').value = '';
      loadData();
    }
    
    async function unbanHwid(hwid) {
      if (!confirm('Unban this HWID?')) return;
      await fetch('/api/unban-hwid', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ hwid })
      });
      loadData();
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Toggle sidebar on mobile
    document.querySelector('.brand')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });
    
    // Load data on page load
    loadData();
  </script>
</body>
</html>`);
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, name: 'Karma Protection v6.3' });
});

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const processedInteractions = new Set();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (processedInteractions.has(interaction.id)) return;
  processedInteractions.add(interaction.id);
  setTimeout(() => processedInteractions.delete(interaction.id), 60_000).unref?.();

  try {
    if (interaction.isButton()) {
      const customId = interaction.customId;
      
      if (customId.startsWith('panel_redeem_')) {
        const panelId = customId.replace('panel_redeem_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const modal = new ModalBuilder()
          .setCustomId(`redeem_${panelId}`)
          .setTitle('Redeem License Key');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('key')
              .setLabel('Enter your license key')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
        return interaction.showModal(modal);
      }
      
      if (customId.startsWith('panel_reset_')) {
        const panelId = customId.replace('panel_reset_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const modal = new ModalBuilder()
          .setCustomId(`reset_${panelId}`)
          .setTitle('Reset HWID');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('key')
              .setLabel('Enter your license key')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
        return interaction.showModal(modal);
      }
      
      if (customId.startsWith('panel_loader_')) {
        const panelId = customId.replace('panel_loader_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(panel.script_id);
        if (!script) return interaction.reply({ content: 'Script not found.', ephemeral: true });
        
        const loadstring = `loadstring(game:HttpGet("${publicBaseUrl()}/loader/${script.id}"))()`;
        return interaction.reply({ content: `\`\`\`lua\n${loadstring}\n\`\`\``, ephemeral: true });
      }
      
      if (customId.startsWith('panel_info_')) {
        const panelId = customId.replace('panel_info_', '');
        const modal = new ModalBuilder()
          .setCustomId(`info_${panelId}`)
          .setTitle('Key Info');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('key')
              .setLabel('Enter your license key')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
        return interaction.showModal(modal);
      }
    }
    
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;
      const key = interaction.fields.getTextInputValue('key');
      
      if (customId.startsWith('redeem_')) {
        const panelId = customId.replace('redeem_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND panel_id = ?').get(key, panelId);
        if (!license) return interaction.reply({ content: 'Invalid key.', ephemeral: true });
        if (license.revoked) return interaction.reply({ content: 'This key has been revoked.', ephemeral: true });
        if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
          return interaction.reply({ content: 'This key has expired.', ephemeral: true });
        }
        if (license.discord_user_id && license.discord_user_id !== interaction.user.id) {
          return interaction.reply({ content: 'This key is already claimed by another user.', ephemeral: true });
        }
        
        db.prepare('UPDATE licenses SET discord_user_id = ?, redeemed_at = CURRENT_TIMESTAMP WHERE license_key = ?')
          .run(interaction.user.id, key);
        
        return interaction.reply({ content: '✅ Key redeemed successfully!', ephemeral: true });
      }
      
      if (customId.startsWith('reset_')) {
        const panelId = customId.replace('reset_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND panel_id = ?').get(key, panelId);
        if (!license) return interaction.reply({ content: 'Key not found.', ephemeral: true });
        if (license.discord_user_id !== interaction.user.id) {
          return interaction.reply({ content: 'You can only reset HWID for your own keys.', ephemeral: true });
        }
        
        const lastReset = license.last_reset_at ? new Date(license.last_reset_at).getTime() : 0;
        const cooldownMs = (panel.hwid_cooldown || 180) * 1000;
        if (Date.now() - lastReset < cooldownMs) {
          const remaining = Math.ceil((cooldownMs - (Date.now() - lastReset)) / 1000);
          return interaction.reply({ content: `⏳ Please wait ${remaining} seconds before resetting again.`, ephemeral: true });
        }
        
        db.prepare('UPDATE licenses SET hwid = NULL, last_reset_at = CURRENT_TIMESTAMP WHERE license_key = ?')
          .run(key);
        
        return interaction.reply({ content: '🔄 HWID reset successfully!', ephemeral: true });
      }
      
      if (customId.startsWith('info_')) {
        const panelId = customId.replace('info_', '');
        const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
        if (!panel) return interaction.reply({ content: 'Panel not found.', ephemeral: true });
        
        const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND panel_id = ?').get(key, panelId);
        if (!license) return interaction.reply({ content: 'Key not found.', ephemeral: true });
        
        const status = license.revoked ? 'Revoked' :
                      (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) ? 'Expired' :
                      license.discord_user_id ? 'Redeemed' : 'Unused';
        
        const embed = new EmbedBuilder()
          .setTitle('Key Information')
          .setColor(0x6366f1)
          .addFields(
            { name: 'Key', value: `\`${license.license_key}\``, inline: false },
            { name: 'Status', value: status, inline: true },
            { name: 'HWID', value: license.hwid ? `\`${license.hwid}\`` : 'Not set', inline: true },
            { name: 'Expires', value: license.expires_at ? new Date(license.expires_at).toLocaleDateString() : 'Never', inline: true },
            { name: 'Note', value: license.note || 'None', inline: false }
          );
        
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied) {
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

// ---------------- Loader Routes ----------------
app.get('/loader/:id', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  
  const baseUrl = publicBaseUrl();
  res.type('text/plain').send(`--[[ Karma Protection Loader ]]
return (function()
  local url = "${baseUrl}/script/${script.id}"
  local loadstring = loadstring or load
  local src = game:HttpGet(url)
  if not src or #src < 10 then error("Invalid script payload") end
  local func, err = loadstring(src, "@KarmaVM")
  if not func then error(err) end
  return func()
end)()`);
});

app.get('/script/:id', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  
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

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log(`Cleared guild commands.`);
  }
}

(async () => {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Command deploy failed:', error);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Karma Protection v6.3 running on port ${port}`);
    console.log(`Website: http://localhost:${port}`);
  });
  
  await client.login(DISCORD_TOKEN);
})();
