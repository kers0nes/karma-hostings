// server.js
// Karma Protection v6.3 - Enhanced Anti-Tamper System
// Full Bot + Website Integration (No /obfuscate route)

require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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
  GLOBAL_API_TOKEN,
  PUBLIC_BASE_URL = 'https://your-render-app.onrender.com',
  OBFUSCATOR_API_URL = 'https://luarmor-bot-1-0yt4.onrender.com',
  DISCORD_OAUTH_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  SESSION_SECRET,
  DISCORD_INVITE_URL = 'https://discord.com',
  OWNER_ID = '1207803375807373415',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  RESET_COOLDOWN_HOURS = '24',
  MAX_SCRIPTS_PER_USER = '5',
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET
} = process.env;

const OAUTH_CLIENT_ID = DISCORD_OAUTH_CLIENT_ID || CLIENT_ID || '1525736430813450342';
const SESSION_SIGNING_SECRET = SESSION_SECRET || DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = parseInt(MAX_SCRIPTS_PER_USER, 10) || 5;
const resetCooldowns = new Map();
const oauthStates = new Map();

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// ---------------- Database ----------------
const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  admin_role_id TEXT,
  customer_role_id TEXT,
  log_channel_id TEXT,
  panel_channel_id TEXT,
  panel_message_id TEXT,
  panel_title TEXT,
  panel_description TEXT,
  panel_script_id TEXT,
  api_key_hash TEXT,
  api_key_preview TEXT,
  key_system_enabled INTEGER DEFAULT 0,
  key_system_color TEXT DEFAULT '#d4af37',
  key_system_title TEXT DEFAULT 'Karma Key System',
  key_system_description TEXT DEFAULT 'Enter your license key to unlock access',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_secret_hash TEXT NOT NULL,
  api_secret_preview TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
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
  used_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosted_scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  source_code TEXT,
  linked_script_id TEXT,
  obfuscated INTEGER NOT NULL DEFAULT 0,
  obfuscation_level TEXT DEFAULT 'standard',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_scripts (
  service_id TEXT NOT NULL,
  script_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(service_id, script_id)
);

CREATE TABLE IF NOT EXISTS key_system_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  guild_id TEXT,
  config TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id TEXT NOT NULL,
  license_key TEXT,
  hwid TEXT,
  ip TEXT,
  executor TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT,
  display_name TEXT,
  avatar TEXT,
  provider TEXT,
  provider_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  script_quota INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_users (
  id TEXT PRIMARY KEY,
  username TEXT,
  global_name TEXT,
  avatar TEXT,
  display_username TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  script_quota INTEGER NOT NULL DEFAULT 5,
  last_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS premium_codes (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'premium',
  redeemed_by TEXT,
  redeemed_at TEXT,
  created_by TEXT,
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

CREATE INDEX IF NOT EXISTS idx_scripts_guild ON scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_licenses_script ON licenses(script_id);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_guild ON hosted_scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_user ON hosted_scripts(created_by);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_linked ON hosted_scripts(linked_script_id);
CREATE INDEX IF NOT EXISTS idx_premium_codes_redeemed_by ON premium_codes(redeemed_by);
`);

// Migrations
for (const migration of [
  'ALTER TABLE guild_settings ADD COLUMN panel_title TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_description TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_script_id TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_hash TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_preview TEXT',
  'ALTER TABLE guild_settings ADD COLUMN key_system_enabled INTEGER DEFAULT 0',
  "ALTER TABLE guild_settings ADD COLUMN key_system_color TEXT DEFAULT '#d4af37'",
  "ALTER TABLE guild_settings ADD COLUMN key_system_title TEXT DEFAULT 'Karma Key System'",
  "ALTER TABLE guild_settings ADD COLUMN key_system_description TEXT DEFAULT 'Enter your license key to unlock access'",
  'ALTER TABLE licenses ADD COLUMN last_reset_at TEXT',
  'ALTER TABLE licenses ADD COLUMN reset_count INTEGER DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN display_username TEXT',
  'ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT \'free\'',
  'ALTER TABLE website_users ADD COLUMN script_quota INTEGER NOT NULL DEFAULT 5',
  'ALTER TABLE hosted_scripts ADD COLUMN source_code TEXT',
  'ALTER TABLE hosted_scripts ADD COLUMN linked_script_id TEXT',
  'ALTER TABLE hosted_scripts ADD COLUMN obfuscation_level TEXT DEFAULT \'standard\'',
  'ALTER TABLE licenses ADD COLUMN used_count INTEGER DEFAULT 0',
  'ALTER TABLE licenses ADD COLUMN user_id TEXT'
]) {
  try { db.prepare(migration).run(); } catch (_) {}
}

// ---------------- Passport Setup ----------------
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

app.use(passport.initialize());
app.use(passport.session());

// Serialize user
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user);
});

// Google OAuth Strategy
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${PUBLIC_BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
    scope: ['profile', 'email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('No email provided'), null);

      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      
      if (!user) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        db.prepare(`
          INSERT INTO users (id, email, username, display_name, avatar, provider, provider_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, profile.username || email.split('@')[0], profile.displayName, profile.photos?.[0]?.value, 'google', profile.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }

      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
}

// GitHub OAuth Strategy
if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) {
  passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: `${PUBLIC_BASE_URL || 'http://localhost:3000'}/auth/github/callback`,
    scope: ['user:email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || `${profile.username}@github.com`;
      
      let user = db.prepare('SELECT * FROM users WHERE email = ? OR provider_id = ?').get(email, profile.id);
      
      if (!user) {
        const id = `user_${crypto.randomBytes(8).toString('hex')}`;
        db.prepare(`
          INSERT INTO users (id, email, username, display_name, avatar, provider, provider_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, email, profile.username, profile.displayName || profile.username, profile.photos?.[0]?.value, 'github', profile.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }

      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
}

// ---------------- Auth Routes ----------------
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => res.redirect('/dashboard'));
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
app.get('/auth/github/callback', passport.authenticate('github', { failureRedirect: '/login' }), (req, res) => res.redirect('/dashboard'));

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    res.redirect('/');
  });
});

// ---------------- Helpers ----------------
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function makeKey(prefix = 'PS') {
  const raw = crypto.randomBytes(18).toString('base64url').toUpperCase();
  return `${prefix}-${raw.match(/.{1,6}/g).join('-')}`;
}

function makeId(prefix = 'script') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
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
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function canResetHWID(license) {
  if (!license || !license.last_reset_at) return true;
  const lastReset = new Date(license.last_reset_at).getTime();
  const cooldownMs = (parseInt(RESET_COOLDOWN_HOURS, 10) || 24) * 60 * 60 * 1000;
  return Date.now() - lastReset >= cooldownMs;
}

function getResetCooldownRemaining(license) {
  if (!license || !license.last_reset_at) return 0;
  const lastReset = new Date(license.last_reset_at).getTime();
  const cooldownMs = (parseInt(RESET_COOLDOWN_HOURS, 10) || 24) * 60 * 60 * 1000;
  return Math.max(0, cooldownMs - (Date.now() - lastReset));
}

function makeLoaderSnippet(scriptId) {
  const baseUrl = publicBaseUrl();
  return `loadstring(game:HttpGet("${baseUrl}/loadstring/${scriptId}"))("${scriptId}")`;
}

function makeProtectedLoader(rawUrl, scriptId) {
  const home = publicBaseUrl();
  
  return `--[[
    Karma Protection VM Loader v6.3
    Enhanced Anti-Tamper - Anti-Dump Hardening
]]
-- Anti-tamper checks
local function _checkEnvironment()
  local env = getfenv(0) or _G
  local checks = {
    function() return type(getfenv) == "function" end,
    function() return type(loadstring) == "function" end,
    function() return type(pcall) == "function" end,
    function() return type(error) == "function" end,
  }
  for _, check in ipairs(checks) do
    if not check() then return false end
  end
  return true
end

if not _checkEnvironment() then
  error("Karma Protection: Environment tamper detected")
end

-- Anti-dump hardening
local function _antiDump()
  local src = debug.getinfo(1).source
  if src and src:find("dump") then
    return false
  end
  return true
end

if not _antiDump() then
  return "Dumping detected - payload hidden"
end

return (function(_sid, ...)
  local _G = getfenv(0) or _G
  local _type, _pcall, _tostr, _byte, _error = type, pcall, tostring, string.byte, error
  local _load = loadstring or load
  local _warn = (typeof(warn) == "function") and warn or print
  local _setclip = (typeof(setclipboard) == "function") and setclipboard or nil
  
  local _iqru = ${JSON.stringify(home)}
  local _30lq = ${JSON.stringify(rawUrl)}
  local _r0wo = { script_id = ${JSON.stringify(scriptId)}, executed = false }
  
  -- Prevent multiple executions with same key
  local function _checkExecution()
    if _r0wo.executed then
      error("Karma Protection: Script already executed with this key")
    end
    _r0wo.executed = true
  end
  
  local function _gat3(m)
    if _setclip then _pcall(_setclip, _iqru) end
    _pcall(_warn, "[Karma VM] " .. _tostr(m) .. " | " .. _iqru)
    while true do _error(m, 0) end
  end

  local function _xm17(f, ...)
    local ok, r = _pcall(f, ...)
    return ok and r or nil
  end

  local function _r8wq(v)
    local s, n = _tostr(v), 2166136261
    for i = 1, #s do
      n = bit32.bxor(n, _byte(s, i))
      n = (n * 16777619) % 4294967296
    end
    return n
  end

  -- VM State
  local _gqej = 1
  local _bmcv = getfenv(1)
  
  -- Enhanced Instruction Stream
  local _y4m2 = {1, 2, 3, 4, 5, 7, 8, 1, 3, 6, 9, 10}
  
  local _rrw1 = {
    [1] = function() -- PULSE / TAMPER CHECK
      local _raw = { _K = "Karma Protection" }
      local _sig = { _K = 2947889846 }
      for k, v in pairs(_sig) do
        if _r8wq(_raw[k]) ~= v then _gat3("tamper detected") end
      end
    end,
    [2] = function() -- CHECK_ENV
      if typeof(getfenv) == "function" then
        local e = _xm17(getfenv, 1)
        if _type(e) == "table" then
          local s = { "hookfunction", "newcclosure", "syn", "fluxus", "dump" }
          for _, k in ipairs(s) do
            if e[k] ~= nil and rawget(_G, k) == nil then _gat3("env logger: " .. k) end
          end
        end
      end
    end,
    [3] = function() -- CHECK_HOOKS
      local c = {tostring, type, pcall, pairs, _load}
      for _, f in ipairs(c) do
        if typeof(f) ~= "function" then _gat3("hook detected") end
        if typeof(islclosure) == "function" and islclosure(f) then _gat3("hooked closure") end
      end
    end,
    [4] = function() -- CHECK_GAME
      local ok, info = _pcall(function() return game:GetService("MarketplaceService"):GetProductInfo(game.PlaceId) end)
      if ok and _type(info) == "table" and _type(info.Name) ~= "string" then _gat3("game tamper") end
    end,
    [5] = function() -- FETCH
      local function _g(u)
        if game and game.HttpGet then
          local r = _xm17(function() return game:HttpGet(u) end)
          if _type(r) == "string" and #r > 0 then return r end
        end
        local req = (typeof(syn) == "table" and syn.request) or (typeof(http_request) == "function" and http_request) or (typeof(request) == "function" and request)
        if _type(req) == "function" then
          local res = _xm17(req, { Url = u, Method = "GET" })
          if _type(res) == "table" then return res.Body or res.body end
        end
        return nil
      end
      _r0wo.src = _g(_30lq)
      if _type(_r0wo.src) ~= "string" then _gat3("fetch failed") end
    end,
    
    [7] = function() -- LOGGING
      local function _l(u, d)
        local req = (typeof(syn) == "table" and syn.request) or (typeof(http_request) == "function" and http_request) or (typeof(request) == "function" and request)
        if _type(req) == "function" then
          _pcall(req, {
            Url = u,
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = game:GetService("HttpService"):JSONEncode(d)
          })
        end
      end
      local d = {
        script_id = _r0wo.script_id or "unknown",
        key = _G.KarmaKey or "none",
        hwid = (typeof(gethwid) == "function" and gethwid()) or "none",
        executor = (typeof(identifyexecutor) == "function" and identifyexecutor()) or "unknown",
        executed = _r0wo.executed
      }
      _l(_iqru .. "/api/log-execution", d)
    end,

    [8] = function() -- SOURCE ANTI-TAMPER
      local function _sc(s)
        local c = 0
        if s then
          for i = 1, #s do
            c = (c + _byte(s, i) * i) % 4294967295
          end
        end
        return c
      end
      local src1 = debug.getinfo(1).source
      local sum1 = _sc(src1)
      if typeof(task) == "table" and task.wait then task.wait(0.1) end
      local src2 = debug.getinfo(1).source
      local sum2 = _sc(src2)
      if sum1 ~= sum2 or sum1 == 0 then
        _gat3("source tampering detected")
      end
    end,

    [9] = function() -- EXECUTION CHECK
      _checkExecution()
    end,

    [10] = function() -- FAST MODE
      if _G._FAST_MODE then
        local src = _g(_30lq)
        if src then
          return _load(src)(...)
        end
      end
    end,

    [6] = function(...) -- EXECUTE
      if _type(_load) ~= "function" then _gat3("no load") end
      local ok, f = _pcall(_load, _r0wo.src, "KarmaVM")
      if not ok or _type(f) ~= "function" then _gat3("load failed") end
      return f(...)
    end
  }

  -- Interpreter Loop
  while _gqej <= #_y4m2 do
    local _szk7 = _y4m2[_gqej]
    local _ci83 = _rrw1[_szk7]
    if _szk7 == 6 or _szk7 == 10 then
      local result = _ci83(...)
      if _szk7 == 10 and result then return result end
      if _szk7 == 6 then return result end
    else
      _ci83()
    end
    _gqej = _gqej + 1
  end
end)(...)
`;
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
  
  // Enhanced obfuscation with multiple XOR keys and Base92 encoding
  const xorKeys = [
    0x5A, 0x3C, 0xF1, 0xE7, 0x2B, 0x8D, 0x4F, 0x9C,
    0x7A, 0x1E, 0xD3, 0x6B, 0xA4, 0xC8, 0x5F, 0x2E
  ];
  
  const base92Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?/~';
  
  let obfuscated = luaCode;
  
  // Layer 1: XOR encryption
  let xorResult = '';
  for (let i = 0; i < luaCode.length; i++) {
    const key = xorKeys[i % xorKeys.length];
    xorResult += String.fromCharCode(luaCode.charCodeAt(i) ^ key);
  }
  
  // Layer 2: Base92 encoding
  let base92Result = '';
  let buffer = 0;
  let bits = 0;
  
  for (let i = 0; i < xorResult.length; i++) {
    buffer = (buffer << 8) | xorResult.charCodeAt(i);
    bits += 8;
    while (bits >= 14) {
      const index = (buffer >> (bits - 14)) & 0x3FFF;
      base92Result += base92Alphabet[index % base92Alphabet.length];
      buffer &= (1 << (bits - 14)) - 1;
      bits -= 14;
    }
  }
  
  if (bits > 0) {
    const index = buffer << (14 - bits);
    base92Result += base92Alphabet[index % base92Alphabet.length];
  }
  
  // Layer 3: Anti-tamper wrapper
  return `--[[ Karma Protection v6.3 - Enhanced Anti-Tamper ]]
local function _decrypt(data)
  local xorKeys = {${xorKeys.join(',')}}
  local base92 = "${base92Alphabet}"
  local decoded = {}
  local buffer = 0
  local bits = 0
  
  for i = 1, #data do
    local char = data:sub(i, i)
    local val = base92:find(char) - 1
    if val then
      buffer = (buffer << 14) | val
      bits = bits + 14
      while bits >= 8 do
        bits = bits - 8
        table.insert(decoded, string.char((buffer >> bits) & 0xFF))
      end
    end
  end
  
  local result = table.concat(decoded)
  local decrypted = {}
  for i = 1, #result do
    local key = xorKeys[(i - 1) % #xorKeys + 1]
    table.insert(decrypted, string.char(string.byte(result, i) ~ key))
  end
  return table.concat(decrypted)
end

local _code = [[${base92Result}]]
local _decrypted = _decrypt(_code)
local _func, _err = loadstring(_decrypted, "@KarmaVM")
if not _func then error(_err) end
return _func(...)
`;
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---------------- Website Routes ----------------
app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  
  const hasGoogle = !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET;
  const hasGithub = !!GITHUB_CLIENT_ID && !!GITHUB_CLIENT_SECRET;
  
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charSet="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Karma Protection — Lua Code Protection &amp; Licensing</title>
  <meta name="description" content="Protect and encrypt your Lua code with HWID-locked keys, custom obfuscation, and a Discord-synced panel — free for every creator."/>
  <link rel="icon" type="image/x-icon" href="/favicon.ico"/>
  <link rel="icon" type="image/png" sizes="512x512" href="/assets/karma-logo.png"/>
  <link rel="apple-touch-icon" href="/assets/karma-logo.png"/>
  <style>
    :root {
      --color-bg: #030303;
      --color-surface: rgba(15,15,16,0.85);
      --color-card: rgba(15,15,16,0.6);
      --color-border: rgba(255,255,255,0.08);
      --color-primary: #d4af37;
      --color-primary-foreground: #000;
      --color-muted: #a1a1aa;
      --color-foreground: #f8fafc;
      --color-glow: rgba(212,175,55,0.3);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--color-bg);
      color: var(--color-foreground);
      font-family: "Inter", "SF Pro Display", system-ui, sans-serif;
      min-height: 100vh;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
    a { color: inherit; text-decoration: none; }
    
    header {
      position: sticky;
      top: 0;
      z-index: 40;
      border-bottom: 1px solid var(--color-border);
      background: rgba(3,3,3,0.92);
      backdrop-filter: blur(18px);
    }
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 64px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
    }
    .brand img {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid rgba(212,175,55,0.4);
      object-fit: cover;
    }
    .brand .beta {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      border: 1px solid #2d2d32;
      border-radius: 4px;
      padding: 2px 8px;
      color: #b6b6bd;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(255,255,255,0.05);
      color: var(--color-foreground);
      cursor: pointer;
      transition: 0.2s;
    }
    .btn:hover { border-color: var(--color-primary); background: rgba(212,175,55,0.1); }
    .btn-primary {
      background: var(--color-primary);
      color: #000;
      border-color: var(--color-primary);
      box-shadow: 0 0 40px rgba(212,175,55,0.15);
    }
    .btn-primary:hover { box-shadow: 0 0 60px rgba(212,175,55,0.25); transform: translateY(-1px); }
    .btn-glow {
      background: var(--color-primary);
      color: #000;
      border: none;
      box-shadow: 0 0 40px rgba(212,175,55,0.15);
    }
    .btn-glow:hover { box-shadow: 0 0 60px rgba(212,175,55,0.25); transform: translateY(-1px); }
    .btn-outline {
      border: 1px solid var(--color-border);
      background: transparent;
    }
    .btn-outline:hover { border-color: var(--color-primary); }
    
    .hero {
      text-align: center;
      padding: 80px 0 60px;
      position: relative;
    }
    .hero .pill {
      display: inline-flex;
      gap: 10px;
      align-items: center;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(255,255,255,0.04);
      border-radius: 999px;
      padding: 6px 16px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #d4d4d8;
    }
    .hero .pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-primary);
      box-shadow: 0 0 18px var(--color-primary);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
    .hero h1 {
      font-size: clamp(48px, 8vw, 96px);
      line-height: 1.02;
      letter-spacing: -0.06em;
      margin: 24px auto 16px;
      max-width: 900px;
    }
    .hero h1 .gold { color: var(--color-primary); text-shadow: 0 0 40px var(--color-glow); }
    .hero p {
      max-width: 640px;
      margin: 0 auto;
      color: var(--color-muted);
      font-size: 15px;
      line-height: 1.8;
    }
    .hero .actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 32px;
    }
    .hero .video-wrap {
      margin: 48px auto 0;
      max-width: 860px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      overflow: hidden;
      background: linear-gradient(180deg, #111, #070707);
    }
    .hero .video-wrap .placeholder {
      aspect-ratio: 16/9;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 50% 40%, rgba(212,175,55,0.12), transparent 40%),
                  linear-gradient(135deg, #050505, #151515);
    }
    .hero .video-wrap .placeholder img {
      width: 80px;
      height: 80px;
      border-radius: 20px;
      object-fit: cover;
      opacity: 0.8;
    }
    .hero .video-wrap .caption {
      padding: 14px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: #888;
      text-align: center;
    }
    
    .section {
      border-top: 1px solid rgba(255,255,255,0.06);
      padding: 72px 0;
    }
    .section-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--color-primary);
      margin-bottom: 8px;
    }
    .section h2 {
      font-size: clamp(32px, 4vw, 56px);
      line-height: 1.05;
      letter-spacing: -0.04em;
      margin-bottom: 12px;
    }
    .section h2 .gold { color: var(--color-primary); }
    .section .sub {
      max-width: 560px;
      color: var(--color-muted);
      font-size: 14px;
      line-height: 1.7;
    }
    
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 32px;
    }
    .feature-card {
      border: 1px solid var(--color-border);
      border-radius: 20px;
      background: var(--color-card);
      padding: 24px;
      transition: 0.2s;
    }
    .feature-card:hover { border-color: rgba(212,175,55,0.4); box-shadow: 0 0 40px rgba(212,175,55,0.05); }
    .feature-card .icon { font-size: 24px; margin-bottom: 12px; }
    .feature-card h3 { font-size: 16px; margin-bottom: 6px; }
    .feature-card p { font-size: 13px; color: var(--color-muted); line-height: 1.6; }
    
    .pricing-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border: 1px solid var(--color-border);
      border-radius: 20px;
      overflow: hidden;
      background: var(--color-card);
      max-width: 900px;
      margin: 0 auto;
    }
    .pricing-plan {
      padding: 32px;
    }
    .pricing-plan + .pricing-plan {
      border-left: 1px solid var(--color-border);
      background: rgba(212,175,55,0.03);
    }
    .pricing-plan .name {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--color-muted);
    }
    .pricing-plan .price {
      font-size: 48px;
      font-weight: 900;
      letter-spacing: -0.04em;
      color: var(--color-primary);
      margin: 8px 0;
    }
    .pricing-plan .price span { font-size: 16px; color: var(--color-muted); font-weight: 400; }
    .pricing-plan ul {
      list-style: none;
      padding: 0;
      margin: 20px 0;
    }
    .pricing-plan ul li {
      padding: 6px 0;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pricing-plan ul li::before { content: "✓"; color: var(--color-primary); font-weight: 700; }
    .pricing-plan .btn { width: 100%; justify-content: center; margin-top: 12px; }
    
    .changelog-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .changelog-item {
      border: 1px solid var(--color-border);
      border-radius: 16px;
      background: var(--color-card);
      padding: 20px;
      transition: 0.2s;
    }
    .changelog-item:hover { border-color: rgba(212,175,55,0.3); }
    .changelog-item .version {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--color-primary);
    }
    .changelog-item .date {
      font-size: 10px;
      color: var(--color-muted);
      float: right;
    }
    .changelog-item h4 { font-size: 15px; margin: 8px 0 4px; }
    .changelog-item p { font-size: 12px; color: var(--color-muted); line-height: 1.6; }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      max-width: 700px;
      margin: 0 auto;
    }
    .stat-card {
      border: 1px solid var(--color-border);
      border-radius: 16px;
      background: var(--color-card);
      padding: 20px;
      text-align: center;
    }
    .stat-card .num { font-size: 32px; font-weight: 900; color: var(--color-primary); }
    .stat-card .label { font-size: 12px; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
    
    .cta-section {
      text-align: center;
      padding: 60px 0;
    }
    .cta-section h2 { font-size: clamp(32px, 4vw, 48px); margin-bottom: 12px; }
    .cta-section .sub { max-width: 500px; margin: 0 auto 24px; color: var(--color-muted); }
    
    footer {
      border-top: 1px solid var(--color-border);
      padding: 40px 0;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 12px;
      color: var(--color-muted);
    }
    footer a { color: var(--color-muted); transition: 0.2s; }
    footer a:hover { color: var(--color-primary); }
    footer .links { display: flex; gap: 20px; flex-wrap: wrap; }
    
    @media (max-width: 768px) {
      .pricing-grid { grid-template-columns: 1fr; }
      .pricing-plan + .pricing-plan { border-left: none; border-top: 1px solid var(--color-border); }
      .hero h1 { font-size: 40px; }
      .features-grid { grid-template-columns: 1fr; }
      .changelog-grid { grid-template-columns: 1fr; }
      footer { flex-direction: column; align-items: center; text-align: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container nav">
      <a class="brand" href="/">
        <img src="/assets/karma-logo.png" alt="Karma Protection"/>
        <span>Karma Protection</span>
        <span class="beta">beta</span>
      </a>
      <div style="display:flex;gap:12px;align-items:center;">
        ${hasGoogle ? `<a class="btn btn-outline" href="/auth/google">Google</a>` : ''}
        ${hasGithub ? `<a class="btn btn-outline" href="/auth/github">GitHub</a>` : ''}
        <a class="btn btn-glow" href="/login">Sign In</a>
      </div>
    </div>
  </header>
  
  <main>
    <section class="hero">
      <div class="container">
        <a class="pill" href="#features">
          <span class="pulse"></span>
          The gold standard for Lua security
        </a>
        <h1>Protect. <span class="gold">Monetize.</span> Earn.</h1>
        <p>Drop your project, get a secure build, and monetize with confidence. HWID-lock, whitelist keys, obfuscate, and ship straight from Discord.</p>
        <div class="actions">
          <a class="btn btn-glow" href="/dashboard">Enter the lab →</a>
          <a class="btn btn-outline" href="#features">Explore features</a>
        </div>
        <div class="video-wrap">
          <div class="placeholder">
            <img src="/assets/karma-logo.png" alt="Karma Protection"/>
          </div>
          <div class="caption">Create a protected script in seconds.</div>
        </div>
      </div>
    </section>
    
    <section id="features" class="section">
      <div class="container">
        <div class="section-label">Features</div>
        <h2>Everything you need to <span class="gold">ship and protect.</span></h2>
        <p class="sub">Multi-layer VM with bytecode compression, HWID-locked keys, and a Discord-synced panel.</p>
        <div class="features-grid">
          <div class="feature-card">
            <div class="icon">⚙️</div>
            <h3>Custom Obfuscator</h3>
            <p>Multi-layer VM with bytecode compression, super-ops and dual-VM dispatch tuned in-house.</p>
          </div>
          <div class="feature-card">
            <div class="icon">🔑</div>
            <h3>Whitelist System</h3>
            <p>Hand out keys, let clients self-redeem, revoke or extend access in one click.</p>
          </div>
          <div class="feature-card">
            <div class="icon">🤖</div>
            <h3>Discord Bot</h3>
            <p>Multiple powerful commands to make management easier that we know you will love.</p>
          </div>
          <div class="feature-card">
            <div class="icon">📊</div>
            <h3>Dashboard</h3>
            <p>Scripts, keys, audit logs and live status — one place.</p>
          </div>
          <div class="feature-card">
            <div class="icon">🖥️</div>
            <h3>HWID Tracker</h3>
            <p>Lock each key to a single device on first run. Reset anytime with cooldown.</p>
          </div>
          <div class="feature-card">
            <div class="icon">📦</div>
            <h3>Protected Loadstrings</h3>
            <p>Served through a protected loader route so the raw endpoint is not exposed.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section id="changelog" class="section">
      <div class="container">
        <div class="section-label">Latest builds</div>
        <h2>Shipping <span class="gold">every week.</span></h2>
        <p class="sub">Recent protections and platform improvements.</p>
        <div class="changelog-grid">
          <div class="changelog-item">
            <span class="version">v6.3.005</span>
            <span class="date">2026-07-13</span>
            <h4>Enhanced Anti-Tamper System</h4>
            <p>Added multi-layer XOR encryption, Base92 encoding, and runtime integrity checks.</p>
          </div>
          <div class="changelog-item">
            <span class="version">v6.3.004</span>
            <span class="date">2026-07-12</span>
            <h4>Key System GUI Customizer</h4>
            <p>Introduced custom key system templates with color, title, and description customization.</p>
          </div>
          <div class="changelog-item">
            <span class="version">v6.3.003</span>
            <span class="date">2026-07-11</span>
            <h4>Anti-Dump Hardening</h4>
            <p>Loader now detects dumping tools mid-run and refuses to hand anything over.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="section">
      <div class="container">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="num">—</div>
            <div class="label">Creators Onboarded</div>
          </div>
          <div class="stat-card">
            <div class="num">—</div>
            <div class="label">Scripts Protected</div>
          </div>
          <div class="stat-card">
            <div class="num">—</div>
            <div class="label">Keys Issued</div>
          </div>
        </div>
      </div>
    </section>
    
    <section id="pricing" class="section">
      <div class="container">
        <div style="text-align:center;margin-bottom:32px;">
          <div class="section-label">Pricing</div>
          <h2>Simple plans. <span class="gold">Real protection.</span></h2>
          <p class="sub" style="margin:0 auto;">Start free. Upgrade when you need unlimited firepower.</p>
        </div>
        <div class="pricing-grid">
          <div class="pricing-plan">
            <div class="name">Citizen</div>
            <div class="price">$0 <span>forever</span></div>
            <ul>
              <li>Discord bot + panel deploy</li>
              <li>Whitelist keys</li>
              <li>Standard obfuscation</li>
              <li>20 obfuscations / week</li>
            </ul>
            <a class="btn btn-outline" href="/login">Get Started Free</a>
          </div>
          <div class="pricing-plan">
            <div class="name">Royal</div>
            <div class="price">$3 <span>month</span></div>
            <ul>
              <li>Everything in Citizen</li>
              <li>Unlimited obfuscations</li>
              <li>Maximum &amp; VM protection</li>
              <li>Priority queue on builds</li>
            </ul>
            <a class="btn btn-glow" href="/login">Upgrade to Royal</a>
          </div>
        </div>
      </div>
    </section>
    
    <section class="cta-section">
      <div class="container">
        <h2>Ready to <span class="gold">take back</span> control?</h2>
        <p class="sub">Sign in with Discord, upload your first script, and ship in minutes.</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          <a class="btn btn-glow" href="/login">Sign in →</a>
          <a class="btn btn-outline" href="${DISCORD_INVITE_URL}">Join Discord</a>
        </div>
      </div>
    </section>
  </main>
  
  <footer>
    <div class="container" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;width:100%;">
      <span>© Karma Protection</span>
      <div class="links">
        <a href="/changelog">Changelog</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="${DISCORD_INVITE_URL}">Discord</a>
      </div>
      <span class="gold">Protect, Monetize, Earn</span>
    </div>
  </footer>
</body>
</html>`);
});

// ---------------- Dashboard Route ----------------
app.get('/dashboard', requireAuth, (req, res) => {
  const user = req.user;
  const tab = req.query.tab || 'overview';
  
  // Get stats
  const totalScripts = db.prepare('SELECT COUNT(*) as c FROM hosted_scripts WHERE created_by = ?').get(user.id)?.c || 0;
  const totalKeys = db.prepare('SELECT COUNT(*) as c FROM licenses WHERE created_by = ?').get(user.id)?.c || 0;
  const quota = user.script_quota || MAX_WEB_SCRIPTS_PER_USER;
  
  const scripts = db.prepare('SELECT * FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC LIMIT 500').all(user.id);
  
  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${req.query.script === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? '🔒 Obfuscated' : '📄 Plain'}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  
  if (tab === 'overview') {
    content = `
      <div class="card">
        <h2>Welcome, ${escapeHtml(user.display_name || user.username)}</h2>
        <p class="muted">Manage your scripts, keys, and obfuscation from one place.</p>
        <div class="stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px;">
          <div class="stat"><div class="num">${totalScripts}</div><span>Scripts</span></div>
          <div class="stat"><div class="num">${totalKeys}</div><span>Keys</span></div>
          <div class="stat"><div class="num">${Math.max(0, quota - totalScripts)}</div><span>Slots Left</span></div>
        </div>
        <div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;">
          <a class="btn btn-glow" href="/dashboard?tab=scripts">Manage Scripts</a>
          <a class="btn btn-outline" href="/dashboard?tab=keys">Manage Keys</a>
        </div>
      </div>
    `;
  } else if (tab === 'scripts') {
    const selectedId = String(req.query.script || '');
    const selected = selectedId ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(selectedId, user.id) : (scripts[0] || null);
    
    content = `
      <div class="card">
        <h2>Your Scripts</h2>
        <p class="muted">${scripts.length} scripts stored. Click a script to view or edit.</p>
        ${scriptLinks}
      </div>
      ${selected ? `
        <div class="card">
          <h2>${escapeHtml(selected.name)}</h2>
          <p class="muted">${selected.obfuscated ? '🔒 Obfuscated' : '📄 Plain'} · Level: ${escapeHtml(selected.obfuscation_level || 'standard')}</p>
          <h3>Loadstring</h3>
          <code class="block">${makeLoaderSnippet(selected.id)}</code>
          <h3>Edit Script</h3>
          <form method="post" action="/dashboard/scripts/${selected.id}/update">
            <label>Script name</label>
            <input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required>
            <label>Source Code</label>
            <textarea name="code" maxlength="4000" required>${escapeHtml(selected.source_code || selected.code)}</textarea>
            <label class="check"><input type="checkbox" name="obfuscate" value="true" ${selected.obfuscated ? 'checked' : ''}> Obfuscate on save</label>
            <label>Obfuscation level</label>
            <select name="level">
              <option value="light">Light</option>
              <option value="standard" ${selected.obfuscated && selected.obfuscation_level === 'standard' ? 'selected' : ''}>Standard</option>
              <option value="max" ${selected.obfuscated && selected.obfuscation_level === 'max' ? 'selected' : ''}>Maximum</option>
              <option value="vm" ${selected.obfuscated && selected.obfuscation_level === 'vm' ? 'selected' : ''}>VM Protected</option>
            </select>
            <button type="submit">💾 Save Script</button>
          </form>
          <div style="margin-top:12px;">
            <a class="btn btn-outline" href="/dashboard/scripts/${selected.id}/reset-hwid">🔄 Reset HWID for this script</a>
          </div>
        </div>
      ` : `<div class="card"><h2>No script selected</h2><p class="muted">Create a new script below.</p></div>`}
      <div class="card">
        <h2>Upload New Script</h2>
        <form method="post" action="/dashboard/scripts" enctype="multipart/form-data">
          <label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required>
          <label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain">
          <label>Source Code</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea>
          <label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label>
          <label>Obfuscation level</label>
          <select name="level">
            <option value="light">Light</option>
            <option value="standard" selected>Standard</option>
            <option value="max">Maximum</option>
            <option value="vm">VM Protected</option>
          </select>
          <button type="submit">📤 Save Script</button>
        </form>
      </div>
    `;
  } else if (tab === 'keys') {
    const keys = db.prepare('SELECT * FROM licenses WHERE created_by = ? ORDER BY created_at DESC LIMIT 50').all(user.id);
    
    content = `
      <div class="card">
        <h2>License Keys</h2>
        <p class="muted">${keys.length} keys generated.</p>
        <form method="post" action="/dashboard/keys">
          <label>Script ID</label><input name="script_id" placeholder="script_xxxxxxxx">
          <label>Days until expiry (0 = lifetime)</label><input name="days" type="number" value="30" min="0" max="3650">
          <label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20">
          <button type="submit">🔑 Generate Keys</button>
        </form>
        <h3>Recent Keys</h3>
        ${keys.map(k => `<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${k.expires_at || 'Lifetime'} · ${k.revoked ? '🚫 Revoked' : '✅ Active'}${k.hwid ? ' · 🔒 HWID locked' : ''}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}
      </div>
    `;
  }

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Karma Protection — Dashboard</title>
  <style>
    :root {
      --color-bg: #030303;
      --color-surface: rgba(15,15,16,0.85);
      --color-card: rgba(15,15,16,0.6);
      --color-border: rgba(255,255,255,0.08);
      --color-primary: #d4af37;
      --color-muted: #a1a1aa;
      --color-foreground: #f8fafc;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--color-bg);
      color: var(--color-foreground);
      font-family: "Inter", system-ui, sans-serif;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
    a { color: inherit; text-decoration: none; }
    
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--color-border);
      background: rgba(3,3,3,0.92);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
    }
    .topbar .brand img { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(212,175,55,0.4); }
    .topbar .user-info { display: flex; align-items: center; gap: 12px; }
    .topbar .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--color-primary); }
    
    .dashboard {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 0;
      min-height: calc(100vh - 64px);
    }
    .sidebar {
      background: rgba(8,8,8,0.95);
      border-right: 1px solid var(--color-border);
      padding: 20px 12px;
    }
    .sidebar .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      color: #a1a1aa;
      font-weight: 600;
      font-size: 14px;
      transition: 0.15s;
      margin-bottom: 2px;
    }
    .sidebar .nav-link:hover { background: rgba(255,255,255,0.05); color: #fff; }
    .sidebar .nav-link.active { background: rgba(212,175,55,0.12); color: var(--color-primary); }
    .sidebar .nav-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #666;
      padding: 12px 14px 6px;
      font-weight: 700;
    }
    
    .main-content { padding: 24px 32px; }
    
    .card {
      border: 1px solid var(--color-border);
      border-radius: 16px;
      background: var(--color-surface);
      padding: 24px;
      margin-bottom: 16px;
    }
    .card h2 { font-size: 24px; margin-bottom: 4px; }
    .card h3 { font-size: 16px; margin: 16px 0 8px; }
    .muted { color: var(--color-muted); }
    
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .stat { border: 1px solid var(--color-border); border-radius: 12px; background: rgba(255,255,255,0.03); padding: 16px; text-align: center; }
    .stat .num { font-size: 32px; font-weight: 900; color: var(--color-primary); }
    .stat span { display: block; font-size: 13px; color: var(--color-muted); margin-top: 4px; }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(255,255,255,0.05);
      color: var(--color-foreground);
      cursor: pointer;
      transition: 0.2s;
    }
    .btn:hover { border-color: var(--color-primary); background: rgba(212,175,55,0.1); }
    .btn-glow { background: var(--color-primary); color: #000; border: none; box-shadow: 0 0 30px rgba(212,175,55,0.15); }
    .btn-glow:hover { box-shadow: 0 0 50px rgba(212,175,55,0.25); transform: translateY(-1px); }
    .btn-outline { border: 1px solid var(--color-border); background: transparent; }
    .btn-outline:hover { border-color: var(--color-primary); }
    
    input, textarea, select {
      width: 100%;
      background: rgba(8,8,9,0.9);
      color: #fff;
      border: 1px solid #343438;
      border-radius: 8px;
      padding: 10px 14px;
      margin: 6px 0 12px;
      font: inherit;
    }
    textarea { min-height: 120px; font-family: monospace; }
    .check { display: flex; gap: 10px; align-items: center; }
    .check input { width: auto; }
    .block {
      display: block;
      white-space: pre-wrap;
      word-break: break-all;
      padding: 12px;
      margin: 8px 0;
      background: rgba(8,8,9,0.9);
      border: 1px solid #343438;
      border-radius: 8px;
      font-family: monospace;
      font-size: 13px;
    }
    .row {
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px 14px;
      margin: 6px 0;
      background: rgba(11,11,12,0.6);
    }
    .scriptLink {
      display: block;
      border: 1px solid var(--color-border);
      background: rgba(14,14,14,0.8);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 8px;
      transition: 0.15s;
    }
    .scriptLink:hover { border-color: rgba(255,255,255,0.18); }
    .scriptLink.active { border-color: var(--color-primary); background: rgba(212,175,55,0.08); }
    .scriptLink b { display: block; font-size: 15px; }
    .scriptLink small { font-size: 12px; color: var(--color-muted); }
    
    @media (max-width: 768px) {
      .dashboard { grid-template-columns: 1fr; }
      .sidebar { display: none; position: fixed; inset: 0; z-index: 100; height: 100vh; width: 260px; background: rgba(8,8,8,0.98); }
      .sidebar.open { display: block; }
      .main-content { padding: 16px; }
      .stats { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <img src="/assets/karma-logo.png" alt="Karma Protection"/>
      <span>Karma v6.3</span>
    </div>
    <div class="user-info">
      <img class="avatar" src="${escapeHtml(user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.display_name || user.username))}" alt="Avatar"/>
      <span style="font-weight:600;font-size:14px;">${escapeHtml(user.display_name || user.username)}</span>
      <button class="btn btn-outline" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
      <a class="btn btn-outline" href="/logout">Sign Out</a>
    </div>
  </header>
  
  <div class="dashboard">
    <aside class="sidebar" id="sidebar">
      <div class="nav-label">Navigation</div>
      <a class="nav-link ${tab === 'overview' ? 'active' : ''}" href="/dashboard?tab=overview">📊 Overview</a>
      <a class="nav-link ${tab === 'scripts' ? 'active' : ''}" href="/dashboard?tab=scripts">📄 Scripts</a>
      <a class="nav-link ${tab === 'keys' ? 'active' : ''}" href="/dashboard?tab=keys">🔑 Keys</a>
    </aside>
    
    <main class="main-content">
      ${content}
    </main>
  </div>
  
  <script>
    document.getElementById('fileInput')?.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const nameInput = document.querySelector('input[name="name"]');
      if (nameInput && !nameInput.value) {
        nameInput.value = f.name.replace(/\\.(lua|txt)$/i, '');
      }
      const codeBox = document.getElementById('codeBox');
      if (codeBox) codeBox.value = await f.text();
    });
  </script>
</body>
</html>`);
});

// ---------------- API Routes ----------------
app.post('/dashboard/scripts', async (req, res) => {
  const user = req.user;
  const name = String(req.body.name || '').trim().slice(0, 80);
  const code = String(req.body.code || '').slice(0, 4000);
  const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
  const level = String(req.body.level || 'standard');
  if (!name || !code) return res.status(400).send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

  const count = db.prepare('SELECT COUNT(*) as c FROM hosted_scripts WHERE created_by = ?').get(user.id).c;
  const quota = user.script_quota || MAX_WEB_SCRIPTS_PER_USER;
  if (count >= quota) {
    return res.status(403).send(`<h1>Script limit reached</h1><p>You have ${quota} scripts. Upgrade your plan for more.</p><a href="/dashboard?tab=scripts">Back</a>`);
  }

  let finalCode = code;
  if (shouldObfuscate) {
    try {
      finalCode = await callObfuscator(code, level);
    } catch (error) {
      return res.status(500).send(`<h1>Obfuscation failed</h1><p>${escapeHtml(error.message)}</p><a href="/dashboard?tab=scripts">Back</a>`);
    }
  }

  const id = makeId('host');
  db.prepare(`
    INSERT INTO hosted_scripts (id, name, code, source_code, obfuscated, obfuscation_level, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, finalCode, code, shouldObfuscate ? 1 : 0, shouldObfuscate ? level : null, user.id);

  res.redirect('/dashboard?tab=scripts');
});

app.post('/dashboard/scripts/:id/update', async (req, res) => {
  const user = req.user;
  const current = db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(req.params.id, user.id);
  if (!current) return res.status(404).send('<h1>Script not found</h1><a href="/dashboard?tab=scripts">Back</a>');

  const name = String(req.body.name || current.name).trim().slice(0, 80);
  const source = String(req.body.code || '').slice(0, 4000);
  const level = String(req.body.level || 'standard');
  const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
  if (!name || !source) return res.status(400).send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

  let finalCode = source;
  if (shouldObfuscate) {
    try {
      finalCode = await callObfuscator(source, level);
    } catch (error) {
      return res.status(500).send(`<h1>Obfuscation failed</h1><p>${escapeHtml(error.message)}</p><a href="/dashboard?tab=scripts">Back</a>`);
    }
  }

  db.prepare('UPDATE hosted_scripts SET name = ?, code = ?, source_code = ?, obfuscated = ?, obfuscation_level = ? WHERE id = ?')
    .run(name, finalCode, source, shouldObfuscate ? 1 : 0, shouldObfuscate ? level : null, req.params.id);
  res.redirect(`/dashboard?tab=scripts&script=${encodeURIComponent(req.params.id)}`);
});

app.post('/dashboard/scripts/:id/reset-hwid', (req, res) => {
  const user = req.user;
  const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(req.params.id, user.id);
  if (!script) return res.status(404).send('<h1>Script not found</h1>');
  
  db.prepare('UPDATE licenses SET hwid = NULL, last_reset_at = CURRENT_TIMESTAMP WHERE script_id = ? AND created_by = ?')
    .run(req.params.id, user.id);
  
  res.redirect(`/dashboard?tab=scripts&script=${encodeURIComponent(req.params.id)}`);
});

app.post('/dashboard/keys', (req, res) => {
  const user = req.user;
  const scriptId = String(req.body.script_id || '').trim();
  const days = Math.max(0, Math.min(3650, Number(req.body.days || 0)));
  const quantity = Math.max(1, Math.min(20, Number(req.body.quantity || 1)));
  
  let script = db.prepare('SELECT * FROM scripts WHERE id = ? AND created_by = ?').get(scriptId, user.id);
  if (!script) {
    const name = `Project_${Date.now().toString(36)}`;
    const apiSecret = `ps_${crypto.randomBytes(32).toString('base64url')}`;
    db.prepare('INSERT INTO scripts (id, name, api_secret_hash, api_secret_preview, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(scriptId, name, hashSecret(apiSecret), `${apiSecret.slice(0, 8)}...${apiSecret.slice(-6)}`, user.id);
    script = db.prepare('SELECT * FROM scripts WHERE id = ? AND created_by = ?').get(scriptId, user.id);
  }

  const expiresAt = addDays(days);
  const insert = db.prepare('INSERT INTO licenses (license_key, script_id, expires_at, created_by) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < quantity; i++) {
    const key = makeKey('KS');
    insert.run(key, scriptId, expiresAt, user.id);
  }
  res.redirect('/dashboard?tab=keys');
});

// ---------------- Loader Routes ----------------
app.get('/script/:id.lua', (req, res) => {
  const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(script.code);
});

app.get('/loadstring/:id', (req, res) => {
  const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
  if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
  const rawUrl = `${publicBaseUrl()}/script/${script.id}.lua`;
  res.setHeader('Cache-Control', 'no-store');
  return res.type('text/plain').send(makeProtectedLoader(rawUrl, script.id));
});

// ---------------- API Routes ----------------
app.get('/api/stats', (req, res) => {
  const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
  const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  res.json({ scripts: scriptCount, keys: keyCount });
});

app.post('/api/log-execution', (req, res) => {
  const { script_id, key, hwid, executor } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  if (script_id) {
    if (key) {
      db.prepare('UPDATE licenses SET used_count = COALESCE(used_count, 0) + 1 WHERE license_key = ?').run(key);
    }
    db.prepare('INSERT INTO execution_logs (script_id, license_key, hwid, ip, executor) VALUES (?, ?, ?, ?, ?)')
      .run(script_id, key || null, hwid || null, ip || null, executor || null);
  }
  return res.json({ ok: true });
});

app.post('/api/verify', (req, res) => {
  const { script_id, key, hwid } = req.body || {};
  const apiSecret = req.header('X-API-Secret');

  if (!script_id || !key || !hwid || !apiSecret) {
    return res.status(400).json({ ok: false, message: 'Missing required fields' });
  }

  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND script_id = ?').get(key, script_id);
  if (!license) return res.status(404).json({ ok: false, message: 'Invalid key' });
  if (license.revoked) return res.status(403).json({ ok: false, message: 'Key revoked' });
  if (isExpired(license.expires_at)) return res.status(403).json({ ok: false, message: 'Key expired' });
  if (license.used_count > 0 && !license.hwid) {
    return res.status(403).json({ ok: false, message: 'Key already used' });
  }

  const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(String(hwid));
  if (banned) {
    return res.status(403).json({ ok: false, message: 'HWID banned', reason: banned.reason || 'No reason provided' });
  }

  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(script_id);
  if (!script || script.api_secret_hash !== hashSecret(apiSecret)) {
    return res.status(401).json({ ok: false, message: 'Invalid script or API secret' });
  }

  if (license.hwid && license.hwid !== hwid) {
    return res.status(403).json({ ok: false, message: 'HWID mismatch' });
  }

  if (!license.hwid) {
    db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);
  }

  db.prepare('UPDATE licenses SET used_count = COALESCE(used_count, 0) + 1 WHERE license_key = ?').run(key);

  return res.json({
    ok: true,
    message: 'License verified',
    discord_user_id: license.discord_user_id,
    expires_at: license.expires_at,
    script_id
  });
});

// ---------------- Start Server ----------------
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Karma Protection v6.3 running on port ${port}`);
  console.log(`Dashboard: http://localhost:${port}/dashboard`);
});
