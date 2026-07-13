// server.js
// Single-file Node.js Discord license bot with full key system, script management, and dashboard

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
  KARMA_DISCORD_TOKEN,
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

if (!KARMA_DISCORD_TOKEN) {
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
    .setDescription('Set up Karma Protection panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc => sc
      .setName('panel')
      .setDescription('Post a script panel')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(true).setMaxLength(500))
      .addStringOption(o => o.setName('script_id').setDescription('Hosted script ID').setRequired(false)))
    .addSubcommand(sc => sc
      .setName('keysystem')
      .setDescription('Configure key system')
      .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(false))
      .addStringOption(o => o.setName('title').setDescription('Key system title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Key system description').setRequired(false))),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Create/apply a protected script and host its loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Auto-obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' }
    ))
    .addStringOption(o => o.setName('keysystem').setDescription('Key system ID to attach').setRequired(false)),

  new SlashCommandBuilder()
    .setName('createscript')
    .setDescription('Create a script/product')
    .addStringOption(o => o.setName('name').setDescription('Script/product name').setRequired(true).setMaxLength(80)),

  new SlashCommandBuilder()
    .setName('scripts')
    .setDescription('List scripts/products'),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate license keys')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true))
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
    .addStringOption(o => o.setName('code').setDescription('Lua code to host').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('script_id').setDescription('Optional script/product ID').setRequired(false))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Auto-obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' }
    )),

  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate Lua code or an uploaded .lua/.txt file')
    .addStringOption(o => o.setName('code').setDescription('Lua code to obfuscate').setRequired(false).setMaxLength(4000))
    .addAttachmentOption(o => o.setName('file').setDescription('Upload a .lua or .txt file').setRequired(false))
    .addStringOption(o => o.setName('filename').setDescription('Output filename').setRequired(false).setMaxLength(80))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' }
    ))
    .addBooleanOption(o => o.setName('private').setDescription('Only you can see the result')),

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

  const rest = new REST({ version: '10' }).setToken(KARMA_DISCORD_TOKEN);

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
  key_system_id TEXT,
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
  'ALTER TABLE website_users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN twofa_secret TEXT',
  "ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
  "ALTER TABLE website_users ADD COLUMN script_quota INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE hosted_scripts ADD COLUMN source_code TEXT",
  "ALTER TABLE hosted_scripts ADD COLUMN linked_script_id TEXT",
  "ALTER TABLE hosted_scripts ADD COLUMN key_system_id TEXT"
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

function createHostedScript({ guildId, name, code, sourceCode, linkedScriptId, keySystemId, obfuscated, createdBy }) {
  let id = makeId('host');
  const existing = linkedScriptId
    ? db.prepare('SELECT * FROM hosted_scripts WHERE guild_id = ? AND linked_script_id = ?').get(guildId, linkedScriptId)
    : null;

  if (existing) {
    id = existing.id;
    db.prepare(`
      UPDATE hosted_scripts
      SET name = ?, code = ?, source_code = ?, linked_script_id = ?, key_system_id = ?, obfuscated = ?, created_by = ?
      WHERE id = ?
    `).run(name, code, sourceCode || code, linkedScriptId || null, keySystemId || null, obfuscated ? 1 : 0, createdBy, id);
  } else {
    db.prepare(`
      INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, key_system_id, obfuscated, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, guildId, name, code, sourceCode || code, linkedScriptId || null, keySystemId || null, obfuscated ? 1 : 0, createdBy);
  }

  const script = { id, guild_id: guildId, name, code, source_code: sourceCode || code, linked_script_id: linkedScriptId || null, key_system_id: keySystemId || null, obfuscated: Boolean(obfuscated), created_by: createdBy };
  saveHostedScriptToSupabase(script).catch(err => console.warn('Supabase save failed:', err.message));
  return { id, name, code, source_code: sourceCode || code, linked_script_id: linkedScriptId || null, key_system_id: keySystemId || null, obfuscated: Boolean(obfuscated) };
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
    key_system_id: script.key_system_id || null,
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
    INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, linked_script_id, key_system_id, obfuscated, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      guild_id=excluded.guild_id,
      name=excluded.name,
      code=excluded.code,
      source_code=excluded.source_code,
      linked_script_id=excluded.linked_script_id,
      key_system_id=excluded.key_system_id,
      obfuscated=excluded.obfuscated,
      created_by=excluded.created_by
  `);
  for (const r of rows) {
    stmt.run(r.id, r.guild_id || 'web', r.name || r.id, r.code || '', r.source_code || r.code || '', r.linked_script_id || null, r.key_system_id || null, r.obfuscated ? 1 : 0, r.created_by || 'unknown');
  }
  console.log(`Hydrated ${rows.length} hosted scripts from Supabase.`);
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  return `loadstring(game:HttpGet("https://luarmor-bot-1-0yt4.onrender.com/script/${scriptId}.lua"))()`;
}

function makeProtectedLoader(rawUrl, scriptId) {
  return `loadstring(game:HttpGet("https://luarmor-bot-1-0yt4.onrender.com/script/${scriptId}.lua"))()`;
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
  const apiUrl = (OBFUSCATOR_API_URL || 'https://luarmor-bot-1-0yt4.onrender.com').replace(/\/$/, '') + '/api/obfuscate';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(luaCode || ''), level: selected }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(`API error (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    
    if (!data.ok || typeof data.obfuscated !== 'string') {
      throw new Error(`Invalid response: ${data.error || 'Unknown error'}`);
    }

    return data.obfuscated;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Obfuscation timed out after 60 seconds. Try again or use a smaller script.');
    }
    throw new Error(`Obfuscator failed: ${error.message}`);
  }
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

const processedInteractions = new Set();

function panelEmbed(guildId, sentBy = null) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xd4af37)
    .setThumbnail(`https://files.catbox.moe/vda6a2.png`)
    .setFooter({ text: sentBy ? `Sent By ${sentBy} • Karma Protection` : 'Karma Protection', iconURL: `https://files.catbox.moe/vda6a2.png` });
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
      new ButtonBuilder().setCustomId('panel_get_buyer_role').setLabel('Get Buyer Role').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_keysystem').setLabel('Key System').setStyle(ButtonStyle.Primary)
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
    .setThumbnail(`https://files.catbox.moe/vda6a2.png`)
    .addFields(
      { name: 'How to Redeem', value: 'Click Redeem Key on the main panel and enter your license key.' },
      { name: 'HWID Locking', value: 'Your key locks to your first device. Reset HWID has a cooldown.' }
    )
    .setFooter({ text: 'Karma Protection Key System', iconURL: `https://files.catbox.moe/vda6a2.png` });
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

  if (commandName === 'freekey') return giveFreeKey(interaction);

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
    const keySystemId = interaction.options.getString('keysystem') || null;

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
      keySystemId: keySystemId,
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const base = publicBaseUrl();
    const rawUrl = `${base}/script/${hosted.id}.lua`;
    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Applied **${name}** successfully.\n\nScript ID:\n\`${script.id}\`\n\nAPI Secret, save this now:\n\`${script.apiSecret}\`\n\nHosted Script:\n${rawUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\`${keySystemId ? `\n\nKey System ID: \`${keySystemId}\`` : ''}`
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
    const apiPort = process.env.PORT || process.env.API_PORT || 3000;
    const example = `-- Generic Lua example. Change request/http_request for your environment.\nlocal key = "PASTE_USER_KEY"\nlocal hwid = "PUT_HWID_HERE"\nlocal apiUrl = "https://YOUR-RENDER-URL.onrender.com/api/verify"\n\nlocal body = '{"script_id":"${scriptId}","key":"' .. key .. '","hwid":"' .. hwid .. '"}"'\n\nlocal res = request({\n  Url = apiUrl,\n  Method = "POST",\n  Headers = {\n    ["Content-Type"] = "application/json",\n    ["X-API-Secret"] = "PASTE_SCRIPT_API_SECRET"\n  },\n  Body = body\n})\n\nprint(res.Body)`;
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
    rows = db.prepare('SELECT id, name, obfuscated, key_system_id, created_at FROM hosted_scripts WHERE id = ? OR linked_script_id = ? ORDER BY created_at DESC LIMIT 1').all(settings.panel_script_id, settings.panel_script_id);
  } else {
    rows = db.prepare('SELECT id, name, obfuscated, key_system_id, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 500').all();
  }
  const content = rows.length
    ? rows.map(r => `**${r.name}** ${r.obfuscated ? '(obfuscated)' : ''}${r.key_system_id ? ` [Key System: ${r.key_system_id}]` : ''}\nLoadstring:\n\`\`\`lua\n${makeLoaderSnippet(r.id)}\n\`\`\``).join('\n')
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

async function giveFreeKey(interaction) {
  const base = publicBaseUrl();
  const linkvertiseUrl = process.env.LINKVERTISE_URL || `${base}/dashboard?tab=redeem`;
  return interaction.reply({
    ephemeral: true,
    content: [
      '**Free Key Steps**',
      'Free keys will require Linkvertise steps before a key is issued.',
      '',
      `Step page: ${linkvertiseUrl}`,
      '',
      'Linkvertise is not fully connected yet, so no key was generated. Once you add LINKVERTISE_URL / callback verification, this button can issue the key after completion.'
    ].join('\n')
  });
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

  if (interaction.customId === 'panel_free_key') {
    return giveFreeKey(interaction);
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

function kolsecHomePage() {
  const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM scripts').get().count;
  const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  const hostedCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;

  return `<!doctype html>
<html lang="en" class="dark">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Karma Protection — Lua Code Protection &amp; Licensing</title>
    <meta name="description" content="Karma Protection protects Lua code with obfuscation, HWID-locked keys, hosted loadstrings, and a Discord-synced panel." />
    <link rel="icon" href="https://files.catbox.moe/vda6a2.png" />
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth}
        body{font-family:'Inter',-apple-system,sans-serif;background:#0a0a0a;color:#f0f0f0;line-height:1.6;min-height:100vh;background-image:url('https://files.catbox.moe/vda6a2.png');background-size:cover;background-position:center;background-attachment:fixed;position:relative}
        body::before{content:'';position:fixed;inset:0;background:rgba(10,10,10,0.85);z-index:0;pointer-events:none}
        *{position:relative;z-index:1}
        a{color:inherit;text-decoration:none}
        .container{max-width:1200px;margin:0 auto;padding:0 24px}
        ::-webkit-scrollbar{width:8px}
        ::-webkit-scrollbar-track{background:#0a0a0a}
        ::-webkit-scrollbar-thumb{background:#d4af37;border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:#e8c84a}
        .navbar{position:fixed;top:0;left:0;right:0;z-index:1000;background:rgba(10,10,10,0.9);backdrop-filter:blur(20px);border-bottom:1px solid rgba(212,175,55,0.2);padding:0 24px;height:72px;display:flex;align-items:center}
        .navbar .container{display:flex;align-items:center;justify-content:space-between;width:100%;padding:0}
        .nav-logo{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px;color:#f0f0f0}
        .nav-logo img{width:40px;height:40px;border-radius:10px;border:2px solid rgba(212,175,55,0.4);object-fit:cover}
        .nav-logo span{background:linear-gradient(135deg,#d4af37,#f1d592);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .nav-links{display:flex;align-items:center;gap:32px}
        .nav-links a{color:#a0a0a0;font-size:14px;font-weight:500;transition:color 0.2s;position:relative}
        .nav-links a:hover{color:#d4af37}
        .nav-links a::after{content:'';position:absolute;bottom:-4px;left:0;width:0;height:2px;background:#d4af37;transition:width 0.3s}
        .nav-links a:hover::after{width:100%}
        .nav-actions{display:flex;align-items:center;gap:12px}
        .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;transition:all 0.2s;cursor:pointer;border:none}
        .btn-primary{background:linear-gradient(135deg,#d4af37,#f1d592);color:#0a0a0a}
        .btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(212,175,55,0.3)}
        .btn-outline{background:transparent;color:#f0f0f0;border:1px solid rgba(212,175,55,0.3)}
        .btn-outline:hover{border-color:#d4af37;background:rgba(212,175,55,0.1)}
        .hero{min-height:100vh;display:flex;align-items:center;padding:120px 0 80px}
        .hero-content{max-width:700px}
        .hero-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:999px;background:rgba(212,175,55,0.15);border:1px solid rgba(212,175,55,0.3);font-size:13px;color:#d4af37;margin-bottom:24px}
        .hero-badge .dot{width:8px;height:8px;border-radius:50%;background:#d4af37;animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:0.6}50%{opacity:1}}
        .hero h1{font-size:clamp(48px,6vw,72px);font-weight:800;line-height:1.05;letter-spacing:-0.02em;margin-bottom:20px}
        .hero h1 .gold{background:linear-gradient(135deg,#d4af37,#f1d592);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .hero p{font-size:18px;color:#a0a0a0;max-width:520px;margin-bottom:32px;line-height:1.7}
        .hero-buttons{display:flex;gap:12px;flex-wrap:wrap}
        .section{padding:80px 0}
        .section-header{text-align:center;margin-bottom:48px}
        .section-header h2{font-size:clamp(32px,3.5vw,44px);font-weight:700;margin-bottom:12px}
        .section-header p{color:#a0a0a0;font-size:18px}
        .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
        .feature-card{background:rgba(20,20,20,0.8);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px;transition:all 0.3s;backdrop-filter:blur(10px)}
        .feature-card:hover{border-color:rgba(212,175,55,0.3);transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.4)}
        .feature-icon{width:48px;height:48px;border-radius:12px;background:rgba(212,175,55,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;color:#d4af37}
        .feature-card h3{font-size:18px;font-weight:600;margin-bottom:8px;color:#f0f0f0}
        .feature-card p{color:#a0a0a0;font-size:14px;line-height:1.6}
        .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;padding:40px 0;border-top:1px solid rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06)}
        .stat-item{text-align:center}
        .stat-number{font-size:36px;font-weight:800;color:#d4af37;display:block}
        .stat-label{color:#a0a0a0;font-size:14px;margin-top:4px}
        .footer{padding:40px 0;border-top:1px solid rgba(255,255,255,0.06);text-align:center;color:#a0a0a0;font-size:14px}
        .footer a{color:#d4af37}
        @media(max-width:768px){.nav-links{display:none}.hero{padding:100px 0 60px;text-align:center}.hero p{margin-left:auto;margin-right:auto}.hero-buttons{justify-content:center}.features-grid{grid-template-columns:1fr}}
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="container">
            <a href="/" class="nav-logo">
                <img src="https://files.catbox.moe/vda6a2.png" alt="Karma Protection" />
                <span>Karma Protection</span>
            </a>
            <div class="nav-links">
                <a href="#features">Features</a>
                <a href="#stats">Stats</a>
                <a href="/api">API</a>
                <a href="${DISCORD_INVITE_URL}" target="_blank">Discord</a>
            </div>
            <div class="nav-actions">
                <a href="/login" class="btn btn-primary">Dashboard</a>
            </div>
        </div>
    </nav>

    <section class="hero">
        <div class="container">
            <div class="hero-content">
                <div class="hero-badge">
                    <span class="dot"></span>
                    Secure Your Lua Scripts
                </div>
                <h1>Protect. <span class="gold">Monetize.</span> Earn.</h1>
                <p>The most reliable whitelist and protection service for Lua developers. Drop your project, get a secure build, and monetize with confidence.</p>
                <div class="hero-buttons">
                    <a href="/login" class="btn btn-primary">Get Started →</a>
                    <a href="${DISCORD_INVITE_URL}" target="_blank" class="btn btn-outline">Join Discord</a>
                    <a href="/api" class="btn btn-outline">API Docs</a>
                </div>
            </div>
        </div>
    </section>

    <section id="features" class="section">
        <div class="container">
            <div class="section-header">
                <h2>Powerful Features You'll Love</h2>
                <p>Everything you need to manage your scripts and users automatically.</p>
            </div>
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feature-icon">⚡</div>
                    <h3>Super Fast</h3>
                    <p>Our advanced lua authentication system ensures fast and reliable authentication.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🔒</div>
                    <h3>HWID Locking</h3>
                    <p>Prevent unauthorized sharing with robust hardware ID locking and verification.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🔑</div>
                    <h3>Key System</h3>
                    <p>Mass generate day-locked or lifetime keys and export them for your selling platform.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">📊</div>
                    <h3>Real-time Analytics</h3>
                    <p>Track usage, execution times, regions, and potential threats in real-time.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">🤖</div>
                    <h3>Discord Bot</h3>
                    <p>Ready-to-use Discord bot where users can redeem keys, reset HWID, and manage access.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon">💰</div>
                    <h3>Ad System</h3>
                    <p>Built-in ad link system with effective anti-bypass, protecting your revenue.</p>
                </div>
            </div>
        </div>
    </section>

    <section id="stats" class="section">
        <div class="container">
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-number">${scriptCount}</span>
                    <span class="stat-label">Scripts Protected</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${keyCount}</span>
                    <span class="stat-label">Keys Issued</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${hostedCount}</span>
                    <span class="stat-label">Hosted Scripts</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">99.9%</span>
                    <span class="stat-label">Uptime</span>
                </div>
            </div>
        </div>
    </section>

    <footer class="footer">
        <div class="container">
            <p>© ${new Date().getFullYear()} Karma Protection — Protect, Monetize, Earn</p>
            <p style="margin-top:8px;font-size:12px;">
                <a href="${DISCORD_INVITE_URL}" target="_blank">Discord</a> • 
                <a href="/dashboard">Dashboard</a> •
                <a href="/api">API</a>
            </p>
        </div>
    </footer>
</body>
</html>`;
}

function makeUserApiKey(userId) {
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(`api:${userId}`).digest('base64url').slice(0, 32);
  return `ks_${userId}_${sig}`;
}

function discordDashboardPage(user, req = { query: {} }) {
  const username = escapeHtml(user.global_name || user.username || 'Discord User');
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : 'https://files.catbox.moe/vda6a2.png';
  const apiKey = makeUserApiKey(user.id);
  let tab = String(req.query.tab || 'overview');
  const selectedId = String(req.query.script || '');
  const scripts = db.prepare('SELECT id, name, obfuscated, key_system_id, created_at, created_by FROM hosted_scripts ORDER BY created_at DESC LIMIT 500').all();
  const selected = selectedId ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(selectedId) : (scripts[0] ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(scripts[0].id) : null);
  const myScriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE created_by = ?').get(user.id).count;
  const botInvite = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}&permissions=268435456&scope=bot%20applications.commands`;
  const isOwner = user.id === OWNER_ID;
  const dbUserForQuota = db.prepare('SELECT script_quota FROM website_users WHERE id = ?').get(user.id) || {};
  const scriptQuota = isOwner ? 'Unlimited' : Number(dbUserForQuota.script_quota || MAX_WEB_SCRIPTS_PER_USER);
  const remaining = isOwner ? 'Unlimited' : Math.max(0, Number(scriptQuota) - myScriptCount);
  const canEditSelected = selected && (selected.created_by === user.id || isOwner);

  // Get execution logs for the user's scripts
  const userScriptIds = db.prepare('SELECT id FROM hosted_scripts WHERE created_by = ?').all(user.id).map(r => r.id);
  let executionLogs = [];
  if (userScriptIds.length > 0) {
    const placeholders = userScriptIds.map(() => '?').join(',');
    executionLogs = db.prepare(`SELECT * FROM execution_logs WHERE script_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`).all(...userScriptIds);
  }

  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${selected?.id === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${s.key_system_id ? '🔑' : ''} ${escapeHtml(s.created_at)}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  if (tab === 'scripts') {
    content = selected ? `<div class="card"><div class="cardHead"><div><p class="eyebrow">Selected Script</p><h2>${escapeHtml(selected.name)}</h2><p class="muted">${selected.obfuscated ? 'Obfuscated build' : 'Plain build'} · ${escapeHtml(selected.created_at)}${selected.key_system_id ? ` · Key System: ${selected.key_system_id}` : ''}</p></div></div><h3>Loadstring</h3><code class="block">${makeLoaderSnippet(selected.id)}</code>${canEditSelected ? `<h3>Edit Script</h3><form method="post" action="/dashboard/scripts/${selected.id}/update"><label>Script name</label><input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required><label>Actual Source</label><textarea name="code" maxlength="4000" required>${escapeHtml(selected.source_code || selected.code)}</textarea><label class="check"><input type="checkbox" name="obfuscate" value="true" ${selected.obfuscated ? 'checked' : ''}> Auto-obfuscate on save</label><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><label>Key System ID</label><input name="key_system_id" placeholder="Optional key system ID" value="${escapeHtml(selected.key_system_id || '')}"><div class="buttonRow"><button type="submit">Save Permanently</button></div></form>` : `<p class="muted">This script is available as a loadstring. Source editing is limited to the owner/creator.</p>`}</div>` + `<div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Auto-obfuscate before saving</label><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><label>Key System ID</label><input name="key_system_id" placeholder="Optional key system ID"><button>Save Script</button></form></div>` : `<div class="card"><h2>Scripts</h2><p class="muted">Add your first script below. Scripts are saved permanently unless the owner removes them from the database.</p></div><div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Auto-obfuscate before saving</label><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><label>Key System ID</label><input name="key_system_id" placeholder="Optional key system ID"><button>Save Script</button></form></div>`;
  } else if (tab === 'executions') {
    content = `<div class="card"><p class="eyebrow">Execution Logs</p><h2>Script Executions</h2><p class="muted">View when and how your scripts are being executed.</p>`;
    if (executionLogs.length === 0) {
      content += `<p style="color:#a0a0a0;padding:20px;text-align:center;">No execution logs yet. Your scripts haven't been run or no logs are available.</p>`;
    } else {
      content += `<div style="overflow-x:auto;">`;
      content += `<table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid #2a2a2a;">
          <th style="text-align:left;padding:8px;color:#d4af37;">Script</th>
          <th style="text-align:left;padding:8px;color:#d4af37;">Key</th>
          <th style="text-align:left;padding:8px;color:#d4af37;">HWID</th>
          <th style="text-align:left;padding:8px;color:#d4af37;">Executor</th>
          <th style="text-align:left;padding:8px;color:#d4af37;">IP</th>
          <th style="text-align:left;padding:8px;color:#d4af37;">Time</th>
        </tr></thead><tbody>`;
      for (const log of executionLogs) {
        const scriptName = db.prepare('SELECT name FROM hosted_scripts WHERE id = ?').get(log.script_id)?.name || log.script_id;
        content += `<tr style="border-bottom:1px solid #1a1a1a;">
          <td style="padding:8px;">${escapeHtml(scriptName)}</td>
          <td style="padding:8px;font-family:monospace;font-size:11px;">${escapeHtml(log.license_key || 'N/A')}</td>
          <td style="padding:8px;font-family:monospace;font-size:11px;">${escapeHtml(log.hwid || 'N/A')}</td>
          <td style="padding:8px;">${escapeHtml(log.executor || 'Unknown')}</td>
          <td style="padding:8px;font-family:monospace;font-size:11px;">${escapeHtml(log.ip || 'N/A')}</td>
          <td style="padding:8px;font-size:12px;color:#888;">${new Date(log.created_at).toLocaleString()}</td>
        </tr>`;
      }
      content += `</tbody></table></div>`;
    }
    content += `</div>`;
  } else if (tab === 'api') {
    content = `<div class="card"><p class="eyebrow">API Access</p><h2>Your API Key</h2><p class="muted">Use this key to authenticate API requests.</p><code class="block" style="color:#d4af37;">${apiKey}</code><h3>API Endpoints</h3><div style="display:grid;gap:12px;margin-top:12px;">
      <div style="border:1px solid #2a2a2a;border-radius:8px;padding:12px;">
        <span style="color:#8fdf8f;font-weight:700;">POST</span> <code>/api/obfuscate</code>
        <p style="color:#888;font-size:12px;margin-top:4px;">Obfuscate Lua code</p>
      </div>
      <div style="border:1px solid #2a2a2a;border-radius:8px;padding:12px;">
        <span style="color:#df8f8f;font-weight:700;">POST</span> <code>/api/verify</code>
        <p style="color:#888;font-size:12px;margin-top:4px;">Verify a license key</p>
      </div>
      <div style="border:1px solid #2a2a2a;border-radius:8px;padding:12px;">
        <span style="color:#8fdf8f;font-weight:700;">GET</span> <code>/api/stats</code>
        <p style="color:#888;font-size:12px;margin-top:4px;">Get script statistics</p>
      </div>
    </div>
    <a href="/api" class="btn" style="margin-top:16px;">📚 Full API Documentation</a>
    </div>`;
  } else if (tab === 'keys') {
    const projects = db.prepare('SELECT id, name, created_at FROM scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
    const keys = db.prepare('SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.created_by = ? ORDER BY l.created_at DESC LIMIT 50').all(user.id);
    content = `<div class="card"><p class="eyebrow">Keys</p><h2>Generate keys for projects</h2><p class="muted">Create whitelist keys for any project you own.</p><form method="post" action="/dashboard/keys"><label>Project</label><select name="script_id">${projects.map(pr=>`<option value="${escapeHtml(pr.id)}">${escapeHtml(pr.name)} · ${escapeHtml(pr.id)}</option>`).join('')}</select><label>Days</label><input name="days" type="number" value="30" min="0" max="3650"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20"><button>Generate Keys</button></form><h3>Recent Keys</h3>${keys.map(k=>`<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${escapeHtml(k.script_name)} · ${k.expires_at || 'Lifetime'} · ${k.revoked ? 'Revoked' : 'Active'}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}</div>`;
  } else if (tab === 'obfuscate') {
    content = `<div class="card"><p class="eyebrow">Obfuscator</p><h2>Protect Lua source</h2><p class="muted">Paste your Lua code below and click obfuscate.</p><form method="post" action="/dashboard/obfuscate"><label>Filename</label><input name="filename" value="obfuscated.lua"><label>Lua source</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("protect me")' required></textarea><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><div class="buttonRow"><button type="submit">Obfuscate</button><a class="btn dark" href="/dashboard?tab=scripts">Scripts</a></div></form></div>`;
  } else if (tab === 'settings') {
    const dbUser = db.prepare('SELECT * FROM website_users WHERE id = ?').get(user.id) || {};
    const displayName = dbUser.display_username || user.username || '';
    content = `<div class="card"><p class="eyebrow">Settings</p><h2>Account settings</h2><form method="post" action="/dashboard/settings"><label>Username</label><input name="display_username" minlength="3" maxlength="24" pattern="[A-Za-z0-9]{3,24}" value="${escapeHtml(displayName)}" required><p class="hint">Usernames can only be 3–24 letters or numbers.</p><label class="check"><input type="checkbox" name="twofa_enabled" value="true" ${dbUser.twofa_enabled ? 'checked' : ''}> Enable two factor authentication</label><button type="submit">Save Settings</button></form></div>`;
  } else if (tab === 'owner' && isOwner) {
    const codes = db.prepare('SELECT * FROM premium_codes ORDER BY created_at DESC LIMIT 50').all();
    const banned = db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC LIMIT 50').all();
    content = `<div class="card"><p class="eyebrow">Owner Only</p><h2>Owner panel</h2><div class="stats"><div class="stat"><div class="num">${scripts.length}</div><span>Total scripts</span></div><div class="stat"><div class="num">${banned.length}</div><span>Banned HWIDs</span></div><div class="stat"><div class="num">5</div><span>Default script limit</span></div></div><h3>Create premium code</h3><form method="post" action="/owner/codes"><input name="code" placeholder="PREMIUM-KEY-123" required><input name="plan" placeholder="premium" value="premium"><button>Create Code</button></form><h3>Ban HWID</h3><form method="post" action="/owner/ban-hwid"><input name="hwid" placeholder="HWID" required><input name="reason" placeholder="Reason"><button class="danger">Ban HWID</button></form><h3>Add script to user</h3><form method="post" action="/owner/add-user-script"><input name="user_id" placeholder="Discord user ID" required><input name="name" placeholder="Script name" required><textarea name="code" maxlength="4000" placeholder="Lua source" required></textarea><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before assigning</label><button>Add Script To User</button></form><h3>Manage user access</h3><form method="post" action="/owner/user-plan" class="inlineForm"><input name="user_id" placeholder="Discord user ID" required><select name="plan"><option value="free">free</option><option value="premium">premium</option><option value="royal">royal</option><option value="banned">banned</option></select><input name="script_quota" type="number" min="0" max="10000" value="5" style="width:120px"><button>Set Access</button></form><p class="muted">Website user list is hidden. Enter a Discord ID to add or update that user.</p><h3>Premium codes</h3>${codes.map(c=>`<div class="row"><b>${escapeHtml(c.code)}</b><small>${escapeHtml(c.plan)} · redeemed by ${escapeHtml(c.redeemed_by||'nobody')}</small></div>`).join('')}</div>`;
  } else if (tab === 'changelog') {
    content = `<div class="card"><p class="eyebrow">Changelog</p><h2>Latest Updates</h2><div style="border-left:2px solid #d4af37;padding-left:20px;">
      <div style="margin-bottom:24px;"><h3 style="color:#d4af37;">v1.0.0 - Initial Release</h3><p>• Full key system with HWID locking<br>• Auto-obfuscation for scripts<br>• Discord bot integration<br>• Execution logs tracking<br>• API for obfuscation and verification</p></div>
    </div></div>`;
  } else {
    content = `<div class="card heroCard"><p class="eyebrow">Overview</p><h2>Dashboard</h2><p class="muted">Manage scripts, sources, obfuscation, tutorials, Discord links, redeem codes, and owner tools from one clean dashboard.</p><div class="stats"><div class="stat"><div class="num">${scripts.length}</div><span>Scripts used</span></div><div class="stat"><div class="num">${remaining}</div><span>Slots left</span></div><div class="stat"><div class="num">${scriptQuota}</div><span>Max scripts</span></div></div><div class="anime"></div></div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Dashboard</title><style>
    :root{--bg:#000000;--shell:rgba(11,11,12,0.9);--panel:rgba(16,16,17,0.8);--panel2:rgba(21,21,22,0.8);--line:rgba(212,175,55,0.25);--muted:#a1a1aa;--text:#f8fafc;--gold:#d4af37;--gold2:#f1d592}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:linear-gradient(rgba(0,0,0,0.75),rgba(0,0,0,0.75)),url("https://files.catbox.moe/vda6a2.png") center/cover fixed no-repeat,#000000;color:var(--text);font-family:"SF Pro Display","Aptos","Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;letter-spacing:-.01em}
    a{color:inherit;text-decoration:none}
    .page{padding:28px}
    .shell{max-width:1500px;margin:0 auto;min-height:calc(100vh - 56px);display:grid;grid-template-columns:280px 1fr;border:1px solid rgba(212,175,55,0.4);border-radius:34px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015));box-shadow:0 34px 140px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.025)}
    .side{background:linear-gradient(180deg,rgba(12,12,12,.96),rgba(5,5,5,.96));border-right:1px solid rgba(255,255,255,.20);padding:22px;overflow:auto;box-shadow:18px 0 80px rgba(0,0,0,.28)}
    .brand{display:flex;gap:12px;align-items:center;border-bottom:1px solid #242427;padding-bottom:20px}
    .brand img,.avatar{width:48px;height:48px;border-radius:16px;object-fit:cover;border:1px solid rgba(212,175,55,0.6);box-shadow:0 0 35px rgba(212,175,55,0.3)}
    .brand b{display:block;font-size:18px;font-weight:850}
    .brand small,.muted,small{color:var(--muted)}
    .nav{margin-top:20px}
    .nav a{display:flex;align-items:center;padding:12px 13px;border-radius:14px;color:#d4d4d8;font-weight:720;margin-bottom:4px;transition:all 0.2s}
    .nav a:hover,.nav a.active{background:linear-gradient(90deg,rgba(255,255,255,.18),rgba(255,255,255,.035));color:#fff;box-shadow:inset 3px 0 0 var(--gold)}
    .nav a .icon{font-size:18px;margin-right:12px}
    .main{padding:28px;min-width:0;position:relative;overflow:auto}
    .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
    .profile{display:flex;gap:12px;align-items:center}
    .card{border:1px solid rgba(255,255,255,.16);border-radius:28px;background:linear-gradient(180deg,rgba(24,24,24,.92),rgba(8,8,8,.97));padding:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 26px 90px rgba(0,0,0,.32);margin-bottom:18px;position:relative;z-index:1}
    .card h2{font-size:clamp(32px,4vw,56px);line-height:.95;letter-spacing:-.06em;margin:6px 0 12px}
    .eyebrow{color:#a1a1aa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:850;margin:0 0 8px}
    .btn,button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--gold2);background:linear-gradient(180deg,var(--gold2),var(--gold));color:#000;border-radius:999px;padding:12px 18px;font-weight:950;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;box-shadow:0 12px 38px rgba(255,255,255,.16)}
    .btn:hover,button:hover{transform:translateY(-1px);box-shadow:0 14px 42px rgba(255,255,255,.10)}
    .btn.dark{background:rgba(10,10,10,.75);color:#fff;border-color:rgba(255,255,255,.32);box-shadow:none}
    .secondary{background:rgba(10,10,10,.75);color:#fff;border-color:rgba(255,255,255,.32)}
    .buttonRow{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:6px}
    .danger{background:#220f0f;color:#ffb4ad;border-color:#5b2521}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}
    .stat{border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(10,10,10,.82);padding:18px}
    .num{font-size:38px;font-weight:900;letter-spacing:-.05em}
    select{background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:10px;font:inherit}
    .inlineForm{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
    input,textarea{width:100%;background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:12px;margin:8px 0 14px;font:inherit}
    textarea{min-height:200px}
    .check{display:flex;gap:10px;align-items:center}
    .check input{width:auto}
    .block{display:block;white-space:pre-wrap;word-break:break-all;padding:12px;margin:10px 0;background:#080809;border:1px solid #343438;border-radius:14px;font-family:monospace;font-size:13px}
    .row{border:1px solid #27272a;border-radius:14px;padding:12px;margin:8px 0;background:#0b0b0c}
    .hint{color:#666;font-size:12px;margin:-8px 0 12px}
    .anime{height:220px;border-radius:24px;border:1px solid #27272a;margin-top:22px;background:radial-gradient(circle at 30% 50%,rgba(255,255,255,.18),transparent 18%),radial-gradient(circle at 70% 50%,rgba(255,255,255,.11),transparent 20%),linear-gradient(120deg,#000,#111,#000);background-size:160% 160%;animation:movebg 6s infinite alternate;position:relative;overflow:hidden}
    .anime:after{content:'';position:absolute;inset:-40%;background:conic-gradient(from 0deg,transparent,rgba(255,255,255,.12),transparent 35%);animation:spin 8s linear infinite}
    @keyframes movebg{to{background-position:100% 60%}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:1100px){.page{padding:12px}.shell{grid-template-columns:1fr;border-radius:22px}.side{border-right:0;border-bottom:1px solid var(--line)}.stats{grid-template-columns:1fr}.top{align-items:flex-start;gap:16px;flex-direction:column}}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{text-align:left;padding:8px;color:#d4af37;border-bottom:1px solid #2a2a2a}
    td{padding:8px;border-bottom:1px solid #1a1a1a}
  </style></head><body><div class="page"><div class="shell"><aside class="side"><div class="brand"><img src="https://files.catbox.moe/vda6a2.png"><div><b>Karma Protection</b><small>${username}</small></div></div><nav class="nav">
    <a class="${tab==='overview'?'active':''}" href="/dashboard"><span class="icon">📊</span>Overview</a>
    <a class="${tab==='scripts'?'active':''}" href="/dashboard?tab=scripts"><span class="icon">📜</span>Scripts</a>
    <a class="${tab==='obfuscate'?'active':''}" href="/dashboard?tab=obfuscate"><span class="icon">🔒</span>Obfuscate</a>
    <a class="${tab==='keys'?'active':''}" href="/dashboard?tab=keys"><span class="icon">🔑</span>Keys</a>
    <a class="${tab==='executions'?'active':''}" href="/dashboard?tab=executions"><span class="icon">📈</span>Executions</a>
    <a class="${tab==='api'?'active':''}" href="/dashboard?tab=api"><span class="icon">⚡</span>API</a>
    <a class="${tab==='changelog'?'active':''}" href="/dashboard?tab=changelog"><span class="icon">📋</span>Changelog</a>
    <a class="${tab==='settings'?'active':''}" href="/dashboard?tab=settings"><span class="icon">⚙️</span>Settings</a>
    ${isOwner?`<a class="${tab==='owner'?'active':''}" href="/dashboard?tab=owner"><span class="icon">👑</span>Owner Panel</a>`:''}
    <a href="/logout"><span class="icon">🚪</span>Logout</a>
  </nav></aside><main class="main"><div class="top"><div class="profile"><img class="avatar" src="${avatar}"><div><b>${username}</b><br><small>${myScriptCount}/${scriptQuota} scripts used</small></div></div><div class="buttonRow"><a class="btn dark" href="/api">API Docs</a><a class="btn dark" href="/">Home</a></div></div>${content}</main></div></div><script>document.getElementById('fileInput')?.addEventListener('change', async e => { const f=e.target.files[0]; if(!f) return; document.querySelector('input[name="name"]').value ||= f.name.replace(/\.(lua|txt)$/i,''); document.getElementById('codeBox').value = await f.text(); });</script></body></html>`;
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

// ---------------- Express API ----------------
function startApiServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use('/assets', express.static('public'));

  // Home page
  app.get('/', (req, res) => res.type('html').send(kolsecHomePage()));
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection' }));

  // API Documentation page
  app.get('/api', (req, res) => {
    const user = getSessionUser(req);
    const apiKey = user ? makeUserApiKey(user.id) : null;
    
    res.type('html').send(`<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Karma API - Obfuscator & Licensing API</title>
    <link rel="icon" href="https://files.catbox.moe/vda6a2.png" />
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#0a0a0a;color:#f0f0f0;font-family:system-ui,sans-serif;line-height:1.6}
      .container{max-width:1200px;margin:0 auto;padding:24px}
      .header{text-align:center;padding:40px 0;border-bottom:1px solid rgba(212,175,55,0.2)}
      .header h1{font-size:48px;background:linear-gradient(135deg,#d4af37,#f1d592);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .header p{color:#a0a0a0;font-size:18px}
      .card{background:rgba(20,20,20,0.8);border:1px solid rgba(212,175,55,0.2);border-radius:16px;padding:24px;margin:24px 0}
      .card h2{color:#d4af37;margin-bottom:12px}
      .card p{color:#a0a0a0;margin-bottom:8px}
      code{background:#1a1a1a;padding:2px 8px;border-radius:4px;color:#d4af37;font-family:monospace}
      pre{background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;padding:16px;overflow-x:auto;margin:12px 0}
      pre code{background:transparent;padding:0;color:#e0e0e0}
      .method{display:inline-block;padding:2px 10px;border-radius:4px;font-weight:700;font-size:12px}
      .get{background:#2b5e2b;color:#8fdf8f}
      .post{background:#5e2b2b;color:#df8f8f}
      .badge{display:inline-block;background:#d4af37;color:#0a0a0a;padding:2px 12px;border-radius:999px;font-size:12px;font-weight:700}
      .btn{display:inline-block;padding:10px 24px;border-radius:8px;background:linear-gradient(135deg,#d4af37,#f1d592);color:#0a0a0a;font-weight:700;text-decoration:none;border:none;cursor:pointer}
      .btn:hover{transform:scale(1.02)}
      .btn-outline{background:transparent;border:1px solid #d4af37;color:#d4af37}
      .btn-outline:hover{background:rgba(212,175,55,0.1)}
      .api-key-box{background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;padding:12px;font-family:monospace;color:#d4af37;word-break:break-all}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin:24px 0}
      .endpoint{border:1px solid #2a2a2a;border-radius:12px;padding:16px;background:#111}
      .endpoint h3{color:#d4af37}
      .sidebar{position:fixed;left:0;top:0;bottom:0;width:240px;background:#0d0d0d;border-right:1px solid #2a2a2a;padding:24px;overflow-y:auto}
      .sidebar a{display:block;padding:10px 12px;color:#a0a0a0;border-radius:8px;transition:all 0.2s}
      .sidebar a:hover,.sidebar a.active{background:rgba(212,175,55,0.1);color:#d4af37}
      .main-content{margin-left:240px}
      @media(max-width:768px){.sidebar{display:none}.main-content{margin-left:0}}
    </style>
  </head>
  <body>
    <div class="sidebar">
      <div style="margin-bottom:24px;font-size:20px;font-weight:700;color:#d4af37;">⚡ Karma API</div>
      <a href="#obfuscate" class="active">Obfuscator</a>
      <a href="#verify">Verify License</a>
      <a href="#stats">Stats</a>
      <a href="#examples">Examples</a>
      <a href="/dashboard">← Dashboard</a>
    </div>
    <div class="main-content">
      <div class="container">
        <div class="header">
          <h1>⚡ Karma API</h1>
          <p>Obfuscator & Licensing API for Lua script protection</p>
          <div style="margin-top:16px">
            <span class="badge">Free to use</span>
            <span class="badge" style="background:#2a2a2a;color:#f0f0f0;">No rate limit</span>
          </div>
          ${user ? `<div style="margin-top:16px;padding:16px;background:#111;border-radius:8px;border:1px solid #2a2a2a;">
            <p style="color:#a0a0a0;">Your API Key:</p>
            <div class="api-key-box">${apiKey}</div>
            <p style="color:#666;font-size:12px;margin-top:8px;">Use this key in the X-API-Key header for authenticated endpoints</p>
          </div>` : `<a href="/login" class="btn" style="margin-top:16px;">Login to get your API Key</a>`}
        </div>

        <div id="obfuscate" class="card">
          <h2>📡 Obfuscator API</h2>
          <p>Obfuscate Lua code using our advanced protection engine.</p>
          
          <div style="margin-top:16px;">
            <span class="method post">POST</span>
            <code>/api/obfuscate</code>
          </div>
          
          <h3 style="color:#d4af37;margin-top:16px;">Request</h3>
          <pre><code>{
    "code": "print('Hello World')",
    "level": "standard" // optional: light, standard, max
  }</code></pre>

          <h3 style="color:#d4af37;margin-top:16px;">Response</h3>
          <pre><code>{
    "ok": true,
    "obfuscated": "obfuscated_code_here",
    "level": "standard",
    "stats": {
      "originalSize": 20,
      "obfuscatedSize": 456,
      "ratio": "2280.00%"
    }
  }</code></pre>
        </div>

        <div id="verify" class="card">
          <h2>🔑 Licensing API</h2>
          <p>Verify license keys and manage script access.</p>
          
          <div style="margin-top:16px;">
            <span class="method post">POST</span>
            <code>/api/verify</code>
          </div>
          
          <h3 style="color:#d4af37;margin-top:16px;">Request</h3>
          <pre><code>{
    "script_id": "script_abc123",
    "key": "PS-XXXXXX-XXXXXX",
    "hwid": "hardware_id_here",
    "timestamp": 1234567890
  }</code></pre>

          <h3 style="color:#d4af37;margin-top:16px;">Headers</h3>
          <pre><code>X-API-Secret: your_script_api_secret</code></pre>
        </div>

        <div id="stats" class="card">
          <h2>📊 Stats API</h2>
          <p>Get execution statistics for your scripts.</p>
          
          <div style="margin-top:16px;">
            <span class="method get">GET</span>
            <code>/api/stats</code>
          </div>
          
          <h3 style="color:#d4af37;margin-top:16px;">Response</h3>
          <pre><code>{
    "scripts": 42,
    "keys": 1337
  }</code></pre>
        </div>

        <div id="examples" class="card">
          <h2>🚀 Quick Start</h2>
          <h3 style="color:#d4af37;margin-top:12px;">cURL</h3>
          <pre><code>curl -X POST ${publicBaseUrl()}/api/obfuscate \\
    -H "Content-Type: application/json" \\
    -d '{"code":"print(\\"Hello World\\")","level":"standard"}'</code></pre>

          <h3 style="color:#d4af37;margin-top:12px;">JavaScript</h3>
          <pre><code>const response = await fetch('${publicBaseUrl()}/api/obfuscate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'print("Hello World")',
      level: 'standard'
    })
  });
  const data = await response.json();
  console.log(data.obfuscated);</code></pre>

          <h3 style="color:#d4af37;margin-top:12px;">Python</h3>
          <pre><code>import requests
  
  response = requests.post('${publicBaseUrl()}/api/obfuscate', 
    json={
      'code': 'print("Hello World")',
      'level': 'standard'
    }
  )
  data = response.json()
  print(data['obfuscated'])</code></pre>
        </div>

        <div style="text-align:center;padding:40px 0;border-top:1px solid #2a2a2a;margin-top:24px;">
          <p style="color:#666;">Need help? <a href="${DISCORD_INVITE_URL}" style="color:#d4af37;">Join our Discord</a></p>
          <p style="color:#444;font-size:12px;margin-top:8px;">Karma Protection — Protect, Monetize, Earn</p>
        </div>
      </div>
    </div>
  </body>
  </html>`);
  });

  // API endpoints
  app.get('/api/stats', (req, res) => {
    const scriptCount = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts').get().count;
    const keyCount = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
    res.json({ scripts: scriptCount, keys: keyCount });
  });

  app.post('/api/obfuscate', async (req, res) => {
    const { code, level = 'standard' } = req.body || {};
    if (!code || !code.trim()) {
      return res.status(400).json({ ok: false, error: 'No code provided' });
    }
    
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

    // Log execution
    db.prepare('INSERT INTO execution_logs (script_id, license_key, hwid, ip) VALUES (?, ?, ?, ?)')
      .run(script_id, key, hwid, req.headers['x-forwarded-for'] || req.socket.remoteAddress || null);

    if (!license.hwid) db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);

    return res.json({
      ok: true,
      message: 'License verified',
      discord_user_id: license.discord_user_id,
      expires_at: license.expires_at,
      script_id
    });
  });

  // OAuth routes
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

  // Dashboard routes
  app.get('/dashboard', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    return res.type('html').send(discordDashboardPage(user, req));
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
    const keySystemId = String(req.body.key_system_id || '').trim() || null;
    if (!name || !code) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard">Back</a>');

    let finalCode = code;
    if (shouldObfuscate) finalCode = await callObfuscator(code, level);

    createHostedScript({
      guildId: 'web',
      name,
      code: String(finalCode),
      sourceCode: code,
      keySystemId: keySystemId,
      obfuscated: shouldObfuscate,
      createdBy: user.id
    });

    return res.redirect('/dashboard?tab=scripts');
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
    const keySystemId = String(req.body.key_system_id || '').trim() || null;
    if (!name || !source) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');

    const finalCode = shouldObfuscate ? await callObfuscator(source, level) : source;
    db.prepare('UPDATE hosted_scripts SET name = ?, code = ?, source_code = ?, key_system_id = ?, obfuscated = ? WHERE id = ?')
      .run(name, finalCode, source, keySystemId, shouldObfuscate ? 1 : 0, req.params.id);
    return res.redirect(`/dashboard?tab=scripts&script=${encodeURIComponent(req.params.id)}`);
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

  app.post('/dashboard/obfuscate', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    
    const code = String(req.body.code || '').slice(0, 4000);
    const filename = String(req.body.filename || req.body.name || 'obfuscated.lua').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const level = String(req.body.level || 'standard');
    
    if (!code || !code.trim()) {
      return res.status(400).type('html').send(`
        <!doctype html>
        <html>
          <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Error - Karma</title></head>
          <body style="background:#000;color:#fff;font-family:system-ui;padding:40px;text-align:center;">
            <h1 style="color:#d4af37;">Missing Code</h1>
            <p>Please paste some Lua code to obfuscate.</p>
            <a href="/dashboard?tab=obfuscate" style="color:#d4af37;">Go Back</a>
          </body>
        </html>
      `);
    }

    try {
      const obfuscated = await callObfuscator(code, level);
      
      return res.type('html').send(`<!doctype html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Obfuscated - Karma Protection</title>
            <style>
              body{margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif}
              .wrap{width:min(1100px,94%);margin:32px auto}
              .card{border:1px solid #d4af37;border-radius:28px;background:linear-gradient(180deg,#181818,#080808);padding:24px}
              .gold{color:#d4af37}
              textarea{width:100%;min-height:62vh;background:#050505;color:#fff;border:1px solid #333;border-radius:16px;padding:14px;font:12px monospace;resize:vertical}
              button,a{display:inline-flex;margin:10px 8px 18px 0;padding:12px 20px;border-radius:999px;border:1px solid #d4af37;background:#d4af37;color:#000;text-decoration:none;font-weight:700;cursor:pointer;transition:all 0.2s}
              button:hover,a:hover{transform:scale(1.02)}
              .dark{background:transparent;color:#fff;border-color:#555}
              .dark:hover{background:rgba(255,255,255,0.05)}
              .stats{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}
              .stat{padding:8px 16px;background:#111;border-radius:8px;border:1px solid #222}
            </style>
          </head>
          <body>
            <div class="wrap">
              <div class="card">
                <h1 style="color:#d4af37;">✓ Obfuscated Successfully</h1>
                <p>Level: <b class="gold">${escapeHtml(level)}</b></p>
                <div class="stats">
                  <div class="stat">Original: ${code.length} chars</div>
                  <div class="stat">Obfuscated: ${obfuscated.length} chars</div>
                  <div class="stat">Ratio: ${((obfuscated.length / code.length) * 100).toFixed(1)}%</div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                  <button onclick="navigator.clipboard.writeText(document.getElementById('out').value)">📋 Copy</button>
                  <button onclick="downloadFile()">💾 Download</button>
                  <a class="dark" href="/dashboard?tab=obfuscate">← Back to Obfuscator</a>
                  <a class="dark" href="/dashboard?tab=scripts">📜 Scripts</a>
                  <a class="dark" href="/api">📚 API Docs</a>
                </div>
                <textarea id="out" spellcheck="false">${escapeHtml(obfuscated)}</textarea>
              </div>
            </div>
            <script>
              function downloadFile() {
                const content = document.getElementById('out').value;
                const blob = new Blob([content], {type: 'text/plain'});
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = '${filename}';
                a.click();
                URL.revokeObjectURL(a.href);
              }
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      return res.status(500).type('html').send(`<!doctype html>
        <html>
          <head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Obfuscation Failed - Karma</title></head>
          <body style="background:#000;color:#fff;font-family:system-ui;padding:40px;text-align:center;">
            <h1 style="color:#ff6b6b;">Obfuscation Failed</h1>
            <p>${escapeHtml(error.message)}</p>
            <p style="color:#888;">Try again or use a smaller script.</p>
            <a href="/dashboard?tab=obfuscate" style="color:#d4af37;">Go Back</a>
            <a href="/api" style="color:#d4af37;display:block;margin-top:12px;">📚 API Docs</a>
          </body>
        </html>
      `);
    }
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

  // Script hosting routes
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
    const rows = db.prepare('SELECT id, name, obfuscated, key_system_id, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 50').all();
    res.json({ ok: true, scripts: rows.map(r => ({ ...r, script_url: `${publicBaseUrl()}/script/${r.id}.lua`, loadstring_url: `${publicBaseUrl()}/loadstring/${r.id}` })) });
  });

  // Execution log endpoint
  app.post('/api/log-execution', (req, res) => {
    const { script_id, key, hwid, executor } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (script_id) {
      db.prepare('INSERT INTO execution_logs (script_id, license_key, hwid, ip, executor) VALUES (?, ?, ?, ?, ?)')
        .run(script_id, key || null, hwid || null, ip || null, executor || null);
    }
    
    return res.json({ ok: true });
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
  try {
    await client.login(KARMA_DISCORD_TOKEN);
  } catch (error) {
    console.error('Discord bot login failed (website still running):', error.message);
    console.error('Fix: enable "Server Members Intent" in the Discord Developer Portal for this bot.');
  }
})();
