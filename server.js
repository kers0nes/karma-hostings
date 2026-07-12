// server.js
// Single-file Node.js Discord license bot. No ./src folder needed.

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
  LURAPH_API_URL,
  LURAPH_API_KEY
} = process.env;

const OAUTH_CLIENT_ID = DISCORD_OAUTH_CLIENT_ID || CLIENT_ID || '1525736430813450342';
const SESSION_SIGNING_SECRET = SESSION_SECRET || DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = 1000;
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
    .setName('panel')
    .setDescription('Post/configure the Karma button panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('title').setDescription('Panel title, example: Drizzy Hub').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(true).setMaxLength(500))
    .addRoleOption(o => o.setName('admin_role').setDescription('Role allowed to manage Karma').setRequired(false))
    .addRoleOption(o => o.setName('customer_role').setDescription('Buyer role given after redeeming').setRequired(false))
    .addChannelOption(o => o.setName('log_channel').setDescription('Logs channel').addChannelTypes(ChannelType.GuildText).setRequired(false)),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Create/apply a protected script and host its loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'Luraph API', value: 'luraph' }
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
    .setName('keyinfo')
    .setDescription('Show license key info')
    .addStringOption(o => o.setName('key').setDescription('License key').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mykeys')
    .setDescription('Show your redeemed keys'),

  new SlashCommandBuilder()
    .setName('freekey')
    .setDescription('Get a free key for the first configured script'),

  new SlashCommandBuilder()
    .setName('getrole')
    .setDescription('Get buyer role if you have a redeemed key'),

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
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Run the code through your obfuscator before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' },
      { name: 'Luraph API', value: 'luraph' }
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
      { name: 'Luraph API', value: 'luraph' }
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
    .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true))
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

    // Remove old global commands like /setup and /genkey so they stop showing.
    // Set CLEAR_GLOBAL_COMMANDS=false if you intentionally use global commands.
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
  api_key_hash TEXT,
  api_key_preview TEXT,
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
  redeemed_at TEXT
);

CREATE TABLE IF NOT EXISTS hosted_scripts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  obfuscated INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_premium_codes_redeemed_by ON premium_codes(redeemed_by);
`);

// Migrations for older Render SQLite databases.
for (const migration of [
  'ALTER TABLE guild_settings ADD COLUMN panel_title TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_description TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_hash TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_preview TEXT',
  'ALTER TABLE website_users ADD COLUMN display_username TEXT',
  'ALTER TABLE website_users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN twofa_secret TEXT',
  "ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'"
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
    INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, panel_title, panel_description, api_key_hash, api_key_preview, updated_at)
    VALUES (@guild_id, @admin_role_id, @customer_role_id, @log_channel_id, @panel_channel_id, @panel_message_id, @panel_title, @panel_description, @api_key_hash, @api_key_preview, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      customer_role_id=excluded.customer_role_id,
      log_channel_id=excluded.log_channel_id,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      panel_title=excluded.panel_title,
      panel_description=excluded.panel_description,
      api_key_hash=excluded.api_key_hash,
      api_key_preview=excluded.api_key_preview,
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
    api_key_hash: next.api_key_hash || null,
    api_key_preview: next.api_key_preview || null
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

function createHostedScript({ guildId, name, code, obfuscated, createdBy }) {
  const id = makeId('host');
  db.prepare(`
    INSERT INTO hosted_scripts (id, guild_id, name, code, obfuscated, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, guildId, name, code, obfuscated ? 1 : 0, createdBy);
  return { id, name, code, obfuscated: Boolean(obfuscated) };
}

function publicBaseUrl() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://localhost:${process.env.PORT || process.env.API_PORT || 3000}`;
}

function makeLoaderSnippet(scriptId) {
  return `loadstring(game:HttpGet("${publicBaseUrl()}/loadstring/${scriptId}"))()`;
}

function makeProtectedLoader(rawUrl) {
  const home = publicBaseUrl();
  return `--[[
\tKarma Sources Protected Loader
\tAnti-Dump Hardening: enabled
]]
return(function(...)
  local _home=${JSON.stringify(home)}
  local _url=${JSON.stringify(rawUrl)}
  local function _safe(fn,...) local ok,res=pcall(fn,...) if ok then return res end return nil end
  local function _tamper()
    if setclipboard then _safe(setclipboard,_home) end
    if warn then _safe(warn,"Karma loader protection triggered: ".._home) end
    return nil
  end
  local function _anti()
    if type(loadstring)~="function" then return false end
    if type(game)~="userdata" and type(game)~="table" then return false end
    local _g=(getgenv and _safe(getgenv)) or _G or {}
    if rawget(_g,"KARMA_FORCE_TAMPER") or rawget(_g,"DUMPING_KARMA") then return false end
    if debug and debug.getinfo then
      local ok,info=pcall(debug.getinfo,1,"Sln")
      if ok and info and tostring(info.source):lower():find("decompile") then return false end
    end
    return true
  end
  if not _anti() then return _tamper() end
  local _src
  if game and game.HttpGet then _src=game:HttpGet(_url) end
  if type(_src)~="string" or #_src<1 then return _tamper() end
  local _ok,_fn=pcall(loadstring,_src,"KarmaLoaderPayload")
  if not _ok or type(_fn)~="function" then return _tamper() end
  return _fn(...)
end)(...)
`;
}

function kers0neLocalObfuscate(luaCode, opts = {}) {
  // Stronger Kers0ne-style local obfuscator.
  // Note: no client-side Lua obfuscator is impossible to reverse, but this adds
  // heavier encoding, randomized runtime names, decoys, integrity checks, and
  // anti-tamper probes while keeping normal execution working.
  const source = String(luaCode);
  const strength = Math.max(1, Math.min(3, Number(opts.strength || 2)));
  const bytes = Buffer.from(source, 'utf8');
  const seedA = (crypto.randomBytes(1)[0] || 173) & 255;
  const seedB = (crypto.randomBytes(1)[0] || 91) & 255;
  const salt = crypto.randomBytes(2).readUInt16BE(0);
  const home = publicBaseUrl();

  let prev = seedB;
  const encoded = Array.from(bytes, (byte, index) => {
    const i = index + 1;
    const rolling = (seedA + (i * 37) + ((i % 7) * seedB) + prev + (salt & 255)) & 255;
    const enc = byte ^ rolling;
    prev = (enc + i + seedB) & 255;
    return enc;
  });

  const checksumA = bytes.reduce((a, b) => (a + b) % 65521, 1);
  const checksumB = bytes.reduce((a, b, i) => (a ^ ((b + i * 131) & 0xffffffff)) >>> 0, 2166136261) >>> 0;
  const decoyText = `print(${JSON.stringify('Karma Sources protected build')})`;
  const decoyBytes = Array.from(Buffer.from(decoyText, 'utf8'), (b, i) => b ^ ((seedB + i * 19) & 255));

  const chunks = [];
  const chunkSize = strength === 3 ? 18 : strength === 2 ? 24 : 32;
  for (let i = 0; i < encoded.length; i += chunkSize) chunks.push(encoded.slice(i, i + chunkSize).join(','));
  const decoyChunks = [];
  for (let i = 0; i < decoyBytes.length; i += 20) decoyChunks.push(decoyBytes.slice(i, i + 20).join(','));

  const names = Array.from({ length: 28 }, () => `_${crypto.randomBytes(3).toString('hex')}`);
  const [nChar, nBand, nBxor, nConcat, nByte, nLoad, nPcall, nType, nData, nDecoy, nOut, nSeedA, nSeedB, nSalt, nPrev, nChkA, nChkB, nHome, nTamper, nProbe, nWipe, nLen, nGetfenv, nRawget, nPairs, nTable, nMath, nSelect] = names;
  const junkNumbers = Array.from({ length: 12 }, () => crypto.randomInt(10, 999)).join(',');

  return `--[[
\tProtected By Kers0ne Obfuscator
\tAnti-Dump Hardening: enabled
]]

return(function(...)
  local ${nChar}=string.char
  local ${nBand}=bit32.band
  local ${nBxor}=bit32.bxor
  local ${nConcat}=table.concat
  local ${nByte}=string.byte
  local ${nLoad}=loadstring
  local ${nPcall}=pcall
  local ${nType}=type
  local ${nGetfenv}=getfenv
  local ${nRawget}=rawget
  local ${nPairs}=pairs
  local ${nTable}=table
  local ${nMath}=math
  local ${nSelect}=select
  local ${nHome}=${JSON.stringify(home)}
  local ${nSeedA}=${seedA}
  local ${nSeedB}=${seedB}
  local ${nSalt}=${salt}
  local ${nLen}=${bytes.length}
  local ${nData}={${chunks.join(',')}}
  local ${nDecoy}={${decoyChunks.join(',')}}
  local _junk={${junkNumbers}}

  local function ${nTamper}(...)
    -- If a dumper/tamper breaks the wrapper, give it a useless decoy and point back home.
    if setclipboard then ${nPcall}(setclipboard,${nHome}) end
    if warn then ${nPcall}(warn,"Karma protection triggered: "..${nHome}) end
    local _d={}
    for _i=1,#${nDecoy} do _d[_i]=${nChar}(${nBxor}(${nDecoy}[_i],${nBand}(${nSeedB}+(_i-1)*19,255))) end
    local _fake=${nConcat}(_d)
    if ${nType}(${nLoad})=="function" then local _ok,_fn=${nPcall}(${nLoad},_fake,"KarmaDecoy") if _ok and ${nType}(_fn)=="function" then return _fn(...) end end
    return nil
  end

  local function ${nProbe}()
    -- Luraph-inspired environment/integrity validation, tuned to avoid false errors in normal execution.
    if ${nType}(${nLoad})~="function" or ${nType}(${nConcat})~="function" or ${nType}(${nByte})~="function" then return false end
    local _ok1,_r1=${nPcall}(${nByte},"K",1)
    if not _ok1 or _r1~=75 then return false end
    local _ok2,_r2=${nPcall}(${nConcat},{"K","S"})
    if not _ok2 or _r2~="KS" then return false end
    local _g=(${nGetfenv} and ${nGetfenv}(0)) or _G or {}
    if ${nRawget}(_g,"KARMA_FORCE_TAMPER") or ${nRawget}(_g,"DUMPING_KARMA") then return false end
    local suspicious={"getscriptbytecode","dumpstring","decompile"}
    for _i=1,#suspicious do
      local _v=${nRawget}(_g,suspicious[_i])
      if ${nType}(_v)=="function" then return false end
    end
    if debug and debug.getinfo then
      local _ok,_info=${nPcall}(debug.getinfo,1,"Sln")
      if _ok and _info and _info.source and tostring(_info.source):lower():find("decomp") then return false end
    end
    if setfenv and ${nGetfenv} then
      local _env={}
      local _ok=${nPcall}(setfenv,function() return true end,_env)
      if not _ok then return false end
    end
    local _mt={}
    local _lock={}
    local _okmt=${nPcall}(function() setmetatable(_mt,{__metatable=_lock}); return getmetatable(_mt)==_lock end)
    if not _okmt then return false end
    return true
  end

  local function ${nWipe}(_t)
    for _i=1,#_t do _t[_i]=0 end
  end

  if not ${nProbe}() then return ${nTamper}(...) end

  local ${nOut}={}
  local ${nPrev}=${nSeedB}
  for _i=1,#${nData} do
    local _e=${nData}[_i]
    local _r=${nBand}(${nSeedA}+(_i*37)+((_i%7)*${nSeedB})+${nPrev}+${nBand}(${nSalt},255),255)
    ${nOut}[_i]=${nChar}(${nBxor}(_e,_r))
    ${nPrev}=${nBand}(_e+_i+${nSeedB},255)
  end

  local _src=${nConcat}(${nOut})
  if #_src~=${nLen} then ${nWipe}(${nData}) ${nWipe}(${nOut}) return ${nTamper}(...) end

  local ${nChkA}=1
  local ${nChkB}=2166136261
  for _i=1,#_src do
    local _b=${nByte}(_src,_i)
    ${nChkA}=(${nChkA}+_b)%65521
    ${nChkB}=${nBxor}(${nChkB},${nBand}(_b+(_i-1)*131,0xffffffff))
  end
  if ${nChkA}~=${checksumA} or ${nChkB}~=${checksumB} then ${nWipe}(${nData}) ${nWipe}(${nOut}) return ${nTamper}(...) end

  local _ok,_fn=${nPcall}(${nLoad},_src,"KarmaProtected")
  ${nWipe}(${nData}); ${nWipe}(${nOut}); ${nWipe}(_junk)
  if not _ok or ${nType}(_fn)~="function" then return ${nTamper}(...) end
  return _fn(...)
end)(...)
`;
}

async function callLuraphObfuscator(luaCode) {
  if (!LURAPH_API_URL || !LURAPH_API_KEY) {
    throw new Error('Luraph is not configured. Add LURAPH_API_URL and LURAPH_API_KEY in Render. If you have Luraph source code, send the real source file and I can wire it in.');
  }
  const response = await fetch(LURAPH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LURAPH_API_KEY}`,
      'X-API-Key': LURAPH_API_KEY
    },
    body: JSON.stringify({ code: luaCode, source: luaCode, level: 'luraph' })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Luraph API returned ${response.status}: ${text.slice(0, 300)}`);
  try {
    const json = JSON.parse(text);
    return json.obfuscated || json.code || json.result || json.output || text;
  } catch {
    return text;
  }
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
  if (selected === 'luraph') return callLuraphObfuscator(luaCode);
  if (selected === 'light') return kers0neLocalObfuscate(luaCode, { strength: 1 });
  if (selected === 'max' || selected === 'maximum') {
    // Stronger local mode: wrap once, then wrap the protected output again.
    // This is heavier, but keeps execution working while making static dumps harder.
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

// ---------------- Discord Bot ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

// Prevent duplicate replies if Discord/hosting sends the same interaction twice.
const processedInteractions = new Set();

function panelEmbed(guildId) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xe3b944)
    .setThumbnail(`${publicBaseUrl()}/assets/karma-logo.png`)
    .setFooter({ text: 'Karma Sources | v.beta', iconURL: `${publicBaseUrl()}/assets/karma-logo.png` });
}

function panelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_view_script').setLabel('View Script').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_key_info').setLabel('Key Info').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_get_buyer_role').setLabel('Get Buyer Role').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_free_key').setLabel('Free Key').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_reset_hwid').setLabel('Reset HWID').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function logGuild(guild, text) {
  // Disabled by default so commands do not appear to send two messages.
  // If you want separate log messages later, set ENABLE_COMMAND_LOGS=true in Render.
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

  db.prepare('UPDATE licenses SET hwid = NULL WHERE license_key = ?').run(key);
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
        '`/panel title description` - configure/post the button panel',
        '`/apply` - create a script, host it, and get a loadstring',
        '`/createscript` - create a script/API secret only',
        '`/scripts` - list scripts',
        '`/generatekey` - generate license keys',
        '`/redeem` - redeem a key',
        '`/keyinfo` - view key info',
        '`/mykeys` - view your keys',
        '`/freekey` - get a free key if enabled by having a script',
        '`/getrole` - get buyer role after redeeming',
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
    return interaction.reply({ ephemeral: true, content: `Karma Sources is online.\nScripts: **${scriptCount}**\nKeys: **${keyCount}**\nHosted scripts: **${hostedCount}**\nWebsite: ${publicBaseUrl()}` });
  }

  if (commandName === 'setup' || commandName === 'genkey') {
    return interaction.reply({ ephemeral: true, content: commandName === 'setup' ? 'This command was removed. Use `/panel title description` now.' : 'This command was removed. Use `/generatekey` now.' });
  }

  if (commandName === 'panel') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    }

    const panelTitle = interaction.options.getString('title', true);
    const panelDescription = interaction.options.getString('description', true);
    const adminRole = interaction.options.getRole('admin_role', false);
    const customerRole = interaction.options.getRole('customer_role', false);
    const logChannel = interaction.options.getChannel('log_channel', false);

    const patch = {
      panel_channel_id: interaction.channelId,
      panel_title: panelTitle,
      panel_description: panelDescription
    };
    if (adminRole) patch.admin_role_id = adminRole.id;
    if (customerRole) patch.customer_role_id = customerRole.id;
    if (logChannel) patch.log_channel_id = logChannel.id;
    upsertSettings(interaction.guildId, patch);

    // Only ONE Discord response: the panel itself. No channel.send + confirmation.
    const panelMessage = await interaction.reply({
      embeds: [panelEmbed(interaction.guildId)],
      components: panelButtons(),
      fetchReply: true
    });
    upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });
    return;
  }

  const adminCommands = ['generatekey', 'apply', 'hostscript', 'resethwid', 'banhwid', 'createscript', 'scripts', 'revoke', 'extendkey', 'deletekey', 'panel', 'loader', 'obfuscate', 'link'];
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
      obfuscated: shouldObfuscate,
      createdBy: interaction.user.id
    });

    const base = publicBaseUrl();
    const rawUrl = `${base}/script/${hosted.id}.lua`;
    const loadstringUrl = `${base}/loadstring/${hosted.id}`;
    const loadstring = makeLoaderSnippet(hosted.id);

    await interaction.editReply({
      content: `Hosted **${name}** ${shouldObfuscate ? '(obfuscated)' : ''}.\n\nRaw script URL:\n${rawUrl}\n\nLoadstring URL:\n${loadstringUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
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
  const rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE guild_id = ? OR created_by = ? ORDER BY created_at DESC LIMIT 500').all(interaction.guildId, OWNER_ID);
  const base = publicBaseUrl();
  const content = rows.length
    ? rows.map(r => `**${r.name}** ${r.obfuscated ? '(obfuscated)' : ''}\nLoadstring:\n\`\`\`lua\n${makeLoaderSnippet(r.id)}\n\`\`\``).join('\n')
    : 'No hosted scripts yet. Staff can use `/hostscript` or `/apply`.';

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
  if (!settings || !settings.customer_role_id) return interaction.reply({ ephemeral: true, content: 'Buyer role is not configured. Run `/panel title description` first and include customer_role.' });

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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karma Sources - Lua Whitelist & Script Protection</title>
  <meta name="description" content="Karma Sources provides Lua whitelist keys, hosted scripts, obfuscation, HWID resets, and Discord panels." />
  <style>
    :root{--bg:#020202;--side:#070707;--card:#101010;--line:#252525;--text:#fff;--muted:#a8a8a8;--accent:#fff}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 65% -5%,rgba(255,255,255,.18),transparent 32%),radial-gradient(circle at 10% 35%,rgba(255,255,255,.06),transparent 24%),#000;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif}body:before{content:'';position:fixed;right:-120px;bottom:-120px;width:520px;height:520px;background:url('/assets/karma-logo.png') center/contain no-repeat;opacity:.045;filter:grayscale(1);pointer-events:none}a{color:inherit;text-decoration:none}code{background:#111;border:1px solid #2b2b2b;border-radius:10px;padding:5px 8px}.layout{display:grid;grid-template-columns:290px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;background:rgba(5,5,5,.9);border-right:1px solid var(--line);padding:24px 20px;display:flex;flex-direction:column;backdrop-filter:blur(18px)}.brand{display:flex;align-items:center;gap:12px;padding-bottom:24px;border-bottom:1px solid #1b1b1b}.brand img{width:50px;height:50px;border-radius:14px;object-fit:cover;border:1px solid #333}.brand b{display:block;font-size:20px;letter-spacing:-.05em}.brand small{color:#999;font-size:11px;text-transform:uppercase;letter-spacing:.16em}.navgroup{margin-top:24px}.label{font-size:12px;color:#777;text-transform:uppercase;letter-spacing:.12em;margin:0 0 10px 8px}.navitem{display:flex;align-items:center;gap:12px;padding:12px 12px;border-radius:14px;color:#d6d6d6;font-weight:700}.navitem:hover,.navitem.active{background:#121212;color:#fff}.navitem.active{border-left:3px solid #fff;padding-left:9px}.ico{width:22px;text-align:center;color:#fff}.sidebottom{margin-top:auto}.sidebtn{display:flex;align-items:center;justify-content:center;width:100%;padding:15px;border-radius:16px;background:#fff;color:#000;font-weight:950}.version{text-align:center;color:#666;margin-top:14px;font-size:11px;letter-spacing:.18em}.main{min-width:0}.wrap{width:min(1120px,92%);margin:auto}.hero{padding:88px 0 70px}.pill{display:inline-flex;align-items:center;gap:9px;padding:9px 14px;border:1px solid #333;border-radius:999px;background:#080808;color:#ddd}.hero h1{font-size:clamp(48px,8vw,104px);line-height:.9;letter-spacing:-.09em;margin:22px 0;max-width:980px}.hero p{font-size:clamp(17px,2vw,22px);line-height:1.65;color:#b8b8b8;max-width:820px}.actions{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border:1px solid #fff;border-radius:999px;background:#fff;color:#000;padding:13px 19px;font-weight:900}.btn.dark{background:#050505;color:#fff;border-color:#333}.preview{margin-top:44px;border:1px solid #242424;border-radius:30px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));padding:18px;box-shadow:0 35px 120px rgba(255,255,255,.06)}.screen{border:1px solid #222;border-radius:22px;background:#050505;overflow:hidden}.screenbar{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #1f1f1f;color:#999}.screenbar b{color:#fff}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:18px}.tile{border:1px solid #252525;border-radius:18px;background:#0d0d0d;padding:20px}.tile b{display:block;font-size:32px}.tile span{color:#999}.section{padding:74px 0;border-top:1px solid rgba(255,255,255,.04)}.title{max-width:780px}.kicker{color:#aaa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:900}.title h2{font-size:clamp(34px,5vw,64px);line-height:.95;letter-spacing:-.075em;margin:10px 0}.title p{color:#aaa;line-height:1.65}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}.card{border:1px solid #252525;border-radius:28px;background:linear-gradient(180deg,#111,#070707);padding:28px;min-height:220px}.icon{font-size:30px;margin-bottom:18px}.card h3{font-size:22px;margin:0 0 10px}.card p{color:#aaa;line-height:1.65;margin:0}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:28px}.step{border:1px solid #252525;border-radius:28px;background:#080808;padding:26px}.step span{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#fff;color:#000;font-weight:950;margin-bottom:16px}.upload{border:1px solid #282828;border-radius:34px;background:radial-gradient(circle at 50% 0,rgba(255,255,255,.12),transparent 34%),#080808;padding:44px}.features-list{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:22px}.features-list div{border:1px solid #242424;border-radius:18px;background:#0c0c0c;padding:18px;color:#ccc}.mobiletop{display:none;padding:14px 18px;border-bottom:1px solid var(--line);align-items:center;gap:12px;background:#070707;position:sticky;top:0;z-index:20}.mobiletop img{width:40px;height:40px;border-radius:12px}@media(max-width:920px){.layout{display:block}.sidebar{position:relative;height:auto}.brand{display:none}.mobiletop{display:flex}.cards,.steps,.tiles,.features-list{grid-template-columns:1fr}.hero{padding-top:44px}.sidebottom{margin-top:20px}}
  </style>
</head>
<body>
  <div class="mobiletop"><img src="/assets/karma-logo.png" alt="Karma Sources"><b>Karma Sources</b></div>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><img src="/assets/karma-logo.png" alt="Karma Sources"><div><b>Karma Sources</b><small>Lua Protection</small></div></div>
      <div class="navgroup"><p class="label">Main</p><a class="navitem active" href="#overview"><span class="ico">⌁</span>Overview</a><a class="navitem" href="#scripts"><span class="ico">▦</span>Scripts</a><a class="navitem" href="#sources"><span class="ico">▧</span>Sources</a><a class="navitem" href="#obfuscate"><span class="ico">🧩</span>Obfuscate</a></div>
      <div class="navgroup"><p class="label">Learn</p><a class="navitem" href="#tutorials"><span class="ico">↯</span>Tutorials</a><a class="navitem" href="#how"><span class="ico">?</span>How It Works</a><a class="navitem" href="#api"><span class="ico">🔗</span>API Link</a><a class="navitem" href="${DISCORD_INVITE_URL}"><span class="ico">○</span>Discord</a></div>
      <div class="sidebottom"><a class="sidebtn" href="/login">Get Started</a><div class="version">KARMA · SOURCES</div></div>
    </aside>
    <main class="main">
      <section id="overview" class="hero"><div class="wrap"><span class="pill">Lua Whitelist · Script Hosting · Discord OAuth</span><h1>Protect and monetize your Lua scripts.</h1><p>Upload files, obfuscate source, generate keys, host loadstrings, link your Discord server, and manage buyer access with a polished Polsec-style workflow.</p><div class="actions"><a class="btn" href="/login">Get Started</a><a class="btn dark" href="${DISCORD_INVITE_URL}">Join Discord</a><a class="btn dark" href="#how">How It Works</a></div><div class="preview"><div class="screen"><div class="screenbar"><b>Karma Dashboard</b><span>live on Render</span></div><div class="tiles"><div class="tile"><b>${scriptCount}</b><span>Scripts</span></div><div class="tile"><b>${keyCount}</b><span>Keys</span></div><div class="tile"><b>${hostedCount}</b><span>Hosted Loadstrings</span></div></div></div></div></div></section>
      <section id="scripts" class="section"><div class="wrap"><div class="title"><div class="kicker">Scripts</div><h2>Upload, host, and serve loadstrings.</h2><p>Dashboard users get 1000 script slots. Paste source or upload a Lua file, then copy the generated loadstring.</p></div><div class="cards"><div class="card"><div class="icon">📁</div><h3>Upload Files</h3><p>Upload .lua or .txt files from the dashboard and publish them as hosted scripts.</p></div><div class="card"><div class="icon">⚡</div><h3>Instant Loadstrings</h3><p>Every hosted script gets a Render URL and a ready-to-use loadstring.</p></div><div class="card"><div class="icon">🔐</div><h3>Whitelist Keys</h3><p>Generate keys in Discord and verify access through the API endpoint.</p></div></div></div></section>
      <section id="sources" class="section"><div class="wrap"><div class="title"><div class="kicker">Sources</div><h2>Manage source safely.</h2><p>Store hosted scripts in your dashboard, delete old builds, and keep original or obfuscated outputs organized.</p></div><div class="cards"><div class="card"><h3>Source Editor</h3><p>Paste Lua directly into the dashboard editor.</p></div><div class="card"><h3>File Import</h3><p>Upload local Lua/TXT files and auto-fill the editor.</p></div><div class="card"><h3>Hosted Builds</h3><p>Each source becomes a hosted script endpoint.</p></div></div></div></section>
      <section id="tutorials" class="section"><div class="wrap"><div class="title"><div class="kicker">Tutorials</div><h2>Quick start workflow.</h2><p>Use the bot and website together.</p></div><div class="steps"><div class="step"><span>1</span><h3>Get Started</h3><p>Sign in with Discord and open the dashboard.</p></div><div class="step"><span>2</span><h3>Upload or paste source</h3><p>Create a script, optionally obfuscate it, then host it.</p></div><div class="step"><span>3</span><h3>Link Discord</h3><p>Copy your dashboard API key and run <code>/link api</code> in your server.</p></div></div></div></section>
      <section id="how" class="section"><div class="wrap"><div class="title"><div class="kicker">How It Works</div><h2>One website. One bot. Full control.</h2><p>The website handles Discord OAuth, upload files, script hosting, and obfuscation. The bot handles panels, keys, HWID resets, and Discord roles.</p></div><div class="cards"><div class="card"><div class="icon">🤖</div><h3>Discord Panel</h3><p>Run <code>/panel title description</code> to post your customer panel without duplicate messages.</p></div><div id="api" class="card"><div class="icon">🔗</div><h3>API Link</h3><p>Run <code>/link api key:...</code> to connect your Discord server to your dashboard API key.</p></div><div class="card"><div class="icon">🖥️</div><h3>HWID</h3><p>Keys lock to first device and can be reset with <code>/resethwid</code>.</p></div></div></div></section>
      <section id="obfuscate" class="section"><div class="wrap"><div class="upload"><div class="kicker">Obfuscate Features</div><h2>Kers0ne-style protection.</h2><p>Uses the protected-output style from your uploaded Kers0ne example: banner, encoded byte table, rolling XOR decoder, checksum, and loadstring wrapper.</p><div class="features-list"><div>Protected banner: <b>Protected By Kers0ne Obfuscator</b></div><div>Rolling XOR encoded Lua source</div><div>Optional obfuscation before hosting</div><div>Download obfuscated output as .lua</div></div><div class="actions"><a class="btn" href="/login">Upload Files and Obfuscate</a><a class="btn dark" href="/health">Check Status</a></div><p><code>/panel</code> <code>/generatekey</code> <code>/apply</code> <code>/hostscript</code> <code>/obfuscate</code> <code>/link api</code></p></div></div></section>
    </main>
  </div>
</body>
</html>`;
}

function makeUserApiKey(userId) {
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(`api:${userId}`).digest('base64url').slice(0, 32);
  return `ks_${userId}_${sig}`;
}

function discordDashboardPage(user, req = { query: {} }) {
  const username = escapeHtml(user.global_name || user.username || 'Discord User');
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : '/assets/karma-logo.png';
  const apiKey = makeUserApiKey(user.id);
  const tab = String(req.query.tab || 'overview');
  const selectedId = String(req.query.script || '');
  const scripts = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
  const selected = selectedId ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(selectedId, user.id) : (scripts[0] ? db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(scripts[0].id, user.id) : null);
  const remaining = user.id === OWNER_ID ? 'Unlimited' : Math.max(0, MAX_WEB_SCRIPTS_PER_USER - scripts.length);
  const botInvite = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}&permissions=268435456&scope=bot%20applications.commands`;
  const isOwner = user.id === OWNER_ID;

  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${selected?.id === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${escapeHtml(s.created_at)}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  if (tab === 'scripts') {
    content = selected ? `<div class="card"><div class="cardHead"><div><p class="eyebrow">Selected Script</p><h2>${escapeHtml(selected.name)}</h2><p class="muted">${selected.obfuscated ? 'Obfuscated build · edits auto re-obfuscate on save' : 'Plain build'} · ${escapeHtml(selected.created_at)}</p></div></div><h3>Loadstring</h3><code class="block">${makeLoaderSnippet(selected.id)}</code><h3>Edit Script</h3><form method="post" action="/dashboard/scripts/${selected.id}/update"><label>Script name</label><input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required><label>Source / Output</label><textarea name="code" maxlength="4000" required>${escapeHtml(selected.code)}</textarea><div class="buttonRow"><button type="submit">Save Script</button><button class="secondary" type="submit" formaction="/dashboard/obfuscate" formmethod="post">Obfuscate Download</button><button class="danger" type="submit" formaction="/dashboard/scripts/${selected.id}/delete" formmethod="post">Delete Script</button></div></form></div>` : `<div class="card"><h2>Scripts</h2><p class="muted">Create a script from the Sources page.</p></div>`;
  } else if (tab === 'sources') {
    content = `<div class="card"><p class="eyebrow">Sources</p><h2>Create a hosted script</h2><p class="muted">Upload a Lua or text file, or paste source manually. Obfuscation can run before hosting.</p><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><p class="hint">File contents will be placed into the source box below.</p><label>Source code</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("Karma Sources")' required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before hosting</label><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option><option value="luraph">Luraph API</option></select><div class="buttonRow"><button type="submit">Host Script</button><button class="secondary" type="submit" formaction="/dashboard/obfuscate" formmethod="post">Obfuscate Only</button></div></form></div>`;
  } else if (tab === 'keys') {
    const projects = db.prepare('SELECT id, name, created_at FROM scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
    const keys = db.prepare('SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.created_by = ? ORDER BY l.created_at DESC LIMIT 50').all(user.id);
    content = `<div class="card"><p class="eyebrow">Keys</p><h2>Generate keys for projects</h2><p class="muted">Create whitelist keys for any project you own.</p><form method="post" action="/dashboard/keys"><label>Project</label><select name="script_id">${projects.map(pr=>`<option value="${escapeHtml(pr.id)}">${escapeHtml(pr.name)} · ${escapeHtml(pr.id)}</option>`).join('')}</select><label>Days</label><input name="days" type="number" value="30" min="0" max="3650"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20"><button>Generate Keys</button></form><h3>Recent Keys</h3>${keys.map(k=>`<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${escapeHtml(k.script_name)} · ${k.expires_at || 'Lifetime'} · ${k.revoked ? 'Revoked' : 'Active'}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}</div>`;
  } else if (tab === 'storage') {
    if (!isOwner) {
      content = `<div class="card"><h2>Script Storage</h2><p class="muted">Only the owner can access global storage.</p></div>`;
    } else {
      const stored = db.prepare('SELECT * FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC LIMIT 500').all(OWNER_ID);
      content = `<div class="card"><p class="eyebrow">Owner Storage</p><h2>Script Storage</h2><p class="muted">Owner account has unlimited scripts. Add global scripts here and use them in panels/loadstrings.</p><form method="post" action="/owner/storage"><label>Name</label><input name="name" maxlength="80" required><label>Source</label><textarea name="code" maxlength="4000" required></textarea><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option><option value="luraph">Luraph API</option></select><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before storing</label><button>Add Stored Script</button></form><h3>Stored Scripts</h3>${stored.map(r=>`<div class="row"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.id)} · ${r.obfuscated ? 'Obfuscated' : 'Plain'}</small><code class="block">${makeLoaderSnippet(r.id)}</code></div>`).join('') || '<p class="muted">No stored scripts.</p>'}</div>`;
    }
  } else if (tab === 'obfuscate') {
    content = `<div class="card"><p class="eyebrow">Obfuscator</p><h2>Protect Lua source</h2><p class="muted">Kers0ne-style protected wrapper with randomized locals, rolling XOR, checksum validation, and anti-tamper fallback.</p><form method="post" action="/dashboard/obfuscate"><label>Filename</label><input name="filename" value="obfuscated.lua"><label>Lua source</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("protect me")' required></textarea><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option><option value="luraph">Luraph API</option></select><div class="buttonRow"><button type="submit">Download Obfuscated Lua</button><a class="btn dark" href="/dashboard?tab=sources">Upload Source</a></div></form><div class="featureGrid"><div>Anti-tamper checksum</div><div>Anti-Dump Hardening on new builds</div><div>Rolling XOR byte encoding</div><div>Decoy layer for automated dumps</div><div>Random local names</div><div>Protected output banner</div></div></div>`;
  } else if (tab === 'how') {
    content = `<div class="card"><p class="eyebrow">How It Works</p><h2>Complete workflow</h2><div class="stepsDash"><div><span>1</span><b>Upload source</b><p>Go to Sources and upload a Lua file or paste code.</p></div><div><span>2</span><b>Obfuscate or host</b><p>Enable obfuscation and create a hosted loadstring.</p></div><div><span>3</span><b>Link Discord</b><p>Run <code>/link api key:${apiKey}</code> in your server.</p></div><div><span>4</span><b>Generate keys</b><p>Use <code>/generatekey</code> and the panel for buyers.</p></div></div></div>`;
  } else if (tab === 'tutorials') {
    content = `<div class="card"><p class="eyebrow">Tutorials</p><h2>Quick tutorials</h2><h3>Bot setup</h3><p class="muted">Invite the bot, then run <code>/panel title:Your Hub description:Use buttons below</code>.</p><h3>Script upload</h3><p class="muted">Open Sources, upload your Lua file, optionally obfuscate, and copy the loadstring from Scripts.</p><h3>Premium/redeem</h3><p class="muted">Give customers a code from the Owner panel. They redeem it on the Redeem page.</p></div>`;
  } else if (tab === 'redeem') {
    content = `<div class="card"><p class="eyebrow">Redeem</p><h2>Redeem access code</h2><p class="muted">Paste a premium or access code you received.</p><form method="post" action="/redeem"><input name="code" placeholder="XXXX-XXXX-XXXX" required><button type="submit">Redeem</button></form></div>`;
  } else if (tab === 'discord') {
    content = `<div class="card"><p class="eyebrow">Discord</p><h2>Connect your server</h2><p class="muted">Add the bot to your server, then link your dashboard API key.</p><a class="btn" href="${botInvite}">Add Discord Bot To Server</a><h3>Link API</h3><code class="block">/link api key:${apiKey}</code><p class="muted">Run this in Discord to connect the server to the website.</p></div>`;
  } else if (tab === 'settings') {
    const dbUser = db.prepare('SELECT * FROM website_users WHERE id = ?').get(user.id) || {};
    const displayName = dbUser.display_username || user.username || '';
    content = `<div class="card"><p class="eyebrow">Settings</p><h2>Account settings</h2><form method="post" action="/dashboard/settings"><label>Username</label><input name="display_username" minlength="3" maxlength="24" pattern="[A-Za-z0-9]{3,24}" value="${escapeHtml(displayName)}" required><p class="hint">Usernames can only be 3–24 letters or numbers.</p><label class="check"><input type="checkbox" name="twofa_enabled" value="true" ${dbUser.twofa_enabled ? 'checked' : ''}> Enable two factor authentication</label><p class="hint">This adds a dashboard 2FA setting flag. Connect a real authenticator provider later if you want enforced OTP challenges.</p><button type="submit">Save Settings</button></form></div>`;
  } else if (tab === 'owner' && isOwner) {
    const users = db.prepare('SELECT * FROM website_users ORDER BY last_login DESC LIMIT 50').all();
    const codes = db.prepare('SELECT * FROM premium_codes ORDER BY created_at DESC LIMIT 50').all();
    const banned = db.prepare('SELECT * FROM banned_hwids ORDER BY created_at DESC LIMIT 50').all();
    content = `<div class="card"><p class="eyebrow">Owner Only</p><h2>Owner panel</h2><div class="stats"><div class="stat"><div class="num">${users.length}</div><span>Recent users</span></div><div class="stat"><div class="num">${scripts.length}</div><span>Your scripts</span></div><div class="stat"><div class="num">${banned.length}</div><span>Banned HWIDs</span></div></div><h3>Create premium code</h3><form method="post" action="/owner/codes"><input name="code" placeholder="PREMIUM-KEY-123" required><input name="plan" placeholder="premium" value="premium"><button>Create Code</button></form><h3>Ban HWID</h3><form method="post" action="/owner/ban-hwid"><input name="hwid" placeholder="HWID" required><input name="reason" placeholder="Reason"><button class="danger">Ban HWID</button></form><h3>Website users</h3>${users.map(u=>`<div class="row"><b>${escapeHtml(u.display_username||u.global_name||u.username||u.id)}</b><small>${escapeHtml(u.id)} · plan: ${escapeHtml(u.plan||'free')} · last: ${escapeHtml(u.last_login)}</small><form method="post" action="/owner/user-plan" class="inlineForm"><input type="hidden" name="user_id" value="${escapeHtml(u.id)}"><select name="plan"><option value="free" ${(u.plan||'free')==='free'?'selected':''}>free</option><option value="premium" ${u.plan==='premium'?'selected':''}>premium</option><option value="royal" ${u.plan==='royal'?'selected':''}>royal</option><option value="banned" ${u.plan==='banned'?'selected':''}>banned</option></select><button>Update</button></form></div>`).join('')}<h3>Premium codes</h3>${codes.map(c=>`<div class="row"><b>${escapeHtml(c.code)}</b><small>${escapeHtml(c.plan)} · redeemed by ${escapeHtml(c.redeemed_by||'nobody')}</small></div>`).join('')}</div>`;
  } else {
    content = `<div class="card heroCard"><p class="eyebrow">Overview</p><h2>Dashboard</h2><p class="muted">Manage scripts, sources, obfuscation, tutorials, Discord links, redeem codes, and owner tools from one clean dashboard.</p><div class="stats"><div class="stat"><div class="num">${scripts.length}</div><span>Scripts used</span></div><div class="stat"><div class="num">${remaining}</div><span>Slots left</span></div><div class="stat"><div class="num">1000</div><span>Max scripts</span></div></div><div class="anime"></div></div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Dashboard</title><style>:root{--bg:#050505;--shell:#0b0b0c;--panel:#101011;--panel2:#151516;--line:#2a2a2d;--muted:#a1a1aa;--text:#f8fafc}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.16),transparent 30%),#000;color:var(--text);font-family:"SF Pro Display","Aptos","Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;letter-spacing:-.01em}body:before{content:'';position:fixed;right:-140px;bottom:-140px;width:560px;height:560px;background:url('/assets/karma-logo.png') center/contain no-repeat;opacity:.045;filter:grayscale(1);pointer-events:none}a{color:inherit;text-decoration:none}.page{padding:28px}.shell{max-width:1480px;margin:0 auto;min-height:calc(100vh - 56px);display:grid;grid-template-columns:270px 260px 1fr;border:1px solid var(--line);border-radius:32px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018));box-shadow:0 30px 120px rgba(0,0,0,.5)}.side{background:rgba(8,8,9,.86);border-right:1px solid var(--line);padding:22px;overflow:auto}.brand{display:flex;gap:12px;align-items:center;border-bottom:1px solid #242427;padding-bottom:20px}.brand img,.avatar{width:48px;height:48px;border-radius:14px;object-fit:cover}.brand b{display:block;font-size:18px;font-weight:850}.brand small,.muted,small{color:var(--muted)}.nav{margin-top:20px}.nav a{display:flex;align-items:center;padding:12px 13px;border-radius:14px;color:#d4d4d8;font-weight:720;margin-bottom:4px}.nav a:hover,.nav a.active{background:#18181b;color:#fff}.scriptsPane{background:rgba(5,5,6,.75);border-right:1px solid var(--line);padding:20px;overflow:auto}.scriptLink{display:block;border:1px solid #27272a;background:#0e0e10;border-radius:16px;padding:13px;margin-bottom:10px}.scriptLink.active{border-color:#fff;background:#171719}.main{padding:28px;min-width:0;position:relative;overflow:hidden}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.profile{display:flex;gap:12px;align-items:center}.card{border:1px solid var(--line);border-radius:26px;background:linear-gradient(180deg,rgba(24,24,27,.92),rgba(9,9,10,.96));padding:26px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 24px 80px rgba(0,0,0,.28);margin-bottom:18px;position:relative;z-index:1}.card h2{font-size:clamp(32px,4vw,56px);line-height:.95;letter-spacing:-.06em;margin:6px 0 12px}.eyebrow{color:#a1a1aa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:850;margin:0 0 8px}.btn,button{display:inline-flex;align-items:center;justify-content:center;border:1px solid #fff;background:#fff;color:#000;border-radius:999px;padding:12px 18px;font-weight:900;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;box-shadow:0 10px 30px rgba(255,255,255,.06)}.btn:hover,button:hover{transform:translateY(-1px);box-shadow:0 14px 42px rgba(255,255,255,.10)}.btn.dark{background:#0a0a0b;color:#fff;border-color:#343438}.secondary{background:#0a0a0b;color:#fff;border-color:#343438}.buttonRow{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:6px}.danger{background:#220f0f;color:#ffb4ad;border-color:#5b2521}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}.stat{border:1px solid #27272a;border-radius:18px;background:#0b0b0c;padding:18px}.num{font-size:38px;font-weight:900;letter-spacing:-.05em}select{background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:10px;font:inherit}.inlineForm{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}input,textarea{width:100%;background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:12px;margin:8px 0 14px;font:inherit}textarea{min-height:260px}.check{display:flex;gap:10px;align-items:center}.check input{width:auto}.block{display:block;white-space:pre-wrap;word-break:break-all;padding:12px;margin:10px 0;background:#080809;border:1px solid #343438;border-radius:14px}.row{border:1px solid #27272a;border-radius:14px;padding:12px;margin:8px 0;background:#0b0b0c}.featureGrid,.stepsDash{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:16px}.featureGrid div,.stepsDash div{border:1px solid #27272a;border-radius:16px;background:#0b0b0c;padding:16px}.stepsDash span{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#fff;color:#000;font-weight:900}.anime{height:220px;border-radius:24px;border:1px solid #27272a;margin-top:22px;background:radial-gradient(circle at 30% 50%,rgba(255,255,255,.18),transparent 18%),radial-gradient(circle at 70% 50%,rgba(255,255,255,.11),transparent 20%),linear-gradient(120deg,#000,#111,#000);background-size:160% 160%;animation:movebg 6s infinite alternate;position:relative;overflow:hidden}.anime:after{content:'';position:absolute;inset:-40%;background:conic-gradient(from 0deg,transparent,rgba(255,255,255,.12),transparent 35%);animation:spin 8s linear infinite}@keyframes movebg{to{background-position:100% 60%}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1100px){.page{padding:12px}.shell{grid-template-columns:1fr;border-radius:22px}.side,.scriptsPane{border-right:0;border-bottom:1px solid var(--line)}.stats,.featureGrid,.stepsDash{grid-template-columns:1fr}.top{align-items:flex-start;gap:16px;flex-direction:column}}</style></head><body><div class="page"><div class="shell"><aside class="side"><div class="brand"><img src="/assets/karma-logo.png"><div><b>Karma Sources</b><small>${username}</small></div></div><nav class="nav"><a class="${tab==='overview'?'active':''}" href="/dashboard">Overview</a><a class="${tab==='scripts'?'active':''}" href="/dashboard?tab=scripts">Scripts</a><a class="${tab==='sources'?'active':''}" href="/dashboard?tab=sources">Sources</a><a class="${tab==='keys'?'active':''}" href="/dashboard?tab=keys">Keys</a><a class="${tab==='storage'?'active':''}" href="/dashboard?tab=storage">Script Storage</a><a class="${tab==='obfuscate'?'active':''}" href="/dashboard?tab=obfuscate">Obfuscate</a><a class="${tab==='how'?'active':''}" href="/dashboard?tab=how">How It Works</a><a class="${tab==='tutorials'?'active':''}" href="/dashboard?tab=tutorials">Tutorials</a><a class="${tab==='redeem'?'active':''}" href="/dashboard?tab=redeem">Redeem</a><a class="${tab==='discord'?'active':''}" href="/dashboard?tab=discord">Discord Bot</a><a class="${tab==='settings'?'active':''}" href="/dashboard?tab=settings">Settings</a>${isOwner?`<a class="${tab==='owner'?'active':''}" href="/dashboard?tab=owner">Owner Panel</a>`:''}<a href="/logout">Logout</a></nav></aside><aside class="scriptsPane"><h3>Scripts</h3>${scriptLinks}<a class="btn" href="/dashboard?tab=sources">New Script</a></aside><main class="main"><div class="top"><div class="profile"><img class="avatar" src="${avatar}"><div><b>${username}</b><br><small>${scripts.length}/1000 scripts used</small></div></div><a class="btn dark" href="/">Home</a></div>${content}</main></div></div><script>document.getElementById('fileInput')?.addEventListener('change', async e => { const f=e.target.files[0]; if(!f) return; document.querySelector('input[name="name"]').value ||= f.name.replace(/\.(lua|txt)$/i,''); document.getElementById('codeBox').value = await f.text(); });</script></body></html>`;
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
  const token = readCookies(req).kolsec_session;
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(body).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const user = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!user.exp || user.exp < Date.now()) return null;
  return user;
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
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use('/assets', express.static('public'));

  app.get('/', (req, res) => res.type('html').send(kolsecHomePage()));
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Sources' }));

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
    return res.type('html').send(discordDashboardPage(user, req));
  });

  app.post('/dashboard/scripts', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;

    const count = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE created_by = ?').get(user.id).count;
    if (user.id !== OWNER_ID && count >= MAX_WEB_SCRIPTS_PER_USER) {
      return res.status(403).type('html').send(`<h1>Script limit reached</h1><p>You already have ${MAX_WEB_SCRIPTS_PER_USER} scripts.</p><a href="/dashboard">Back</a>`);
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
      obfuscated: shouldObfuscate,
      createdBy: user.id
    });

    return res.redirect('/dashboard');
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
    const current = db.prepare('SELECT * FROM hosted_scripts WHERE id = ? AND created_by = ?').get(req.params.id, user.id);
    if (!current) return res.status(404).type('html').send('<h1>Script not found</h1><a href="/dashboard?tab=scripts">Back</a>');
    const name = String(req.body.name || current.name).trim().slice(0, 80);
    let code = String(req.body.code || '').slice(0, 4000);
    if (!name || !code) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard?tab=scripts">Back</a>');
    if (current.obfuscated) code = await callObfuscator(code, 'standard');
    db.prepare('UPDATE hosted_scripts SET name = ?, code = ?, obfuscated = ? WHERE id = ? AND created_by = ?')
      .run(name, code, current.obfuscated ? 1 : 0, req.params.id, user.id);
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

  app.post('/dashboard/scripts/:id/delete', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM hosted_scripts WHERE id = ? AND created_by = ?').run(req.params.id, user.id);
    return res.redirect('/dashboard');
  });

  app.post('/dashboard/obfuscate', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    const code = String(req.body.code || '').slice(0, 4000);
    const filename = String(req.body.filename || req.body.name || 'obfuscated.lua').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const level = String(req.body.level || 'standard');
    if (!code) return res.status(400).type('html').send('<h1>Missing code</h1><a href="/dashboard?tab=obfuscate">Back</a>');
    const obfuscated = await callObfuscator(code, level);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.endsWith('.lua') ? filename : `${filename}.lua`}"`);
    return res.type('text/plain').send(obfuscated);
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
    createHostedScript({ guildId: 'owner-storage', name, code: finalCode, obfuscated: shouldObfuscate, createdBy: OWNER_ID });
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

  app.post('/owner/user-plan', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const userId = String(req.body.user_id || '').trim();
    const plan = String(req.body.plan || 'free').trim();
    if (userId && ['free', 'premium', 'royal', 'banned'].includes(plan)) {
      db.prepare('UPDATE website_users SET plan = ? WHERE id = ?').run(plan, userId);
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
    if (!script) return res.status(404).type('text/plain').send('-- Karma Sources: script not found');
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code);
  });

  app.get('/loadstring/:id', (req, res) => {
    const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
    if (!script) return res.status(404).type('text/plain').send('-- Karma Sources: script not found');
    const rawUrl = `${publicBaseUrl()}/script/${script.id}.lua`;
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(makeProtectedLoader(rawUrl));
  });

  app.get('/hosted', (req, res) => {
    const rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 50').all();
    res.json({ ok: true, scripts: rows.map(r => ({ ...r, script_url: `${publicBaseUrl()}/script/${r.id}.lua`, loadstring_url: `${publicBaseUrl()}/loadstring/${r.id}` })) });
  });

  app.post('/api/verify', (req, res) => {
    if (GLOBAL_API_TOKEN && req.header('X-Global-Token') !== GLOBAL_API_TOKEN) {
      return res.status(401).json({ ok: false, message: 'Invalid global token' });
    }

    const { script_id, key, hwid } = req.body || {};
    const apiSecret = req.header('X-API-Secret');

    if (!script_id || !key || !hwid || !apiSecret) {
      return res.status(400).json({ ok: false, message: 'Missing script_id, key, hwid, or X-API-Secret' });
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

  // Render requires process.env.PORT for web services.
  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));
}

(async () => {
  try {
    await deployCommands();
  } catch (error) {
    console.error('Slash command deploy failed:', error);
  }

  startApiServer();
  await client.login(DISCORD_TOKEN);
})();
