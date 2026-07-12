// server.js
// Complete Karma Protection Discord Bot with Credits System, Supabase Sync, and Enhanced Obfuscation

require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
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
  PUBLIC_BASE_URL,
  OBFUSCATOR_API_URL = 'https://leakd-detector.up.railway.app',
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
  CREDIT_COST_PER_SCRIPT = '5'
} = process.env;

const OAUTH_CLIENT_ID = DISCORD_OAUTH_CLIENT_ID || CLIENT_ID || '1525736430813450342';
const SESSION_SIGNING_SECRET = SESSION_SECRET || DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = parseInt(MAX_SCRIPTS_PER_USER, 10) || 5;
const CREDIT_COST = parseInt(CREDIT_COST_PER_SCRIPT, 10) || 5;
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
  key_system_color TEXT DEFAULT '#5865F2',
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
  hwid TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TEXT,
  last_reset_at TEXT,
  reset_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosted_scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  source_code TEXT,
  linked_script_id TEXT,
  obfuscated INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TEXT
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

CREATE TABLE IF NOT EXISTS website_users (
  id TEXT PRIMARY KEY,
  username TEXT,
  global_name TEXT,
  avatar TEXT,
  display_username TEXT,
  twofa_enabled INTEGER NOT NULL DEFAULT 0,
  twofa_secret TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  script_quota INTEGER NOT NULL DEFAULT 5,
  credits INTEGER NOT NULL DEFAULT 5,
  first_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE INDEX IF NOT EXISTS idx_scripts_guild ON scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_licenses_script ON licenses(script_id);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_guild ON hosted_scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_user ON hosted_scripts(created_by);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_linked ON hosted_scripts(linked_script_id);
CREATE INDEX IF NOT EXISTS idx_premium_codes_redeemed_by ON premium_codes(redeemed_by);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
`);

// Migrations
for (const migration of [
  'ALTER TABLE guild_settings ADD COLUMN panel_title TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_description TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_script_id TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_hash TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_preview TEXT',
  'ALTER TABLE guild_settings ADD COLUMN key_system_enabled INTEGER DEFAULT 0',
  "ALTER TABLE guild_settings ADD COLUMN key_system_color TEXT DEFAULT '#5865F2'",
  "ALTER TABLE guild_settings ADD COLUMN key_system_title TEXT DEFAULT 'Karma Key System'",
  "ALTER TABLE guild_settings ADD COLUMN key_system_description TEXT DEFAULT 'Enter your license key to unlock access'",
  'ALTER TABLE licenses ADD COLUMN last_reset_at TEXT',
  'ALTER TABLE licenses ADD COLUMN reset_count INTEGER DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN display_username TEXT',
  'ALTER TABLE website_users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN twofa_secret TEXT',
  "ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
  "ALTER TABLE website_users ADD COLUMN script_quota INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE website_users ADD COLUMN credits INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE hosted_scripts ADD COLUMN source_code TEXT",
  "ALTER TABLE hosted_scripts ADD COLUMN linked_script_id TEXT",
  "ALTER TABLE hosted_scripts ADD COLUMN synced_at TEXT"
]) {
  try { db.prepare(migration).run(); } catch (_) {}
}

// ---------------- Helper Functions ----------------
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

function getSettings(guildId) {
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

function upsertSettings(guildId, patch) {
  const current = getSettings(guildId) || {};
  const next = { ...current, ...patch };

  db.prepare(`
    INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, panel_title, panel_description, panel_script_id, api_key_hash, api_key_preview, key_system_enabled, key_system_color, key_system_title, key_system_description, updated_at)
    VALUES (@guild_id, @admin_role_id, @customer_role_id, @log_channel_id, @panel_channel_id, @panel_message_id, @panel_title, @panel_description, @panel_script_id, @api_key_hash, @api_key_preview, @key_system_enabled, @key_system_color, @key_system_title, @key_system_description, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      customer_role_id=excluded.customer_role_id,
      log_channel_id=excluded.log_channel_id,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      panel_title=excluded.panel_title,
      panel_description=excluded.panel_description,
      panel_script_id=excluded.panel_script_id,
      api_key_hash=excluded.api_key_hash,
      api_key_preview=excluded.api_key_preview,
      key_system_enabled=excluded.key_system_enabled,
      key_system_color=excluded.key_system_color,
      key_system_title=excluded.key_system_title,
      key_system_description=excluded.key_system_description,
      updated_at=CURRENT_TIMESTAMP
  `).run({
    guild_id: guildId,
    admin_role_id: next.admin_role_id || null,
    customer_role_id: next.customer_role_id || null,
    log_channel_id: next.log_channel_id || null,
    panel_channel_id: next.panel_channel_id || null,
    panel_message_id: next.panel_message_id || null,
    panel_title: next.panel_title || null,
    panel_description: next.panel_description || null,
    panel_script_id: next.panel_script_id || null,
    api_key_hash: next.api_key_hash || null,
    api_key_preview: next.api_key_preview || null,
    key_system_enabled: next.key_system_enabled || 0,
    key_system_color: next.key_system_color || '#5865F2',
    key_system_title: next.key_system_title || 'Karma Key System',
    key_system_description: next.key_system_description || 'Enter your license key to unlock access'
  });
}

function createScript({ guildId, name, createdBy }) {
  const id = makeId('script');
  const apiSecret = `ps_${crypto.randomBytes(32).toString('base64url')}`;

  db.prepare(`
    INSERT INTO scripts (id, guild_id, name, api_secret_hash, api_secret_preview, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, guildId, name, hashSecret(apiSecret), `${apiSecret.slice(0, 8)}...${apiSecret.slice(-6)}`, createdBy);

  return { id, name, apiSecret };
}

function getCredits(userId) {
  const row = db.prepare('SELECT credits FROM website_users WHERE id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO website_users (id, credits) VALUES (?, ?)').run(userId, 5);
    return 5;
  }
  return row.credits || 0;
}

function addCredits(userId, amount, reason) {
  const current = getCredits(userId);
  const newBalance = current + amount;
  db.prepare('UPDATE website_users SET credits = ? WHERE id = ?').run(newBalance, userId);
  db.prepare('INSERT INTO credit_transactions (id, user_id, amount, reason) VALUES (?, ?, ?, ?)')
    .run(makeId('tx'), userId, amount, reason || 'Admin adjustment');
  return newBalance;
}

function spendCredits(userId, amount, reason) {
  const current = getCredits(userId);
  if (current < amount) return false;
  const newBalance = current - amount;
  db.prepare('UPDATE website_users SET credits = ? WHERE id = ?').run(newBalance, userId);
  db.prepare('INSERT INTO credit_transactions (id, user_id, amount, reason) VALUES (?, ?, ?, ?)')
    .run(makeId('tx'), userId, -amount, reason || 'Script creation');
  return true;
}

function createHostedScript({ guildId, name, code, sourceCode, linkedScriptId, obfuscated, createdBy }) {
  let id = makeId('host');
  const existing = linkedScriptId
    ? db.prepare('SELECT * FROM hosted_scripts WHERE guild_id = ? AND linked_script_id = ?').get(guildId, linkedScriptId)
    : null;

  if (existing) {
    id = existing.id;
    db.prepare(`
      UPDATE hosted_scripts
      SET name = ?, code = ?, source_code = ?, linked_script_id = ?, obfuscated = ?, created_by = ?, synced_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, code, sourceCode || code, linkedScriptId || null, obfuscated ? 1 : 0, createdBy, id);
  } else {
    db.prepare(`
      INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, obfuscated, created_by, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, guildId, name, code, sourceCode || code, linkedScriptId || null, obfuscated ? 1 : 0, createdBy);
  }

  const script = { id, guild_id: guildId, name, code, source_code: sourceCode || code, linked_script_id: linkedScriptId || null, obfuscated: Boolean(obfuscated), created_by: createdBy };
  saveHostedScriptToSupabase(script).catch(err => console.warn('Supabase save failed:', err.message));
  return { id, name, code, source_code: sourceCode || code, linked_script_id: linkedScriptId || null, obfuscated: Boolean(obfuscated) };
}

function supabaseConfig() {
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !key) return null;
  return { url: SUPABASE_URL.replace(/\/$/, ''), key };
}

async function saveHostedScriptToSupabase(script) {
  const cfg = supabaseConfig();
  if (!cfg) return;
  const row = {
    id: script.id,
    guild_id: script.guild_id,
    name: script.name,
    code: script.code,
    source_code: script.source_code || script.code,
    linked_script_id: script.linked_script_id || null,
    obfuscated: script.obfuscated ? 1 : 0,
    created_by: script.created_by,
    synced_at: new Date().toISOString()
  };
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.url}/rest/v1/hosted_scripts?id=eq.${encodeURIComponent(script.id)}`, {
        method: 'PATCH',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row)
      });
      if (res.status === 204) return;
      const insert = await fetch(`${cfg.url}/rest/v1/hosted_scripts`, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
      });
      if (insert.ok || insert.status === 201) return;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    } catch (_) {}
  }
}

async function hydrateHostedScriptsFromSupabase() {
  const cfg = supabaseConfig();
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/rest/v1/hosted_scripts?select=*`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  const stmt = db.prepare(`
    INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, obfuscated, created_by, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      guild_id=excluded.guild_id,
      name=excluded.name,
      code=excluded.code,
      source_code=excluded.source_code,
      linked_script_id=excluded.linked_script_id,
      obfuscated=excluded.obfuscated,
      created_by=excluded.created_by,
      synced_at=excluded.synced_at
  `);
  for (const r of rows) {
    stmt.run(r.id, r.guild_id || 'web', r.name || r.id, r.code || '', r.source_code || r.code || '', r.linked_script_id || null, r.obfuscated ? 1 : 0, r.created_by || 'unknown', r.synced_at || new Date().toISOString());
  }
  console.log(`Hydrated ${rows.length} hosted scripts from Supabase.`);
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  const baseUrl = publicBaseUrl();
  return `getgenv().SCRIPT_KEY = "KEYLESS" loadstring(game:HttpGet("${baseUrl}/api/v1/luascripts/public/${scriptId}/download"))()`;
}

function kers0neLocalObfuscate(luaCode, opts = {}) {
  const source = String(luaCode || '');
  const strength = Math.max(1, Math.min(3, Number(opts.strength || 2)));
  const bytes = Buffer.from(source, 'utf8');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%';
  const keyCount = strength === 3 ? 48 : strength === 2 ? 32 : 16;
  const keys = Array.from(crypto.randomBytes(keyCount));
  const seedA = crypto.randomBytes(1)[0] || 173;
  const seedB = crypto.randomBytes(1)[0] || 91;
  const seedC = crypto.randomBytes(1)[0] || 47;
  const home = publicBaseUrl();

  let prev = seedB;
  const encrypted = Array.from(bytes, (byte, index) => {
    const i = index + 1;
    const k1 = keys[(i - 1) % keys.length];
    const k2 = keys[(i * 7 + seedA) % keys.length];
    const rolling = (seedA + i * 17 + (i % 11) * seedB + prev + seedC + k2) & 255;
    let enc = byte ^ k1 ^ rolling;
    enc = (enc + ((i * 13 + seedC) & 255)) & 255;
    prev = (enc + k1 + seedB + i) & 255;
    return enc;
  });

  let packed = '';
  for (const b of encrypted) {
    packed += alphabet[Math.floor(b / 66)] + alphabet[b % 66];
  }
  let keyPacked = '';
  for (const b of keys) {
    keyPacked += alphabet[Math.floor(b / 66)] + alphabet[b % 66];
  }

  const checksum = bytes.reduce((a, b, i) => (a + ((b + 1) * ((i % 251) + 1))) % 2147483647, 7);
  const decoy = `print(${JSON.stringify('Karma Protection: decoy payload')})`;
  let decoyPacked = '';
  for (const b of Buffer.from(decoy, 'utf8')) {
    const e = b ^ seedC;
    decoyPacked += alphabet[Math.floor(e / 66)] + alphabet[e % 66];
  }

  const names = Array.from({ length: 26 }, () => `_${crypto.randomBytes(3).toString('hex')}`);
  const [nAlphabet,nPayload,nKeys,nDecoy,nChar,nByte,nSub,nFind,nConcat,nLoad,nPcall,nType,nBxor,nBand,nFloor,nOut,nPrev,nSeedA,nSeedB,nSeedC,nChk,nHome,nTamper,nDecode,nWipe,nLen] = names;

  // VM Protection Check
  const vmCheck = `
local function _vmCheck()
  local _env = getfenv and getfenv() or _ENV
  if not _env or type(_env) ~= "table" then return false end
  local _checks = {"debug","getfenv","setfenv","loadstring","pcall"}
  for _, _name in ipairs(_checks) do
    if type(_env[_name]) ~= "function" then return false end
  end
  return true
end
if not _vmCheck() then return nil end
`;

  return `--[[
\tProtected By Karma Obfuscator
\tKarma Protection Anti-Tamper: Base66 Multi-XOR
]]

return(function(...)
  ${vmCheck}
  local ${nAlphabet}=${JSON.stringify(alphabet)}
  local ${nPayload}=[=[${packed}]=]
  local ${nKeys}=[=[${keyPacked}]=]
  local ${nDecoy}=[=[${decoyPacked}]=]
  local ${nChar}=string.char
  local ${nByte}=string.byte
  local ${nSub}=string.sub
  local ${nFind}=string.find
  local ${nConcat}=table.concat
  local ${nLoad}=loadstring or load
  local ${nPcall}=pcall
  local ${nType}=type
  local ${nFloor}=math.floor
  local ${nBxor}=(bit32 and bit32.bxor) or (bit and bit.bxor)
  local ${nBand}=(bit32 and bit32.band) or (bit and bit.band)
  local ${nSeedA}=${seedA}
  local ${nSeedB}=${seedB}
  local ${nSeedC}=${seedC}
  local ${nLen}=${bytes.length}
  local ${nHome}=${JSON.stringify(home)}

  local function ${nDecode}(_s)
    local _r={}
    for _i=1,#_s,2 do
      local _a=${nFind}(${nAlphabet},${nSub}(_s,_i,_i),1,true)
      local _b=${nFind}(${nAlphabet},${nSub}(_s,_i+1,_i+1),1,true)
      if not _a or not _b then return nil end
      _r[#_r+1]=(_a-1)*66+(_b-1)
    end
    return _r
  end

  local function ${nTamper}(...)
    if setclipboard then ${nPcall}(setclipboard,${nHome}) end
    if warn then ${nPcall}(warn,"Karma Protection triggered: "..${nHome}) end
    local _d=${nDecode}(${nDecoy}) or {}
    local _o={}
    for _i=1,#_d do _o[_i]=${nChar}(${nBxor}(_d[_i],${nSeedC})) end
    local _fake=${nConcat}(_o)
    if ${nType}(${nLoad})=="function" then local _ok,_fn=${nPcall}(${nLoad},_fake,"KarmaDecoy") if _ok and ${nType}(_fn)=="function" then return _fn(...) end end
    return nil
  end

  local function ${nWipe}(_t) for _i=1,#_t do _t[_i]=0 end end
  if ${nType}(${nLoad})~="function" or not ${nBxor} or not ${nBand} then return ${nTamper}(...) end

  local _data=${nDecode}(${nPayload})
  local _keys=${nDecode}(${nKeys})
  if not _data or not _keys or #_keys<1 then return ${nTamper}(...) end

  local ${nOut}={}
  local ${nPrev}=${nSeedB}
  for _i=1,#_data do
    local _e=_data[_i]
    local _k1=_keys[((_i-1)%#_keys)+1]
    local _k2=_keys[((_i*7+${nSeedA})%#_keys)+1]
    local _unadd=${nBand}(_e-(${nBand}(_i*13+${nSeedC},255)),255)
    local _roll=${nBand}(${nSeedA}+_i*17+(_i%11)*${nSeedB}+${nPrev}+${nSeedC}+_k2,255)
    local _plain=${nBxor}(${nBxor}(_unadd,_k1),_roll)
    ${nOut}[_i]=${nChar}(_plain)
    ${nPrev}=${nBand}(_e+_k1+${nSeedB}+_i,255)
  end

  local _src=${nConcat}(${nOut})
  if #_src~=${nLen} then ${nWipe}(_data); ${nWipe}(_keys); ${nWipe}(${nOut}); return ${nTamper}(...) end

  local ${nChk}=7
  for _i=1,#_src do
    local _b=${nByte}(_src,_i)
    ${nChk}=(${nChk}+((_b+1)*(((_i-1)%251)+1)))%2147483647
  end
  if ${nChk}~=${checksum} then ${nWipe}(_data); ${nWipe}(_keys); ${nWipe}(${nOut}); return ${nTamper}(...) end

  local _ok,_fn=${nPcall}(${nLoad},_src,"KarmaProtected")
  ${nWipe}(_data); ${nWipe}(_keys); ${nWipe}(${nOut})
  if not _ok or ${nType}(_fn)~="function" then return ${nTamper}(...) end
  return _fn(...)
end)(...)
`;
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
  if (selected === 'light') return kers0neLocalObfuscate(luaCode, { strength: 1 });
  if (selected === 'max' || selected === 'maximum' || selected === 'vm') {
    return kers0neLocalObfuscate(kers0neLocalObfuscate(kers0neLocalObfuscate(luaCode, { strength: 3 }), { strength: 3 }), { strength: 3 });
  }
  return kers0neLocalObfuscate(luaCode, { strength: 2 });
}

function verifyAdmin(member, settings) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;
  return Boolean(settings && settings.admin_role_id && member.roles.cache.has(settings.admin_role_id));
}

function keyStatus(license) {
  if (!license) return 'Missing';
  if (license.revoked) return 'Revoked';
  if (isExpired(license.expires_at)) return 'Expired';
  if (license.discord_user_id) return 'Redeemed';
  return 'Unused';
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

// ---------------- Commands ----------------
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Karma command list'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show Karma service/database status'),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up Karma Protection panel or API link')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('panel')
      .setDescription('Post a script panel')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(true).setMaxLength(500))
      .addStringOption(o => o.setName('script_id').setDescription('Hosted script ID from the website, example host_xxxxx').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('api')
      .setDescription('Link website API to this Discord server')
      .addStringOption(o => o.setName('key').setDescription('API key from the website dashboard').setRequired(true))
      .addStringOption(o => o.setName('script_id').setDescription('Optional hosted script ID for this server panel').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('keysystem')
      .setDescription('Configure the custom key system GUI')
      .addStringOption(o => o.setName('color').setDescription('Hex color, example #5865F2').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Key system title').setRequired(false).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Key system description').setRequired(false).setMaxLength(500))),

  new SlashCommandBuilder()
    .setName('credits')
    .setDescription('Check your credit balance'),

  new SlashCommandBuilder()
    .setName('addcredits')
    .setDescription('Add credits to a user (owner only)')
    .addUserOption(o => o.setName('user').setDescription('User to add credits to').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount of credits').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Create/apply a protected script and host its loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('script_id').setDescription('Script ID from /createscript or /apply to attach this host to').setRequired(false))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    )),

  new SlashCommandBuilder()
    .setName('createscript')
    .setDescription('Create a script/product and API secret (costs 5 credits)')
    .addStringOption(o => o.setName('name').setDescription('Script/product name').setRequired(true).setMaxLength(80)),

  new SlashCommandBuilder()
    .setName('scripts')
    .setDescription('List scripts/products'),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate license keys')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID from /apply or /createscript').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Days until expiry, 0 = lifetime').setRequired(true).setMinValue(0).setMaxValue(3650))
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of keys').setRequired(false).setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mykeys')
    .setDescription('Show your redeemed keys'),

  new SlashCommandBuilder()
    .setName('viewscript')
    .setDescription('View hosted script loadstrings'),

  new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reset HWID for a user')
    .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true))
    .addStringOption(o => o.setName('key').setDescription('Optional specific key').setRequired(false)),

  new SlashCommandBuilder()
    .setName('reset-hwid')
    .setDescription('Reset your own HWID or, for admins, a specific key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('Revoke a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('extendkey')
    .setDescription('Extend a license key by days')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Days to add').setRequired(true).setMinValue(1).setMaxValue(3650)),

  new SlashCommandBuilder()
    .setName('deletekey')
    .setDescription('Permanently delete a license key')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('banhwid')
    .setDescription('Ban an HWID from license verification')
    .addStringOption(o => o.setName('hwid').setDescription('HWID to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(200)),

  new SlashCommandBuilder()
    .setName('hostscript')
    .setDescription('Host Lua code and get a loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('script_id').setDescription('Optional script/product ID from /createscript to update instead of duplicating').setRequired(false))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Run the code through your obfuscator before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    )),

  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate Lua code or an uploaded .lua/.txt file')
    .addStringOption(o => o.setName('code').setDescription('Lua code to obfuscate, max 4000 chars').setRequired(false).setMaxLength(4000))
    .addAttachmentOption(o => o.setName('file').setDescription('Upload a .lua or .txt file to obfuscate').setRequired(false))
    .addStringOption(o => o.setName('filename').setDescription('Output filename').setRequired(false).setMaxLength(80))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'VM Protected', value: 'vm' }
    ))
    .addBooleanOption(o => o.setName('private').setDescription('Only you can see the result. Default: false/public')),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link this Discord server to the website API')
    .addSubcommand(sc => sc
      .setName('api')
      .setDescription('Link your website/API key to this Discord server')
      .addStringOption(o => o.setName('key').setDescription('API key from the website/dashboard').setRequired(true))),

  new SlashCommandBuilder()
    .setName('loader')
    .setDescription('Get a Lua verification loader example')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('keysystem')
    .setDescription('Manage custom key system GUI')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('create')
      .setDescription('Create a key system template')
      .addStringOption(o => o.setName('name').setDescription('Template name').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Description').setRequired(false)))
    .addSubcommand(sc => sc.setName('list').setDescription('List key system templates')),

  new SlashCommandBuilder()
    .setName('service')
    .setDescription('Service management for scripts')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('create')
      .setDescription('Create a service')
      .addStringOption(o => o.setName('name').setDescription('Service name').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Service description').setRequired(false)))
    .addSubcommand(sc => sc.setName('list').setDescription('List services'))
    .addSubcommand(sc => sc
      .setName('add')
      .setDescription('Add a hosted script to a service')
      .addStringOption(o => o.setName('service').setDescription('Service name or ID').setRequired(true))
      .addStringOption(o => o.setName('script_id').setDescription('Hosted script ID').setRequired(true)))
].map(c => c.toJSON());

async function deployCommands() {
  if (!CLIENT_ID) {
    console.log('CLIENT_ID missing, skipping slash command deploy.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Deployed ${commands.length} commands to guild ${GUILD_ID}.`);

    if (process.env.CLEAR_GLOBAL_COMMANDS !== 'false') {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('Cleared global commands.');
    }
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Deployed ${commands.length} global commands. They can take up to 1 hour to show.`);
  }
}

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const processedInteractions = new Set();

function panelEmbed(guildId, sentBy = null) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xe3b944)
    .setFooter({ text: sentBy ? `Sent By ${sentBy} • Karma Protection` : 'Karma Protection' });
}

function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_view_script').setLabel('View Script').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_reset_hwid').setLabel('Reset HWID').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('panel_mykeys').setLabel('My Keys').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_keysystem').setLabel('Key System').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_obfuscator').setLabel('Obfuscator').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function keySystemEmbed(guildId) {
  const settings = getSettings(guildId);
  const rawColor = settings?.key_system_color || '#5865F2';
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? parseInt(rawColor.slice(1), 16) : 0x5865F2;
  return new EmbedBuilder()
    .setTitle(settings?.key_system_title || 'Karma Key System')
    .setDescription(settings?.key_system_description || 'Enter your license key to unlock access')
    .setColor(color)
    .addFields(
      { name: 'How to Redeem', value: 'Click Redeem Key on the main panel and enter your license key.' },
      { name: 'HWID Locking', value: 'Your key locks to your first device. Reset HWID has a cooldown.' }
    )
    .setFooter({ text: 'Karma Protection Key System' });
}

async function logGuild(guild, text) {
  if (process.env.ENABLE_COMMAND_LOGS !== 'true') return;
  const settings = getSettings(guild.id);
  if (!settings || !settings.log_channel_id) return;
  const channel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
  if (channel && channel.isTextBased()) await channel.send(text).catch(() => null);
}

function requireAdmin(interaction) {
  return verifyAdmin(interaction.member, getSettings(interaction.guildId));
}

async function redeemKey({ guild, member, userId, key }) {
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, guild.id);

  if (!license) return { ok: false, message: 'That key does not exist in this server.' };
  if (license.revoked) return { ok: false, message: 'That key has been revoked.' };
  if (isExpired(license.expires_at)) return { ok: false, message: 'That key is expired.' };
  if (license.discord_user_id && license.discord_user_id !== userId) return { ok: false, message: 'That key was already redeemed by someone else.' };

  db.prepare('UPDATE licenses SET discord_user_id = ?, redeemed_at = COALESCE(redeemed_at, CURRENT_TIMESTAMP) WHERE license_key = ?').run(userId, key);

  const settings = getSettings(guild.id);
  if (settings && settings.customer_role_id && member) {
    await member.roles.add(settings.customer_role_id).catch(() => null);
  }

  await logGuild(guild, `✅ <@${userId}> redeemed key \`${key}\`.`);
  return { ok: true, message: 'Key redeemed successfully.' };
}

async function resetHwid({ guild, userId, key, admin }) {
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, guild.id);
  if (!license) return { ok: false, message: 'That key does not exist in this server.' };
  if (!admin && license.discord_user_id !== userId) return { ok: false, message: 'You can only reset HWID for your own redeemed key.' };

  if (!admin && !canResetHWID(license)) {
    const remaining = getResetCooldownRemaining(license);
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    return { ok: false, message: `HWID reset cooldown active. Try again in ${hours}h ${minutes}m.` };
  }

  db.prepare('UPDATE licenses SET hwid = NULL, last_reset_at = CURRENT_TIMESTAMP, reset_count = COALESCE(reset_count, 0) + 1 WHERE license_key = ?').run(key);
  await logGuild(guild, `🖥️ HWID reset for key \`${key}\` by <@${userId}>.`);
  return { ok: true, message: 'HWID reset successfully.' };
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (processedInteractions.has(interaction.id)) return;
  processedInteractions.add(interaction.id);
  setTimeout(() => processedInteractions.delete(interaction.id), 60_000).unref?.();

  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong. Check your bot console.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

async function handleCommand(interaction) {
  const commandName = interaction.commandName;

  if (commandName === 'help') {
    return interaction.reply({
      ephemeral: true,
      content: [
        '**Karma Commands**',
        '`/setup panel title description script_id` - post a script-specific panel',
        '`/credits` - check your credit balance',
        '`/addcredits` - add credits to a user (owner only)',
        '`/apply` - create a script, host it, and get a loadstring',
        '`/createscript` - create a script/API secret (costs 5 credits)',
        '`/scripts` - list scripts',
        '`/generatekey` - generate license keys',
        '`/redeem` - redeem a key',
        '`/mykeys` - view your keys',
        '`/viewscript` - view hosted loadstrings',
        '`/resethwid user` - admin reset HWID for a user',
        '`/reset-hwid` - reset your own key HWID',
        '`/revoke` - revoke a key',
        '`/extendkey` - extend a key',
        '`/deletekey` - delete a key',
        '`/hostscript` - host Lua and get a loadstring',
        '`/obfuscate` - obfuscate Lua using your API',
        '`/link api` - link this Discord server to the website API',
        '`/loader` - verification loader example'
      ].join('\n')
    });
  }

  if (commandName === 'status') {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM scripts WHERE guild_id = ?').get(interaction.guildId).count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses WHERE guild_id = ?').get(interaction.guildId).count;
    const hostedCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE guild_id = ?').get(interaction.guildId).count;
    return interaction.reply({ ephemeral: true, content: `Karma Protection is online.\nScripts: **${scriptCount}**\nKeys: **${keyCount}**\nHosted scripts: **${hostedCount}**\nWebsite: ${publicBaseUrl()}` });
  }

  if (commandName === 'credits') {
    const balance = getCredits(interaction.user.id);
    return interaction.reply({ ephemeral: true, content: `💰 Your credit balance: **${balance}** credits.\n\nEach script creation costs **${CREDIT_COST}** credits.` });
  }

  if (commandName === 'addcredits') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ ephemeral: true, content: '❌ Only the owner can add credits.' });
    }
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const newBalance = addCredits(target.id, amount, `Added by ${interaction.user.tag}`);
    await logGuild(interaction.guild, `💰 Added ${amount} credits to <@${target.id}> by <@${interaction.user.id}>. New balance: ${newBalance}`);
    return interaction.reply({ ephemeral: true, content: `✅ Added **${amount}** credits to ${target}. New balance: **${newBalance}**` });
  }

  if (commandName === 'setup') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    }

    const setupMode = interaction.options.getSubcommand(false);
    if (setupMode === 'api') {
      const key = interaction.options.getString('key', true).trim();
      const panelScriptId = interaction.options.getString('script_id', false);
      const preview = `${key.slice(0, 6)}...${key.slice(-4)}`;
      const patch = { api_key_hash: hashSecret(key), api_key_preview: preview };
      if (panelScriptId) patch.panel_script_id = panelScriptId;
      upsertSettings(interaction.guildId, patch);
      return interaction.reply({ ephemeral: true, content: `API linked successfully. Key: \`${preview}\`${panelScriptId ? `\nPanel script set to: \`${panelScriptId}\`` : ''}` });
    }

    const panelTitle = interaction.options.getString('title', true);
    const panelDescription = interaction.options.getString('description', true);
    const panelScriptId = interaction.options.getString('script_id', false);

    // If no script_id provided, show available scripts
    if (!panelScriptId) {
      const scripts = db.prepare('SELECT id, name FROM hosted_scripts WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10')
        .all(interaction.guildId);
      
      if (scripts.length === 0) {
        return interaction.reply({
          ephemeral: true,
          content: '❌ No scripts found. Create one first with `/hostscript` or `/apply`.\n\n' +
                   'Then run: `/setup panel title:"My Hub" description:"Keys here" script_id:YOUR_SCRIPT_ID`'
        });
      }
      
      return interaction.reply({
        ephemeral: true,
        content: '📋 Available scripts:\n' + 
                 scripts.map(s => `• **${s.name}** — \`${s.id}\``).join('\n') +
                 '\n\nUse: `/setup panel title:"Title" description:"Desc" script_id:ID`'
      });
    }

    const patch = {
      panel_channel_id: interaction.channelId,
      panel_title: panelTitle,
      panel_description: panelDescription,
      panel_script_id: panelScriptId || null
    };
    upsertSettings(interaction.guildId, patch);

    const panelMessage = await interaction.reply({
      embeds: [panelEmbed(interaction.guildId, interaction.user.username)],
      components: panelButtons(),
      fetchReply: true
    });
    upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });
    return;
  }

  const adminCommands = ['generatekey', 'apply', 'hostscript', 'resethwid', 'banhwid', 'createscript', 'scripts', 'revoke', 'extendkey', 'deletekey', 'setup', 'loader', 'obfuscate', 'link', 'keysystem', 'service'];
  if (adminCommands.includes(commandName) && !requireAdmin(interaction)) {
    await interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    return;
  }

  if (commandName === 'createscript') {
    const name = interaction.options.getString('name', true);
    
    // Check credits
    if (interaction.user.id !== OWNER_ID) {
      const balance = getCredits(interaction.user.id);
      if (balance < CREDIT_COST) {
        return interaction.reply({ 
          ephemeral: true, 
          content: `❌ You need **${CREDIT_COST}** credits to create a script. You have **${balance}** credits.\n\nGet more credits from the owner or use \`/addcredits\` (owner only).` 
        });
      }
      spendCredits(interaction.user.id, CREDIT_COST, `Script creation: ${name}`);
    }
    
    const script = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });
    await interaction.reply({ 
      ephemeral: true, 
      content: `Script created.\nName: **${script.name}**\nScript ID: \`${script.id}\`\nAPI Secret: \`${script.apiSecret}\`\n\nSave the API secret now. It is only shown once.` 
    });
    await logGuild(interaction.guild, `📦 Script \`${name}\` created by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'scripts') {
    const scripts = db.prepare('SELECT id, name, api_secret_preview FROM scripts WHERE guild_id = ? ORDER BY created_at DESC').all(interaction.guildId);
    if (!scripts.length) return interaction.reply({ ephemeral: true, content: 'No scripts yet. Use `/createscript`.' });
    return interaction.reply({ ephemeral: true, content: scripts.map(s => `**${s.name}**\nID: \`${s.id}\`\nSecret: \`${s.api_secret_preview}\``).join('\n\n') });
  }

  if (commandName === 'generatekey') {
    const scriptId = interaction.options.getString('script_id', true);
    const days = interaction.options.getInteger('days', true);
    const quantity = interaction.options.getInteger('quantity') || 1;
    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND guild_id = ?').get(scriptId, interaction.guildId);
    if (!script) return interaction.reply({ ephemeral: true, content: 'Invalid script ID.' });

    const expiresAt = addDays(days);
    const insert = db.prepare('INSERT INTO licenses (license_key, script_id, guild_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?)');
    const keys = [];
    for (let i = 0; i < quantity; i++) {
      const key = makeKey('PS');
      insert.run(key, scriptId, interaction.guildId, expiresAt, interaction.user.id);
      keys.push(key);
    }

    await interaction.reply({ ephemeral: true, content: `Generated ${keys.length} key(s) for **${script.name}**:\n\n${keys.map(k => `\`${k}\``).join('\n')}\n\nExpiry: ${expiresAt || 'Lifetime'}` });
    await logGuild(interaction.guild, `🔑 ${keys.length} key(s) generated for \`${script.name}\` by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'redeem') {
    const key = interaction.options.getString('key', true).trim();
    const result = await redeemKey({ guild: interaction.guild, member: interaction.member, userId: interaction.user.id, key });
    return interaction.reply({ ephemeral: true, content: result.message });
  }

  if (commandName === 'resethwid') {
    const target = interaction.options.getUser('user', true);
    const key = interaction.options.getString('key', false)?.trim();

    let result;
    if (key) {
      result = db.prepare('UPDATE licenses SET hwid = NULL WHERE guild_id = ? AND discord_user_id = ? AND license_key = ?')
        .run(interaction.guildId, target.id, key);
    } else {
      result = db.prepare('UPDATE licenses SET hwid = NULL WHERE guild_id = ? AND discord_user_id = ?')
        .run(interaction.guildId, target.id);
    }

    await logGuild(interaction.guild, `🖥️ HWID reset for <@${target.id}> by <@${interaction.user.id}>. Rows: ${result.changes}`);
    return interaction.reply({ ephemeral: true, content: `Reset HWID for ${target}. Updated ${result.changes} key(s).` });
  }

  if (commandName === 'reset-hwid') {
    const key = interaction.options.getString('key', true).trim();
    const result = await resetHwid({ guild: interaction.guild, userId: interaction.user.id, key, admin: requireAdmin(interaction) });
    return interaction.reply({ ephemeral: true, content: result.message });
  }

  if (commandName === 'revoke') {
    const key = interaction.options.getString('key', true).trim();
    const info = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, interaction.guildId);
    if (!info) return interaction.reply({ ephemeral: true, content: 'Key not found.' });
    db.prepare('UPDATE licenses SET revoked = 1 WHERE license_key = ?').run(key);
    await logGuild(interaction.guild, `⛔ Key \`${key}\` revoked by <@${interaction.user.id}>.`);
    return interaction.reply({ ephemeral: true, content: `Revoked \`${key}\`.` });
  }

  if (commandName === 'mykeys') return sendMyKeys(interaction, interaction.user.id);

  if (commandName === 'viewscript') return sendHostedScripts(interaction);

  if (commandName === 'keysystem') {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const color = interaction.options.getString('color') || '#5865F2';
      const title = interaction.options.getString('title') || 'Karma Key System';
      const description = interaction.options.getString('description') || 'Enter your license key to unlock access';
      const id = makeId('keytpl');
      const config = JSON.stringify({ color, title, description });
      db.prepare('INSERT INTO key_system_templates (id, name, guild_id, config, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, name, interaction.guildId, config, interaction.user.id);
      return interaction.reply({ ephemeral: true, content: `Key system template created: \`${id}\`` });
    }
    const rows = db.prepare('SELECT id, name, config FROM key_system_templates WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20').all(interaction.guildId);
    return interaction.reply({ ephemeral: true, content: rows.length ? rows.map(r => `**${r.name}** — \`${r.id}\``).join('\n') : 'No key system templates yet.' });
  }

  if (commandName === 'service') {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const description = interaction.options.getString('description') || '';
      const id = makeId('svc');
      db.prepare('INSERT INTO services (id, guild_id, name, description, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, interaction.guildId, name, description, interaction.user.id);
      return interaction.reply({ ephemeral: true, content: `Service created: **${name}** (\`${id}\`)` });
    }
    if (sub === 'add') {
      const serviceRef = interaction.options.getString('service', true);
      const scriptId = interaction.options.getString('script_id', true);
      const svc = db.prepare('SELECT * FROM services WHERE guild_id = ? AND (id = ? OR name = ?)').get(interaction.guildId, serviceRef, serviceRef);
      if (!svc) return interaction.reply({ ephemeral: true, content: 'Service not found.' });
      db.prepare('INSERT OR IGNORE INTO service_scripts (service_id, script_id) VALUES (?, ?)').run(svc.id, scriptId);
      return interaction.reply({ ephemeral: true, content: `Added \`${scriptId}\` to service **${svc.name}**.` });
    }
    const rows = db.prepare('SELECT * FROM services WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20').all(interaction.guildId);
    return interaction.reply({ ephemeral: true, content: rows.length ? rows.map(r => `**${r.name}** — \`${r.id}\` — ${r.description || 'No description'}`).join('\n') : 'No services yet.' });
  }

  if (commandName === 'apply') {
    const name = interaction.options.getString('name', true);
    const originalCode = interaction.options.getString('code', true);
    const linkedScriptId = interaction.options.getString('script_id', false);
    const shouldObfuscate = interaction.options.getBoolean('obfuscate') || false;
    const level = interaction.options.getString('level') || 'standard';

    await interaction.deferReply({ ephemeral: true });

    // Auto-generate script_id if not provided
    let finalScriptId = linkedScriptId;
    if (!finalScriptId) {
      // Check credits
      if (interaction.user.id !== OWNER_ID) {
        const balance = getCredits(interaction.user.id);
        if (balance < CREDIT_COST) {
          return interaction.editReply({ 
            content: `❌ You need **${CREDIT_COST}** credits to create a script. You have **${balance}** credits.`
          });
        }
        spendCredits(interaction.user.id, CREDIT_COST, `Script creation: ${name}`);
      }
      const newScript = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });
      finalScriptId = newScript.id;
    }

    let finalCode = originalCode;
    if (shouldObfuscate) {
      try {
        finalCode = await callObfuscator(originalCode, level);
      } catch (error) {
        await interaction.editReply({ content: `Script was created, but obfuscation/hosting failed: ${error.message}\nScript ID: \`${finalScriptId}\`` });
        return;
      }
    }

    const hosted = createHostedScript({
      guildId: interaction.guildId,
      name,
      code: String(finalCode),
      sourceCode: originalCode,
      linkedScriptId: finalScriptId,
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Applied **${name}** successfully.\n\nScript ID:\n\`${finalScriptId}\`\n\nHosted Script Loadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
    });
    await logGuild(interaction.guild, `✅ Applied script \`${name}\` by <@${interaction.user.id}>. Script ID: \`${finalScriptId}\``);
    return;
  }

  if (commandName === 'obfuscate') {
    let code = interaction.options.getString('code', false);
    const upload = interaction.options.getAttachment('file', false);
    const privateResult = interaction.options.getBoolean('private') || false;
    const filenameInput = interaction.options.getString('filename') || upload?.name || 'obfuscated.lua';
    const filename = filenameInput.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const level = interaction.options.getString('level') || 'standard';

    await interaction.deferReply({ ephemeral: privateResult });

    try {
      if (upload) {
        if (upload.size > 256 * 1024) {
          await interaction.editReply({ content: 'File too large. Upload a .lua/.txt file under 256 KB.' });
          return;
        }
        if (!/\.(lua|txt)$/i.test(upload.name || '')) {
          await interaction.editReply({ content: 'Please upload a .lua or .txt file.' });
          return;
        }
        const response = await fetch(upload.url);
        if (!response.ok) throw new Error(`Could not download uploaded file: ${response.status}`);
        code = await response.text();
      }

      if (!code || !code.trim()) {
        await interaction.editReply({ content: 'Add Lua code with `code:` or upload a `.lua` / `.txt` file with `file:`.' });
        return;
      }

      code = code.slice(0, 4000);
      const obfuscated = await callObfuscator(code, level);
      const attachment = new AttachmentBuilder(Buffer.from(String(obfuscated), 'utf8'), { name: filename.endsWith('.lua') ? filename : `${filename}.lua` });
      await interaction.editReply({
        content: `Obfuscated successfully. Level: **${level}**. Uploaded by <@${interaction.user.id}>.`,
        files: [attachment]
      });
      await logGuild(interaction.guild, `Code obfuscated by <@${interaction.user.id}>.`);
    } catch (error) {
      await interaction.editReply({ content: `Obfuscator failed: ${error.message}` });
    }
    return;
  }

  if (commandName === 'extendkey') {
    const key = interaction.options.getString('key', true).trim();
    const days = interaction.options.getInteger('days', true);
    const info = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, interaction.guildId);
    if (!info) return interaction.reply({ ephemeral: true, content: 'Key not found.' });

    const baseDate = info.expires_at && new Date(info.expires_at).getTime() > Date.now() ? new Date(info.expires_at) : new Date();
    baseDate.setUTCDate(baseDate.getUTCDate() + days);
    db.prepare('UPDATE licenses SET expires_at = ? WHERE license_key = ?').run(baseDate.toISOString(), key);
    await logGuild(interaction.guild, `➕ Key \`${key}\` extended by ${days} day(s) by <@${interaction.user.id}>.`);
    return interaction.reply({ ephemeral: true, content: `Extended \`${key}\` until ${baseDate.toISOString()}.` });
  }

  if (commandName === 'deletekey') {
    const key = interaction.options.getString('key', true).trim();
    const result = db.prepare('DELETE FROM licenses WHERE license_key = ? AND guild_id = ?').run(key, interaction.guildId);
    if (!result.changes) return interaction.reply({ ephemeral: true, content: 'Key not found.' });
    await logGuild(interaction.guild, `🗑️ Key \`${key}\` deleted by <@${interaction.user.id}>.`);
    return interaction.reply({ ephemeral: true, content: `Deleted \`${key}\`.` });
  }

  if (commandName === 'banhwid') {
    const hwid = interaction.options.getString('hwid', true).trim();
    const reason = interaction.options.getString('reason') || 'Banned by admin';
    db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, reason, banned_by) VALUES (?, ?, ?)')
      .run(hwid, reason, interaction.user.id);
    await logGuild(interaction.guild, `HWID banned by <@${interaction.user.id}>: \`${hwid}\``);
    return interaction.reply({ ephemeral: true, content: `Banned HWID: \`${hwid}\`` });
  }

  if (commandName === 'hostscript') {
    const name = interaction.options.getString('name', true);
    const originalCode = interaction.options.getString('code', true);
    const linkedScriptId = interaction.options.getString('script_id', false);
    if (linkedScriptId) {
      const product = db.prepare('SELECT * FROM scripts WHERE id = ? AND guild_id = ?').get(linkedScriptId, interaction.guildId);
      if (!product) return interaction.reply({ ephemeral: true, content: 'Invalid script_id. Use `/createscript` first, then use that script ID here.' });
    }
    const shouldObfuscate = interaction.options.getBoolean('obfuscate') || false;
    const level = interaction.options.getString('level') || 'standard';

    await interaction.deferReply({ ephemeral: true });

    let finalCode = originalCode;
    if (shouldObfuscate) {
      try {
        finalCode = await callObfuscator(originalCode, level);
      } catch (error) {
        await interaction.editReply({ content: `Obfuscator API failed, script was not hosted: ${error.message}` });
        return;
      }
    }

    // Auto-generate script_id if not provided
    let finalScriptId = linkedScriptId;
    if (!finalScriptId) {
      if (interaction.user.id !== OWNER_ID) {
        const balance = getCredits(interaction.user.id);
        if (balance < CREDIT_COST) {
          return interaction.editReply({ 
            content: `❌ You need **${CREDIT_COST}** credits to create a script. You have **${balance}** credits.`
          });
        }
        spendCredits(interaction.user.id, CREDIT_COST, `Script creation: ${name}`);
      }
      const newScript = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });
      finalScriptId = newScript.id;
    }

    const hosted = createHostedScript({
      guildId: interaction.guildId,
      name,
      code: String(finalCode),
      sourceCode: originalCode,
      linkedScriptId: finalScriptId,
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Hosted **${name}** ${shouldObfuscate ? '(obfuscated)' : ''}${linkedScriptId ? ` for script ID \`${linkedScriptId}\`` : ''}.\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
    });
    await logGuild(interaction.guild, `🌐 Script \`${name}\` hosted by <@${interaction.user.id}>. ID: \`${hosted.id}\``);
    return;
  }

  if (commandName === 'link') {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'api') {
      const key = interaction.options.getString('key', true).trim();
      const preview = `${key.slice(0, 6)}...${key.slice(-4)}`;
      upsertSettings(interaction.guildId, {
        api_key_hash: hashSecret(key),
        api_key_preview: preview
      });
      await logGuild(interaction.guild, `🔗 API linked by <@${interaction.user.id}>. Key: \`${preview}\``);
      return interaction.reply({ ephemeral: true, content: `API linked successfully. Key: \`${preview}\`` });
    }
  }

  if (commandName === 'loader') {
    const scriptId = interaction.options.getString('script_id', true);
    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND guild_id = ?').get(scriptId, interaction.guildId);
    if (!script) return interaction.reply({ ephemeral: true, content: 'Invalid script ID.' });
    
    const example = `-- Generic Lua example. Change request/http_request for your environment.
local key = "PASTE_USER_KEY"
local hwid = "PUT_HWID_HERE"
local apiUrl = "https://YOUR-RENDER-URL.onrender.com/api/verify"

local body = '{"script_id":"${scriptId}","key":"' .. key .. '","hwid":"' .. hwid .. '"}'

local res = request({
  Url = apiUrl,
  Method = "POST",
  Headers = {
    ["Content-Type"] = "application/json",
    ["X-API-Secret"] = "PASTE_SCRIPT_API_SECRET"
  },
  Body = body
})

print(res.Body)`;
    
    return interaction.reply({ ephemeral: true, content: `\`\`\`lua\n${example}\n\`\`\`` });
  }
}

async function sendMyKeys(interaction, userId) {
  const rows = db.prepare(`SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.guild_id = ? AND l.discord_user_id = ? ORDER BY l.redeemed_at DESC`).all(interaction.guildId, userId);
  const content = rows.length
    ? rows.map(r => `**${r.script_name}** — \`${r.license_key}\` — ${keyStatus(r)} — expires: ${r.expires_at || 'Lifetime'} — HWID: ${r.hwid ? 'set' : 'not set'}`).join('\n')
    : 'You have no redeemed keys.';

  if (interaction.deferred || interaction.replied) await interaction.followUp({ ephemeral: true, content });
  else await interaction.reply({ ephemeral: true, content });
}

async function sendHostedScripts(interaction) {
  const settings = getSettings(interaction.guildId);
  let rows;
  if (settings?.panel_script_id) {
    rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE id = ? OR linked_script_id = ? ORDER BY created_at DESC LIMIT 1').all(settings.panel_script_id, settings.panel_script_id);
  } else {
    rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 500').all();
  }
  
  if (rows.length === 0) {
    const content = '❌ No script is linked to this panel yet.\n\n' +
                    '**Option 1:** Create a script first with `/hostscript` or `/apply`\n' +
                    '**Option 2:** Link an existing script with `/setup panel title:"Title" description:"Desc" script_id:YOUR_SCRIPT_ID`\n' +
                    '**Option 3:** Use the dashboard at ' + publicBaseUrl() + '/dashboard';
    
    if (interaction.deferred || interaction.replied) await interaction.followUp({ ephemeral: true, content });
    else await interaction.reply({ ephemeral: true, content });
    return;
  }
  
  const content = rows.map(r => `**${r.name}** ${r.obfuscated ? '(obfuscated)' : ''}\nLoadstring:\n\`\`\`lua\n${makeLoaderSnippet(r.id)}\n\`\`\``).join('\n');

  if (interaction.deferred || interaction.replied) await interaction.followUp({ ephemeral: true, content });
  else await interaction.reply({ ephemeral: true, content });
}

async function handleButton(interaction) {
  if (interaction.customId === 'panel_view_script') {
    return sendHostedScripts(interaction);
  }

  if (interaction.customId === 'panel_redeem') {
    const modal = new ModalBuilder().setCustomId('modal_redeem').setTitle('Redeem License Key');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short).setRequired(true)));
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'panel_reset_hwid') {
    const modal = new ModalBuilder().setCustomId('modal_reset_hwid').setTitle('Reset HWID');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short).setRequired(true)));
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'panel_mykeys') return sendMyKeys(interaction, interaction.user.id);

  if (interaction.customId === 'panel_keysystem') {
    return interaction.reply({ ephemeral: true, embeds: [keySystemEmbed(interaction.guildId)] });
  }

  if (interaction.customId === 'panel_obfuscator') {
    return interaction.reply({ ephemeral: true, content: `${publicBaseUrl()}/dashboard?tab=obfuscate` });
  }
}

async function handleModal(interaction) {
  const key = interaction.fields.getTextInputValue('key').trim();

  if (interaction.customId === 'modal_redeem') {
    const result = await redeemKey({ guild: interaction.guild, member: interaction.member, userId: interaction.user.id, key });
    return interaction.reply({ ephemeral: true, content: result.message });
  }

  if (interaction.customId === 'modal_reset_hwid') {
    const result = await resetHwid({ guild: interaction.guild, userId: interaction.user.id, key, admin: false });
    return interaction.reply({ ephemeral: true, content: result.message });
  }
}

// ---------------- Express API ----------------
function startApiServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  // ============================================================
  // INDEX PAGE - The main website landing page
  // ============================================================
  app.get('/', (req, res) => {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM scripts').get().count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
    const hostedCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM website_users').get().count;

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karma Protection — Lua Code Protection & Licensing</title>
  <meta name="description" content="Karma Protection protects Lua code with obfuscation, HWID-locked keys, hosted loadstrings, and a Discord synced panel." />
  <style>
    :root{--bg:#030303;--card:#0b0b0c;--muted:#a1a1aa;--line:#242428;--text:#f8fafc;--primary:#ffffff;--soft:#151518}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -8%,rgba(255,255,255,.16),transparent 30%),#030303;color:var(--text);font-family:"SF Pro Display","Aptos","Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;letter-spacing:-.01em;min-height:100vh}
    .grid{position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,#000,transparent 82%);pointer-events:none}
    a{color:inherit;text-decoration:none}.container{width:min(1180px,92%);margin:auto}
    header{position:sticky;top:0;z-index:40;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(3,3,3,.82);backdrop-filter:blur(18px)}
    .nav{height:64px;display:flex;align-items:center;justify-content:space-between}
    .brand{display:flex;align-items:center;gap:10px;font-weight:780}
    .beta{font:10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;border:1px solid #2d2d32;border-radius:5px;padding:2px 6px;color:#b6b6bd}
    .btn{display:inline-flex;align-items:center;gap:10px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.055);padding:13px 18px;font:800 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:#fff;cursor:pointer}
    .btn.primary{background:#fff;color:#050505;border-color:#fff;box-shadow:0 0 40px rgba(255,255,255,.14)}
    .btn.dark{background:rgba(10,10,10,.75);color:#fff;border-color:rgba(255,255,255,.32)}
    .hero{position:relative;text-align:center;padding:80px 0 60px}
    .pill{display:inline-flex;gap:10px;align-items:center;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.045);border-radius:999px;padding:8px 13px;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#d4d4d8}
    .pulse{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 18px #fff}
    .hero h1{font-size:clamp(40px,7vw,80px);line-height:1.02;letter-spacing:-.075em;margin:26px auto 18px;max-width:900px}
    .glow{text-shadow:0 0 32px rgba(255,255,255,.34)}
    .hero p{max-width:680px;margin:0 auto;color:#a1a1aa;font:500 15px/1.8 ui-monospace,monospace}
    .actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:34px}
    .section{border-top:1px solid rgba(255,255,255,.10);padding:60px 0}
    .sectionHead{max-width:720px;margin-bottom:34px}
    .kicker{font:800 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#fff;margin-bottom:10px}
    .section h2{font-size:clamp(30px,4vw,48px);line-height:1.02;letter-spacing:-.055em;margin:0}
    .muted{color:#a1a1aa}
    .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
    .card{border:1px solid rgba(255,255,255,.13);border-radius:24px;background:rgba(15,15,16,.72);padding:24px;transition:.2s ease}
    .card:hover{border-color:rgba(255,255,255,.35);transform:translateY(-2px)}
    .icon{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.18);border-radius:12px;margin-bottom:16px;font-size:18px}
    .card h3{margin:0 0 8px;font-size:18px}
    .card p{margin:0;color:#a1a1aa;font:500 12px/1.7 ui-monospace,monospace}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:20px}
    .stat{border:1px solid rgba(255,255,255,.13);border-radius:18px;background:rgba(15,15,16,.65);padding:22px;display:flex;gap:15px;align-items:center}
    .num{font-size:34px;font-weight:850}
    .pricing{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid rgba(255,255,255,.13);border-radius:28px;overflow:hidden;background:rgba(15,15,16,.45)}
    .plan{padding:32px}
    .plan+.plan{border-left:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.035)}
    .price{font-size:58px;font-weight:900;letter-spacing:-.06em}
    .plan ul{list-style:none;padding:0;margin:22px 0;display:grid;gap:13px}
    .plan li:before{content:'✓';margin-right:10px}
    .cta{text-align:center;max-width:760px;margin:auto}
    .footer{border-top:1px solid rgba(255,255,255,.10);padding:34px 0;color:#777;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
    @media(max-width:850px){.features,.pricing{grid-template-columns:1fr}.plan+.plan{border-left:0;border-top:1px solid rgba(255,255,255,.13)}.hero{text-align:left}.actions{justify-content:flex-start}}
  </style>
</head>
<body>
  <div class="grid"></div>
  <header><div class="container nav"><a class="brand" href="/"><span style="font-weight:900">Karma</span><span class="beta">Protection</span></a><div style="display:flex;gap:12px"><a class="btn dark" href="/login">Sign In</a><a class="btn primary" href="${DISCORD_INVITE_URL}">Discord</a></div></div></header>
  <main>
    <section class="hero"><div class="container"><a class="pill" href="#features"><span class="pulse"></span>The standard for Lua security</a><h1>Protect. <span class="glow">Monetize.</span> Earn.</h1><p>Drop your project, get a secure build, and monetize with confidence. HWID-lock, whitelist keys, obfuscate, and ship straight from Discord.</p><div class="actions"><a class="btn primary" href="/login">Enter the lab</a><a class="btn dark" href="/dashboard?tab=obfuscate">Obfuscator</a><a class="btn dark" href="#features">Explore</a></div></div></section>
    <section id="features" class="section"><div class="container"><div class="sectionHead"><div class="kicker">Karma Protection</div><h2>Everything you need to ship and protect.</h2></div><div class="features"><div class="card"><div class="icon">⚙️</div><h3>Custom Obfuscator</h3><p>Multi-layer local protection with anti-tamper checks, encoded payloads, and protected loadstrings.</p></div><div class="card"><div class="icon">🔑</div><h3>Whitelist System</h3><p>Hand out keys, let clients redeem, revoke, extend, and reset HWID access.</p></div><div class="card"><div class="icon">🤖</div><h3>Discord Bot</h3><p>Panels, script hosting, key generation, HWID bans, and API linking from Discord.</p></div><div class="card"><div class="icon">📊</div><h3>Dashboard</h3><p>Scripts, protected builds, upload files, users, owner tools, and live status in one place.</p></div><div class="card"><div class="icon">🆔</div><h3>HWID Tracker</h3><p>Lock each key to a single device on first run. Reset or ban HWIDs anytime.</p></div><div class="card"><div class="icon">📦</div><h3>Protected Loadstrings</h3><p>Served through a protected loader route with KEYLESS support for easy execution.</p></div></div></div></section>
    <section class="section"><div class="container"><div class="stats"><div class="stat"><div class="num">${userCount}</div><div><b>creators onboarded</b><br><span class="muted">signed in users</span></div></div><div class="stat"><div class="num">${hostedCount}</div><div><b>scripts protected</b><br><span class="muted">hosted builds</span></div></div><div class="stat"><div class="num">${keyCount}</div><div><b>keys issued</b><br><span class="muted">license keys</span></div></div></div></div></section>
    <section id="pricing" class="section"><div class="container"><div class="sectionHead" style="text-align:center;margin-inline:auto"><div class="kicker">pricing</div><h2>Simple plans. Real protection.</h2></div><div class="pricing"><div class="plan"><div class="kicker">Citizen</div><div class="price">$0</div><p class="muted">forever</p><ul><li>Discord bot + panel deploy</li><li>Whitelist keys</li><li>Standard obfuscation</li><li>5 scripts by default</li></ul><a class="btn dark" href="/login">Get Started Free</a></div><div class="plan"><div class="kicker">Royal</div><div class="price">$3</div><p class="muted">month</p><ul><li>Higher script limits</li><li>Maximum obfuscation</li><li>Priority builds</li><li>Owner controlled upgrades</li></ul><a class="btn primary" href="/login">Upgrade</a></div></div></div></section>
    <section class="section"><div class="container cta"><h2>Ready to take back control?</h2><p class="muted">Sign in with Discord, upload your first script, and ship in minutes.</p><div class="actions"><a class="btn primary" href="/login">Sign in with Discord</a><a class="btn dark" href="${DISCORD_INVITE_URL}">Join the Discord</a></div></div></section>
  </main>
  <footer class="container footer"><span>© Karma Protection</span><span>Protect, Monetize, Earn</span></footer>
</body>
</html>`);
  });

  app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection' }));

  app.get('/api/stats', (req, res) => {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM website_users').get().count;
    res.json({ scripts: scriptCount, keys: keyCount, users: userCount });
  });

  app.post('/api/obfuscate', async (req, res) => {
    const { code, level = 'standard' } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: 'No code provided' });
    try {
      const obfuscated = await callObfuscator(String(code), String(level));
      return res.json({
        ok: true,
        obfuscated,
        level,
        stats: {
          originalSize: String(code).length,
          obfuscatedSize: obfuscated.length,
          ratio: String(code).length ? `${((obfuscated.length / String(code).length) * 100).toFixed(2)}%` : '0%'
        }
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Loadstring endpoint - returns the protected loader
  app.get('/loadstring/:id', (req, res) => {
    const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
    if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
    const baseUrl = publicBaseUrl();
    const loadstring = `getgenv().SCRIPT_KEY = "KEYLESS" loadstring(game:HttpGet("${baseUrl}/api/v1/luascripts/public/${script.id}/download"))()`;
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(loadstring);
  });

  // Script download endpoint
  app.get('/script/:id.lua', (req, res) => {
    const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
    if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code);
  });

  // API v1 endpoint matching the requested format
  app.get('/api/v1/luascripts/public/:id/download', (req, res) => {
    const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
    if (!script) return res.status(404).type('text/plain').send('-- Karma Protection: script not found');
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code);
  });

  app.get('/hosted', (req, res) => {
    const rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 50').all();
    res.json({ ok: true, scripts: rows.map(r => ({ ...r, loadstring: makeLoaderSnippet(r.id) })) });
  });

  app.post('/api/verify', (req, res) => {
    if (GLOBAL_API_TOKEN && req.header('X-Global-Token') !== GLOBAL_API_TOKEN) {
      return res.status(401).json({ ok: false, message: 'Invalid global token' });
    }

    const { script_id, key, hwid, timestamp } = req.body || {};
    const apiSecret = req.header('X-API-Secret');

    if (!script_id || !key || !hwid || !apiSecret) {
      return res.status(400).json({ ok: false, message: 'Missing script_id, key, hwid, or X-API-Secret' });
    }

    if (timestamp) {
      const requestTime = Number(timestamp);
      if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 30000) {
        return res.status(403).json({ ok: false, message: 'Request expired' });
      }
    }

    const banned = db.prepare('SELECT * FROM banned_hwids WHERE hwid = ?').get(String(hwid));
    if (banned) {
      return res.status(403).json({ ok: false, message: 'HWID banned', reason: banned.reason || 'No reason provided' });
    }

    const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(script_id);
    if (!script || script.api_secret_hash !== hashSecret(apiSecret)) {
      return res.status(401).json({ ok: false, message: 'Invalid script or API secret' });
    }

    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND script_id = ?').get(key, script_id);
    if (!license) return res.status(404).json({ ok: false, message: 'Invalid key' });
    if (license.revoked) return res.status(403).json({ ok: false, message: 'Key revoked' });
    if (isExpired(license.expires_at)) return res.status(403).json({ ok: false, message: 'Key expired' });
    if (!license.discord_user_id) return res.status(403).json({ ok: false, message: 'Key not redeemed' });
    if (license.hwid && license.hwid !== hwid) return res.status(403).json({ ok: false, message: 'HWID mismatch' });

    if (!license.hwid) db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);

    return res.json({
      ok: true,
      message: 'License verified',
      discord_user_id: license.discord_user_id,
      expires_at: license.expires_at,
      script_id
    });
  });

  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(18).toString('hex');
    oauthStates.set(state, Date.now());
    for (const [oldState, createdAt] of oauthStates) {
      if (Date.now() - createdAt > 10 * 60 * 1000) oauthStates.delete(oldState);
    }

    const redirectUri = `${publicBaseUrl()}/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state
    });

    return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  app.get('/auth/discord/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state || !oauthStates.has(state)) {
        return res.status(400).type('html').send('<h1>Invalid OAuth state</h1><p>Please go back and try signing in again.</p>');
      }
      oauthStates.delete(state);

      if (!DISCORD_CLIENT_SECRET) {
        return res.status(500).type('html').send('<h1>OAuth not configured</h1><p>Add DISCORD_CLIENT_SECRET in Render environment variables, then redeploy.</p>');
      }

      const redirectUri = `${publicBaseUrl()}/auth/discord/callback`;
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: OAUTH_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri
        })
      });

      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) {
        return res.status(500).type('html').send(`<h1>Discord OAuth failed</h1><pre>${escapeHtml(JSON.stringify(tokenData, null, 2))}</pre>`);
      }

      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userResponse.json();
      if (!userResponse.ok) {
        return res.status(500).type('html').send('<h1>Could not fetch Discord user</h1>');
      }

      db.prepare(`
        INSERT INTO website_users (id, username, global_name, avatar, last_login)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          username=excluded.username,
          global_name=excluded.global_name,
          avatar=excluded.avatar,
          last_login=CURRENT_TIMESTAMP
      `).run(user.id, user.username || null, user.global_name || null, user.avatar || null);

      const secure = publicBaseUrl().startsWith('https://') ? '; Secure' : '';
      res.setHeader('Set-Cookie', `kolsec_session=${encodeURIComponent(makeSession(user))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
      return res.redirect('/dashboard');
    } catch (error) {
      console.error('OAuth callback error:', error);
      return res.status(500).type('html').send(`<h1>OAuth error</h1><pre>${escapeHtml(error.message)}</pre>`);
    }
  });

  app.use((err, req, res, next) => {
    console.error('API error:', err);
    if (res.headersSent) return next(err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
  });

  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));
}

function makeSession(user) {
  const payload = {
    id: user.id,
    username: user.username,
    global_name: user.global_name,
    avatar: user.avatar,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

(async () => {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Slash command deploy failed:', error);
  }

  try { await hydrateHostedScriptsFromSupabase(); } catch (error) { console.warn('Supabase hydrate failed:', error.message); }
  startApiServer();
  await client.login(DISCORD_TOKEN);
})();
