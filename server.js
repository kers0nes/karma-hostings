// server.js
// Full Reconstruction & Enhancement of Karma Protection v6.2
// Features: Advanced VM, Anti-Dump, HWID 24h Cooldown, Key Customizer, Services

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
  MAX_SCRIPTS_PER_USER = '5'
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
      .addStringOption(o => o.setName('color').setDescription('Hex color, example #d4af37').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Key system title').setRequired(false).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Key system description').setRequired(false).setMaxLength(500))),

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
    .setDescription('Create a script/product and API secret')
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
    .setDescription('Host Lua code on Render and get a loadstring')
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
  first_login TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

CREATE INDEX IF NOT EXISTS idx_scripts_guild ON scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_licenses_script ON licenses(script_id);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_guild ON hosted_scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_user ON hosted_scripts(created_by);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_linked ON hosted_scripts(linked_script_id);
CREATE INDEX IF NOT EXISTS idx_premium_codes_redeemed_by ON premium_codes(redeemed_by);
`);

// Migrations for older Render SQLite databases.
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
  'ALTER TABLE website_users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN twofa_secret TEXT',
  "ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
  "ALTER TABLE website_users ADD COLUMN script_quota INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE hosted_scripts ADD COLUMN source_code TEXT",
  "ALTER TABLE hosted_scripts ADD COLUMN linked_script_id TEXT"
]) {
  try { db.prepare(migration).run(); } catch (_) {}
}

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
    key_system_color: next.key_system_color || '#d4af37',
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

function createHostedScript({ guildId, name, code, sourceCode, linkedScriptId, obfuscated, createdBy }) {
  let id = makeId('host');
  const existing = linkedScriptId
    ? db.prepare('SELECT * FROM hosted_scripts WHERE guild_id = ? AND linked_script_id = ?').get(guildId, linkedScriptId)
    : null;

  if (existing) {
    id = existing.id;
    db.prepare(`
      UPDATE hosted_scripts
      SET name = ?, code = ?, source_code = ?, linked_script_id = ?, obfuscated = ?, created_by = ?
      WHERE id = ?
    `).run(name, code, sourceCode || code, linkedScriptId || null, obfuscated ? 1 : 0, createdBy, id);
  } else {
    db.prepare(`
      INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, obfuscated, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    created_by: script.created_by
  };
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
  if (!insert.ok && insert.status !== 201) throw new Error(await insert.text());
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
    INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, obfuscated, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      guild_id=excluded.guild_id,
      name=excluded.name,
      code=excluded.code,
      source_code=excluded.source_code,
      linked_script_id=excluded.linked_script_id,
      obfuscated=excluded.obfuscated,
      created_by=excluded.created_by
  `);
  for (const r of rows) {
    stmt.run(r.id, r.guild_id || 'web', r.name || r.id, r.code || '', r.source_code || r.code || '', r.linked_script_id || null, r.obfuscated ? 1 : 0, r.created_by || 'unknown');
  }
  console.log(`Hydrated ${rows.length} hosted scripts from Supabase.`);
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  return `loadstring(game:HttpGet("${publicBaseUrl()}/loadstring/${scriptId}"))("${scriptId}")`;
}

function makeProtectedLoader(rawUrl, scriptId) {
  const home = publicBaseUrl();
  
  return `--[[
    Karma Protection VM Loader v6.2
    Secure Instruction Stream - Anti-Dump Hardened
]]
return (function(_sid, ...)
  local _G = getfenv(0) or _G
  local _type, _pcall, _tostr, _byte, _error = type, pcall, tostring, string.byte, error
  local _load = loadstring or load
  local _warn = (typeof(warn) == "function") and warn or print
  local _setclip = (typeof(setclipboard) == "function") and setclipboard or nil
  
  local _iqru = ${JSON.stringify(home)}
  local _30lq = ${JSON.stringify(rawUrl)}
  local _r0wo = { script_id = ${JSON.stringify(scriptId)} }
  
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
  
  -- Instruction Stream (Encoded)
  -- 1: PULSE, 2: CHECK_ENV, 3: CHECK_HOOKS, 4: CHECK_GAME, 5: FETCH, 6: EXECUTE
  local _y4m2 = {1, 2, 3, 4, 5, 7, 8, 1, 3, 6}
  
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
          local s = { "hookfunction", "newcclosure", "syn", "fluxus" }
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
        executor = (typeof(identifyexecutor) == "function" and identifyexecutor()) or "unknown"
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
    if _szk7 == 6 then
      return _ci83(...)
    else
      _ci83()
    end
    _gqej = _gqej + 1
  end
end)(...)
`;
}

async function callObfuscator(luaCode, level = 'standard') {
  // Calls the Karma Obfuscator API to obfuscate the given Lua code.
  const selected = String(level || 'standard').toLowerCase();
  const apiUrl = (OBFUSCATOR_API_URL || 'https://luarmor-bot-1-0yt4.onrender.com').replace(/\/$/, '') + '/api/obfuscate';

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(luaCode || ''), level: selected })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`Karma Obfuscator API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.ok || typeof data.obfuscated !== 'string') {
    throw new Error(`Karma Obfuscator API returned an error: ${data.error || JSON.stringify(data).slice(0, 200)}`);
  }

  return data.obfuscated;
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

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

// Prevent duplicate replies if Discord/hosting sends the same interaction twice.
const processedInteractions = new Set();

function panelEmbed(guildId, sentBy = null) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xd4af37)
    .setThumbnail(`${publicBaseUrl()}/assets/karma-logo.png`)
    .setFooter({ text: sentBy ? `Sent By ${sentBy} • Karma Protection` : 'Karma Protection', iconURL: `${publicBaseUrl()}/assets/karma-logo.png` });
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
  const rawColor = settings?.key_system_color || '#d4af37';
  const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? parseInt(rawColor.slice(1), 16) : 0xd4af37;
  return new EmbedBuilder()
    .setTitle(settings?.key_system_title || 'Karma Key System')
    .setDescription(settings?.key_system_description || 'Enter your license key to unlock access')
    .setColor(color)
    .setThumbnail(`${publicBaseUrl()}/assets/karma-logo.png`)
    .addFields(
      { name: 'How to Redeem', value: 'Click Redeem Key on the main panel and enter your license key.' },
      { name: 'HWID Locking', value: 'Your key locks to your first device. Reset HWID has a cooldown.' }
    )
    .setFooter({ text: 'Karma Protection Key System', iconURL: `${publicBaseUrl()}/assets/karma-logo.png` });
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
        '`/apply` - create a script, host it, and get a loadstring',
        '`/createscript` - create a script/API secret only',
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

  if (commandName === 'genkey') {
    return interaction.reply({ ephemeral: true, content: 'This command was removed. Use `/generatekey` now.' });
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

    const patch = {
      panel_channel_id: interaction.channelId,
      panel_title: panelTitle,
      panel_description: panelDescription,
      panel_script_id: panelScriptId || null
    };
    upsertSettings(interaction.guildId, patch);

    // Only ONE Discord response: the panel itself. No channel.send + confirmation.
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
    const script = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });
    await interaction.reply({ ephemeral: true, content: `Script created.\nName: **${script.name}**\nScript ID: \`${script.id}\`\nAPI Secret: \`${script.apiSecret}\`\n\nSave the API secret now. It is only shown once.` });
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

  if (commandName === 'keyinfo') {
    const key = interaction.options.getString('key', true).trim();
    const info = db.prepare(`SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.license_key = ? AND l.guild_id = ?`).get(key, interaction.guildId);
    if (!info) return interaction.reply({ ephemeral: true, content: 'Key not found.' });
    return interaction.reply({ ephemeral: true, content: `Key: \`${info.license_key}\`\nScript: **${info.script_name}**\nStatus: **${keyStatus(info)}**\nUser: ${info.discord_user_id ? `<@${info.discord_user_id}>` : 'None'}\nHWID: ${info.hwid ? `\`${info.hwid}\`` : 'None'}\nExpires: ${info.expires_at || 'Lifetime'}` });
  }

  if (commandName === 'mykeys') return sendMyKeys(interaction, interaction.user.id);

  if (commandName === 'getrole') return giveBuyerRole(interaction);

  if (commandName === 'viewscript') return sendHostedScripts(interaction);

  if (commandName === 'keysystem') {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const color = interaction.options.getString('color') || '#d4af37';
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
    const shouldObfuscate = interaction.options.getBoolean('obfuscate') || false;
    const level = interaction.options.getString('level') || 'standard';

    await interaction.deferReply({ ephemeral: true });

    const script = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });

    let finalCode = originalCode;
    if (shouldObfuscate) {
      try {
        finalCode = await callObfuscator(originalCode, level);
      } catch (error) {
        await interaction.editReply({ content: `Script was created, but obfuscation/hosting failed: ${error.message}\nScript ID: \`${script.id}\`\nAPI Secret: \`${script.apiSecret}\`` });
        return;
      }
    }

    const hosted = createHostedScript({
      guildId: interaction.guildId,
      name,
      code: String(finalCode),
      sourceCode: originalCode,
      linkedScriptId: script.id,
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const base = publicBaseUrl();
    const rawUrl = `${base}/script/${hosted.id}.lua`;
    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Applied **${name}** successfully.\n\nScript ID:\n\`${script.id}\`\n\nAPI Secret, save this now:\n\`${script.apiSecret}\`\n\nHosted Script:\n${rawUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
    });
    await logGuild(interaction.guild, `✅ Applied script \`${name}\` by <@${interaction.user.id}>. Script ID: \`${script.id}\``);
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

    const hosted = createHostedScript({
      guildId: interaction.guildId,
      name,
      code: String(finalCode),
      sourceCode: originalCode,
      linkedScriptId,
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const base = publicBaseUrl();
    const rawUrl = `${base}/script/${hosted.id}.lua`;
    const loadstringUrl = `${base}/loadstring/${hosted.id}`;
    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Hosted **${name}** ${shouldObfuscate ? '(obfuscated)' : ''}${linkedScriptId ? ` for script ID \`${linkedScriptId}\`` : ''}.\n\nRaw script URL:\n${rawUrl}\n\nLoadstring URL:\n${loadstringUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
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
    const example = `-- Generic Lua example. Change request/http_request for your environment.\nlocal key = "PASTE_USER_KEY"\nlocal hwid = "PUT_HWID_HERE"\nlocal apiUrl = "https://YOUR-RENDER-URL.onrender.com/api/verify"\n\nlocal body = '{"script_id":"${scriptId}","key":"' .. key .. '","hwid":"' .. hwid .. '"}'\n\nlocal res = request({\n  Url = apiUrl,\n  Method = "POST",\n  Headers = {\n    ["Content-Type"] = "application/json",\n    ["X-API-Secret"] = "PASTE_SCRIPT_API_SECRET"\n  },\n  Body = body\n})\n\nprint(res.Body)`;
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
  const content = rows.length
    ? rows.map(r => `**${r.name}** ${r.obfuscated ? '(obfuscated)' : ''}\nLoadstring:\n\`\`\`lua\n${makeLoaderSnippet(r.id)}\n\`\`\``).join('\n')
    : 'No script is linked to this panel yet. Repost with `/setup panel ... script_id:<host_id>` or add scripts in the dashboard.';

  if (interaction.deferred || interaction.replied) await interaction.followUp({ ephemeral: true, content });
  else await interaction.reply({ ephemeral: true, content });
}

async function sendKeyInfo(interaction, key) {
  const info = db.prepare(`SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.license_key = ? AND l.guild_id = ?`).get(key, interaction.guildId);
  if (!info) return interaction.reply({ ephemeral: true, content: 'Key not found.' });
  return interaction.reply({ ephemeral: true, content: `Key: \`${info.license_key}\`\nScript: **${info.script_name}**\nStatus: **${keyStatus(info)}**\nUser: ${info.discord_user_id ? `<@${info.discord_user_id}>` : 'None'}\nHWID: ${info.hwid ? `\`${info.hwid}\`` : 'None'}\nExpires: ${info.expires_at || 'Lifetime'}` });
}

async function giveBuyerRole(interaction) {
  const settings = getSettings(interaction.guildId);
  if (!settings || !settings.customer_role_id) return interaction.reply({ ephemeral: true, content: 'Buyer role is not configured. Run `/setup panel title description` first and include customer_role.' });

  const owned = db.prepare('SELECT * FROM licenses WHERE guild_id = ? AND discord_user_id = ? AND revoked = 0 LIMIT 1').get(interaction.guildId, interaction.user.id);
  if (!owned) return interaction.reply({ ephemeral: true, content: 'You need to redeem a key first.' });
  if (isExpired(owned.expires_at)) return interaction.reply({ ephemeral: true, content: 'Your key is expired.' });

  await interaction.member.roles.add(settings.customer_role_id).catch(() => null);
  return interaction.reply({ ephemeral: true, content: 'Buyer role added.' });
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

  if (interaction.customId === 'panel_key_info') {
    const modal = new ModalBuilder().setCustomId('modal_key_info').setTitle('Key Info');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short).setRequired(true)));
    return interaction.showModal(modal);
  }

  if (interaction.customId === 'panel_get_buyer_role') {
    return giveBuyerRole(interaction);
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

  if (interaction.customId === 'modal_key_info') {
    return sendKeyInfo(interaction, key);
  }

  if (interaction.customId === 'modal_reset_hwid') {
    const result = await resetHwid({ guild: interaction.guild, userId: interaction.user.id, key, admin: false });
    return interaction.reply({ ephemeral: true, content: result.message });
  }
}

function makeUserApiKey(userId) {
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(`api:${userId}`).digest('base64url').slice(0, 32);
  return `ks_${userId}_${sig}`;
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

function readCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [decodeURIComponent(v.slice(0, i).trim()), decodeURIComponent(v.slice(i + 1).trim())];
  }));
}

function getSessionUser(req) {
  try {
    const token = readCookies(req).kolsec_session;
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(body).digest('base64url');
    if (!sig || Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const user = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!user.exp || user.exp < Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}

function requireDashboardUser(req, res) {
  const user = getSessionUser(req);
  if (!user) {
    res.redirect('/login');
    return null;
  }
  return user;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ============================================================
// KEYFORGE-STYLE DASHBOARD HTML
// ============================================================

function keyforgeDashboardPage(user, req = { query: {} }) {
  const username = escapeHtml(user.global_name || user.username || 'Discord User');
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : '/assets/karma-logo.png';
  const apiKey = makeUserApiKey(user.id);
  let tab = String(req.query.tab || 'overview');
  const validTabs = ['overview', 'scripts', 'keys', 'obfuscate', 'how', 'redeem', 'discord', 'settings', 'owner', 'storage', 'customizer'];
  if (!validTabs.includes(tab)) tab = 'overview';
  
  const selectedId = String(req.query.script || '');
  const scripts = db.prepare('SELECT id, name, obfuscated, created_at, created_by FROM hosted_scripts ORDER BY created_at DESC LIMIT 500').all();
  const selected = selectedId ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(selectedId) : (scripts[0] ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(scripts[0].id) : null);
  const myScriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE created_by = ?').get(user.id).count;
  const botInvite = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}&permissions=268435456&scope=bot%20applications.commands`;
  const isOwner = user.id === OWNER_ID;
  const dbUserForQuota = db.prepare('SELECT script_quota FROM website_users WHERE id = ?').get(user.id) || {};
  const scriptQuota = isOwner ? 'Unlimited' : Number(dbUserForQuota.script_quota || MAX_WEB_SCRIPTS_PER_USER);
  const remaining = isOwner ? 'Unlimited' : Math.max(0, Number(scriptQuota) - myScriptCount);
  const canEditSelected = selected && (selected.created_by === user.id || isOwner);

  // Get stats
  const totalScripts = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
  const totalKeys = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  const totalLoads = db.prepare('SELECT COUNT(*) AS count FROM execution_logs').get().count;

  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${selected?.id === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${escapeHtml(s.created_at)}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  
  if (tab === 'overview') {
    content = `
      <div class="card heroCard">
        <p class="eyebrow">Overview</p>
        <h2>Karma Protection v6.2</h2>
        <p class="muted">Advanced VM protection, anti-dump hardening, and secure script delivery.</p>
        <div class="stats">
          <div class="stat"><div class="num">${totalScripts}</div><span>Scripts</span></div>
          <div class="stat"><div class="num">${totalKeys}</div><span>Keys</span></div>
          <div class="stat"><div class="num">${totalLoads}</div><span>Loads</span></div>
        </div>
        <div class="anime"></div>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Scripts</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-accent">${totalScripts}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Keys</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${totalKeys}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Loads</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${totalLoads}</p>
        </div>
        <div class="stat-card card px-5 py-4">
          <p class="kf-label">Projects</p>
          <p class="mt-2 font-display text-3xl font-semibold tabular-nums text-txt">${myScriptCount}</p>
        </div>
      </div>
      <div class="filter-bar">
        <a href="/dashboard?tab=scripts">Scripts</a>
        <a href="/dashboard?tab=keys">Keys</a>
        <a href="/dashboard?tab=obfuscate">Obfuscator</a>
        <a href="/dashboard?tab=discord">Discord</a>
        <a href="/dashboard?tab=customizer">GUI Customizer</a>
      </div>
    `;
  } else if (tab === 'scripts') {
    content = selected ? `
      <div class="card"><div class="cardHead"><div><p class="eyebrow">Selected Script</p><h2>${escapeHtml(selected.name)}</h2><p class="muted">${selected.obfuscated ? 'Obfuscated build · edits auto re-obfuscate on save' : 'Plain build'} · ${escapeHtml(selected.created_at)}</p></div></div>
      <h3>Loadstring</h3><code class="block">${makeLoaderSnippet(selected.id)}</code>
      ${canEditSelected ? `
        <h3>Edit Script</h3>
        <form method="post" action="/dashboard/scripts/${selected.id}/update">
          <label>Script name</label>
          <input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required>
          <label>Actual Source</label>
          <textarea name="code" maxlength="4000" required>${escapeHtml(selected.source_code || selected.code)}</textarea>
          <label class="check"><input type="checkbox" name="obfuscate" value="true" ${selected.obfuscated ? 'checked' : ''}> Obfuscate on save</label>
          <label>Obfuscation level</label>
          <select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="vm">VM Protected</option></select>
          <div class="buttonRow"><button type="submit">Save Permanently</button>
          <button class="secondary" type="submit" formaction="/dashboard/obfuscate" formmethod="post">Obfuscate</button></div>
        </form>
      ` : `<p class="muted">This script is available as a loadstring. Source editing is limited to the owner/creator.</p>`}
      </div>
      <div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2>
      <form method="post" action="/dashboard/scripts">
        <label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required>
        <label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain">
        <label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea>
        <label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label>
        <label>Obfuscation level</label>
        <select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="vm">VM Protected</option></select>
        <button>Save Script</button>
      </form></div>
    ` : `<div class="card"><h2>Scripts</h2><p class="muted">Add your first script below. Scripts are saved permanently unless the owner removes them from the database.</p></div>
      <div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2>
      <form method="post" action="/dashboard/scripts">
        <label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required>
        <label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain">
        <label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea>
        <label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label>
        <label>Obfuscation level</label>
        <select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="vm">VM Protected</option></select>
        <button>Save Script</button>
      </form></div>`;
  } else if (tab === 'keys') {
    const projects = db.prepare('SELECT id, name, created_at FROM scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
    const keys = db.prepare('SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.created_by = ? ORDER BY l.created_at DESC LIMIT 50').all(user.id);
    content = `
      <div class="card"><p class="eyebrow">Keys</p><h2>Generate keys for projects</h2>
      <p class="muted">Create whitelist keys for any project you own.</p>
      <form method="post" action="/dashboard/keys">
        <label>Project</label>
        <select name="script_id">${projects.map(pr=>`<option value="${escapeHtml(pr.id)}">${escapeHtml(pr.name)} · ${escapeHtml(pr.id)}</option>`).join('')}</select>
        <label>Days</label><input name="days" type="number" value="30" min="0" max="3650">
        <label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20">
        <button>Generate Keys</button>
      </form>
      <h3>Recent Keys</h3>
      ${keys.map(k=>`<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${escapeHtml(k.script_name)} · ${k.expires_at || 'Lifetime'} · ${k.revoked ? 'Revoked' : 'Active'}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}
      </div>`;
  } else if (tab === 'obfuscate') {
    content = `
      <div class="card"><p class="eyebrow">Obfuscator</p><h2>Protect Lua source</h2>
      <p class="muted">Multi-layer obfuscation with VM protection, anti-tamper checks, and encoded payloads.</p>
      <form method="post" action="/dashboard/obfuscate">
        <label>Filename</label><input name="filename" value="obfuscated.lua">
        <label>Lua source</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("protect me")' required></textarea>
        <label>Obfuscation level</label>
        <select name="level">
          <option value="light">Light</option>
          <option value="standard" selected>Standard</option>
          <option value="max">Maximum</option>
          <option value="vm">VM Protected</option>
        </select>
        <div class="buttonRow"><button type="submit">Obfuscate</button>
        <a class="btn dark" href="/dashboard?tab=scripts">Scripts</a></div>
      </form>
      <div class="featureGrid">
        <div>Anti-tamper checksum</div>
        <div>Anti-Dump Hardening</div>
        <div>Rolling XOR byte encoding</div>
        <div>Decoy layer for dumps</div>
        <div>Random local names</div>
        <div>Protected output banner</div>
        <div>VM Protection</div>
        <div>Runtime integrity checks</div>
      </div></div>`;
  } else if (tab === 'customizer') {
    content = `
      <div class="card"><p class="eyebrow">GUI Customizer</p><h2>Key System Customizer</h2>
      <p class="muted">Customize the look and feel of your key redemption panel.</p>
      <form method="post" action="/dashboard/customize">
        <label>Panel Title</label><input name="title" value="Karma Key System" maxlength="100">
        <label>Panel Description</label><textarea name="description" maxlength="500">Enter your license key to unlock access</textarea>
        <label>Color</label><input name="color" type="color" value="#d4af37">
        <button class="btn">Save Customization</button>
      </form>
      <h3>Preview</h3>
      <div style="border:1px solid #333;border-radius:12px;padding:20px;background:#0a0a0b;margin-top:10px;">
        <h3 style="color:#d4af37;">Karma Key System</h3>
        <p style="color:#888;">Enter your license key to unlock access</p>
        <div style="display:flex;gap:10px;margin-top:10px;">
          <button style="background:#d4af37;color:#000;border:none;padding:8px 16px;border-radius:6px;">Redeem Key</button>
          <button style="background:#333;color:#fff;border:none;padding:8px 16px;border-radius:6px;">Reset HWID</button>
        </div>
      </div>
      </div>`;
  } else if (tab === 'how') {
    content = `
      <div class="card"><p class="eyebrow">How It Works</p><h2>Complete workflow</h2>
      <div class="stepsDash">
        <div><span>1</span><b>Upload source</b><p>Go to Scripts and upload a Lua file or paste code.</p></div>
        <div><span>2</span><b>Obfuscate or host</b><p>Enable obfuscation and create a hosted loadstring.</p></div>
        <div><span>3</span><b>Link Discord</b><p>Run <code>/link api key:${apiKey}</code> in your server.</p></div>
        <div><span>4</span><b>Generate keys</b><p>Use <code>/generatekey</code> and the panel for buyers.</p></div>
      </div></div>`;
  } else if (tab === 'redeem') {
    content = `
      <div class="card"><p class="eyebrow">Redeem</p><h2>Redeem access code</h2>
      <p class="muted">Paste a premium or access code you received.</p>
      <form method="post" action="/redeem">
        <input name="code" placeholder="XXXX-XXXX-XXXX" required>
        <button type="submit">Redeem</button>
      </form></div>`;
  } else if (tab === 'discord') {
    content = `
      <div class="card"><p class="eyebrow">Discord</p><h2>Connect your server</h2>
      <p class="muted">Add the bot to your server, then link your dashboard API key.</p>
      <a class="btn" href="${botInvite}">Add Discord Bot To Server</a>
      <h3>Link API</h3><code class="block">/link api key:${apiKey}</code>
      <p class="muted">Run this in Discord to connect the server to the website.</p></div>`;
  } else if (tab === 'settings') {
    const dbUser = db.prepare('SELECT * FROM website_users WHERE id = ?').get(user.id) || {};
    const displayName = dbUser.display_username || user.username || '';
    content = `
      <div class="card"><p class="eyebrow">Settings</p><h2>Account settings</h2>
      <form method="post" action="/dashboard/settings">
        <label>Username</label>
        <input name="display_username" minlength="3" maxlength="24" pattern="[A-Za-z0-9]{3,24}" value="${escapeHtml(displayName)}" required>
        <p class="hint">Usernames can only be 3–24 letters or numbers.</p>
        <label class="check"><input type="checkbox" name="twofa_enabled" value="true" ${dbUser.twofa_enabled ? 'checked' : ''}> Enable two factor authentication</label>
        <button type="submit">Save Settings</button>
      </form></div>`;
  } else if (tab === 'owner' && isOwner) {
    const codes = db.prepare('SELECT * FROM premium_codes ORDER BY created_at DESC LIMIT 50').all();
    const banned = db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC LIMIT 50').all();
    content = `
      <div class="card"><p class="eyebrow">Owner Only</p><h2>Owner panel</h2>
      <div class="stats">
        <div class="stat"><div class="num">${scripts.length}</div><span>Total scripts</span></div>
        <div class="stat"><div class="num">${banned.length}</div><span>Banned HWIDs</span></div>
        <div class="stat"><div class="num">5</div><span>Default script limit</span></div>
      </div>
      <h3>Create premium code</h3>
      <form method="post" action="/owner/codes">
        <input name="code" placeholder="PREMIUM-KEY-123" required>
        <input name="plan" placeholder="premium" value="premium">
        <button>Create Code</button>
      </form>
      <h3>Ban HWID</h3>
      <form method="post" action="/owner/ban-hwid">
        <input name="hwid" placeholder="HWID" required>
        <input name="reason" placeholder="Reason">
        <button class="danger">Ban HWID</button>
      </form>
      <h3>Add script to user</h3>
      <form method="post" action="/owner/add-user-script">
        <input name="user_id" placeholder="Discord user ID" required>
        <input name="name" placeholder="Script name" required>
        <textarea name="code" maxlength="4000" placeholder="Lua source" required></textarea>
        <label>Obfuscation level</label>
        <select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="vm">VM Protected</option></select>
        <label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before assigning</label>
        <button>Add Script To User</button>
      </form>
      <h3>Manage user access</h3>
      <form method="post" action="/owner/user-plan" class="inlineForm">
        <input name="user_id" placeholder="Discord user ID" required>
        <select name="plan"><option value="free">free</option><option value="premium">premium</option><option value="royal">royal</option><option value="banned">banned</option></select>
        <input name="script_quota" type="number" min="0" max="10000" value="5" style="width:120px">
        <button>Set Access</button>
      </form>
      <h3>Premium codes</h3>
      ${codes.map(c=>`<div class="row"><b>${escapeHtml(c.code)}</b><small>${escapeHtml(c.plan)} · redeemed by ${escapeHtml(c.redeemed_by||'nobody')}</small></div>`).join('')}
      </div>`;
  } else if (tab === 'storage') {
    if (!isOwner) {
      content = `<div class="card"><h2>Script Storage</h2><p class="muted">Only the owner can access global storage.</p></div>`;
    } else {
      const stored = db.prepare('SELECT * FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC LIMIT 500').all(OWNER_ID);
      content = `
        <div class="card"><p class="eyebrow">Owner Storage</p><h2>Script Storage</h2>
        <p class="muted">Owner account has unlimited scripts. Add global scripts here and use them in panels/loadstrings.</p>
        <form method="post" action="/owner/storage">
          <label>Name</label><input name="name" maxlength="80" required>
          <label>Source</label><textarea name="code" maxlength="4000" required></textarea>
          <label>Obfuscation level</label>
          <select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="vm">VM Protected</option></select>
          <label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before storing</label>
          <button>Add Stored Script</button>
        </form>
        <h3>Stored Scripts</h3>
        ${stored.map(r=>`<div class="row"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.id)} · ${r.obfuscated ? 'Obfuscated' : 'Plain'}</small><code class="block">${makeLoaderSnippet(r.id)}</code></div>`).join('') || '<p class="muted">No stored scripts.</p>'}
        </div>`;
    }
  }

  return `<!doctype html>
<html lang="en" data-theme="violet" data-appearance="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karma Protection v6.2 — protect & deliver scripts</title>
  <meta name="description" content="Upload a script, lock it with keys, share a loader. Discord panels included." />
  <link rel="icon" href="/assets/karma-logo.png" />
  <style>
    :root {
      --bg: #030303;
      --surface: rgba(15,15,16,0.85);
      --surface-2: rgba(25,25,28,0.7);
      --muted: #a1a1aa;
      --stroke: rgba(255,255,255,0.08);
      --stroke-hi: rgba(255,255,255,0.18);
      --text: #f8fafc;
      --text-2: #d4d4d8;
      --text-3: #a1a1aa;
      --accent: #d4af37;
      --accent-hover: #e3c94a;
      --green: #4ade80;
      --red: #f87171;
      --gold: #d4af37;
      --gold2: #f1d592;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85)), 
                  radial-gradient(circle at 20% 30%, rgba(212,175,55,0.06), transparent 40%),
                  radial-gradient(circle at 80% 70%, rgba(212,175,55,0.04), transparent 35%),
                  #030303;
      color: var(--text);
      font-family: "SF Pro Display", "Aptos", "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
      letter-spacing: -0.01em;
    }
    a { color: inherit; text-decoration: none; }
    .container { width: min(1400px, 96%); margin: 0 auto; padding: 0 16px; }
    
    /* Topbar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      border-bottom: 1px solid var(--stroke);
      background: rgba(3,3,3,0.92);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 780;
    }
    .topbar .brand img {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      border: 1px solid rgba(212,175,55,0.4);
    }
    .topbar .brand span {
      font-size: 18px;
    }
    .topbar .brand small {
      font-size: 12px;
      color: var(--muted);
      font-weight: 400;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(212,175,55,0.3);
      background: rgba(255,255,255,0.05);
      padding: 8px 16px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      transition: 0.2s;
    }
    .btn:hover {
      border-color: var(--gold);
      background: rgba(212,175,55,0.12);
    }
    .btn-accent {
      background: linear-gradient(180deg, var(--gold2), var(--gold));
      color: #000;
      border-color: var(--gold);
    }
    .btn-accent:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 30px rgba(212,175,55,0.25);
    }
    .btn-dark {
      background: rgba(10,10,10,0.8);
      color: #fff;
      border-color: rgba(255,255,255,0.2);
    }
    .btn-danger {
      background: #220f0f;
      color: #ffb4ad;
      border-color: #5b2521;
    }
    
    /* Dashboard layout */
    .dashboard {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 0;
      min-height: calc(100vh - 68px);
    }
    .sidebar {
      background: rgba(8,8,8,0.95);
      border-right: 1px solid var(--stroke);
      padding: 20px 12px;
      overflow-y: auto;
      position: sticky;
      top: 68px;
      height: calc(100vh - 68px);
    }
    .sidebar .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      color: var(--text-2);
      font-weight: 600;
      font-size: 14px;
      transition: 0.15s;
      margin-bottom: 2px;
    }
    .sidebar .nav-link:hover {
      background: rgba(255,255,255,0.06);
      color: #fff;
    }
    .sidebar .nav-link.active {
      background: rgba(212,175,55,0.15);
      color: var(--gold);
    }
    .sidebar .nav-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-3);
      padding: 12px 14px 6px;
      font-weight: 700;
    }
    .sidebar .profile-card {
      border-top: 1px solid var(--stroke);
      margin-top: 16px;
      padding-top: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
    }
    .sidebar .profile-card .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid var(--stroke);
    }
    .sidebar .profile-card .name {
      font-weight: 600;
      font-size: 14px;
    }
    .sidebar .profile-card .plan {
      font-size: 12px;
      color: var(--text-3);
    }
    
    .main-content {
      padding: 24px 32px;
      overflow-y: auto;
    }
    
    /* Cards */
    .card {
      border: 1px solid var(--stroke);
      border-radius: 20px;
      background: var(--surface);
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    .card h2 {
      font-size: clamp(28px, 3.5vw, 44px);
      line-height: 1.05;
      letter-spacing: -0.04em;
      margin: 4px 0 8px;
    }
    .card h3 {
      font-size: 16px;
      margin: 16px 0 8px;
      font-weight: 700;
    }
    .eyebrow {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-3);
      font-weight: 700;
    }
    .muted { color: var(--text-3); }
    .pad { padding: 8px 0; }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .stat {
      border: 1px solid var(--stroke);
      border-radius: 14px;
      background: var(--surface-2);
      padding: 16px;
    }
    .stat .num {
      font-size: 34px;
      font-weight: 850;
      letter-spacing: -0.04em;
      color: var(--gold);
    }
    .stat span {
      display: block;
      font-size: 13px;
      color: var(--text-3);
      margin-top: 4px;
    }
    
    .stat-card {
      border: 1px solid var(--stroke);
      border-radius: 16px;
      background: var(--surface-2);
      padding: 16px 20px;
    }
    .stat-card .kf-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-3);
      font-weight: 600;
    }
    .stat-card .text-accent { color: var(--gold); }
    .stat-card .text-txt { color: var(--text); }
    .stat-card .text-green { color: var(--green); }
    .stat-card .text-3xl { font-size: 30px; font-weight: 700; }
    .stat-card .tabular-nums { font-feature-settings: "tnum"; }
    
    .grid { display: grid; gap: 12px; }
    .grid-cols-2 { grid-template-columns: 1fr 1fr; }
    .gap-3 { gap: 12px; }
    @media (min-width: 1024px) {
      .lg\\:grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
    }
    
    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .filter-bar a {
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--stroke);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-2);
      transition: 0.15s;
    }
    .filter-bar a:hover {
      border-color: var(--gold);
      color: var(--text);
    }
    
    input, textarea, select {
      width: 100%;
      background: rgba(8,8,9,0.9);
      color: #fff;
      border: 1px solid #343438;
      border-radius: 12px;
      padding: 10px 14px;
      margin: 6px 0 12px;
      font: inherit;
    }
    textarea { min-height: 120px; }
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
      border-radius: 12px;
      font-family: monospace;
      font-size: 13px;
    }
    .row {
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 10px 14px;
      margin: 6px 0;
      background: rgba(11,11,12,0.6);
    }
    .buttonRow { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    .inlineForm { display: flex; gap: 10px; flex-wrap: wrap; }
    .inlineForm input, .inlineForm select { width: auto; flex: 1; min-width: 120px; }
    
    .featureGrid, .stepsDash {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .featureGrid div, .stepsDash div {
      border: 1px solid #27272a;
      border-radius: 14px;
      background: rgba(11,11,12,0.6);
      padding: 14px;
    }
    .stepsDash span {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--gold);
      color: #000;
      font-weight: 900;
      font-size: 14px;
      margin-right: 8px;
    }
    .stepsDash b { display: inline-block; margin-top: 4px; }
    .stepsDash p { font-size: 13px; color: var(--text-3); margin: 4px 0 0; }
    
    .anime {
      height: 140px;
      border-radius: 16px;
      border: 1px solid #27272a;
      margin-top: 16px;
      background: radial-gradient(circle at 30% 50%, rgba(212,175,55,0.12), transparent 18%),
                  radial-gradient(circle at 70% 50%, rgba(212,175,55,0.08), transparent 20%),
                  linear-gradient(120deg, #000, #111, #000);
      background-size: 160% 160%;
      animation: movebg 6s infinite alternate;
      position: relative;
      overflow: hidden;
    }
    .anime:after {
      content: '';
      position: absolute;
      inset: -40%;
      background: conic-gradient(from 0deg, transparent, rgba(212,175,55,0.08), transparent 35%);
      animation: spin 8s linear infinite;
    }
    @keyframes movebg { to { background-position: 100% 60%; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .scriptLink {
      display: block;
      border: 1px solid var(--stroke);
      background: rgba(14,14,14,0.8);
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 8px;
      transition: 0.15s;
    }
    .scriptLink:hover { border-color: var(--stroke-hi); }
    .scriptLink.active {
      border-color: var(--gold);
      background: linear-gradient(180deg, rgba(212,175,55,0.12), rgba(18,18,18,0.9));
    }
    .scriptLink b { display: block; font-size: 15px; }
    .scriptLink small { font-size: 12px; color: var(--text-3); }
    
    .logout-link {
      color: var(--text-3);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      transition: 0.15s;
      margin-top: auto;
    }
    .logout-link:hover {
      background: rgba(255,255,255,0.05);
      color: #ffb4ad;
    }
    
    @media (max-width: 900px) {
      .dashboard { grid-template-columns: 1fr; }
      .sidebar {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 100;
        height: 100vh;
        width: 280px;
        background: rgba(8,8,8,0.98);
        border-right: 1px solid var(--stroke);
        padding: 16px;
      }
      .sidebar.open { display: block; }
      .main-content { padding: 16px; }
      .topbar { padding: 10px 16px; }
      .grid-cols-2 { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr 1fr; }
      .featureGrid, .stepsDash { grid-template-columns: 1fr; }
    }
    @media (max-width: 500px) {
      .stats { grid-template-columns: 1fr; }
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #666; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <img src="/assets/karma-logo.png" alt="Karma Protection">
      <div>
        <span>Karma Protection v6.2</span>
        <small>protect & deliver</small>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="btn btn-dark" onclick="document.getElementById('sidebar').classList.toggle('open')" aria-label="Toggle menu">☰</button>
      <a class="btn btn-dark" href="/logout">Sign out</a>
    </div>
  </header>
  
  <div class="dashboard">
    <aside class="sidebar" id="sidebar">
      <div class="nav-label">Workspace</div>
      <a class="nav-link ${tab === 'overview' ? 'active' : ''}" href="/dashboard">Home</a>
      <a class="nav-link ${tab === 'scripts' ? 'active' : ''}" href="/dashboard?tab=scripts">Scripts</a>
      <a class="nav-link ${tab === 'keys' ? 'active' : ''}" href="/dashboard?tab=keys">Keys</a>
      <a class="nav-link ${tab === 'how' ? 'active' : ''}" href="/dashboard?tab=how">Guide</a>
      
      <div class="nav-label">Tools</div>
      <a class="nav-link ${tab === 'obfuscate' ? 'active' : ''}" href="/dashboard?tab=obfuscate">Obfuscator</a>
      <a class="nav-link ${tab === 'customizer' ? 'active' : ''}" href="/dashboard?tab=customizer">GUI Customizer</a>
      <a class="nav-link ${tab === 'discord' ? 'active' : ''}" href="/dashboard?tab=discord">Discord</a>
      <a class="nav-link ${tab === 'redeem' ? 'active' : ''}" href="/dashboard?tab=redeem">Redeem</a>
      ${isOwner ? `<a class="nav-link ${tab === 'owner' ? 'active' : ''}" href="/dashboard?tab=owner">Owner Panel</a>` : ''}
      <a class="nav-link ${tab === 'storage' ? 'active' : ''}" href="/dashboard?tab=storage">Storage</a>
      <a class="nav-link ${tab === 'settings' ? 'active' : ''}" href="/dashboard?tab=settings">Settings</a>
      
      <div class="profile-card">
        <img class="avatar" src="${avatar}" alt="Avatar">
        <div>
          <div class="name">${username}</div>
          <div class="plan">${myScriptCount} scripts</div>
        </div>
      </div>
      <a class="logout-link" href="/logout">Sign out</a>
    </aside>
    
    <main class="main-content">
      ${content}
    </main>
  </div>
  
  <script>
    // File upload handler
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
    
    // Close sidebar on outside click (mobile)
    document.addEventListener('click', function(e) {
      const sidebar = document.getElementById('sidebar');
      if (window.innerWidth <= 900 && sidebar && sidebar.classList.contains('open')) {
        if (!sidebar.contains(e.target) && !e.target.closest('.topbar-actions')) {
          sidebar.classList.remove('open');
        }
      }
    });
  </script>
</body>
</html>`;
}

// ---------------- Express API ----------------
function startApiServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use('/assets', express.static('public'));

  app.get('/', (req, res) => {
    const user = getSessionUser(req);
    if (user) return res.redirect('/dashboard');
    res.type('html').send(`
      <!doctype html>
      <html><head><title>Karma Protection</title>
      <style>body{margin:0;background:#030303;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}.card{max-width:600px;padding:48px;border:1px solid #333;border-radius:28px;background:#0a0a0a}h1{font-size:48px;letter-spacing:-.04em}.gold{color:#d4af37}a{display:inline-block;margin-top:20px;padding:12px 28px;border:1px solid #d4af37;border-radius:999px;color:#fff;text-decoration:none;font-weight:700}a:hover{background:#d4af37;color:#000}</style>
      </head><body>
      <div class="card">
        <h1>Karma <span class="gold">Protection v6.2</span></h1>
        <p>Protect your Lua scripts with HWID-locked keys, obfuscation, and Discord integration.</p>
        <a href="/login">Sign in with Discord</a>
      </div>
      </body></html>
    `);
  });
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection v6.2' }));

  app.get('/api/stats', (req, res) => {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
    res.json({ scripts: scriptCount, keys: keyCount });
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

  app.get('/dashboard', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    return res.type('html').send(keyforgeDashboardPage(user, req));
  });

  app.post('/dashboard/customize', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const title = String(req.body.title || '').trim().slice(0, 100);
    const description = String(req.body.description || '').trim().slice(0, 500);
    const color = String(req.body.color || '#d4af37');
    // Store customization in guild_settings or user settings
    // For now, just redirect back
    return res.redirect('/dashboard?tab=customizer');
  });

  app.post('/dashboard/scripts', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;

    const count = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE created_by = ?').get(user.id).count;
    const quotaRow = db.prepare('SELECT script_quota FROM website_users WHERE id = ?').get(user.id) || {};
    const quota = Number(quotaRow.script_quota || MAX_WEB_SCRIPTS_PER_USER);
    if (user.id !== OWNER_ID && count >= quota) {
      return res.status(403).type('html').send(`<h1>Script limit reached</h1><p>You already have ${quota} scripts.</p><a href="/dashboard">Back</a>`);
    }

    const name = String(req.body.name || '').trim().slice(0, 80);
    const code = String(req.body.code || '').slice(0, 4000);
    const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
    const level = String(req.body.level || 'standard');
    if (!name || !code) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard">Back</a>');

    let finalCode = code;
    if (shouldObfuscate) finalCode = await callObfuscator(code, level);

    createHostedScript({
      guildId: 'web',
      name,
      code: String(finalCode),
      sourceCode: code,
      obfuscated: shouldObfuscate,
      createdBy: user.id
    });

    return res.redirect('/dashboard?tab=scripts');
  });

  app.post('/dashboard/keys', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const scriptId = String(req.body.script_id || '').trim();
    const days = Math.max(0, Math.min(3650, Number(req.body.days || 0)));
    const quantity = Math.max(1, Math.min(20, Number(req.body.quantity || 1)));
    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND created_by = ?').get(scriptId, user.id);
    if (!script) return res.status(404).type('html').send('<h1>Project not found</h1><p>Create a project with the Discord bot /apply or /createscript first.</p><a href="/dashboard?tab=keys">Back</a>');
    const expiresAt = addDays(days);
    const insert = db.prepare('INSERT INTO licenses (license_key, script_id, guild_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < quantity; i++) insert.run(makeKey('KS'), scriptId, script.guild_id, expiresAt, user.id);
    return res.redirect('/dashboard?tab=keys');
  });

  app.post('/dashboard/scripts/:id/update', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const current = user.id === OWNER_ID
      ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(req.params.id, user.id);
    if (!current) return res.status(404).type('html').send('<h1>Script not found</h1><a href="/dashboard?tab=scripts">Back</a>');

    const name = String(req.body.name || current.name).trim().slice(0, 80);
    const source = String(req.body.code || '').slice(0, 4000);
    const level = String(req.body.level || 'standard');
    const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
    if (!name || !source) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

    const finalCode = shouldObfuscate ? await callObfuscator(source, level) : source;
    db.prepare('UPDATE hosted_scripts SET name = ?, code = ?, source_code = ?, obfuscated = ? WHERE id = ?')
      .run(name, finalCode, source, shouldObfuscate ? 1 : 0, req.params.id);
    return res.redirect(`/dashboard?tab=scripts&script=${encodeURIComponent(req.params.id)}`);
  });

  app.post('/dashboard/settings', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const display = String(req.body.display_username || '').trim();
    if (!/^[A-Za-z0-9]{3,24}$/.test(display)) {
      return res.status(400).type('html').send('<h1>Invalid username</h1><p>Usernames must be 3–24 letters/numbers only.</p><a href="/dashboard?tab=settings">Back</a>');
    }
    const twofa = req.body.twofa_enabled === 'true' || req.body.twofa_enabled === 'on' ? 1 : 0;
    const secret = twofa ? (db.prepare('SELECT twofa_secret FROM website_users WHERE id = ?').get(user.id)?.twofa_secret || crypto.randomBytes(10).toString('hex')) : null;
    db.prepare('UPDATE website_users SET display_username = ?, twofa_enabled = ?, twofa_secret = ? WHERE id = ?')
      .run(display, twofa, secret, user.id);
    return res.redirect('/dashboard?tab=settings');
  });

  app.post('/dashboard/obfuscate', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const code = String(req.body.code || '').slice(0, 4000);
    const filename = String(req.body.filename || req.body.name || 'obfuscated.lua').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const level = String(req.body.level || 'standard');
    if (!code) return res.status(400).type('html').send('<h1>Missing code</h1><a href="/dashboard?tab=obfuscate">Back</a>');
    const obfuscated = await callObfuscator(code, level);
    return res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Obfuscated - Karma Protection</title><style>body{margin:0;background:#000;color:#fff;font-family:SF Pro Display,Aptos,Segoe UI,system-ui,sans-serif}.wrap{width:min(1100px,94%);margin:32px auto}.card{border:1px solid #2a2a2d;border-radius:28px;background:linear-gradient(180deg,#181818,#080808);padding:24px}textarea{width:100%;min-height:62vh;background:#050505;color:#fff;border:1px solid #333;border-radius:16px;padding:14px;font:12px ui-monospace,monospace}button,a{display:inline-flex;margin:10px 8px 18px 0;padding:12px 16px;border-radius:999px;border:1px solid #fff;background:#fff;color:#000;text-decoration:none;font-weight:900;cursor:pointer}.dark{background:#000;color:#fff;border-color:#333}</style></head><body><div class="wrap"><div class="card"><h1>Obfuscated Successfully</h1><p>Level: <b>${escapeHtml(level)}</b>. Copy it below — no download needed.</p><button onclick="navigator.clipboard.writeText(document.getElementById('out').value)">Copy Obfuscated Code</button><a class="dark" href="/dashboard?tab=obfuscate">Back to Obfuscator</a><a class="dark" href="/dashboard?tab=scripts">Scripts</a><textarea id="out" spellcheck="false">${escapeHtml(obfuscated)}</textarea></div></div></body></html>`);
  });

  app.post('/redeem', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const code = String(req.body.code || '').trim();
    const row = db.prepare('SELECT * FROM premium_codes WHERE code = ?').get(code);
    if (!row) return res.status(404).type('html').send('<h1>Invalid code</h1><a href="/dashboard?tab=redeem">Back</a>');
    if (row.redeemed_by && row.redeemed_by !== user.id) return res.status(403).type('html').send('<h1>Code already redeemed</h1><a href="/dashboard?tab=redeem">Back</a>');
    db.prepare('UPDATE premium_codes SET redeemed_by = ?, redeemed_at = COALESCE(redeemed_at, CURRENT_TIMESTAMP) WHERE code = ?').run(user.id, code);
    return res.type('html').send('<h1>Redeemed successfully</h1><p>Your premium code is now linked to your Discord account.</p><a href="/dashboard">Back to dashboard</a>');
  });

  app.post('/owner/storage', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const name = String(req.body.name || '').trim().slice(0, 80);
    const source = String(req.body.code || '').slice(0, 4000);
    const level = String(req.body.level || 'standard');
    const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
    if (!name || !source) return res.status(400).type('html').send('<h1>Missing storage script</h1><a href="/dashboard?tab=storage">Back</a>');
    const finalCode = shouldObfuscate ? await callObfuscator(source, level) : source;
    createHostedScript({ guildId: 'owner-storage', name, code: finalCode, sourceCode: source, obfuscated: shouldObfuscate, createdBy: OWNER_ID });
    return res.redirect('/dashboard?tab=storage');
  });

  app.post('/owner/codes', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const code = String(req.body.code || '').trim();
    const plan = String(req.body.plan || 'premium').trim();
    if (code) db.prepare('INSERT OR IGNORE INTO premium_codes (code, plan, created_by) VALUES (?, ?, ?)').run(code, plan, user.id);
    return res.redirect('/dashboard?tab=owner');
  });

  app.post('/owner/add-user-script', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const targetId = String(req.body.user_id || '').trim();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const source = String(req.body.code || '').slice(0, 4000);
    const level = String(req.body.level || 'standard');
    const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
    if (!targetId || !name || !source) return res.status(400).type('html').send('<h1>Missing fields</h1><a href="/dashboard?tab=owner">Back</a>');
    db.prepare('INSERT OR IGNORE INTO website_users (id, username, global_name, display_username, script_quota) VALUES (?, ?, ?, ?, ?)')
      .run(targetId, targetId, targetId, targetId, MAX_WEB_SCRIPTS_PER_USER);
    const finalCode = shouldObfuscate ? await callObfuscator(source, level) : source;
    createHostedScript({ guildId: 'owner-assigned', name, code: finalCode, sourceCode: source, obfuscated: shouldObfuscate, createdBy: targetId });
    return res.redirect('/dashboard?tab=owner');
  });

  app.post('/owner/user-plan', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const userId = String(req.body.user_id || '').trim();
    const plan = String(req.body.plan || 'free').trim();
    const quota = Math.max(0, Math.min(10000, Number(req.body.script_quota || MAX_WEB_SCRIPTS_PER_USER)));
    if (userId && ['free', 'premium', 'royal', 'banned'].includes(plan)) {
      db.prepare(`INSERT INTO website_users (id, username, global_name, display_username, plan, script_quota, last_login)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET plan=excluded.plan, script_quota=excluded.script_quota`)
        .run(userId, userId, userId, userId, plan, quota);
    }
    return res.redirect('/dashboard?tab=owner');
  });

  app.post('/owner/ban-hwid', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const hwid = String(req.body.hwid || '').trim();
    const reason = String(req.body.reason || '').trim();
    if (hwid) db.prepare('INSERT OR REPLACE INTO banned_hwids (hwid, reason, banned_by) VALUES (?, ?, ?)').run(hwid, reason, user.id);
    return res.redirect('/dashboard?tab=owner');
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'kolsec_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return res.redirect('/');
  });

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

  app.get('/hosted', (req, res) => {
    const rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 50').all();
    res.json({ ok: true, scripts: rows.map(r => ({ ...r, script_url: `${publicBaseUrl()}/script/${r.id}.lua`, loadstring_url: `${publicBaseUrl()}/loadstring/${r.id}` })) });
  });

  app.post('/api/log-execution', (req, res) => {
    const { script_id, key, hwid, executor } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (script_id) {
      db.prepare('INSERT INTO execution_logs (script_id, license_key, hwid, ip, executor) VALUES (?, ?, ?, ?, ?)')
        .run(script_id, key || null, hwid || null, ip || null, executor || null);
    }
    
    return res.json({ ok: true });
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

  app.use((err, req, res, next) => {
    console.error('Website error:', err);
    if (res.headersSent) return next(err);
    return res.status(500).type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Protection Error</title><style>body{margin:0;background:#000;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(680px,92%);border:1px solid #333;border-radius:24px;background:#090909;padding:28px}a{color:#fff}</style></head><body><div class="card"><h1>Something went wrong</h1><p>The website hit an error instead of loading this page.</p><p>Try signing in again, or check Render logs for the exact error.</p><a href="/">Back home</a></div></body></html>`);
  });

  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));
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
