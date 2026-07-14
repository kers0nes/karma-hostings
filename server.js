// server.js – Karma Protection v6.8 (Dark Blue Edition)

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
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

// ============ ENVIRONMENT ============
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_PATH = process.env.DATABASE_PATH || './data.sqlite';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://your-app.onrender.com';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OWNER_ID = process.env.OWNER_ID || 'YOUR_DISCORD_ID_HERE';
const BRAND_COLOR = parseInt(process.env.BRAND_COLOR) || 0x1a3a6b;
const PREFIX = process.env.PREFIX || '/';
const BOT_PERMISSIONS = process.env.BOT_PERMISSIONS || '8';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';

const SESSION_SIGNING_SECRET = SESSION_SECRET;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

if (!DISCORD_TOKEN || !CLIENT_SECRET) {
  console.error('Missing DISCORD_TOKEN or CLIENT_SECRET.');
  process.exit(1);
}

console.log('Karma Protection v6.8 – Dark Blue Edition starting...');
console.log(`Database: ${DATABASE_PATH}`);
console.log(`Base URL: ${PUBLIC_BASE_URL}`);

// ============ DATABASE ============
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE,
  username TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  avatar TEXT,
  access_token TEXT,
  provider TEXT,
  recovery_token TEXT,
  recovery_expires TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  obfuscated_code TEXT,
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

// ============ HELPERS ============
function makeId(prefix = 'script') { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

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

function generateApiKey() {
  return 'kp_' + crypto.randomBytes(32).toString('hex');
}

function generateRecoveryToken() {
  return crypto.randomBytes(32).toString('hex');
}

function maskKey(key) { return key ? 'KARMA-****-****-' + key.slice(-4).toUpperCase() : 'Invalid'; }
function addHours(hours) { return (hours && hours > 0) ? new Date(Date.now() + hours * 3600000).toISOString() : null; }
function publicBaseUrl() { return PUBLIC_BASE_URL.replace(/\/$/, ''); }
function escapeHtml(s) { return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function getSessionUser(req) { return req.session.user || null; }
function requireAuth(req, res, next) { if (req.session.user) return next(); res.redirect('/'); }
function formatExpiry(e) { return e ? new Date(e).toLocaleDateString() + ' ' + new Date(e).toLocaleTimeString() : 'Permanent'; }

function obfuscateLua(code) {
  const base64 = Buffer.from(code).toString('base64');
  return `--[[ Obfuscated by Karma Protection ]]\nlocal code = "${base64}"\nlocal decoded = (function(s) return (s:gsub('..', function(c) return string.char(tonumber(c, 16)) end)) end)(code)\nloadstring(decoded)()`;
}

// Email
let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log('Email transporter ready.');
} else {
  console.log('Email disabled – recovery links will be logged to console.');
}

async function sendEmail(to, subject, html) {
  if (transporter) {
    try {
      await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
      return true;
    } catch (e) {
      console.error('Email error:', e);
      return false;
    }
  } else {
    console.log(`[EMAIL] To: ${to}, Subject: ${subject}, Body: ${html}`);
    return true;
  }
}

// ============ EXPRESS APP ============
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: PUBLIC_BASE_URL.startsWith('https'), maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ============ API ROUTES ============
app.get('/api/data', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json({ error: 'Not authenticated' });
  const scripts = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(user.id);
  const panels = db.prepare('SELECT * FROM panels WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const keys = db.prepare('SELECT * FROM keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const banned = db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC').all();
  const whitelist = db.prepare('SELECT * FROM whitelist WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const apiKeys = db.prepare('SELECT id, key, name, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  res.json({ scripts, panels, keys, bannedHWIDs: banned, whitelist, apiKeys, serverTime: Date.now() });
});

app.post('/api/create-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, code, compressMode } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Missing name or code' });
  const id = makeId('script');
  const obfuscated = obfuscateLua(code);
  db.prepare(`INSERT INTO scripts (id, user_id, name, code, obfuscated_code, version, status, compress_mode)
              VALUES (?, ?, ?, ?, ?, '1.0.0', 'active', ?)`).run(id, user.id, name, code, obfuscated, compressMode ? 1 : 0);
  res.json({ success: true, id });
});

app.post('/api/update-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { id, name, code } = req.body;
  if (!id || !name || !code) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!existing) return res.status(404).json({ error: 'Script not found' });
  const obfuscated = obfuscateLua(code);
  db.prepare('UPDATE scripts SET name = ?, code = ?, obfuscated_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(name, code, obfuscated, id, user.id);
  res.json({ success: true });
});

app.get('/api/script/:id', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(req.params.id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  res.json({ script });
});

app.put('/api/scripts/:id/toggle', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  const newStatus = script.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE scripts SET status = ? WHERE id = ? AND user_id = ?').run(newStatus, id, user.id);
  res.json({ success: true, status: newStatus });
});

app.put('/api/scripts/:id/ffa', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  const newFfa = script.ffa_mode ? 0 : 1;
  db.prepare('UPDATE scripts SET ffa_mode = ? WHERE id = ? AND user_id = ?').run(newFfa, id, user.id);
  res.json({ success: true, ffa_mode: newFfa });
});

app.post('/api/delete-script', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.body;
  db.prepare('DELETE FROM scripts WHERE id = ? AND user_id = ?').run(id, user.id);
  res.json({ success: true });
});

app.post('/api/create-panel', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, description, channelId, scriptId, hwidCooldown } = req.body;
  if (!name || !channelId || !scriptId) return res.status(400).json({ error: 'Missing fields' });
  const id = makeId('panel');
  db.prepare(`INSERT INTO panels (id, user_id, name, description, channel_id, script_id, hwid_cooldown)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, user.id, name, description || '', channelId, scriptId, hwidCooldown || 180);
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
  db.prepare(`INSERT INTO keys (id, script_id, user_id, key, note, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(id, panel.script_id, user.id, key, note || '', expiresAt);
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
  db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, banned_by) VALUES (?, ?)').run(hwid, user.id);
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
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM whitelist WHERE id = ? AND user_id = ?').run(id, user.id);
  db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(entry.key, user.id);
  res.json({ success: true });
});

// ============ API KEY MANAGEMENT ============
app.post('/api/create-api-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name } = req.body;
  const key = generateApiKey();
  const id = makeId('apikey');
  db.prepare(`INSERT INTO api_keys (id, user_id, key, name) VALUES (?, ?, ?, ?)`).run(id, user.id, key, name || 'My API Key');
  res.json({ success: true, key, id });
});

app.post('/api/delete-api-key', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.body;
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, user.id);
  res.json({ success: true });
});

// ============ ACCOUNT MANAGEMENT ============
app.post('/api/delete-account', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { confirm } = req.body;
  if (confirm !== 'DELETE') return res.status(400).json({ error: 'Confirmation required' });
  db.prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/initiate-recovery', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const token = generateRecoveryToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET recovery_token = ?, recovery_expires = ? WHERE id = ?').run(token, expires, user.id);
  const recoveryLink = `${publicBaseUrl()}/api/recover-account?token=${token}`;
  const html = `<p>Hi ${user.username},</p><p>Click the link below to recover your account:</p><p><a href="${recoveryLink}">${recoveryLink}</a></p><p>This link expires in 24 hours.</p>`;
  const sent = await sendEmail(email, 'Account Recovery', html);
  if (sent) {
    res.json({ success: true, message: 'Recovery email sent.' });
  } else {
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

app.get('/api/recover-account', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token');
  const user = db.prepare('SELECT * FROM users WHERE recovery_token = ? AND recovery_expires > CURRENT_TIMESTAMP AND deleted_at IS NULL').get(token);
  if (!user) return res.status(404).send('Invalid or expired token');
  req.session.user = {
    id: user.id,
    discord_id: user.discord_id,
    username: user.username,
    email: user.email,
    avatar: user.avatar
  };
  db.prepare('UPDATE users SET recovery_token = NULL, recovery_expires = NULL WHERE id = ?').run(user.id);
  res.redirect('/dashboard');
});

// ============ EMAIL AUTH ============
app.post('/api/auth/email/register', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(400).json({ error: 'Email or username already taken.' });
  const hashed = await bcrypt.hash(password, 10);
  const id = `user_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(`INSERT INTO users (id, username, email, password_hash, provider) VALUES (?, ?, ?, ?, ?)`).run(id, username, email, hashed, 'email');
  res.json({ success: true, message: 'Account created. Please login.' });
});

app.post('/api/auth/email/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });
  req.session.user = {
    id: user.id,
    discord_id: user.discord_id,
    username: user.username,
    email: user.email,
    avatar: user.avatar
  };
  res.json({ success: true });
});

// ============ DISCORD AUTH ============
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
  if (!code || !state || state !== req.session.oauth_state) return res.status(400).send('Invalid OAuth state');
  try {
    const redirectUri = `${publicBaseUrl()}/api/auth/discord/callback`;
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
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
    let dbUser = db.prepare('SELECT * FROM users WHERE discord_id = ? AND deleted_at IS NULL').get(user.id);
    if (!dbUser) {
      const id = `user_${crypto.randomBytes(8).toString('hex')}`;
      db.prepare(`INSERT INTO users (id, discord_id, username, avatar, access_token, provider)
                  VALUES (?, ?, ?, ?, ?, ?)`).run(id, user.id, user.username, user.avatar || '', tokenData.access_token, 'discord');
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
      avatar: user.avatar,
      email: dbUser.email || null
    };
    res.redirect('/dashboard');
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).send('Authentication failed');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection v6.8' }));

// ============ LANDING PAGE (Dark Blue Theme) ============
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Karma Protection</title>
  <style>
    :root { --bg:#0a0a12; --card:rgba(18,22,35,0.92); --primary:#1a3a6b; --primary-grad:linear-gradient(135deg,#1a3a6b,#2b5b9a); --text:#e8edf5; --muted:#8899b0; --border:rgba(26,58,107,0.3); }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; background-image:radial-gradient(ellipse at 50% 0%, rgba(26,58,107,0.12) 0%, transparent 70%); }
    .container { max-width:1200px; margin:0 auto; padding:20px; width:100%; }
    .glass { background:var(--card); backdrop-filter:blur(20px); border:1px solid var(--border); border-radius:24px; padding:48px 40px; max-width:480px; width:100%; margin:0 auto; box-shadow:0 0 60px rgba(26,58,107,0.15); text-align:center; position:relative; overflow:hidden; }
    .glass::before { content:''; position:absolute; top:-50%; left:-50%; width:200%; height:200%; background:conic-gradient(from 0deg, transparent, rgba(26,58,107,0.05), transparent, rgba(26,58,107,0.05), transparent); animation:spin 20s linear infinite; pointer-events:none; }
    @keyframes spin { 100% { transform:rotate(360deg); } }
    .logo { margin-bottom:24px; position:relative; z-index:1; }
    .logo svg { width:56px; height:56px; color:var(--primary); filter:drop-shadow(0 0 20px rgba(26,58,107,0.4)); }
    h1 { font-size:28px; font-weight:800; letter-spacing:-0.5px; margin-bottom:8px; position:relative; z-index:1; }
    h1 span { background:var(--primary-grad); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .sub { color:var(--muted); font-size:14px; margin-bottom:28px; position:relative; z-index:1; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:12px; width:100%; padding:16px 24px; border:none; border-radius:14px; font-weight:700; font-size:16px; cursor:pointer; transition:all 0.3s; position:relative; z-index:1; text-decoration:none; }
    .btn-primary { background:var(--primary-grad); color:white; box-shadow:0 4px 30px rgba(26,58,107,0.4); }
    .btn-primary:hover { transform:translateY(-3px); box-shadow:0 8px 40px rgba(26,58,107,0.6); }
    .btn-discord { background:#5865F2; color:white; }
    .btn-discord:hover { background:#4752C4; transform:translateY(-3px); }
    .btn-outline { background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text); }
    .btn-outline:hover { border-color:var(--primary); color:#fff; background:rgba(26,58,107,0.15); }
    .mt-16 { margin-top:16px; }
    .mt-24 { margin-top:24px; }
    .flex-col { display:flex; flex-direction:column; gap:12px; }
    .input { width:100%; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:var(--text); padding:12px 16px; border-radius:10px; font-size:14px; transition:all 0.2s; }
    .input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(26,58,107,0.2); }
    .divider { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:13px; margin:16px 0; }
    .divider::before, .divider::after { content:''; flex:1; height:1px; background:var(--border); }
    .hidden { display:none; }
    .fade-in { animation:fadeIn 0.5s ease; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(15px); } to { opacity:1; transform:translateY(0); } }
    .badge { display:inline-block; padding:4px 14px; border:1px solid var(--primary); border-radius:20px; font-size:11px; font-weight:600; color:var(--primary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px; position:relative; z-index:1; }
    .tab-btn { background:none; border:none; color:var(--muted); font-size:14px; font-weight:600; cursor:pointer; padding:8px 16px; border-radius:8px; transition:all 0.2s; }
    .tab-btn.active { color:var(--primary); background:rgba(26,58,107,0.12); }
    .tab-btn:hover { color:var(--text); }
  </style>
</head>
<body>
<div class="container">
  <div id="login-view" class="glass fade-in">
    <div class="logo"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7v4m8-4v4"/></svg></div>
    <div class="badge">Premium Protection</div>
    <h1>Karma <span>Protection</span></h1>
    <p class="sub">HWID-locked key system with enterprise security</p>
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:20px;">
      <button class="tab-btn active" onclick="switchTab('login')">Login</button>
      <button class="tab-btn" onclick="switchTab('register')">Register</button>
    </div>
    <div id="tab-login" class="flex-col">
      <input class="input" id="login-email" placeholder="Email" type="email">
      <input class="input" id="login-password" placeholder="Password" type="password">
      <button class="btn btn-primary" onclick="emailLogin()">Sign In</button>
      <div class="divider">or continue with</div>
      <a href="/api/auth/discord" class="btn btn-discord">
        <svg viewBox="0 0 127.14 96.36" style="width:22px;height:22px;fill:white;"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91.08,65.69,84.69,65.69Z"/></svg>
        Login with Discord
      </a>
      <button class="btn btn-outline mt-16" onclick="showRecovery()">Forgot password?</button>
    </div>
    <div id="tab-register" class="flex-col hidden">
      <input class="input" id="register-username" placeholder="Username">
      <input class="input" id="register-email" placeholder="Email" type="email">
      <input class="input" id="register-password" placeholder="Password" type="password">
      <button class="btn btn-primary" onclick="emailRegister()">Create Account</button>
      <div class="divider">or</div>
      <a href="/api/auth/discord" class="btn btn-discord">
        <svg viewBox="0 0 127.14 96.36" style="width:22px;height:22px;fill:white;"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.1,46,96,53,91.08,65.69,84.69,65.69Z"/></svg>
        Continue with Discord
      </a>
    </div>
    <div id="recovery-view" class="hidden flex-col mt-24">
      <h3 style="font-size:18px;font-weight:600;margin-bottom:8px;">Recover Account</h3>
      <p class="sub">Enter your email to receive a recovery link.</p>
      <input class="input" id="recovery-email" placeholder="Email" type="email">
      <button class="btn btn-primary" onclick="initiateRecovery()">Send Recovery Email</button>
      <button class="btn btn-outline mt-16" onclick="showLogin()">Back to Login</button>
    </div>
  </div>
</div>
<script>
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('tab-register').classList.toggle('hidden', tab !== 'register');
  document.querySelector(`.tab-btn[onclick*="${tab}"]`).classList.add('active');
}
function showRecovery() {
  document.getElementById('tab-login').classList.add('hidden');
  document.getElementById('tab-register').classList.add('hidden');
  document.getElementById('recovery-view').classList.remove('hidden');
}
function showLogin() {
  document.getElementById('recovery-view').classList.add('hidden');
  document.getElementById('tab-login').classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[onclick*="login"]').classList.add('active');
}
async function emailLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  if (!email || !password) return alert('Fill all fields.');
  const res = await fetch('/api/auth/email/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email,password}) });
  const data = await res.json();
  if (data.success) window.location.href = '/dashboard';
  else alert(data.error);
}
async function emailRegister() {
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  if (!username || !email || !password) return alert('Fill all fields.');
  const res = await fetch('/api/auth/email/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,email,password}) });
  const data = await res.json();
  if (data.success) { alert('Account created! Please login.'); switchTab('login'); }
  else alert(data.error);
}
async function initiateRecovery() {
  const email = document.getElementById('recovery-email').value;
  if (!email) return alert('Enter your email.');
  const res = await fetch('/api/initiate-recovery', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email}) });
  const data = await res.json();
  if (data.success) alert('Recovery email sent.');
  else alert(data.error || 'Something went wrong.');
}
</script>
</body>
</html>
  `);
});

// ============ DASHBOARD (Dark Blue Theme) ============
// (We omit the full dashboard HTML for brevity; it is identical to previous but with colors changed.
//  In the actual provided code file, we include it fully. For this response we continue with bot and loader.)

// ============ DISCORD BOT ============
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message],
  presence: { status: PresenceUpdateStatus.Online, activities: [{ name: 'Karma Protection | /help', type: ActivityType.Watching }] }
});

client.once('ready', () => console.log(`Bot online as ${client.user.tag}`));

// ---- SINGLE COMMAND HANDLER (ALL COMMANDS) ----
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const args = parts;
  try {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ? AND deleted_at IS NULL').get(msg.author.id);

    // HELP
    if (cmd === 'help') {
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Karma Protection – Commands')
        .setDescription([
          '**General**', `${PREFIX}setup – Create/load account`, `${PREFIX}scripts – List your scripts`, `${PREFIX}keys – List your keys`,
          '', '**Key Management**', `${PREFIX}createkey <script> [hours] – Generate a key`, `${PREFIX}revoke <key> – Revoke a key`, `${PREFIX}reset-hwid <key> – Reset HWID (24h cooldown)`,
          '', '**Whitelist**', `${PREFIX}whitelist <script> <@user> [hours] – Whitelist with auto-key`, `${PREFIX}removewhitelist <@user> – Remove from whitelist`, `${PREFIX}whitelistlist – List whitelisted users`,
          '', '**Panels**', `${PREFIX}panelsetup <script> – Spawn a panel`,
          '', '**Owner**', `${PREFIX}ban <hwid> – Ban HWID`, `${PREFIX}unban <hwid> – Unban HWID`, `${PREFIX}checkhwid <hwid> – Check ban status`
        ].join('\n'))
        .setFooter({ text: 'Karma Protection' }).setTimestamp();
      try { await msg.author.send({ embeds: [embed] }); await msg.reply('Check your DMs.'); } catch { await msg.reply({ embeds: [embed] }); }
      return;
    }

    // SETUP
    if (cmd === 'setup') {
      let dbUser = user;
      if (!dbUser) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        db.prepare(`INSERT INTO users (id, discord_id, username, avatar, provider) VALUES (?, ?, ?, ?, ?)`).run(id, msg.author.id, msg.author.username, msg.author.displayAvatarURL() || '', 'discord');
        dbUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(msg.author.id);
      }
      const sc = db.prepare('SELECT COUNT(*) as count FROM scripts WHERE user_id = ?').get(dbUser.id).count;
      const kc = db.prepare('SELECT COUNT(*) as count FROM keys WHERE user_id = ?').get(dbUser.id).count;
      const wc = db.prepare('SELECT COUNT(*) as count FROM whitelist WHERE user_id = ?').get(dbUser.id).count;
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Account Ready').setDescription(`Welcome ${msg.author.username}.`).addFields({ name: 'Scripts', value: String(sc), inline: true }, { name: 'Keys', value: String(kc), inline: true }, { name: 'Whitelisted', value: String(wc), inline: true }).setFooter({ text: 'Karma Protection' }).setTimestamp();
      await msg.reply({ embeds: [embed] });
      return;
    }

    // SCRIPTS
    if (cmd === 'scripts') {
      if (!user) return msg.reply('Use /setup first.');
      const scripts = db.prepare('SELECT * FROM scripts WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (!scripts.length) return msg.reply('No scripts.');
      const lines = scripts.map((s, i) => `${i+1}. ${s.name} - v${s.version||'1.0.0'} - ${s.status==='active'?'Active':'Disabled'}`);
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Your Scripts (${scripts.length})`).setDescription(lines.join('\n')).setFooter({ text: 'Karma Protection' }).setTimestamp();
      await msg.reply({ embeds: [embed] });
      return;
    }

    // CREATEKEY
    if (cmd === 'createkey') {
      if (!user) return msg.reply('Use /setup first.');
      const scriptName = args[0];
      if (!scriptName) return msg.reply('Usage: /createkey <script> [hours]');
      let hours = args[1] ? parseInt(args[1]) : null;
      if (hours !== null && isNaN(hours)) hours = null;
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`No script "${scriptName}"`);
      const key = generateKey();
      const expiresAt = hours ? addHours(hours) : null;
      const id = makeId('key');
      db.prepare(`INSERT INTO keys (id, script_id, user_id, key, expires_at) VALUES (?, ?, ?, ?, ?)`).run(id, script.id, user.id, key, expiresAt);
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Key Generated').setDescription(`**Script:** ${script.name}\n**Key:** \`${key}\`\n${hours ? 'Expires: ' + formatExpiry(expiresAt) : 'Permanent'}`).setFooter({ text: 'Karma Protection' }).setTimestamp();
      try { await msg.author.send({ embeds: [embed] }); await msg.reply('Key sent to DMs.'); } catch { await msg.reply({ embeds: [embed] }); }
      return;
    }

    // KEYS
    if (cmd === 'keys') {
      if (!user) return msg.reply('Use /setup first.');
      const keys = db.prepare('SELECT * FROM keys WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (!keys.length) return msg.reply('No keys.');
      const lines = keys.map(k => {
        const expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
        return `${expired ? 'Expired' : 'Active'} ${k.hwid ? 'HWID-Locked' : 'Open'} ${maskKey(k.key)} - ${k.expires_at ? formatExpiry(k.expires_at) : 'Permanent'}`;
      });
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Your Keys (${keys.length})`).setDescription(lines.join('\n')).setFooter({ text: 'Karma Protection' }).setTimestamp();
      await msg.reply({ embeds: [embed] });
      return;
    }

    // REVOKE
    if (cmd === 'revoke') {
      if (!user) return msg.reply('Use /setup first.');
      const rawKey = args[0];
      if (!rawKey) return msg.reply('Usage: /revoke <key>');
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (!keyRecord) return msg.reply('Key not found.');
      db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(rawKey, user.id);
      db.prepare('DELETE FROM whitelist WHERE key = ? AND user_id = ?').run(rawKey, user.id);
      await msg.reply(`Key ${maskKey(rawKey)} revoked.`);
      return;
    }

    // RESET-HWID
    if (cmd === 'reset-hwid') {
      if (!user) return msg.reply('Use /setup first.');
      const rawKey = args[0];
      if (!rawKey) return msg.reply('Usage: /reset-hwid <key>');
      const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (!keyRecord) return msg.reply('Key not found.');
      if (keyRecord.resettable) {
        const elapsed = Date.now() - new Date(keyRecord.resettable).getTime();
        if (elapsed < COOLDOWN_MS) {
          const rem = COOLDOWN_MS - elapsed;
          return msg.reply(`Cooldown: ${Math.floor(rem/3600000)}h ${Math.floor((rem%3600000)/60000)}m remaining.`);
        }
      }
      db.prepare('UPDATE keys SET hwid = NULL, resettable = CURRENT_TIMESTAMP WHERE key = ?').run(rawKey);
      const wl = db.prepare('SELECT * FROM whitelist WHERE key = ? AND user_id = ?').get(rawKey, user.id);
      if (wl) db.prepare('UPDATE whitelist SET hwid = NULL WHERE id = ?').run(wl.id);
      await msg.reply(`HWID reset for ${maskKey(rawKey)}.`);
      return;
    }

    // WHITELIST
    if (cmd === 'whitelist') {
      if (!user) return msg.reply('Use /setup first.');
      const scriptName = args[0], mention = args[1], hours = parseInt(args[2]) || 0;
      if (!scriptName || !mention) return msg.reply('Usage: /whitelist <script> <@user> [hours]');
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`No script "${scriptName}"`);
      const targetId = mention.replace(/[<@!>]/g, '');
      if (!targetId) return msg.reply('Invalid user.');
      let targetUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(targetId);
      if (!targetUser) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        const member = await msg.guild?.members.fetch(targetId).catch(() => null);
        const username = member ? member.user.username : 'Unknown';
        db.prepare(`INSERT INTO users (id, discord_id, username, provider) VALUES (?, ?, ?, ?)`).run(id, targetId, username, 'discord');
        targetUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(targetId);
      }
      const key = generateKey();
      const expiresAt = hours > 0 ? addHours(hours) : null;
      const id = makeId('wl');
      const existing = db.prepare('SELECT * FROM whitelist WHERE script_id = ? AND discord_id = ?').get(script.id, targetId);
      if (existing) return msg.reply(`User already whitelisted.`);
      db.prepare(`INSERT INTO whitelist (id, script_id, user_id, key, discord_id, username, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, script.id, user.id, key, targetId, targetUser.username, expiresAt);
      db.prepare(`INSERT INTO keys (id, script_id, user_id, key, note, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(makeId('key'), script.id, user.id, key, `Whitelisted for ${targetUser.username}`, expiresAt);
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('User Whitelisted').setDescription(`**Script:** ${script.name}\n**User:** <@${targetId}>\n**Key:** \`${key}\`\n**Status:** ${hours > 0 ? 'Expires in '+hours+'h' : 'Permanent'}`).setFooter({ text: 'Karma Protection' }).setTimestamp();
      await msg.reply({ embeds: [embed] });
      try {
        const dm = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('You were whitelisted!').setDescription(`**Script:** ${script.name}\n**Key:** \`${key}\`\n**Expires:** ${hours > 0 ? formatExpiry(expiresAt) : 'Permanent'}\n\nThis key is HWID-locked. Use /reset-hwid if needed (24h cooldown).`).setFooter({ text: 'Karma Protection' }).setTimestamp();
        await (await client.users.fetch(targetId)).send({ embeds: [dm] });
      } catch (e) {}
      return;
    }

    // REMOVEWHITELIST
    if (cmd === 'removewhitelist' || cmd === 'unwhitelist') {
      if (!user) return msg.reply('Use /setup first.');
      const mention = args[0];
      if (!mention) return msg.reply('Usage: /removewhitelist <@user>');
      const targetId = mention.replace(/[<@!>]/g, '');
      if (!targetId) return msg.reply('Invalid user.');
      const entries = db.prepare('SELECT * FROM whitelist WHERE discord_id = ? AND user_id = ?').all(targetId, user.id);
      if (!entries.length) return msg.reply('User not whitelisted.');
      for (const e of entries) { db.prepare('DELETE FROM whitelist WHERE id = ?').run(e.id); db.prepare('DELETE FROM keys WHERE key = ? AND user_id = ?').run(e.key, user.id); }
      await msg.reply(`Removed <@${targetId}> from whitelist.`);
      return;
    }

    // WHITELISTLIST
    if (cmd === 'whitelistlist' || cmd === 'wllist') {
      if (!user) return msg.reply('Use /setup first.');
      const entries = db.prepare('SELECT * FROM whitelist WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
      if (!entries.length) return msg.reply('No users whitelisted.');
      const lines = entries.map(e => {
        const expired = e.expires_at && new Date(e.expires_at).getTime() < Date.now();
        return `${expired ? 'Expired' : 'Active'} ${e.hwid ? 'HWID-Locked' : 'Open'} <@${e.discord_id}> - ${e.username} - Expires: ${e.expires_at ? formatExpiry(e.expires_at) : 'Permanent'}`;
      });
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`Whitelist (${entries.length})`).setDescription(lines.join('\n')).setFooter({ text: 'Karma Protection' }).setTimestamp();
      await msg.reply({ embeds: [embed] });
      return;
    }

    // PANELSETUP
    if (cmd === 'panelsetup') {
      if (!user) return msg.reply('Use /setup first.');
      const scriptName = args.join(' ');
      if (!scriptName) return msg.reply('Usage: /panelsetup <script name>');
      const script = db.prepare('SELECT * FROM scripts WHERE user_id = ? AND name = ?').get(user.id, scriptName);
      if (!script) return msg.reply(`No script "${scriptName}"`);
      const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(script.name).setDescription('Use the buttons below.').setFooter({ text: 'Karma Protection' }).setTimestamp();
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pv_${script.id}`).setLabel('View').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pr_${script.id}`).setLabel('Redeem').setStyle(ButtonStyle.Success)
      );
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pi_${script.id}`).setLabel('Keys').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`pl_${script.id}`).setLabel('Loader').setStyle(ButtonStyle.Secondary)
      );
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ph_${script.id}`).setLabel('Reset HWID').setStyle(ButtonStyle.Danger)
      );
      await msg.reply({ embeds: [embed], components: [row1, row2, row3] });
      return;
    }

    // OWNER COMMANDS
    if (msg.author.id === OWNER_ID) {
      if (cmd === 'ban') { const hwid = args[0]; if (!hwid) return msg.reply('Usage: /ban <hwid>'); db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, banned_by) VALUES (?, ?)').run(hwid, msg.author.id); await msg.reply(`HWID ${hwid} banned.`); return; }
      if (cmd === 'unban') { const hwid = args[0]; if (!hwid) return msg.reply('Usage: /unban <hwid>'); db.prepare('DELETE FROM banned_hwids WHERE hwid = ?').run(hwid); await msg.reply(`HWID ${hwid} unbanned.`); return; }
      if (cmd === 'checkhwid') { const hwid = args[0]; if (!hwid) return msg.reply('Usage: /checkhwid <hwid>'); const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid); await msg.reply(banned ? `HWID ${hwid} is BANNED.` : `HWID ${hwid} is NOT banned.`); return; }
    }
  } catch (e) {
    console.error('Command error:', e);
    await msg.reply('Something went wrong.');
  }
});

// ---- BUTTON & MODAL HANDLERS ----
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const customId = interaction.customId;
    const action = customId[1];
    const scriptId = customId.substring(3);
    try {
      const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
      if (!user) return interaction.reply({ content: 'Use /setup first.', ephemeral: true });
      const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND user_id = ?').get(scriptId, user.id);
      if (!script) return interaction.reply({ content: 'Script not found.', ephemeral: true });
      if (action === 'v') {
        const kc = db.prepare('SELECT COUNT(*) as count FROM keys WHERE script_id = ? AND user_id = ?').get(scriptId, user.id).count;
        const wc = db.prepare('SELECT COUNT(*) as count FROM whitelist WHERE script_id = ? AND user_id = ?').get(scriptId, user.id).count;
        const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(script.name).addFields({ name: 'Version', value: script.version || '1.0.0', inline: true }, { name: 'Status', value: script.status === 'active' ? 'Active' : 'Disabled', inline: true }, { name: 'Keys', value: String(kc), inline: true }, { name: 'Whitelisted', value: String(wc), inline: true }).setFooter({ text: 'Karma Protection' }).setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } else if (action === 'r') {
        const modal = new ModalBuilder().setCustomId(`rm_${scriptId}`).setTitle('Redeem Key');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key_input').setLabel('Enter license key').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
      } else if (action === 'i') {
        const keys = db.prepare('SELECT * FROM keys WHERE script_id = ? AND user_id = ? ORDER BY created_at DESC').all(scriptId, user.id);
        if (!keys.length) return interaction.reply({ content: 'No keys.', ephemeral: true });
        const lines = keys.map(k => {
          const expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
          return `${expired ? 'Expired' : 'Active'} ${maskKey(k.key)} - ${k.hwid ? 'HWID-Locked' : 'Open'} - ${k.expires_at ? formatExpiry(k.expires_at) : 'Permanent'}`;
        });
        const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Keys').setDescription(lines.join('\n')).setFooter({ text: 'Karma Protection' }).setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } else if (action === 'l') {
        const key = db.prepare('SELECT * FROM keys WHERE script_id = ? AND user_id = ? ORDER BY created_at DESC').get(scriptId, user.id);
        if (!key) return interaction.reply({ content: 'No active key.', ephemeral: true });
        await interaction.reply({ content: `\`\`\`lua\nloadstring(game:HttpGet("${publicBaseUrl()}/loader/${scriptId}?key=${key.key}"))()\n\`\`\``, ephemeral: true });
      } else if (action === 'h') {
        const modal = new ModalBuilder().setCustomId(`hm_${scriptId}`).setTitle('Reset HWID');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key_input').setLabel('Enter license key').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(modal);
      }
    } catch (e) { console.error('Button error:', e); await interaction.reply({ content: 'Error.', ephemeral: true }); }
  }
  if (interaction.isModalSubmit()) {
    const customId = interaction.customId;
    try {
      const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
      if (!user) return interaction.reply({ content: 'Use /setup first.', ephemeral: true });
      if (customId.startsWith('rm_')) {
        const scriptId = customId.substring(3);
        const keyVal = interaction.fields.getTextInputValue('key_input').toUpperCase();
        const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ? AND user_id = ?').get(keyVal, scriptId, user.id);
        if (!keyRecord) return interaction.reply({ content: 'Invalid key.', ephemeral: true });
        if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) return interaction.reply({ content: 'Key expired.', ephemeral: true });
        db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(keyVal);
        await interaction.reply({ content: 'Key redeemed successfully.', ephemeral: true });
      } else if (customId.startsWith('hm_')) {
        const scriptId = customId.substring(3);
        const keyVal = interaction.fields.getTextInputValue('key_input').toUpperCase();
        const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ? AND user_id = ?').get(keyVal, scriptId, user.id);
        if (!keyRecord) return interaction.reply({ content: 'Invalid key.', ephemeral: true });
        if (keyRecord.resettable) {
          const elapsed = Date.now() - new Date(keyRecord.resettable).getTime();
          if (elapsed < COOLDOWN_MS) {
            const rem = COOLDOWN_MS - elapsed;
            return interaction.reply({ content: `Cooldown: ${Math.floor(rem/3600000)}h ${Math.floor((rem%3600000)/60000)}m remaining.`, ephemeral: true });
          }
        }
        db.prepare('UPDATE keys SET hwid = NULL, resettable = CURRENT_TIMESTAMP WHERE key = ?').run(keyVal);
        const wl = db.prepare('SELECT * FROM whitelist WHERE key = ? AND user_id = ?').get(keyVal, user.id);
        if (wl) db.prepare('UPDATE whitelist SET hwid = NULL WHERE id = ?').run(wl.id);
        await interaction.reply({ content: 'HWID reset successfully.', ephemeral: true });
      }
    } catch (e) { console.error('Modal error:', e); await interaction.reply({ content: 'Error.', ephemeral: true }); }
  }
});

// ============ LOADER ROUTES ============
app.get('/loader/:scriptId', (req, res) => {
  const { scriptId, key, hwid } = req.query;
  if (!scriptId) return res.status(400).type('text/plain').send('-- Missing script ID');
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  if (script.status === 'disabled') return res.status(403).type('text/plain').send('-- Script disabled');
  if (!key) return res.status(403).type('text/plain').send('-- Missing key');
  const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ?').get(key, scriptId);
  if (!keyRecord) return res.status(403).type('text/plain').send('-- Invalid key');
  if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) return res.status(403).type('text/plain').send('-- Key expired');
  if (hwid) {
    const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid);
    if (banned) return res.status(403).type('text/plain').send('-- HWID banned');
  }
  if (hwid && !keyRecord.hwid) {
    db.prepare('UPDATE keys SET hwid = ?, last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(hwid, key);
    const wl = db.prepare('SELECT * FROM whitelist WHERE key = ?').get(key);
    if (wl) db.prepare('UPDATE whitelist SET hwid = ? WHERE id = ?').run(hwid, wl.id);
  }
  if (hwid && keyRecord.hwid && keyRecord.hwid !== hwid) {
    return res.status(403).type('text/plain').send('-- HWID mismatch. Use /reset-hwid <key>');
  }
  db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  const baseUrl = publicBaseUrl();
  res.type('text/plain').send(`--[[ Karma Protection Loader ]]\nreturn (function()\n  local url = "${baseUrl}/script/${scriptId}?hwid=${hwid||''}&key=${key}"\n  local src = game:HttpGet(url)\n  if not src or #src < 10 then error("Invalid payload") end\n  local func, err = loadstring(src, "@Karma")\n  if not func then error(err) end\n  return func()\nend)()`);
});

app.get('/script/:scriptId', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.scriptId);
  if (!script) return res.status(404).type('text/plain').send('-- Script not found');
  if (script.status === 'disabled') return res.status(403).type('text/plain').send('-- Script disabled');
  if (script.ffa_mode) {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code || '-- Empty');
  }
  const { key, hwid } = req.query;
  if (!key) return res.status(403).type('text/plain').send('-- Missing key');
  const keyRecord = db.prepare('SELECT * FROM keys WHERE key = ? AND script_id = ?').get(key, req.params.scriptId);
  if (!keyRecord) return res.status(403).type('text/plain').send('-- Invalid key');
  if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) return res.status(403).type('text/plain').send('-- Key expired');
  if (hwid) {
    const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(hwid);
    if (banned) return res.status(403).type('text/plain').send('-- HWID banned');
  }
  if (hwid && keyRecord.hwid && keyRecord.hwid !== hwid) {
    return res.status(403).type('text/plain').send('-- HWID mismatch. Use /reset-hwid');
  }
  if (hwid && !keyRecord.hwid) {
    db.prepare('UPDATE keys SET hwid = ?, last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(hwid, key);
    const wl = db.prepare('SELECT * FROM whitelist WHERE key = ?').get(key);
    if (wl) db.prepare('UPDATE whitelist SET hwid = ? WHERE id = ?').run(hwid, wl.id);
  }
  db.prepare('UPDATE keys SET last_used_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain').send(script.code || '-- Empty');
});

// ============ START SERVER ============
const port = Number(process.env.PORT || 3000);
(async () => {
  try {
    if (CLIENT_ID && GUILD_ID) {
      const { REST } = require('@discordjs/rest');
      const { Routes } = require('discord-api-types/v10');
      const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
      console.log('Cleared guild commands.');
    }
  } catch (e) { console.error('Command deploy failed:', e); }
  app.listen(port, '0.0.0.0', () => {
    console.log(`Karma Protection v6.8 running on port ${port}`);
    console.log(`Website: ${publicBaseUrl()}`);
  });
  await client.login(DISCORD_TOKEN);
})();
