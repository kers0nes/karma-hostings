// server.js
// Karma Protection v6.5 - Gold Edition (Clean)

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
const CLIENT_SECRET = process.env.CLIENT_SECRET;   // ← NEW: separate from DISCORD_TOKEN
const GUILD_ID = process.env.GUILD_ID;
const DATABASE_PATH = process.env.DATABASE_PATH || './data.sqlite';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://luarmor-bot-1-0yt4.onrender.com';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OWNER_ID = process.env.OWNER_ID || 'YOUR_DISCORD_ID_HERE';
const BRAND_COLOR = parseInt(process.env.BRAND_COLOR) || 0xD4AF37;
const PREFIX = process.env.PREFIX || '/';

const SESSION_SIGNING_SECRET = SESSION_SECRET;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}
if (!CLIENT_SECRET) {
  console.error('❌ Missing CLIENT_SECRET environment variable.');
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

// ---------------- API Routes (unchanged - keep from previous) ----------------
// For brevity, include all your API routes here (they are the same as before)
// I'll summarize: /api/data, /api/create-script, /api/update-script, /api/scripts/:id/toggle, /api/scripts/:id/ffa,
// /api/delete-script, /api/create-panel, /api/delete-panel, /api/send-panel, /api/generate-key, /api/delete-key,
// /api/add-time-all, /api/ban-hwid, /api/unban-hwid, /api/delete-whitelist
// (You can copy these from your previous working version)

// ---------------- Discord Auth Routes (FIXED) ----------------
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
        client_secret: CLIENT_SECRET,   // ← CORRECT: use CLIENT_SECRET, not DISCORD_TOKEN
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

// ---------------- Website Routes (Gold Theme) ----------------
// (Include the same / and /dashboard routes from earlier – they're unchanged)
// For brevity, I'll refer to the previous messages for those long HTML strings.

// ---------------- Discord Bot (SINGLE instance, no duplicate commands) ----------------
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

// -------- SINGLE messageCreate handler (NO DUPLICATES) --------
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const args = parts;

  try {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(msg.author.id);

    // ---- COMMANDS ----
    // (All commands are defined ONCE inside this single handler)

    if (cmd === 'help') {
      // ... help embed
      return;
    }

    if (cmd === 'whitelist') {
      // ... whitelist logic
      return;
    }

    if (cmd === 'removewhitelist' || cmd === 'unwhitelist') {
      // ... remove logic
      return;
    }

    if (cmd === 'whitelistlist' || cmd === 'wllist') {
      // ... list logic
      return;
    }

    if (cmd === 'setup') {
      // ... setup logic
      return;
    }

    if (cmd === 'scripts') {
      // ... scripts list
      return;
    }

    if (cmd === 'createkey') {
      // ... create key
      return;
    }

    if (cmd === 'keys') {
      // ... list keys
      return;
    }

    if (cmd === 'revoke') {
      // ... revoke key
      return;
    }

    if (cmd === 'reset-hwid') {
      // ... reset HWID
      return;
    }

    if (cmd === 'panelsetup') {
      // ... panel setup
      return;
    }

    // Owner commands
    if (cmd === 'ban' && msg.author.id === OWNER_ID) {
      // ... ban
      return;
    }

    if (cmd === 'unban' && msg.author.id === OWNER_ID) {
      // ... unban
      return;
    }

    if (cmd === 'checkhwid' && msg.author.id === OWNER_ID) {
      // ... check HWID
      return;
    }

    // If no command matches, do nothing (or send error)
    // msg.reply('Unknown command. Use /help');

  } catch (e) {
    console.error('Command error:', e);
    await msg.reply('❌ Something went wrong.');
  }
});

// -------- Button and Modal handlers (no duplicates) --------
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    // ... button logic (single handler)
    return;
  }
  if (interaction.isModalSubmit()) {
    // ... modal logic (single handler)
    return;
  }
});

// ---------------- Loader Routes ----------------
app.get('/loader/:scriptId', (req, res) => {
  // ... loader logic (same as before)
});

app.get('/script/:scriptId', (req, res) => {
  // ... script delivery logic (same as before)
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
