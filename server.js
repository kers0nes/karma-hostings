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
  OWNER_ID = '1207803375807373415'
} = process.env;

const OAUTH_CLIENT_ID = DISCORD_OAUTH_CLIENT_ID || CLIENT_ID || '1525736430813450342';
const SESSION_SIGNING_SECRET = SESSION_SECRET || DISCORD_CLIENT_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_WEB_SCRIPTS_PER_USER = 20;
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
      .addStringOption(o => o.setName('script_id').setDescription('Optional hosted script ID for this server panel').setRequired(false))),


  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Create/apply a protected script and host its loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Obfuscate before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' }
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
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Run the code through your obfuscator before hosting'))
    .addStringOption(o => o.setName('level').setDescription('Obfuscation level').setRequired(false).addChoices(
      { name: 'Light', value: 'light' },
      { name: 'Standard', value: 'standard' },
      { name: 'Maximum', value: 'max' }
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
      { name: 'Maximum', value: 'max' }
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
  panel_script_id TEXT,
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
  source_code TEXT,
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
  script_quota INTEGER NOT NULL DEFAULT 20,
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
  'ALTER TABLE guild_settings ADD COLUMN panel_script_id TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_hash TEXT',
  'ALTER TABLE guild_settings ADD COLUMN api_key_preview TEXT',
  'ALTER TABLE website_users ADD COLUMN display_username TEXT',
  'ALTER TABLE website_users ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE website_users ADD COLUMN twofa_secret TEXT',
  "ALTER TABLE website_users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
  "ALTER TABLE website_users ADD COLUMN script_quota INTEGER NOT NULL DEFAULT 20"
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
    INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, panel_title, panel_description, panel_script_id, api_key_hash, api_key_preview, updated_at)
    VALUES (@guild_id, @admin_role_id, @customer_role_id, @log_channel_id, @panel_channel_id, @panel_message_id, @panel_title, @panel_description, @panel_script_id, @api_key_hash, @api_key_preview, CURRENT_TIMESTAMP)
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

function createHostedScript({ guildId, name, code, sourceCode, obfuscated, createdBy }) {
  const id = makeId('host');
  db.prepare(`
    INSERT INTO hosted_scripts (id, guild_id, name, code, source_code, obfuscated, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, guildId, name, code, sourceCode || code, obfuscated ? 1 : 0, createdBy);
  return { id, name, code, source_code: sourceCode || code, obfuscated: Boolean(obfuscated) };
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
\tKarma Protection Loader
\tStable execution path
]]
return(function(...)
  local _home=${JSON.stringify(home)}
  local _url=${JSON.stringify(rawUrl)}
  local function _safe(fn,...) local ok,res=pcall(fn,...) if ok then return res end return nil end
  local function _tamper()
    if setclipboard then _safe(setclipboard,_home) end
    if warn then _safe(warn,"Karma loader fallback: ".._home) end
    return nil
  end
  local function _get(url)
    if game and game.HttpGet then
      local r=_safe(function() return game:HttpGet(url) end)
      if type(r)=="string" then return r end
    end
    local req = (syn and syn.request) or http_request or request
    if type(req)=="function" then
      local res=_safe(req,{Url=url,Method="GET"})
      if type(res)=="table" then return res.Body or res.body end
      if type(res)=="string" then return res end
    end
    return nil
  end
  if type(loadstring or load)~="function" then return _tamper() end
  local _src=_get(_url)
  if type(_src)~="string" or #_src<1 then return _tamper() end
  local _ok,_fn=pcall(loadstring or load,_src,"KarmaLoaderPayload")
  if not _ok or type(_fn)~="function" then return _tamper() end
  return _fn(...)
end)(...)
`;
}

function kers0neLocalObfuscate(luaCode, opts = {}) {
  // Reliable Karma/Kers0ne-style obfuscator.
  // Goal: execute without false anti-tamper crashes, while still making static dumps useless.
  // Anti-tamper now only stops on real payload corruption or missing execution primitives.
  const source = String(luaCode || '');
  const strength = Math.max(1, Math.min(3, Number(opts.strength || 2)));
  const bytes = Buffer.from(source, 'utf8');
  const seedA = (crypto.randomBytes(1)[0] || 173) & 255;
  const seedB = (crypto.randomBytes(1)[0] || 91) & 255;
  const seedC = (crypto.randomBytes(1)[0] || 47) & 255;
  const home = publicBaseUrl();

  let prev = seedB;
  const encoded = Array.from(bytes, (byte, index) => {
    const i = index + 1;
    const rolling = (seedA + i * 17 + (i % 11) * seedB + prev + seedC) & 255;
    const enc = byte ^ rolling;
    prev = (enc + seedB + i) & 255;
    return enc;
  });

  const checksum = bytes.reduce((a, b, i) => (a + ((b + 1) * ((i % 251) + 1))) % 2147483647, 7);
  const decoyText = `print(${JSON.stringify('Karma Protection: decoy payload')})`;
  const decoyBytes = Array.from(Buffer.from(decoyText, 'utf8'), (b, i) => b ^ ((seedC + i * 13) & 255));

  const chunkSize = strength === 3 ? 16 : strength === 2 ? 24 : 36;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += chunkSize) chunks.push(encoded.slice(i, i + chunkSize).join(','));
  const decoyChunks = [];
  for (let i = 0; i < decoyBytes.length; i += 24) decoyChunks.push(decoyBytes.slice(i, i + 24).join(','));

  const names = Array.from({ length: 20 }, () => `_${crypto.randomBytes(3).toString('hex')}`);
  const [nChar, nConcat, nByte, nLoad, nPcall, nType, nData, nDecoy, nOut, nSeedA, nSeedB, nSeedC, nPrev, nChk, nHome, nTamper, nWipe, nLen, nBxor, nBand] = names;
  const junkNumbers = Array.from({ length: 8 }, () => crypto.randomInt(10, 999)).join(',');

  return `--[[
\tProtected By Kers0ne Obfuscator
\tKarma Protection Anti-Tamper: stable
]]

return(function(...)
  local ${nChar}=string.char
  local ${nConcat}=table.concat
  local ${nByte}=string.byte
  local ${nLoad}=loadstring or load
  local ${nPcall}=pcall
  local ${nType}=type
  local ${nHome}=${JSON.stringify(home)}
  local ${nSeedA}=${seedA}
  local ${nSeedB}=${seedB}
  local ${nSeedC}=${seedC}
  local ${nLen}=${bytes.length}
  local ${nData}={${chunks.join(',')}}
  local ${nDecoy}={${decoyChunks.join(',')}}
  local _junk={${junkNumbers}}

  local ${nBxor} = (bit32 and bit32.bxor) or (bit and bit.bxor)
  local ${nBand} = (bit32 and bit32.band) or (bit and bit.band)

  local function ${nTamper}(...)
    if setclipboard then ${nPcall}(setclipboard,${nHome}) end
    if warn then ${nPcall}(warn,"Karma Protection triggered: "..${nHome}) end
    local _d={}
    if ${nBxor} and ${nBand} then
      for _i=1,#${nDecoy} do _d[_i]=${nChar}(${nBxor}(${nDecoy}[_i],${nBand}(${nSeedC}+(_i-1)*13,255))) end
      local _fake=${nConcat}(_d)
      if ${nType}(${nLoad})=="function" then local _ok,_fn=${nPcall}(${nLoad},_fake,"KarmaDecoy") if _ok and ${nType}(_fn)=="function" then return _fn(...) end end
    end
    return nil
  end

  local function ${nWipe}(_t) for _i=1,#_t do _t[_i]=0 end end

  -- Do not false-flag normal executors. Only fail if core primitives are missing.
  if ${nType}(${nLoad})~="function" or ${nType}(${nConcat})~="function" or ${nType}(${nByte})~="function" or not ${nBxor} or not ${nBand} then
    return ${nTamper}(...)
  end

  local ${nOut}={}
  local ${nPrev}=${nSeedB}
  for _i=1,#${nData} do
    local _e=${nData}[_i]
    local _r=${nBand}(${nSeedA}+_i*17+(_i%11)*${nSeedB}+${nPrev}+${nSeedC},255)
    ${nOut}[_i]=${nChar}(${nBxor}(_e,_r))
    ${nPrev}=${nBand}(_e+${nSeedB}+_i,255)
  end

  local _src=${nConcat}(${nOut})
  if #_src~=${nLen} then ${nWipe}(${nData}); ${nWipe}(${nOut}); return ${nTamper}(...) end

  local ${nChk}=7
  for _i=1,#_src do
    local _b=${nByte}(_src,_i)
    ${nChk}=(${nChk}+((_b+1)*(((_i-1)%251)+1)))%2147483647
  end
  if ${nChk}~=${checksum} then ${nWipe}(${nData}); ${nWipe}(${nOut}); return ${nTamper}(...) end

  local _ok,_fn=${nPcall}(${nLoad},_src,"KarmaProtected")
  ${nWipe}(${nData}); ${nWipe}(${nOut}); ${nWipe}(_junk)
  if not _ok or ${nType}(_fn)~="function" then return ${nTamper}(...) end
  return _fn(...)
end)(...)
`;
}

async function callObfuscator(luaCode, level = 'standard') {
  const selected = String(level || 'standard').toLowerCase();
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

function panelEmbed(guildId, sentBy = null) {
  const settings = guildId ? getSettings(guildId) : null;
  const title = settings?.panel_title || 'Karma Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xe3b944)
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

  const adminCommands = ['generatekey', 'apply', 'hostscript', 'resethwid', 'banhwid', 'createscript', 'scripts', 'revoke', 'extendkey', 'deletekey', 'setup', 'loader', 'obfuscate', 'link'];
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
      sourceCode: originalCode,
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
      sourceCode: originalCode,
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
  const settings = getSettings(interaction.guildId);
  let rows;
  if (settings?.panel_script_id) {
    rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE id = ? LIMIT 1').all(settings.panel_script_id);
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
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM website_users').get().count;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Karma Protection — Lua Code Protection & Licensing</title>
  <meta name="description" content="Karma Protection protects Lua code with obfuscation, HWID-locked keys, hosted loadstrings, and a Discord synced panel." />
  <style>
    :root{--bg:#030303;--card:#0b0b0c;--muted:#a1a1aa;--line:#242428;--text:#f8fafc;--primary:#ffffff;--soft:#151518}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -8%,rgba(255,255,255,.16),transparent 30%),#030303;color:var(--text);font-family:"SF Pro Display","Aptos","Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;letter-spacing:-.01em}body:before{content:'';position:fixed;right:-170px;bottom:-170px;width:620px;height:620px;background:url('/assets/karma-logo.png') center/contain no-repeat;opacity:.045;filter:grayscale(1);pointer-events:none}.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,#000,transparent 82%);pointer-events:none}a{color:inherit;text-decoration:none}.container{width:min(1180px,92%);margin:auto}header{position:sticky;top:0;z-index:40;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(3,3,3,.82);backdrop-filter:blur(18px)}.nav{height:64px;display:flex;align-items:center;justify-content:space-between}.brand{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-weight:780}.brand img{width:34px;height:34px;border-radius:10px;object-fit:cover;border:1px solid rgba(255,255,255,.24)}.beta{font:10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;border:1px solid #2d2d32;border-radius:5px;padding:2px 6px;color:#b6b6bd}.menu{width:38px;height:38px;display:grid;place-items:center;border:1px solid #2b2b30;border-radius:10px;background:rgba(255,255,255,.03);color:#fff}.btn{display:inline-flex;align-items:center;gap:10px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.055);padding:13px 18px;font:800 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:#fff}.btn.primary{background:#fff;color:#050505;border-color:#fff;box-shadow:0 0 40px rgba(255,255,255,.14)}.hero{position:relative;text-align:center;padding:105px 0 80px}.pill{display:inline-flex;gap:10px;align-items:center;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.045);border-radius:999px;padding:8px 13px;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#d4d4d8}.pulse{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 18px #fff}.hero h1{font-size:clamp(50px,8vw,104px);line-height:1.02;letter-spacing:-.075em;margin:26px auto 18px;max-width:930px}.glow{text-shadow:0 0 32px rgba(255,255,255,.34)}.hero p{max-width:680px;margin:0 auto;color:#a1a1aa;font:500 15px/1.8 ui-monospace,monospace}.actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:34px}.heroVideo{margin:56px auto 0;max-width:860px;border:1px solid rgba(255,255,255,.16);border-radius:24px;overflow:hidden;background:linear-gradient(180deg,#111,#070707);box-shadow:0 0 80px rgba(255,255,255,.08)}.fakeVideo{aspect-ratio:16/9;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.18),transparent 20%),linear-gradient(135deg,#050505,#151515,#050505);background-size:160% 160%;animation:shift 7s infinite alternate}.fakeVideo img{width:110px;height:110px;border-radius:28px;object-fit:cover;filter:grayscale(1);opacity:.9}@keyframes shift{to{background-position:100% 60%}}.caption{padding:14px;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#888}.section{border-top:1px solid rgba(255,255,255,.10);padding:88px 0}.sectionHead{max-width:720px;margin-bottom:34px}.kicker{font:800 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;color:#fff;margin-bottom:10px}.section h2{font-size:clamp(34px,5vw,58px);line-height:1.02;letter-spacing:-.055em;margin:0}.muted{color:#a1a1aa}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{border:1px solid rgba(255,255,255,.13);border-radius:28px;background:rgba(15,15,16,.72);padding:26px;transition:.2s ease;box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}.card:hover{border-color:rgba(255,255,255,.35);transform:translateY(-2px);box-shadow:0 0 60px rgba(255,255,255,.07)}.icon{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.18);border-radius:12px;margin-bottom:16px}.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:#a1a1aa;font:500 12px/1.7 ui-monospace,monospace}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.stat{border:1px solid rgba(255,255,255,.13);border-radius:18px;background:rgba(15,15,16,.65);padding:22px;display:flex;gap:15px;align-items:center}.num{font-size:34px;font-weight:850}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid rgba(255,255,255,.13);border-radius:28px;overflow:hidden;background:rgba(15,15,16,.45)}.plan{padding:32px}.plan+ .plan{border-left:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.035)}.price{font-size:64px;font-weight:900;letter-spacing:-.06em}.plan ul{list-style:none;padding:0;margin:22px 0;display:grid;gap:13px}.plan li:before{content:'✓';margin-right:10px}.cta{text-align:center;max-width:760px;margin:auto}.footer{border-top:1px solid rgba(255,255,255,.10);padding:34px 0;color:#777;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.16em;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}@media(max-width:850px){.features,.stats,.pricing{grid-template-columns:1fr}.plan+.plan{border-left:0;border-top:1px solid rgba(255,255,255,.13)}.brand{position:static;transform:none}.nav{gap:12px}.hero{text-align:left}.actions{justify-content:flex-start}}
  </style>
</head>
<body>
  <div class="grid"></div>
  <header><div class="container nav"><a class="menu" href="#features">☰</a><a class="brand" href="/"><img src="/assets/karma-logo.png" alt="Karma Protection"><span>Karma Protection</span><span class="beta">beta</span></a><a class="btn" href="${DISCORD_INVITE_URL}">Discord</a></div></header>
  <main>
    <section class="hero"><div class="container"><a class="pill" href="#builds"><span class="pulse"></span>The black & white standard for Lua security</a><h1>Protect. <span class="glow">Monetize.</span> Earn.</h1><p>Drop your project, get a secure build, and monetize with confidence. HWID-lock, whitelist keys, obfuscate, and ship straight from Discord.</p><div class="actions"><a class="btn primary" href="/login">Enter the lab</a><a class="btn" href="/dashboard?tab=obfuscate">Obfuscator</a><a class="btn" href="#features">Explore features</a></div><figure class="heroVideo"><div class="fakeVideo"><img src="/assets/karma-logo.png" alt="Karma Protection"></div><figcaption class="caption">Create a protected script in seconds.</figcaption></figure></div></section>
    <section id="features" class="section"><div class="container"><div class="sectionHead"><div class="kicker">Karma Protection features</div><h2>Everything you need to ship and protect.</h2></div><div class="features"><div class="card"><div class="icon">CPU</div><h3>Custom Obfuscator</h3><p>Multi-layer local protection with anti-tamper checks, encoded payloads, and protected loadstrings.</p></div><div class="card"><div class="icon">KEY</div><h3>Whitelist System</h3><p>Hand out keys, let clients redeem, revoke, extend, and reset HWID access.</p></div><div class="card"><div class="icon">BOT</div><h3>Discord Bot</h3><p>Panels, script hosting, key generation, HWID bans, and API linking from Discord.</p></div><div class="card"><div class="icon">DASH</div><h3>Dashboard</h3><p>Scripts, protected builds, upload files, users, owner tools, and live status in one place.</p></div><div class="card"><div class="icon">ID</div><h3>HWID Tracker</h3><p>Lock each key to a single device on first run. Reset or ban HWIDs anytime.</p></div><div class="card"><div class="icon">LOAD</div><h3>Protected Loadstrings</h3><p>Served through a protected loader route so the raw endpoint is not exposed in the panel.</p></div></div></div></section>
    <section id="builds" class="section"><div class="container"><div class="sectionHead"><div class="kicker">latest builds</div><h2>Shipping every week.</h2><p class="muted">Recent protections and platform improvements.</p></div><div class="features"><div class="card"><div class="kicker">v1.76.005</div><h3>Anti-dump hardening</h3><p>Payloads use runtime checks and decoys so dumped files come back useless.</p></div><div class="card"><div class="kicker">v1.76.004</div><h3>Loader execution recovery</h3><p>Protected loadstrings now fetch and execute through the /loadstring route.</p></div><div class="card"><div class="kicker">v1.76.003</div><h3>Runtime integrity</h3><p>Reduced fingerprinting and strengthened payload integrity checks.</p></div></div></div></section>
    <section class="section"><div class="container"><div class="stats"><div class="stat"><div class="num">${userCount}</div><div><b>creators onboarded</b><br><span class="muted">signed in users</span></div></div><div class="stat"><div class="num">${hostedCount}</div><div><b>scripts protected</b><br><span class="muted">hosted builds</span></div></div><div class="stat"><div class="num">${keyCount}</div><div><b>keys issued</b><br><span class="muted">license keys</span></div></div></div></div></section>
    <section id="pricing" class="section"><div class="container"><div class="sectionHead" style="text-align:center;margin-inline:auto"><div class="kicker">pricing</div><h2>Simple plans. Real protection.</h2></div><div class="pricing"><div class="plan"><div class="kicker">Citizen</div><div class="price">$0</div><p class="muted">forever</p><ul><li>Discord bot + panel deploy</li><li>Whitelist keys</li><li>Standard obfuscation</li><li>20 scripts by default</li></ul><a class="btn" href="/login">Get Started Free</a></div><div class="plan"><div class="kicker">Royal</div><div class="price">$3</div><p class="muted">month</p><ul><li>Higher script limits</li><li>Maximum obfuscation</li><li>Priority builds</li><li>Owner controlled upgrades</li></ul><a class="btn primary" href="/login">Upgrade</a></div></div></div></section>
    <section class="section"><div class="container cta"><h2>Ready to take back control?</h2><p class="muted">Sign in with Discord, upload your first script, and ship in minutes.</p><div class="actions"><a class="btn primary" href="/login">Sign in with Discord</a><a class="btn" href="${DISCORD_INVITE_URL}">Join the Discord</a></div></div></section>
  </main>
  <footer class="container footer"><span>© Karma Protection</span><span>Protect, Monetize, Earn</span></footer>
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
  let tab = String(req.query.tab || 'overview');
  if (['keys','how','tutorials','redeem','settings','discord','sources','storage'].includes(tab)) tab = 'overview';
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

  const scriptLinks = scripts.length
    ? scripts.map(s => `<a class="scriptLink ${selected?.id === s.id ? 'active' : ''}" href="/dashboard?tab=scripts&script=${s.id}"><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${escapeHtml(s.created_at)}</small></a>`).join('')
    : `<p class="muted pad">No scripts yet.</p>`;

  let content = '';
  if (tab === 'scripts') {
    content = selected ? `<div class="card"><div class="cardHead"><div><p class="eyebrow">Selected Script</p><h2>${escapeHtml(selected.name)}</h2><p class="muted">${selected.obfuscated ? 'Obfuscated build · edits auto re-obfuscate on save' : 'Plain build'} · ${escapeHtml(selected.created_at)}</p></div></div><h3>Loadstring</h3><code class="block">${makeLoaderSnippet(selected.id)}</code>${canEditSelected ? `<h3>Edit Script</h3><form method="post" action="/dashboard/scripts/${selected.id}/update"><label>Script name</label><input name="name" maxlength="80" value="${escapeHtml(selected.name)}" required><label>Actual Source</label><textarea name="code" maxlength="4000" required>${escapeHtml(selected.source_code || selected.code)}</textarea><label class="check"><input type="checkbox" name="obfuscate" value="true" ${selected.obfuscated ? 'checked' : ''}> Obfuscate on save</label><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><div class="buttonRow"><button type="submit">Save Permanently</button><button class="secondary" type="submit" formaction="/dashboard/obfuscate" formmethod="post">Obfuscate</button></div></form>` : `<p class="muted">This script is available as a loadstring. Source editing is limited to the owner/creator.</p>`}</div>` + `<div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><button>Save Script</button></form></div>` : `<div class="card"><h2>Scripts</h2><p class="muted">Add your first script below. Scripts are saved permanently unless the owner removes them from the database.</p></div><div class="card"><p class="eyebrow">Add Script</p><h2>Permanent script upload</h2><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><label>Actual Source</label><textarea id="codeBox" name="code" maxlength="4000" required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before saving</label><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><button>Save Script</button></form></div>`;
  } else if (tab === 'sources') {
    content = `<div class="card"><p class="eyebrow">Sources</p><h2>Create a hosted script</h2><p class="muted">Upload a Lua or text file, or paste source manually. Obfuscation can run before hosting.</p><form method="post" action="/dashboard/scripts"><label>Script name</label><input name="name" maxlength="80" placeholder="Main Loader" required><label>Upload file</label><input id="fileInput" type="file" accept=".lua,.txt,text/plain"><p class="hint">File contents will be placed into the source box below.</p><label>Source code</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("Karma Protection")' required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate before hosting</label><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><div class="buttonRow"><button type="submit">Host Script</button><button class="secondary" type="submit" formaction="/dashboard/obfuscate" formmethod="post">Obfuscate Only</button></div></form></div>`;
  } else if (tab === 'keys') {
    const projects = db.prepare('SELECT id, name, created_at FROM scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
    const keys = db.prepare('SELECT l.*, s.name AS script_name FROM licenses l JOIN scripts s ON s.id = l.script_id WHERE l.created_by = ? ORDER BY l.created_at DESC LIMIT 50').all(user.id);
    content = `<div class="card"><p class="eyebrow">Keys</p><h2>Generate keys for projects</h2><p class="muted">Create whitelist keys for any project you own.</p><form method="post" action="/dashboard/keys"><label>Project</label><select name="script_id">${projects.map(pr=>`<option value="${escapeHtml(pr.id)}">${escapeHtml(pr.name)} · ${escapeHtml(pr.id)}</option>`).join('')}</select><label>Days</label><input name="days" type="number" value="30" min="0" max="3650"><label>Quantity</label><input name="quantity" type="number" value="1" min="1" max="20"><button>Generate Keys</button></form><h3>Recent Keys</h3>${keys.map(k=>`<div class="row"><b>${escapeHtml(k.license_key)}</b><small>${escapeHtml(k.script_name)} · ${k.expires_at || 'Lifetime'} · ${k.revoked ? 'Revoked' : 'Active'}</small></div>`).join('') || '<p class="muted">No keys yet.</p>'}</div>`;
  } else if (tab === 'storage') {
    if (!isOwner) {
      content = `<div class="card"><h2>Script Storage</h2><p class="muted">Only the owner can access global storage.</p></div>`;
    } else {
      const stored = db.prepare('SELECT * FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC LIMIT 500').all(OWNER_ID);
      content = `<div class="card"><p class="eyebrow">Owner Storage</p><h2>Script Storage</h2><p class="muted">Owner account has unlimited scripts. Add global scripts here and use them in panels/loadstrings.</p><form method="post" action="/owner/storage"><label>Name</label><input name="name" maxlength="80" required><label>Source</label><textarea name="code" maxlength="4000" required></textarea><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before storing</label><button>Add Stored Script</button></form><h3>Stored Scripts</h3>${stored.map(r=>`<div class="row"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.id)} · ${r.obfuscated ? 'Obfuscated' : 'Plain'}</small><code class="block">${makeLoaderSnippet(r.id)}</code></div>`).join('') || '<p class="muted">No stored scripts.</p>'}</div>`;
    }
  } else if (tab === 'obfuscate') {
    content = `<div class="card"><p class="eyebrow">Obfuscator</p><h2>Protect Lua source</h2><p class="muted">Kers0ne-style protected wrapper with randomized locals, rolling XOR, checksum validation, and anti-tamper fallback.</p><form method="post" action="/dashboard/obfuscate"><label>Filename</label><input name="filename" value="obfuscated.lua"><label>Lua source</label><textarea id="codeBox" name="code" maxlength="4000" placeholder='print("protect me")' required></textarea><label>Obfuscation level</label><select name="level"><option value="light">Light</option><option value="standard" selected>Standard</option><option value="max">Maximum</option></select><div class="buttonRow"><button type="submit">Obfuscate</button><a class="btn dark" href="/dashboard?tab=sources">Upload Source</a></div></form><div class="featureGrid"><div>Anti-tamper checksum</div><div>Anti-Dump Hardening on new builds</div><div>Rolling XOR byte encoding</div><div>Decoy layer for automated dumps</div><div>Random local names</div><div>Protected output banner</div></div></div>`;
  } else if (tab === 'how') {
    content = `<div class="card"><p class="eyebrow">How It Works</p><h2>Complete workflow</h2><div class="stepsDash"><div><span>1</span><b>Upload source</b><p>Go to Sources and upload a Lua file or paste code.</p></div><div><span>2</span><b>Obfuscate or host</b><p>Enable obfuscation and create a hosted loadstring.</p></div><div><span>3</span><b>Link Discord</b><p>Run <code>/link api key:${apiKey}</code> in your server.</p></div><div><span>4</span><b>Generate keys</b><p>Use <code>/generatekey</code> and the panel for buyers.</p></div></div></div>`;
  } else if (tab === 'tutorials') {
    content = `<div class="card"><p class="eyebrow">Tutorials</p><h2>Quick tutorials</h2><h3>Bot setup</h3><p class="muted">Invite the bot, then run <code>/setup panel title:Your Hub description:Use buttons below</code>.</p><h3>Script upload</h3><p class="muted">Open Sources, upload your Lua file, optionally obfuscate, and copy the loadstring from Scripts.</p><h3>Premium/redeem</h3><p class="muted">Give customers a code from the Owner panel. They redeem it on the Redeem page.</p></div>`;
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
    content = `<div class="card"><p class="eyebrow">Owner Only</p><h2>Owner panel</h2><div class="stats"><div class="stat"><div class="num">${users.length}</div><span>Recent users</span></div><div class="stat"><div class="num">${scripts.length}</div><span>Your scripts</span></div><div class="stat"><div class="num">${banned.length}</div><span>Banned HWIDs</span></div></div><h3>Create premium code</h3><form method="post" action="/owner/codes"><input name="code" placeholder="PREMIUM-KEY-123" required><input name="plan" placeholder="premium" value="premium"><button>Create Code</button></form><h3>Ban HWID</h3><form method="post" action="/owner/ban-hwid"><input name="hwid" placeholder="HWID" required><input name="reason" placeholder="Reason"><button class="danger">Ban HWID</button></form><h3>Add script to user</h3><form method="post" action="/owner/add-user-script"><input name="user_id" placeholder="Discord user ID" required><input name="name" placeholder="Script name" required><textarea name="code" maxlength="4000" placeholder="Lua source" required></textarea><label>Obfuscation level</label><select name="level"><option value="standard">Standard</option><option value="max">Maximum</option></select><label class="check"><input type="checkbox" name="obfuscate" value="true" checked> Obfuscate before assigning</label><button>Add Script To User</button></form><h3>Website users</h3>${users.map(u=>`<div class="row"><b>${escapeHtml(u.display_username||u.global_name||u.username||u.id)}</b><small>${escapeHtml(u.id)} · plan: ${escapeHtml(u.plan||'free')} · quota: ${escapeHtml(u.script_quota||20)} · last: ${escapeHtml(u.last_login)}</small><form method="post" action="/owner/user-plan" class="inlineForm"><input type="hidden" name="user_id" value="${escapeHtml(u.id)}"><select name="plan"><option value="free" ${(u.plan||'free')==='free'?'selected':''}>free</option><option value="premium" ${u.plan==='premium'?'selected':''}>premium</option><option value="royal" ${u.plan==='royal'?'selected':''}>royal</option><option value="banned" ${u.plan==='banned'?'selected':''}>banned</option></select><input name="script_quota" type="number" min="0" max="10000" value="${escapeHtml(u.script_quota||20)}" style="width:120px"><button>Update</button></form></div>`).join('')}<h3>Premium codes</h3>${codes.map(c=>`<div class="row"><b>${escapeHtml(c.code)}</b><small>${escapeHtml(c.plan)} · redeemed by ${escapeHtml(c.redeemed_by||'nobody')}</small></div>`).join('')}</div>`;
  } else {
    content = `<div class="card heroCard"><p class="eyebrow">Overview</p><h2>Dashboard</h2><p class="muted">Manage scripts, sources, obfuscation, tutorials, Discord links, redeem codes, and owner tools from one clean dashboard.</p><div class="stats"><div class="stat"><div class="num">${scripts.length}</div><span>Scripts used</span></div><div class="stat"><div class="num">${remaining}</div><span>Slots left</span></div><div class="stat"><div class="num">${scriptQuota}</div><span>Max scripts</span></div></div><div class="anime"></div></div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Dashboard</title><style>:root{--bg:#000000;--shell:#0b0b0c;--panel:#101011;--panel2:#151516;--line:#2a2a2d;--muted:#a1a1aa;--text:#f8fafc;--gold:#ffffff;--gold2:#f5f5f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.22),transparent 30%),radial-gradient(circle at 85% 25%,rgba(255,255,255,.07),transparent 24%),#000000;color:var(--text);font-family:"SF Pro Display","Aptos","Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;letter-spacing:-.01em}body:before{content:'';position:fixed;right:-140px;bottom:-140px;width:560px;height:560px;background:url('/assets/karma-logo.png') center/contain no-repeat;opacity:.045;filter:grayscale(1);pointer-events:none}a{color:inherit;text-decoration:none}.page{padding:28px}.shell{max-width:1500px;margin:0 auto;min-height:calc(100vh - 56px);display:grid;grid-template-columns:280px 270px 1fr;border:1px solid rgba(255,255,255,.22);border-radius:34px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015));box-shadow:0 34px 140px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.025)}.side{background:linear-gradient(180deg,rgba(12,12,12,.96),rgba(5,5,5,.96));border-right:1px solid rgba(255,255,255,.20);padding:22px;overflow:auto;box-shadow:18px 0 80px rgba(0,0,0,.28)}.brand{display:flex;gap:12px;align-items:center;border-bottom:1px solid #242427;padding-bottom:20px}.brand img,.avatar{width:48px;height:48px;border-radius:16px;object-fit:cover;border:1px solid rgba(255,255,255,.38);box-shadow:0 0 35px rgba(255,255,255,.14)}.brand b{display:block;font-size:18px;font-weight:850}.brand small,.muted,small{color:var(--muted)}.nav{margin-top:20px}.nav a{display:flex;align-items:center;padding:12px 13px;border-radius:14px;color:#d4d4d8;font-weight:720;margin-bottom:4px}.nav a:hover,.nav a.active{background:linear-gradient(90deg,rgba(255,255,255,.18),rgba(255,255,255,.035));color:#fff;box-shadow:inset 3px 0 0 var(--gold)}.scriptsPane{background:rgba(7,7,7,.78);border-right:1px solid rgba(255,255,255,.16);padding:20px;overflow:auto}.scriptLink{display:block;border:1px solid rgba(255,255,255,.14);background:rgba(14,14,14,.86);border-radius:16px;padding:13px;margin-bottom:10px}.scriptLink.active{border-color:var(--gold);background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(18,18,18,.88));box-shadow:0 10px 34px rgba(255,255,255,.08)}.main{padding:28px;min-width:0;position:relative;overflow:hidden}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.profile{display:flex;gap:12px;align-items:center}.card{border:1px solid rgba(255,255,255,.16);border-radius:28px;background:linear-gradient(180deg,rgba(24,24,24,.92),rgba(8,8,8,.97));padding:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 26px 90px rgba(0,0,0,.32);margin-bottom:18px;position:relative;z-index:1}.card h2{font-size:clamp(32px,4vw,56px);line-height:.95;letter-spacing:-.06em;margin:6px 0 12px}.eyebrow{color:#a1a1aa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:850;margin:0 0 8px}.btn,button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--gold2);background:linear-gradient(180deg,var(--gold2),var(--gold));color:#000;border-radius:999px;padding:12px 18px;font-weight:950;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;box-shadow:0 12px 38px rgba(255,255,255,.16)}.btn:hover,button:hover{transform:translateY(-1px);box-shadow:0 14px 42px rgba(255,255,255,.10)}.btn.dark{background:rgba(10,10,10,.75);color:#fff;border-color:rgba(255,255,255,.32);box-shadow:none}.secondary{background:rgba(10,10,10,.75);color:#fff;border-color:rgba(255,255,255,.32)}.buttonRow{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:6px}.danger{background:#220f0f;color:#ffb4ad;border-color:#5b2521}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}.stat{border:1px solid rgba(255,255,255,.14);border-radius:18px;background:rgba(10,10,10,.82);padding:18px}.num{font-size:38px;font-weight:900;letter-spacing:-.05em}select{background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:10px;font:inherit}.inlineForm{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}input,textarea{width:100%;background:#080809;color:#fff;border:1px solid #343438;border-radius:14px;padding:12px;margin:8px 0 14px;font:inherit}textarea{min-height:260px}.check{display:flex;gap:10px;align-items:center}.check input{width:auto}.block{display:block;white-space:pre-wrap;word-break:break-all;padding:12px;margin:10px 0;background:#080809;border:1px solid #343438;border-radius:14px}.row{border:1px solid #27272a;border-radius:14px;padding:12px;margin:8px 0;background:#0b0b0c}.featureGrid,.stepsDash{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:16px}.featureGrid div,.stepsDash div{border:1px solid #27272a;border-radius:16px;background:#0b0b0c;padding:16px}.stepsDash span{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#fff;color:#000;font-weight:900}.anime{height:220px;border-radius:24px;border:1px solid #27272a;margin-top:22px;background:radial-gradient(circle at 30% 50%,rgba(255,255,255,.18),transparent 18%),radial-gradient(circle at 70% 50%,rgba(255,255,255,.11),transparent 20%),linear-gradient(120deg,#000,#111,#000);background-size:160% 160%;animation:movebg 6s infinite alternate;position:relative;overflow:hidden}.anime:after{content:'';position:absolute;inset:-40%;background:conic-gradient(from 0deg,transparent,rgba(255,255,255,.12),transparent 35%);animation:spin 8s linear infinite}@keyframes movebg{to{background-position:100% 60%}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1100px){.page{padding:12px}.shell{grid-template-columns:1fr;border-radius:22px}.side,.scriptsPane{border-right:0;border-bottom:1px solid var(--line)}.stats,.featureGrid,.stepsDash{grid-template-columns:1fr}.top{align-items:flex-start;gap:16px;flex-direction:column}}</style></head><body><div class="page"><div class="shell"><aside class="side"><div class="brand"><img src="/assets/karma-logo.png"><div><b>Karma Protection</b><small>${username}</small></div></div><nav class="nav"><a class="${tab==='overview'?'active':''}" href="/dashboard">Overview</a><a class="${tab==='scripts'?'active':''}" href="/dashboard?tab=scripts">Scripts</a><a class="${tab==='obfuscate'?'active':''}" href="/dashboard?tab=obfuscate">Obfuscate</a>${isOwner?`<a class="${tab==='owner'?'active':''}" href="/dashboard?tab=owner">Owner Panel</a>`:''}<a href="/logout">Logout</a></nav></aside><aside class="scriptsPane"><h3>Scripts</h3>${scriptLinks}<a class="btn" href="/dashboard?tab=scripts">New Script</a></aside><main class="main"><div class="top"><div class="profile"><img class="avatar" src="${avatar}"><div><b>${username}</b><br><small>${myScriptCount}/${scriptQuota} scripts used</small></div></div><div class="buttonRow"><a class="btn dark" href="/dashboard?tab=obfuscate">Obfuscator</a><a class="btn dark" href="/">Home</a></div></div>${content}</main></div></div><script>document.getElementById('fileInput')?.addEventListener('change', async e => { const f=e.target.files[0]; if(!f) return; document.querySelector('input[name="name"]').value ||= f.name.replace(/\.(lua|txt)$/i,''); document.getElementById('codeBox').value = await f.text(); });</script></body></html>`;
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
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use('/assets', express.static('public'));

  app.get('/', (req, res) => res.type('html').send(kolsecHomePage()));
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Karma Protection' }));

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

  app.post('/dashboard/scripts/:id/delete', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    return res.status(403).type('html').send('<h1>Delete disabled</h1><p>Scripts are permanent and cannot be deleted from the dashboard.</p><a href="/dashboard?tab=scripts">Back</a>');
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
      .run(targetId, targetId, targetId, targetId, 20);
    const finalCode = shouldObfuscate ? await callObfuscator(source, level) : source;
    createHostedScript({ guildId: 'owner-assigned', name, code: finalCode, sourceCode: source, obfuscated: shouldObfuscate, createdBy: targetId });
    return res.redirect('/dashboard?tab=owner');
  });

  app.post('/owner/user-plan', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user || user.id !== OWNER_ID) return;
    const userId = String(req.body.user_id || '').trim();
    const plan = String(req.body.plan || 'free').trim();
    const quota = Math.max(0, Math.min(10000, Number(req.body.script_quota || 20)));
    if (userId && ['free', 'premium', 'royal', 'banned'].includes(plan)) {
      db.prepare('UPDATE website_users SET plan = ?, script_quota = ? WHERE id = ?').run(plan, quota, userId);
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

  app.use((err, req, res, next) => {
    console.error('Website error:', err);
    if (res.headersSent) return next(err);
    return res.status(500).type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Protection Error</title><style>body{margin:0;background:#000;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(680px,92%);border:1px solid #333;border-radius:24px;background:#090909;padding:28px}a{color:#fff}</style></head><body><div class="card"><h1>Something went wrong</h1><p>The website hit an error instead of loading this page.</p><p>Try signing in again, or check Render logs for the exact error.</p><a href="/">Back home</a></div></body></html>`);
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
