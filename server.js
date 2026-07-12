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
    .setDescription('Show Kolsec command list'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show Kolsec service/database status'),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post/configure the Kolsec button panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('title').setDescription('Panel title, example: Drizzy Hub').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(true).setMaxLength(500))
    .addChannelOption(o => o.setName('channel').setDescription('Where to post the panel').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addRoleOption(o => o.setName('admin_role').setDescription('Role allowed to manage Kolsec').setRequired(false))
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
  const title = settings?.panel_title || 'Kolsec Hub';
  const description = settings?.panel_description || 'Use the buttons below to manage your key';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x2f3136)
    .setFooter({ text: 'Kolsec | v1' });
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
        '**Kolsec Commands**',
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
    return interaction.reply({ ephemeral: true, content: `Kolsec is online.\nScripts: **${scriptCount}**\nKeys: **${keyCount}**\nHosted scripts: **${hostedCount}**\nWebsite: ${publicBaseUrl()}` });
  }

  if (commandName === 'setup' || commandName === 'genkey') {
    return interaction.reply({ ephemeral: true, content: commandName === 'setup' ? 'This command was removed. Use `/panel title description` now.' : 'This command was removed. Use `/generatekey` now.' });
  }

  if (commandName === 'panel') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    }

    const settings = getSettings(interaction.guildId);
    const channel = interaction.options.getChannel('channel', false) || (settings?.panel_channel_id ? await interaction.guild.channels.fetch(settings.panel_channel_id).catch(() => null) : interaction.channel);
    const panelTitle = interaction.options.getString('title', true);
    const panelDescription = interaction.options.getString('description', true);
    const adminRole = interaction.options.getRole('admin_role', false);
    const customerRole = interaction.options.getRole('customer_role', false);
    const logChannel = interaction.options.getChannel('log_channel', false);

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ ephemeral: true, content: 'Panel channel not found.' });
    }

    const patch = {
      panel_channel_id: channel.id,
      panel_title: panelTitle,
      panel_description: panelDescription
    };
    if (adminRole) patch.admin_role_id = adminRole.id;
    if (customerRole) patch.customer_role_id = customerRole.id;
    if (logChannel) patch.log_channel_id = logChannel.id;
    upsertSettings(interaction.guildId, patch);

    const payload = { embeds: [panelEmbed(interaction.guildId)], components: panelButtons() };

    // If posting to the current channel, the interaction reply IS the panel.
    // This prevents the old behavior of sending the panel + a second confirmation message.
    if (channel.id === interaction.channelId) {
      const panelMessage = await interaction.reply({ ...payload, fetchReply: true });
      upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });
      return;
    }

    const panelMessage = await channel.send(payload);
    upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });
    return interaction.reply({ ephemeral: true, content: `Panel posted in ${channel}.` });
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
  <title>Kolsec - Lua Whitelist & Script Protection</title>
  <meta name="description" content="Kolsec is a Discord-based Lua whitelist, script hosting, HWID, and obfuscation platform." />
  <style>
    *{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;background:#000;color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif} a{color:inherit;text-decoration:none}.wrap{width:min(1180px,92%);margin:auto}.bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.18),transparent 34%),radial-gradient(circle at 10% 20%,rgba(255,255,255,.08),transparent 26%),#000}.gridbg{position:fixed;inset:0;z-index:-1;opacity:.08;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,#000,transparent 80%)}
    header{position:sticky;top:0;z-index:10;background:rgba(0,0,0,.72);backdrop-filter:blur(18px);border-bottom:1px solid #1f1f1f}.nav{height:76px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:26px;font-weight:950;letter-spacing:-.06em}.brand span{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#fff;color:#000;margin-right:10px}.links{display:flex;gap:24px;color:#aaa;font-size:14px}.links a:hover{color:#fff}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:13px 19px;border-radius:999px;font-weight:850;border:1px solid #fff;background:#fff;color:#000}.btn.dark{background:#050505;color:#fff;border-color:#333}.btn:hover{transform:translateY(-1px)}
    .hero{padding:96px 0 78px;text-align:center}.pill{display:inline-flex;gap:9px;align-items:center;padding:9px 14px;border:1px solid #333;border-radius:999px;background:#090909;color:#d7d7d7}.hero h1{font-size:clamp(48px,8vw,104px);line-height:.9;letter-spacing:-.09em;margin:22px auto;max-width:1020px}.hero p{font-size:clamp(17px,2vw,22px);line-height:1.6;color:#b8b8b8;max-width:820px;margin:0 auto 32px}.actions{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}.preview{margin:58px auto 0;max-width:920px;border:1px solid #242424;border-radius:30px;background:linear-gradient(180deg,#111,#050505);box-shadow:0 30px 120px rgba(255,255,255,.07);padding:20px}.screen{border:1px solid #222;border-radius:22px;background:#080808;overflow:hidden;text-align:left}.top{display:flex;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #1f1f1f;color:#888}.rows{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:18px}.tile{border:1px solid #252525;background:#0d0d0d;border-radius:18px;padding:20px}.tile b{display:block;margin-bottom:8px}.tile small{color:#999;line-height:1.5}
    .section{padding:76px 0}.title{max-width:780px}.kicker{color:#aaa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:900}.title h2{font-size:clamp(36px,5vw,66px);line-height:.95;letter-spacing:-.075em;margin:10px 0}.title p{color:#aaa;line-height:1.65}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}.card{border:1px solid #242424;border-radius:28px;background:linear-gradient(180deg,#101010,#070707);padding:28px;min-height:220px}.icon{font-size:30px;margin-bottom:18px}.card h3{font-size:22px;margin:0 0 10px}.card p{color:#aaa;line-height:1.65;margin:0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.stat{border:1px solid #242424;border-radius:28px;background:#080808;text-align:center;padding:32px}.num{font-size:56px;font-weight:950;letter-spacing:-.07em}.label{color:#999}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.step{padding:26px;border-radius:28px;border:1px solid #242424;background:#0a0a0a}.step span{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#fff;color:#000;font-weight:950;margin-bottom:18px}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:18px}.price{border:1px solid #252525;border-radius:30px;background:#080808;padding:30px}.price.hot{background:#fff;color:#000}.money{font-size:50px;font-weight:950;letter-spacing:-.07em;margin:12px 0}.price ul{list-style:none;padding:0;margin:20px 0;display:grid;gap:12px}.price li:before{content:'✓';margin-right:10px}.price.hot .btn{background:#000;color:#fff}.cta{text-align:center;border:1px solid #2b2b2b;border-radius:34px;background:radial-gradient(circle at 50% 0,rgba(255,255,255,.14),transparent 35%),#080808;padding:56px}.cmds{line-height:2.2}.cmds code{background:#111;border:1px solid #2a2a2a;border-radius:10px;padding:5px 8px;color:#fff}.footer{border-top:1px solid #1d1d1d;color:#777;padding:30px 0;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}@media(max-width:860px){.links{display:none}.hero{text-align:left}.actions{justify-content:flex-start}.features,.steps,.stats,.pricing,.rows{grid-template-columns:1fr}.cta{padding:34px 20px}}
  </style>
</head>
<body>
  <div class="bg"></div><div class="gridbg"></div>
  <header><div class="wrap nav"><a class="brand" href="/"><span>K</span>Kolsec</a><nav class="links"><a href="#features">Features</a><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#commands">Commands</a></nav><a class="btn dark" href="/login">Get Started</a></div></header>
  <main>
    <section class="hero"><div class="wrap"><div class="pill">Discord OAuth enabled · Lua protection</div><h1>Lua Whitelist & Script Protection</h1><p>Kolsec helps you protect Lua scripts, generate whitelist keys, reset HWIDs, host loadstrings, and manage access straight from Discord.</p><div class="actions"><a class="btn" href="/login">Get Started with Discord</a><a class="btn dark" href="#how">How it works</a></div><div class="preview"><div class="screen"><div class="top"><b>Kolsec Dashboard</b><span>online</span></div><div class="rows"><div class="tile"><b>${scriptCount}</b><small>Scripts created</small></div><div class="tile"><b>${keyCount}</b><small>License keys</small></div><div class="tile"><b>${hostedCount}</b><small>Hosted loadstrings</small></div></div></div></div></div></section>
    <section id="features" class="section"><div class="wrap"><div class="title"><div class="kicker">Powerful features</div><h2>Everything you need to manage your scripts automatically.</h2><p>Built for Discord communities that sell or distribute Lua scripts.</p></div><div class="features"><div class="card"><div class="icon">🔐</div><h3>Whitelist Keys</h3><p>Generate expiring or lifetime keys and let users redeem from your panel.</p></div><div class="card"><div class="icon">🖥️</div><h3>HWID Locking</h3><p>Bind each key to the first device and reset it when support is needed.</p></div><div class="card"><div class="icon">⚡</div><h3>Hosted Loadstrings</h3><p>Host scripts on Render and serve clean loadstrings at /script/id.lua.</p></div><div class="card"><div class="icon">🤖</div><h3>Discord Bot</h3><p>Panels, buttons, logs, buyer roles, key info, and admin commands.</p></div><div class="card"><div class="icon">🧩</div><h3>Obfuscation</h3><p>Use the local Kers0ne-style wrapper when applying or hosting Lua.</p></div><div class="card"><div class="icon">📡</div><h3>REST API</h3><p>Verify keys from loaders using a protected verification endpoint.</p></div></div></div></section>
    <section id="how" class="section"><div class="wrap"><div class="title"><div class="kicker">How it works</div><h2>Set up once. Sell forever.</h2></div><div class="steps"><div class="step"><span>1</span><h3>Run /panel</h3><p>Post the Kolsec panel with your custom title and description.</p></div><div class="step"><span>2</span><h3>Run /apply</h3><p>Create a script, host the loader, and save the API secret.</p></div><div class="step"><span>3</span><h3>Generate keys</h3><p>Users redeem keys and your loader verifies access.</p></div></div></div></section>
    <section class="section"><div class="wrap"><div class="stats"><div class="stat"><div class="num">${scriptCount}</div><div class="label">scripts</div></div><div class="stat"><div class="num">${keyCount}</div><div class="label">keys</div></div><div class="stat"><div class="num">${hostedCount}</div><div class="label">hosted scripts</div></div></div></div></section>
    <section id="pricing" class="section"><div class="wrap"><div class="title"><div class="kicker">Pricing</div><h2>Simple plans. Real protection.</h2></div><div class="pricing"><div class="price"><h3>Citizen</h3><div class="money">$0</div><ul><li>Discord panel</li><li>Key generation</li><li>HWID resets</li><li>Hosted loadstrings</li></ul><a class="btn dark" href="/login">Get Started</a></div><div class="price hot"><h3>Royal</h3><div class="money">$3<span style="font-size:18px">/mo</span></div><ul><li>Unlimited hosting</li><li>Obfuscation workflow</li><li>Priority support</li><li>Advanced automation</li></ul><a class="btn" href="/login">Upgrade</a></div></div></div></section>
    <section id="commands" class="section"><div class="wrap"><div class="cta"><h2>Ready to protect your scripts?</h2><p>Sign in with Discord to start.</p><div class="actions"><a class="btn" href="/login">Get Started</a><a class="btn dark" href="/health">Status</a></div><p class="cmds"><code>/panel</code> <code>/apply</code> <code>/generatekey</code> <code>/hostscript</code> <code>/resethwid</code> <code>/redeem</code> <code>/keyinfo</code></p></div></div></section>
  </main>
  <div class="wrap footer"><span>Kolsec © ${new Date().getFullYear()}</span><span>Lua Whitelist & Script Protection</span></div>
</body>
</html>`;
}

function discordDashboardPage(user) {
  const username = escapeHtml(user.global_name || user.username || 'Discord User');
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : '';
  const scripts = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts WHERE created_by = ? ORDER BY created_at DESC').all(user.id);
  const remaining = Math.max(0, MAX_WEB_SCRIPTS_PER_USER - scripts.length);
  const scriptRows = scripts.length
    ? scripts.map(s => `<div class="script"><div><b>${escapeHtml(s.name)}</b><small>${s.obfuscated ? 'Obfuscated' : 'Plain'} · ${escapeHtml(s.created_at)}</small><code>loadstring(game:HttpGet("${publicBaseUrl()}/script/${s.id}.lua"))()</code></div><form method="post" action="/dashboard/scripts/${s.id}/delete"><button>Delete</button></form></div>`).join('')
    : `<p class="muted">No scripts yet. Create your first hosted loadstring below.</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kolsec Dashboard</title><style>*{box-sizing:border-box}body{margin:0;background:#000;color:#fff;font-family:Inter,Arial,sans-serif}a{color:inherit}.wrap{width:min(1120px,92%);margin:38px auto}.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.card{border:1px solid #242424;border-radius:28px;background:#080808;padding:26px;margin-bottom:18px}.profile{display:flex;align-items:center;gap:16px}.avatar{width:70px;height:70px;border-radius:50%;border:1px solid #333}.muted,small{color:#999}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stat{border:1px solid #242424;border-radius:22px;background:#050505;padding:20px}.num{font-size:38px;font-weight:950}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.script{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:start;border:1px solid #222;border-radius:18px;padding:16px;margin:12px 0;background:#050505}.script b,.script small,.script code{display:block}.script code{white-space:pre-wrap;word-break:break-all;background:#111;border:1px solid #2a2a2a;border-radius:12px;padding:10px;margin-top:10px;color:#eee}input,textarea{width:100%;background:#050505;color:#fff;border:1px solid #2a2a2a;border-radius:14px;padding:12px;margin:8px 0 14px;font:inherit}textarea{min-height:180px}button,.btn{display:inline-flex;border:1px solid #fff;border-radius:999px;background:#fff;color:#000;padding:11px 16px;font-weight:850;text-decoration:none;cursor:pointer}.btn.dark,button.dark{background:#000;color:#fff;border-color:#333}.check{display:flex;gap:10px;align-items:center;margin-bottom:14px}.check input{width:auto;margin:0}@media(max-width:800px){.grid,.stats,.script{grid-template-columns:1fr}}</style></head><body><div class="wrap"><div class="nav"><h1>Kolsec Dashboard</h1><div><a class="btn dark" href="${DISCORD_INVITE_URL}">Connect Discord</a> <a class="btn dark" href="/logout">Logout</a></div></div><div class="card profile">${avatar ? `<img class="avatar" src="${avatar}" alt="avatar">` : ''}<div><h2>Welcome, ${username}</h2><p class="muted">Discord connected. You can host up to <b>${MAX_WEB_SCRIPTS_PER_USER}</b> scripts.</p></div></div><div class="stats"><div class="stat"><div class="num">${scripts.length}</div><div class="muted">Scripts used</div></div><div class="stat"><div class="num">${remaining}</div><div class="muted">Slots left</div></div><div class="stat"><div class="num">1000</div><div class="muted">Max scripts</div></div></div><div class="grid"><div class="card"><h2>Create Script</h2><form method="post" action="/dashboard/scripts"><label>Name</label><input name="name" maxlength="80" placeholder="My Loader" required><label>Lua Code</label><textarea name="code" maxlength="4000" placeholder='print("Kolsec")' required></textarea><label class="check"><input type="checkbox" name="obfuscate" value="true"> Obfuscate with Kers0ne-style wrapper</label><button type="submit">Host Script</button></form></div><div class="card"><h2>Your Scripts</h2>${scriptRows}</div></div><div class="card"><h2>Discord Commands</h2><p><code>/panel</code> <code>/apply</code> <code>/generatekey</code> <code>/hostscript</code> <code>/resethwid</code></p><a class="btn" href="/">Back Home</a></div></div></body></html>`;
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

  app.get('/', (req, res) => res.type('html').send(kolsecHomePage()));
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Kolsec' }));

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
    if (!script) return res.status(404).type('text/plain').send('-- Kolsec: script not found');
    res.setHeader('Cache-Control', 'no-store');
    return res.type('text/plain').send(script.code);
  });

  app.get('/loadstring/:id', (req, res) => {
    const script = db.prepare('SELECT * FROM hosted_scripts WHERE id = ?').get(req.params.id);
    if (!script) return res.status(404).type('text/plain').send('-- Kolsec: script not found');
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
