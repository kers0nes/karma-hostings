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
  DISCORD_INVITE_URL = 'https://discord.com'
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
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Obfuscate before hosting')),

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
    .setName('hostscript')
    .setDescription('Host Lua code on Render and get a loadstring')
    .addStringOption(o => o.setName('name').setDescription('Script name').setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName('code').setDescription('Lua code to host, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addBooleanOption(o => o.setName('obfuscate').setDescription('Run the code through your obfuscator API before hosting')),

  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate Lua code using your obfuscator API')
    .addStringOption(o => o.setName('code').setDescription('Lua code to obfuscate, max 4000 chars').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('filename').setDescription('Output filename').setRequired(false).setMaxLength(80)),

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

CREATE INDEX IF NOT EXISTS idx_scripts_guild ON scripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_licenses_script ON licenses(script_id);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_scripts_guild ON hosted_scripts(guild_id);
`);

// Migrations for older Render SQLite databases.
for (const migration of [
  'ALTER TABLE guild_settings ADD COLUMN panel_title TEXT',
  'ALTER TABLE guild_settings ADD COLUMN panel_description TEXT'
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
    INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, panel_title, panel_description, updated_at)
    VALUES (@guild_id, @admin_role_id, @customer_role_id, @log_channel_id, @panel_channel_id, @panel_message_id, @panel_title, @panel_description, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      customer_role_id=excluded.customer_role_id,
      log_channel_id=excluded.log_channel_id,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      panel_title=excluded.panel_title,
      panel_description=excluded.panel_description,
      updated_at=CURRENT_TIMESTAMP
  `).run({
    guild_id: guildId,
    admin_role_id: next.admin_role_id || null,
    customer_role_id: next.customer_role_id || null,
    log_channel_id: next.log_channel_id || null,
    panel_channel_id: next.panel_channel_id || null,
    panel_message_id: next.panel_message_id || null,
    panel_title: next.panel_title || null,
    panel_description: next.panel_description || null
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

function kers0neLocalObfuscate(luaCode) {
  const key = crypto.randomBytes(1)[0] || 173;
  const bytes = Buffer.from(String(luaCode), 'utf8');
  const encoded = Array.from(bytes, (byte, index) => byte ^ ((key + index * 17) & 255));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += 32) chunks.push(encoded.slice(i, i + 32).join(','));

  return `--[[
\tProtected By Kers0ne Obfuscator
]]

return(function(...)
  local _k=${key}
  local _b={${chunks.join(',')}}
  local _c=string.char
  local _t={}
  for _i=1,#_b do
    _t[_i]=_c(bit32.bxor(_b[_i], bit32.band(_k+(_i-1)*17,255)))
  end
  local _src=table.concat(_t)
  local _fn=assert(loadstring(_src,"Kers0neObfuscated"))
  return _fn(...)
end)(...)
`;
}

async function callObfuscator(luaCode) {
  // Uses the Kers0ne-style local obfuscator. Your uploaded file was an example
  // of protected output, not an API client, so this generates the same branded
  // protected-wrapper format locally instead of sending two/API messages.
  return kers0neLocalObfuscate(luaCode);
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
      new ButtonBuilder().setCustomId('panel_view_script').setLabel('View Script').setEmoji('📜').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setEmoji('🔑').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_key_info').setLabel('Key Info').setEmoji('📊').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_get_buyer_role').setLabel('Get Buyer Role').setEmoji('👤').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel_free_key').setLabel('Free Key').setEmoji('🔗').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_reset_hwid').setLabel('Reset HWID').setEmoji('⚙️').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function logGuild(guild, text) {
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

  const adminCommands = ['generatekey', 'apply', 'hostscript', 'resethwid', 'createscript', 'scripts', 'revoke', 'extendkey', 'deletekey', 'panel', 'loader', 'obfuscate'];
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

    await interaction.deferReply({ ephemeral: true });

    const script = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });

    let finalCode = originalCode;
    if (shouldObfuscate) {
      try {
        finalCode = await callObfuscator(originalCode);
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
    const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;

    await interaction.editReply({
      content: `Applied **${name}** successfully.\n\nScript ID:\n\`${script.id}\`\n\nAPI Secret, save this now:\n\`${script.apiSecret}\`\n\nHosted Script:\n${rawUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
    });
    await logGuild(interaction.guild, `✅ Applied script \`${name}\` by <@${interaction.user.id}>. Script ID: \`${script.id}\``);
    return;
  }

  if (commandName === 'obfuscate') {
    const code = interaction.options.getString('code', true);
    const filename = (interaction.options.getString('filename') || 'obfuscated.lua').replace(/[^a-zA-Z0-9_.-]/g, '_');

    await interaction.deferReply({ ephemeral: true });

    try {
      const obfuscated = await callObfuscator(code);
      const attachment = new AttachmentBuilder(Buffer.from(String(obfuscated), 'utf8'), { name: filename.endsWith('.lua') ? filename : `${filename}.lua` });
      await interaction.editReply({ content: 'Obfuscated successfully.', files: [attachment] });
      await logGuild(interaction.guild, `🧩 Code obfuscated by <@${interaction.user.id}>.`);
    } catch (error) {
      await interaction.editReply({ content: `Obfuscator API failed: ${error.message}` });
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

  if (commandName === 'hostscript') {
    const name = interaction.options.getString('name', true);
    const originalCode = interaction.options.getString('code', true);
    const shouldObfuscate = interaction.options.getBoolean('obfuscate') || false;

    await interaction.deferReply({ ephemeral: true });

    let finalCode = originalCode;
    if (shouldObfuscate) {
      try {
        finalCode = await callObfuscator(originalCode);
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
    const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;

    await interaction.editReply({
      content: `Hosted **${name}** ${shouldObfuscate ? '(obfuscated)' : ''}.\n\nRaw script URL:\n${rawUrl}\n\nLoadstring URL:\n${loadstringUrl}\n\nLoadstring:\n\`\`\`lua\n${loadstring}\n\`\`\``
    });
    await logGuild(interaction.guild, `🌐 Script \`${name}\` hosted by <@${interaction.user.id}>. ID: \`${hosted.id}\``);
    return;
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
  const rows = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10').all(interaction.guildId);
  const base = publicBaseUrl();
  const content = rows.length
    ? rows.map(r => `**${r.name}** ${r.obfuscated ? '(obfuscated)' : ''}\nLoadstring:\n\`\`\`lua\nloadstring(game:HttpGet("${base}/script/${r.id}.lua"))()\n\`\`\``).join('\n')
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
  const script = db.prepare('SELECT * FROM scripts WHERE guild_id = ? ORDER BY created_at ASC LIMIT 1').get(interaction.guildId);
  if (!script) return interaction.reply({ ephemeral: true, content: 'No script exists yet. Staff needs to use `/apply` first.' });

  const already = db.prepare('SELECT * FROM licenses WHERE guild_id = ? AND script_id = ? AND discord_user_id = ? LIMIT 1').get(interaction.guildId, script.id, interaction.user.id);
  if (already) return interaction.reply({ ephemeral: true, content: `You already have a key for **${script.name}**: \`${already.license_key}\`` });

  const key = makeKey('FREE');
  db.prepare('INSERT INTO licenses (license_key, script_id, guild_id, expires_at, created_by, discord_user_id, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run(key, script.id, interaction.guildId, null, interaction.user.id, interaction.user.id);

  const settings = getSettings(interaction.guildId);
  if (settings && settings.customer_role_id) await interaction.member.roles.add(settings.customer_role_id).catch(() => null);
  await logGuild(interaction.guild, `🔗 Free key created for <@${interaction.user.id}>: \`${key}\`.`);
  return interaction.reply({ ephemeral: true, content: `Free key generated and redeemed for **${script.name}**:\n\`${key}\`` });
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
  <title>Karma Sources - Lua Code Protection</title>
  <meta name="description" content="Karma Sources protects, hosts, and licenses Lua scripts with Discord panels, HWID locking, and loadstrings." />
  <style>
    :root{--bg:#030402;--side:#070806;--card:#0d0f0b;--line:#20231b;--text:#f6f3e9;--muted:#8f9189;--gold:#e3b944;--gold2:#ffd866;--soft:#151811}
    *{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;background:radial-gradient(circle at 70% 20%,rgba(227,185,68,.13),transparent 28%),linear-gradient(90deg,#030402,#060704);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif;overflow-x:hidden} a{color:inherit;text-decoration:none} code{background:#11150e;border:1px solid #2b2d24;border-radius:10px;padding:4px 7px;color:#fff}.app{display:grid;grid-template-columns:310px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;background:linear-gradient(180deg,#090a08,#050604);border-right:1px solid var(--line);padding:26px 22px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:14px;padding-bottom:28px;border-bottom:1px solid #151812}.brand img{width:54px;height:54px;border-radius:16px;object-fit:cover;box-shadow:0 0 45px rgba(227,185,68,.2)}.brand b{display:block;font-size:18px;letter-spacing:.04em}.brand small{color:var(--gold);font-size:11px;letter-spacing:.18em;text-transform:uppercase}.navblock{margin-top:24px}.label{color:#777b72;margin:0 0 12px 6px;font-size:13px}.navitem{display:flex;align-items:center;gap:14px;border-radius:14px;padding:13px 12px;color:#d9d6ca;font-weight:650}.navitem:hover,.navitem.active{background:#11140e;color:#fff}.navitem.active{border-left:4px solid var(--gold);padding-left:8px}.ico{width:24px;text-align:center;color:var(--gold)}.sidebottom{margin-top:auto}.dashbtn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#0a0a06;border:none;border-radius:14px;padding:16px;font-weight:900;box-shadow:0 0 50px rgba(227,185,68,.22)}.version{text-align:center;color:#666;margin-top:14px;font-size:11px;letter-spacing:.2em}.main{min-width:0}.hero{min-height:100vh;display:grid;place-items:center;padding:46px}.hero-inner{width:min(1040px,100%)}.pill{display:inline-flex;align-items:center;gap:10px;border:1px solid #2c2d24;background:rgba(13,15,11,.72);color:#d9d6ca;border-radius:999px;padding:9px 14px}.hero h1{font-size:clamp(52px,8vw,112px);line-height:.88;letter-spacing:-.085em;margin:24px 0}.hero p{max-width:760px;color:#b5b3aa;font-size:clamp(17px,2vw,22px);line-height:1.65}.actions{display:flex;gap:14px;flex-wrap:wrap;margin:30px 0}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border-radius:999px;padding:13px 18px;font-weight:900;border:1px solid #fff;background:#fff;color:#000}.btn.gold{background:linear-gradient(180deg,var(--gold2),var(--gold));border-color:var(--gold);color:#090905}.btn.dark{background:#070806;color:#fff;border-color:#2b2d24}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}.stat{border:1px solid var(--line);border-radius:22px;background:rgba(10,12,8,.7);padding:22px}.num{font-size:42px;font-weight:950;color:#fff}.stat span{color:#8d9087}.panel{border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg,rgba(15,18,12,.92),rgba(7,8,6,.92));padding:24px;margin-top:26px;box-shadow:0 25px 90px rgba(0,0,0,.45)}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feature{border:1px solid #24271e;border-radius:18px;background:#090b08;padding:18px}.feature h3{margin:8px 0}.feature p{color:#9fa197;line-height:1.55;margin:0}.mobiletop{display:none;padding:14px 18px;border-bottom:1px solid var(--line);align-items:center;gap:12px;background:#070806;position:sticky;top:0;z-index:20}.mobiletop img{width:40px;height:40px;border-radius:12px}.mobiletop b{font-size:18px}@media(max-width:900px){.app{display:block}.sidebar{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.mobiletop{display:flex}.hero{padding:28px 20px}.stats,.features{grid-template-columns:1fr}.brand{display:none}.sidebottom{margin-top:24px}}
  </style>
</head>
<body>
  <div class="mobiletop"><img src="/assets/karma-logo.png" alt="Karma Sources"><b>Karma Sources</b></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><img src="/assets/karma-logo.png" alt="Karma Sources"><div><b>KARMA</b><small>Lua Code Protection</small></div></div>
      <div class="navblock"><p class="label">Script sections</p><a class="navitem active" href="#overview"><span class="ico">⌁</span>Overview</a><a class="navitem" href="#source"><span class="ico">▧</span>Source</a><a class="navitem" href="#loadstring"><span class="ico">⚿</span>Loadstring</a><a class="navitem" href="#slots"><span class="ico">▦</span>Slots</a><a class="navitem" href="#discord"><span class="ico">○</span>Discord</a><a class="navitem" href="#settings"><span class="ico">⚙</span>Settings</a></div>
      <div class="navblock"><p class="label">Explore</p><a class="navitem" href="#how"><span class="ico">ϟ</span>How it works</a><a class="navitem" href="#faq"><span class="ico">?</span>FAQ</a><a class="navitem" href="${DISCORD_INVITE_URL}"><span class="ico">☊</span>Support</a><a class="navitem" href="#changelog"><span class="ico">▤</span>Changelog</a><a class="navitem" href="/login"><span class="ico">▣</span>Redeem code</a></div>
      <div class="navblock"><p class="label">Community</p><a class="navitem" href="${DISCORD_INVITE_URL}"><span class="ico">◯</span>Discord community</a></div>
      <div class="sidebottom"><a class="dashbtn" href="/login">▦ Go to Dashboard</a><div class="version">KARMA · V. BETA</div></div>
    </aside>
    <main class="main">
      <section id="overview" class="hero"><div class="hero-inner"><span class="pill">⚡ Discord OAuth · Lua whitelist · Script hosting</span><h1>Karma Sources Script Protection</h1><p>Host scripts, generate keys, serve loadstrings, reset HWIDs, and control buyer access from Discord and the web dashboard.</p><div class="actions"><a class="btn gold" href="/login">Get Started</a><a class="btn dark" href="#how">How it works</a></div><div id="slots" class="stats"><div class="stat"><div class="num">${scriptCount}</div><span>Products</span></div><div class="stat"><div class="num">${keyCount}</div><span>Keys</span></div><div class="stat"><div class="num">${hostedCount}</div><span>Hosted scripts</span></div></div><div id="how" class="panel"><div class="features"><div class="feature"><div>🔐</div><h3>Whitelist</h3><p>Generate and redeem license keys through Discord panels.</p></div><div class="feature"><div>⚿</div><h3>Loadstrings</h3><p>Serve Roblox-style loadstrings from your Render URL.</p></div><div class="feature"><div>⚙</div><h3>HWID</h3><p>Lock keys to devices and reset them with commands.</p></div></div></div><div id="loadstring" class="panel"><h2>Commands</h2><p><code>/panel</code> <code>/apply</code> <code>/generatekey</code> <code>/hostscript</code> <code>/resethwid</code> <code>/redeem</code> <code>/keyinfo</code></p></div></div></section>
    </main>
  </div>
</body>
</html>`;
}

function discordDashboardPage(user) {
  const username = escapeHtml(user.global_name || user.username || 'Discord User');
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : '/assets/karma-logo.png';
  const scripts = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
  const remaining = Math.max(0, MAX_WEB_SCRIPTS_PER_USER - scripts.length);
  const scriptRows = scripts.length
    ? scripts.map(s => `<div class="script"><div><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${escapeHtml(s.created_at)}</small><code>loadstring(game:HttpGet("${publicBaseUrl()}/script/${s.id}.lua"))()</code></div><form method="post" action="/dashboard/scripts/${s.id}/delete"><button class="danger">Delete</button></form></div>`).join('')
    : `<p class="muted">No scripts yet. Create your first hosted loadstring in Source.</p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Karma Sources Dashboard</title><style>
:root{--bg:#030402;--side:#070806;--card:#0d0f0b;--line:#20231b;--text:#f6f3e9;--muted:#8f9189;--gold:#e3b944;--gold2:#ffd866}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 10%,rgba(227,185,68,.12),transparent 30%),#030402;color:var(--text);font-family:Inter,Arial,sans-serif}a{color:inherit;text-decoration:none}.app{display:grid;grid-template-columns:310px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;background:linear-gradient(180deg,#090a08,#050604);border-right:1px solid var(--line);padding:26px 22px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:14px;padding-bottom:28px;border-bottom:1px solid #151812}.brand img{width:54px;height:54px;border-radius:16px;object-fit:cover}.brand b{display:block;font-size:18px}.brand small{color:var(--gold);font-size:11px;letter-spacing:.18em;text-transform:uppercase}.navblock{margin-top:24px}.label{color:#777b72;margin:0 0 12px 6px;font-size:13px}.navitem{display:flex;align-items:center;gap:14px;border-radius:14px;padding:13px 12px;color:#d9d6ca;font-weight:650}.navitem.active,.navitem:hover{background:#11140e;color:#fff}.navitem.active{border-left:4px solid var(--gold);padding-left:8px}.ico{width:24px;text-align:center;color:var(--gold)}.sidebottom{margin-top:auto}.dashbtn,button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(180deg,var(--gold2),var(--gold));color:#090905;border:none;border-radius:14px;padding:13px 16px;font-weight:900;text-decoration:none;cursor:pointer}.version{text-align:center;color:#666;margin-top:14px;font-size:11px;letter-spacing:.2em}.main{padding:34px;min-width:0}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}.profile{display:flex;align-items:center;gap:14px}.avatar{width:54px;height:54px;border-radius:16px;border:1px solid #2b2d24;object-fit:cover}.muted,small{color:var(--muted)}.card{border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg,#0d0f0b,#070806);padding:24px;margin-bottom:18px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stat{border:1px solid #24271e;border-radius:20px;background:#070806;padding:20px}.num{font-size:40px;font-weight:950}.grid{display:grid;grid-template-columns:420px 1fr;gap:18px}.script{display:grid;grid-template-columns:1fr auto;gap:14px;border:1px solid #24271e;border-radius:18px;background:#080a07;padding:16px;margin:12px 0}.script b,.script small,.script code{display:block}.script code{white-space:pre-wrap;word-break:break-all;background:#11150e;border:1px solid #2b2d24;border-radius:12px;padding:10px;margin-top:10px;color:#eee}input,textarea{width:100%;background:#050604;color:#fff;border:1px solid #2b2d24;border-radius:14px;padding:12px;margin:8px 0 14px;font:inherit}textarea{min-height:210px}.check{display:flex;gap:10px;align-items:center;margin-bottom:14px}.check input{width:auto;margin:0}.danger{background:#23100f;color:#ffb4ad;border:1px solid #5b2521}.mobiletop{display:none;padding:14px 18px;border-bottom:1px solid var(--line);align-items:center;gap:12px;background:#070806;position:sticky;top:0;z-index:20}.mobiletop img{width:40px;height:40px;border-radius:12px}@media(max-width:920px){.app{display:block}.sidebar{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.brand{display:none}.mobiletop{display:flex}.main{padding:20px}.grid,.stats,.script{grid-template-columns:1fr}.sidebottom{margin-top:20px}}
</style></head><body><div class="mobiletop"><img src="/assets/karma-logo.png"><b>Karma Sources</b></div><div class="app"><aside class="sidebar"><div class="brand"><img src="/assets/karma-logo.png"><div><b>KARMA</b><small>Lua Code Protection</small></div></div><div class="navblock"><p class="label">Script sections</p><a class="navitem active" href="#overview"><span class="ico">⌁</span>Overview</a><a class="navitem" href="#source"><span class="ico">▧</span>Source</a><a class="navitem" href="#loadstring"><span class="ico">⚿</span>Loadstring</a><a class="navitem" href="#slots"><span class="ico">▦</span>Slots</a><a class="navitem" href="${DISCORD_INVITE_URL}"><span class="ico">○</span>Discord</a><a class="navitem" href="#settings"><span class="ico">⚙</span>Settings</a></div><div class="navblock"><p class="label">Explore</p><a class="navitem" href="/"><span class="ico">ϟ</span>How it works</a><a class="navitem" href="/health"><span class="ico">?</span>Status</a><a class="navitem" href="${DISCORD_INVITE_URL}"><span class="ico">☊</span>Support</a><a class="navitem" href="/logout"><span class="ico">↩</span>Logout</a></div><div class="sidebottom"><a class="dashbtn" href="#source">▦ Create Script</a><div class="version">KARMA · V. BETA</div></div></aside><main class="main"><div class="top"><div class="profile"><img class="avatar" src="${avatar}"><div><h1>Dashboard</h1><p class="muted">Welcome, ${username}</p></div></div><a class="btn" href="${DISCORD_INVITE_URL}">Connect Discord</a></div><section id="overview" class="stats"><div class="stat"><div class="num">${scripts.length}</div><span class="muted">Scripts used</span></div><div class="stat"><div class="num">${remaining}</div><span class="muted">Slots left</span></div><div class="stat"><div class="num">1000</div><span class="muted">Max scripts</span></div></section><div class="grid"><section id="source" class="card"><h2>Source</h2><p class="muted">Paste Lua source and host it as a loadstring.</p><form method="post" action="/dashboard/scripts"><label>Name</label><input name="name" maxlength="80" placeholder="My Loader" required><label>Lua Code</label><textarea name="code" maxlength="4000" placeholder='print("Karma Sources")' required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate with Kers0ne-style wrapper</label><button type="submit">Host Script</button></form></section><section id="loadstring" class="card"><h2>Loadstrings</h2>${scriptRows}</section></div><section id="settings" class="card"><h2>Bot commands</h2><p><code>/panel</code> <code>/apply</code> <code>/generatekey</code> <code>/hostscript</code> <code>/resethwid</code> <code>/redeem</code> <code>/keyinfo</code></p></section></main></div></body></html>`;
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
    return res.type('html').send(discordDashboardPage(user));
  });

  app.post('/dashboard/scripts', async (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;

    const count = db.prepare('SELECT COUNT(*) AS count FROM hosted_scripts WHERE created_by = ?').get(user.id).count;
    if (count >= MAX_WEB_SCRIPTS_PER_USER) {
      return res.status(403).type('html').send(`<h1>Script limit reached</h1><p>You already have ${MAX_WEB_SCRIPTS_PER_USER} scripts.</p><a href="/dashboard">Back</a>`);
    }

    const name = String(req.body.name || '').trim().slice(0, 80);
    const code = String(req.body.code || '').slice(0, 4000);
    const shouldObfuscate = req.body.obfuscate === 'true' || req.body.obfuscate === 'on';
    if (!name || !code) return res.status(400).type('html').send('<h1>Missing name or code</h1><a href="/dashboard">Back</a>');

    let finalCode = code;
    if (shouldObfuscate) finalCode = await callObfuscator(code);

    createHostedScript({
      guildId: 'web',
      name,
      code: String(finalCode),
      obfuscated: shouldObfuscate,
      createdBy: user.id
    });

    return res.redirect('/dashboard');
  });

  app.post('/dashboard/scripts/:id/delete', (req, res) => {
    const user = requireDashboardUser(req, res);
    if (!user) return;
    db.prepare('DELETE FROM hosted_scripts WHERE id = ? AND created_by = ?').run(req.params.id, user.id);
    return res.redirect('/dashboard');
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
    const base = publicBaseUrl();
    const rawUrl = `${base}/script/${script.id}.lua`;
    return res.type('text/plain').send(`loadstring(game:HttpGet("${rawUrl}"))()`);
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
