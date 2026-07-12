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
  OBFUSCATOR_API_URL = 'https://leakd-detector.up.railway.app'
} = process.env;

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
    .setName('setup')
    .setDescription('Set up the Kolsec panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName('admin_role').setDescription('Role allowed to manage Kolsec').setRequired(true))
    .addRoleOption(o => o.setName('customer_role').setDescription('Buyer role given after redeeming').setRequired(true))
    .addChannelOption(o => o.setName('panel_channel').setDescription('Channel to post the panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName('log_channel').setDescription('Logs channel').addChannelTypes(ChannelType.GuildText).setRequired(false)),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Repost the Kolsec button panel')
    .addChannelOption(o => o.setName('channel').setDescription('Where to post the panel').addChannelTypes(ChannelType.GuildText).setRequired(false)),

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
    .setName('genkey')
    .setDescription('Alias for /generatekey')
    .addStringOption(o => o.setName('script_id').setDescription('Script ID').setRequired(true))
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
    INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, updated_at)
    VALUES (@guild_id, @admin_role_id, @customer_role_id, @log_channel_id, @panel_channel_id, @panel_message_id, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      admin_role_id=excluded.admin_role_id,
      customer_role_id=excluded.customer_role_id,
      log_channel_id=excluded.log_channel_id,
      panel_channel_id=excluded.panel_channel_id,
      panel_message_id=excluded.panel_message_id,
      updated_at=CURRENT_TIMESTAMP
  `).run({
    guild_id: guildId,
    admin_role_id: next.admin_role_id || null,
    customer_role_id: next.customer_role_id || null,
    log_channel_id: next.log_channel_id || null,
    panel_channel_id: next.panel_channel_id || null,
    panel_message_id: next.panel_message_id || null
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

async function callObfuscator(luaCode) {
  const base = OBFUSCATOR_API_URL.replace(/\/$/, '');
  const urls = [base, `${base}/obfuscate`, `${base}/api/obfuscate`];
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: luaCode, script: luaCode, source: luaCode })
      });

      const text = await response.text();
      if (!response.ok) {
        lastError = new Error(`${url} returned ${response.status}: ${text.slice(0, 300)}`);
        continue;
      }

      try {
        const json = JSON.parse(text);
        return json.obfuscated || json.code || json.result || json.output || json.data || text;
      } catch {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Obfuscator API failed.');
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

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle('Kolsec Hub')
    .setDescription('Use the buttons below to manage your key')
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
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    if (interaction.isButton()) await handleButton(interaction);
    if (interaction.isModalSubmit()) await handleModal(interaction);
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
        '`/setup` - set up roles, logs, and the panel',
        '`/panel` - repost the button panel',
        '`/apply` - create a script, host it, and get a loadstring',
        '`/createscript` - create a script/API secret only',
        '`/scripts` - list scripts',
        '`/generatekey` / `/genkey` - generate license keys',
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

  if (commandName === 'setup') {
    const adminRole = interaction.options.getRole('admin_role', true);
    const customerRole = interaction.options.getRole('customer_role', true);
    const panelChannel = interaction.options.getChannel('panel_channel', true);
    const logChannel = interaction.options.getChannel('log_channel', false);

    upsertSettings(interaction.guildId, {
      admin_role_id: adminRole.id,
      customer_role_id: customerRole.id,
      log_channel_id: logChannel ? logChannel.id : null,
      panel_channel_id: panelChannel.id
    });

    const panelMessage = await panelChannel.send({ embeds: [panelEmbed()], components: panelButtons() });
    upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });

    await interaction.reply({ ephemeral: true, content: `Setup complete. Panel posted in ${panelChannel}.` });
    await logGuild(interaction.guild, `⚙️ License panel setup by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'panel') {
    if (!requireAdmin(interaction)) {
      return interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    }
    const settings = getSettings(interaction.guildId);
    const channel = interaction.options.getChannel('channel', false) || (settings?.panel_channel_id ? await interaction.guild.channels.fetch(settings.panel_channel_id).catch(() => null) : interaction.channel);
    if (!channel || !channel.isTextBased()) return interaction.reply({ ephemeral: true, content: 'Panel channel not found.' });
    const panelMessage = await channel.send({ embeds: [panelEmbed()], components: panelButtons() });
    upsertSettings(interaction.guildId, { panel_channel_id: channel.id, panel_message_id: panelMessage.id });
    await interaction.reply({ ephemeral: true, content: `Panel posted in ${channel}.` });
    return;
  }

  const adminCommands = ['generatekey', 'apply', 'hostscript', 'resethwid', 'createscript', 'scripts', 'genkey', 'revoke', 'extendkey', 'deletekey', 'panel', 'loader', 'obfuscate'];
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

  if (commandName === 'generatekey' || commandName === 'genkey') {
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
  if (!settings || !settings.customer_role_id) return interaction.reply({ ephemeral: true, content: 'Buyer role is not configured. Run `/setup` first.' });

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
  const latestHosted = db.prepare('SELECT id, name, obfuscated, created_at FROM hosted_scripts ORDER BY created_at DESC LIMIT 3').all();

  const buildCards = latestHosted.length
    ? latestHosted.map((r, i) => `<a class="build" href="/script/${r.id}.lua"><span>v1.${String(80 - i).padStart(2, '0')}.00${i + 1}</span><strong>${escapeHtml(r.name)}</strong><small>${r.obfuscated ? 'Obfuscated build' : 'Hosted loader'} · ${escapeHtml(r.created_at)}</small></a>`).join('')
    : `<a class="build" href="#start"><span>v1.00.001</span><strong>Kolsec deployment ready</strong><small>Use /apply or /hostscript to publish your first loader.</small></a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kolsec — Lua Code Protection & Licensing</title>
  <meta name="description" content="Kolsec protects, hosts, and monetizes Lua scripts with Discord licensing, HWID locking, and hosted loadstrings." />
  <style>
    :root{--bg:#050505;--panel:#0b0b0b;--panel2:#111;--text:#fff;--muted:#a3a3a3;--line:#242424;--soft:#e9e9e9;--glow:rgba(255,255,255,.16)}
    *{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif;overflow-x:hidden}
    a{color:inherit;text-decoration:none}.wrap{width:min(1180px,92%);margin:auto}.noise{position:fixed;inset:0;pointer-events:none;opacity:.06;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E")}
    .hex{position:absolute;inset:0;z-index:-1;overflow:hidden}.hex:before{content:'F3263F1D5207C3EA18603AA424DF13498E4B03CB03B1A1EE99CBE054AEAC57E9D922DAC67C79BB9E7A9D9E4B2B993801A8C9EE5002224412962603E1E8E69090805640F34AC34BA25534E50C79ECC0CE1145DBED6D36B725013FD184273BDD1B1FA7F1D11D03E7EB729E58DA2551683EDD1591B56FA9D31D6A31D536497F8ED858BBE63CC2EBA';position:absolute;top:26px;left:50%;transform:translateX(-50%);width:1100px;color:#fff;opacity:.08;font-family:ui-monospace,monospace;font-size:14px;line-height:1.8;word-break:break-all;text-align:center}.orb{position:absolute;width:520px;height:520px;left:50%;top:70px;transform:translateX(-50%);background:radial-gradient(circle,var(--glow),transparent 64%);filter:blur(20px);z-index:-2}
    header{position:sticky;top:0;z-index:5;background:rgba(5,5,5,.68);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08)}.nav{height:78px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;font-size:23px;font-weight:950;letter-spacing:-.06em}.logo{width:38px;height:38px;border:1px solid #fff;border-radius:12px;display:grid;place-items:center;background:#fff;color:#000;box-shadow:0 0 40px rgba(255,255,255,.18)}.links{display:flex;gap:24px;color:var(--muted);font-size:14px}.links a:hover{color:#fff}.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border:1px solid #fff;border-radius:999px;background:#fff;color:#000;padding:13px 19px;font-weight:850;box-shadow:0 0 40px rgba(255,255,255,.08)}.btn.ghost{background:#090909;color:#fff;border-color:#333;box-shadow:none}.btn:hover{transform:translateY(-1px)}
    .hero{position:relative;padding:96px 0 84px;text-align:center}.eyebrow{display:inline-flex;align-items:center;gap:9px;border:1px solid #2d2d2d;border-radius:999px;padding:9px 14px;background:rgba(255,255,255,.04);color:#d9d9d9;font-size:14px}.hero h1{font-size:clamp(48px,9vw,108px);line-height:.86;margin:24px auto 24px;max-width:980px;letter-spacing:-.095em}.hero p{color:#bdbdbd;font-size:clamp(17px,2vw,22px);line-height:1.65;max-width:790px;margin:0 auto 32px}.actions{display:flex;justify-content:center;gap:14px;flex-wrap:wrap}.hero-card{margin:54px auto 0;max-width:860px;border:1px solid #262626;border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.025));padding:18px;box-shadow:0 35px 120px rgba(0,0,0,.5)}.terminal{border-radius:20px;background:#020202;border:1px solid #1d1d1d;text-align:left;overflow:hidden}.bar{display:flex;gap:7px;padding:14px 16px;border-bottom:1px solid #1b1b1b}.dot{width:10px;height:10px;border-radius:50%;background:#fff;opacity:.25}.terminal pre{margin:0;padding:22px;color:#e7e7e7;white-space:pre-wrap;font:14px/1.8 ui-monospace,monospace}.muted{color:#777}.cmd{color:#fff;font-weight:800}
    .section{padding:74px 0}.split{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;margin-bottom:28px}.kicker{color:#aaa;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:800}.section h2{font-size:clamp(34px,5vw,62px);line-height:.95;letter-spacing:-.07em;margin:10px 0}.section .lead{color:#aaa;max-width:680px;line-height:1.65}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.feature{position:relative;min-height:230px;background:linear-gradient(180deg,#111,#080808);border:1px solid var(--line);border-radius:28px;padding:26px;overflow:hidden}.feature:after{content:'';position:absolute;right:-70px;top:-70px;width:170px;height:170px;background:radial-gradient(circle,rgba(255,255,255,.12),transparent 65%)}.icon{font-size:28px;margin-bottom:22px}.feature h3{font-size:22px;margin:0 0 10px}.feature p{color:#a7a7a7;line-height:1.65;margin:0}.mock{border:1px solid #252525;border-radius:26px;background:#0b0b0b;padding:18px}.mock-head{display:flex;justify-content:space-between;color:#777;border-bottom:1px solid #222;padding:0 0 14px}.mock-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:15px 0;border-bottom:1px solid #181818}.tag{border:1px solid #333;border-radius:999px;padding:6px 10px;color:#ddd;background:#111;font-size:12px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.stat{border:1px solid #252525;border-radius:28px;padding:30px;background:#0a0a0a;text-align:center}.num{font-size:52px;font-weight:950;letter-spacing:-.06em}.label{color:#999}.builds{display:grid;gap:14px}.build{display:block;border:1px solid #252525;border-radius:22px;padding:20px;background:#0a0a0a}.build span{font:12px ui-monospace,monospace;color:#888}.build strong{display:block;font-size:19px;margin:7px 0}.build small{color:#999;line-height:1.5}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:18px}.price{border:1px solid #292929;border-radius:30px;padding:30px;background:#090909}.price.hot{background:#fff;color:#000}.price h3{font-size:28px;margin:0}.price .money{font-size:50px;font-weight:950;letter-spacing:-.07em;margin:18px 0}.price ul{list-style:none;padding:0;margin:20px 0;display:grid;gap:12px}.price li:before{content:'✓';margin-right:10px}.price.hot .btn{background:#000;color:#fff;border-color:#000}.cta{border:1px solid #2b2b2b;border-radius:34px;background:radial-gradient(circle at 50% 0,rgba(255,255,255,.13),transparent 34%),#080808;padding:56px;text-align:center}.cta h2{margin-top:0}.footer{border-top:1px solid #1f1f1f;padding:32px 0;color:#777;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
    @media(max-width:860px){.links{display:none}.hero{text-align:left}.actions{justify-content:flex-start}.grid,.pricing,.stats{grid-template-columns:1fr}.split{grid-template-columns:1fr}.hero h1{letter-spacing:-.075em}.cta{padding:34px 22px}}
  </style>
</head>
<body>
  <div class="noise"></div>
  <header><div class="wrap nav"><a class="brand" href="/"><span class="logo">K</span> Kolsec</a><nav class="links"><a href="#features">Features</a><a href="#builds">Builds</a><a href="#pricing">Pricing</a><a href="#start">Commands</a></nav><a class="btn ghost" href="#start">Enter the lab</a></div></header>
  <main>
    <section class="hero"><div class="hex"></div><div class="orb"></div><div class="wrap"><span class="eyebrow">✦ The black and white standard for Lua security</span><h1>Protect. Monetize. Earn.</h1><p>Drop your project, get a protected hosted build, and monetize with confidence. Kolsec handles HWID-locks, whitelist keys, Discord panels, and loadstrings from one Render service.</p><div class="actions"><a class="btn" href="#start">Enter the lab</a><a class="btn ghost" href="#how">How it works</a></div><div class="hero-card"><div class="terminal"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><pre><span class="muted">$</span> <span class="cmd">/apply</span> name:Project code:loader.lua obfuscate:true
<span class="muted">Kolsec:</span> protected build created
<span class="muted">Loadstring:</span> loadstring(game:HttpGet("${publicBaseUrl()}/script/host_xxxxx.lua"))()</pre></div></div></div></section>
    <section id="features" class="section"><div class="wrap"><div class="split"><div><div class="kicker">Kolsec features</div><h2>Everything you need to ship and protect.</h2><p class="lead">An original Kolsec landing page with the same kind of product sections you wanted, but with fresh branding and styling.</p></div></div><div class="grid"><article class="feature"><div class="icon">🧩</div><h3>Custom Obfuscation</h3><p>Send code through your configured obfuscator API while applying or hosting scripts.</p></article><article class="feature"><div class="icon">🔐</div><h3>Whitelist System</h3><p>Generate keys, redeem from the panel, assign buyer roles, revoke access, and reset HWIDs.</p></article><article class="feature"><div class="icon">🤖</div><h3>Discord Bot</h3><p>Clean slash commands: /setup, /generatekey, /apply, /hostscript, and /resethwid.</p></article><article class="feature"><div class="icon">📊</div><h3>Dashboard Feel</h3><p>Live website stats show products, generated keys, and hosted scripts from the database.</p></article><article class="feature"><div class="icon">🖥️</div><h3>HWID Tracker</h3><p>Bind keys to the first device that verifies and reset them from Discord when needed.</p></article><article class="feature"><div class="icon">⚡</div><h3>Hosted Loadstrings</h3><p>Render serves your Lua at /script/&lt;id&gt;.lua with a ready-to-copy loadstring endpoint.</p></article></div></div></section>
    <section id="how" class="section"><div class="wrap"><div class="split"><div><div class="kicker">Create a script in seconds</div><h2>Ship straight from Discord.</h2><p class="lead">Run /apply, save the API secret, generate keys, then let customers use the panel.</p></div><div class="mock"><div class="mock-head"><span>Kolsec Panel</span><span>online</span></div><div class="mock-row"><strong>📜 View Script</strong><span class="tag">loadstring</span></div><div class="mock-row"><strong>🔑 Redeem Key</strong><span class="tag">whitelist</span></div><div class="mock-row"><strong>⚙️ Reset HWID</strong><span class="tag">support</span></div></div></div><div class="stats"><div class="stat"><div class="num">${scriptCount}</div><div class="label">products created</div></div><div class="stat"><div class="num">${keyCount}</div><div class="label">keys generated</div></div><div class="stat"><div class="num">${hostedCount}</div><div class="label">scripts hosted</div></div></div></div></section>
    <section id="builds" class="section"><div class="wrap"><div class="kicker">Kolsec latest builds</div><h2>Shipping every week.</h2><p class="lead">Recent hosted scripts and deployment status appear here.</p><div class="builds">${buildCards}</div></div></section>
    <section id="pricing" class="section"><div class="wrap"><div class="kicker">Kolsec pricing</div><h2>Simple plans. Real protection.</h2><div class="pricing"><div class="price"><h3>Citizen</h3><div class="money">$0<span style="font-size:18px;color:#888">/forever</span></div><ul><li>Discord bot panel</li><li>Whitelist keys</li><li>Hosted loadstrings</li><li>HWID resets</li><li>Basic protection flow</li></ul><a class="btn ghost" href="#start">Get Started Free</a></div><div class="price hot"><h3>Royal</h3><div class="money">$3<span style="font-size:18px;color:#555">/month</span></div><ul><li>Unlimited hosted scripts</li><li>Obfuscation pipeline</li><li>Priority support</li><li>Buyer role automation</li><li>Early access features</li></ul><a class="btn" href="#start">Upgrade to Royal</a></div></div></div></section>
    <section id="start" class="section"><div class="wrap"><div class="cta"><h2>Ready to take back control?</h2><p class="lead" style="margin:0 auto 24px">Use these commands in Discord after the bot starts on Render.</p><p><code>/help</code> <code>/status</code> <code>/setup</code> <code>/panel</code> <code>/apply</code> <code>/createscript</code> <code>/scripts</code> <code>/generatekey</code> <code>/genkey</code> <code>/redeem</code> <code>/keyinfo</code> <code>/mykeys</code> <code>/freekey</code> <code>/getrole</code> <code>/viewscript</code> <code>/resethwid</code> <code>/reset-hwid</code> <code>/revoke</code> <code>/extendkey</code> <code>/deletekey</code> <code>/hostscript</code> <code>/obfuscate</code> <code>/loader</code></p><div class="actions"><a class="btn" href="/health">Check Status</a><a class="btn ghost" href="/hosted">View Hosted Scripts</a></div></div></div></section>
  </main>
  <div class="wrap footer"><span>Kolsec © ${new Date().getFullYear()}</span><span>Lua Code Protection & Licensing</span></div>
</body>
</html>`;
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

  app.get('/', (req, res) => res.type('html').send(kolsecHomePage()));
  app.get('/health', (req, res) => res.json({ ok: true, name: 'Kolsec' }));

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
