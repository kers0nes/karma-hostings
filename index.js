const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionsBitField,
  WebhookClient,
  ChannelType,
} = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');
const axios = require('axios');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

let db;

// =========================
//   DATABASE
// =========================
async function setupDatabase() {
  db = await open({
    filename: './licenses.db',
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'Premium',
      expires_at INTEGER NOT NULL,
      redeemed_by TEXT,
      redeemed_at INTEGER,
      hwid TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      license_key TEXT,
      redeemed_at INTEGER,
      hwid TEXT,
      last_reset INTEGER DEFAULT 0,
      scripts INTEGER DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT,
      script_name TEXT,
      script_content TEXT,
      created_at INTEGER,
      is_obfuscated INTEGER DEFAULT 0,
      is_hosted INTEGER DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      channel_id TEXT PRIMARY KEY,
      webhook_url TEXT,
      created_at INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bans (
      user_id TEXT PRIMARY KEY,
      reason TEXT,
      banned_at INTEGER,
      banned_by TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS panel_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT DEFAULT 'License Panel',
      description TEXT DEFAULT 'Manage your license using the buttons below.\n\n• **Redeem Key** — Link a license to your account\n• **My Stats** — View your license info\n• **Reset HWID** — Reset your machine binding\n• **Generate Key** — Admin only\n\n*Button responses are only visible to you.*'
    )
  `);

  // Add missing columns if they don't exist
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN scripts INTEGER DEFAULT 0`);
  } catch (_) {}
}

// =========================
//   HELPERS
// =========================
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  for (let i = 0; i < 3; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }
  return segments.join('-');
}

async function generateUniqueLicenseKey() {
  let key, exists = true;
  while (exists) {
    key = generateLicenseKey();
    const row = await db.get('SELECT key FROM licenses WHERE key = ?', [key]);
    exists = !!row;
  }
  return key;
}

function hashHWID(hwid) {
  return crypto.createHash('sha256').update(hwid).digest('hex');
}

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.some(role => role.name.toLowerCase() === 'admin')
  );
}

function formatDuration(ms) {
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hours}h`;
}

async function isBanned(userId) {
  const ban = await db.get('SELECT * FROM bans WHERE user_id = ?', [userId]);
  return !!ban;
}

async function getPanelConfig() {
  let config = await db.get('SELECT * FROM panel_config WHERE id = 1');
  if (!config) {
    await db.run(`
      INSERT INTO panel_config (id, title, description) 
      VALUES (1, 'License Panel', 'Manage your license using the buttons below.\n\n• **Redeem Key** — Link a license to your account\n• **My Stats** — View your license info\n• **Reset HWID** — Reset your machine binding\n• **Generate Key** — Admin only\n\n*Button responses are only visible to you.*')
    `);
    config = await db.get('SELECT * FROM panel_config WHERE id = 1');
  }
  return config;
}

function createLicensePanel() {
  return new EmbedBuilder()
    .setTitle('License Panel')
    .setDescription(
      [
        'Manage your license using the buttons below.',
        '',
        '• **Redeem Key** — Link a license to your account',
        '• **My Stats** — View your license info',
        '• **Reset HWID** — Reset your machine binding',
        '• **Generate Key** — Admin only',
        '',
        '*Button responses are only visible to you.*',
      ].join('\n')
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'License Manager' })
    .setTimestamp();
}

function createButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('redeem_key')
      .setLabel('Redeem Key')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('my_stats')
      .setLabel('My Stats')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('reset_hwid')
      .setLabel('Reset HWID')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('generate_key')
      .setLabel('Generate Key')
      .setStyle(ButtonStyle.Success)
  );
}

// =========================
//   OBFUSCATOR ENGINE
// =========================
function obfuscateScript(scriptContent) {
  // This is a simplified obfuscator that mimics the pattern from your example
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
  
  const varName = () => {
    let name = '_';
    for (let i = 0; i < 4; i++) {
      name += chars[Math.floor(Math.random() * chars.length)];
    }
    return name;
  };

  const obfuscateString = (str) => {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      const xorKey = 0xAA;
      result += `\\${charCode ^ xorKey}`;
    }
    return result;
  };

  const obfuscated = `--[[ Protected By Kers0ne Obfuscator ]]
return(function(...) local _${varName()}=string.char local _${varName()},_${varName()},_${varName()}=bit32.band,loadstring,string.gsub local _${varName()}=type local _${varName()}=string.sub local _${varName()},_${varName()}=string.byte,assert local _${varName()}=bit32.bxor local _${varName()},_${varName()},_${varName()}=table.concat,pcall,string.pack local function _${varName()}(data) local _${varName()}={} local _${varName()}=191 for _${varName()}=1,#data do _${varName()}[_${varName()}]=_${varName()}(${obfuscateString(scriptContent)},_${varName()}) end return _${varName()}(_${varName()}) end return _${varName()}(...); end)(...)
`;
  return obfuscated;
}

function embedScript(scriptContent) {
  return `--[[ Luarmor Protected ]]
return(function(...) local _0x=string.char local _1x,_2x,_3x=bit32.band,loadstring,string.gsub local _4x=type local _5x=string.sub local _6x,_7x=string.byte,assert local _8x=bit32.bxor local _9x,_10x,_11x=table.concat,pcall,string.pack 
local function _12x(data) local _13x={} local _14x=191 for _15x=1,#data do _13x[_15x]=_0x(_8x(_7x(data,_15x),_1x(_14x,0xFF)));_14x=_14x+1 end return _9x(_13x) end 
return _12x([===[${Buffer.from(scriptContent).toString('base64')}]===]); 
end)(...)
`;
}

// =========================
//   AI ASSISTANT
// =========================
const AI_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
  model: process.env.AI_MODEL || 'gpt-3.5-turbo',
  baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
};

async function askAI(prompt, context = '') {
  if (!AI_CONFIG.apiKey) {
    return "⚠️ AI Assistant is not configured. Please set the AI_API_KEY environment variable.";
  }

  try {
    const systemPrompt = `You are a helpful Discord bot assistant for a Roblox scripting community. 
You help with Lua scripting, game development, and general programming questions.
Keep responses concise and friendly. If asked about scripts, provide helpful guidance.
Context: ${context}`;

    const response = await axios.post(AI_CONFIG.baseURL, {
      model: AI_CONFIG.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.7,
    }, {
      headers: {
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('AI Error:', error.message);
    return "❌ I'm having trouble thinking right now. Please try again later.";
  }
}

// =========================
//   CORE ACTIONS
// =========================
async function sendMyStats(interaction) {
  const user = await db.get('SELECT * FROM users WHERE discord_id = ?', [interaction.user.id]);

  if (!user || !user.license_key) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Your License Stats')
          .setDescription('❌ You do not have an active license.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  const license = await db.get('SELECT * FROM licenses WHERE key = ?', [user.license_key]);

  if (!license) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Your License Stats')
          .setDescription('❌ Your linked license could not be found.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  const remaining = license.expires_at - Date.now();
  const active = remaining > 0;
  const maskedKey = `${license.key.slice(0, 4)}-****-${license.key.slice(-4)}`;

  const embed = new EmbedBuilder()
    .setTitle('Your License Stats')
    .setColor(active ? 0x00c853 : 0xff5252)
    .addFields(
      { name: 'Status', value: active ? '✅ Active' : '❌ Expired', inline: true },
      { name: 'Tier', value: license.tier, inline: true },
      { name: 'Expires In', value: formatDuration(remaining), inline: true },
      { name: 'HWID', value: user.hwid ? '✅ Bound' : '❌ Not bound', inline: true },
      { name: 'Scripts', value: String(user.scripts || 0), inline: true },
      { name: 'Key', value: maskedKey, inline: false }
    )
    .setFooter({ text: 'Only you can see this' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function resetHWID(interaction, targetUserId = null) {
  const userId = targetUserId || interaction.user.id;
  const isAdminAction = targetUserId && isAdmin(interaction.member);

  if (targetUserId && !isAdminAction) {
    return interaction.reply({
      content: '❌ You don\'t have permission to reset other users\' HWIDs.',
      ephemeral: true,
    });
  }

  const user = await db.get('SELECT * FROM users WHERE discord_id = ?', [userId]);

  if (!user || !user.license_key) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Reset HWID')
          .setDescription('❌ This user doesn\'t have an active license.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  if (!isAdminAction) {
    const cooldown = 24 * 60 * 60 * 1000;
    const lastReset = user.last_reset || 0;
    const elapsed = Date.now() - lastReset;

    if (elapsed < cooldown) {
      const left = cooldown - elapsed;
      const hoursLeft = Math.ceil(left / (1000 * 60 * 60));
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Reset HWID')
            .setDescription(`❌ Cooldown active. Try again in **${hoursLeft} hour(s)**.`)
            .setColor(0xff0000),
        ],
        ephemeral: true,
      });
    }
  }

  await db.run(
    'UPDATE users SET hwid = NULL, last_reset = ? WHERE discord_id = ?',
    [isAdminAction ? 0 : Date.now(), userId]
  );

  const targetName = targetUserId ? `<@${targetUserId}>` : 'Your';
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Reset HWID')
        .setDescription(`✅ ${targetName} HWID has been reset successfully.`)
        .setColor(0x00c853),
    ],
    ephemeral: true,
  });
}

async function redeemLicenseByKey(interaction, licenseKeyRaw) {
  const licenseKey = licenseKeyRaw.toUpperCase().trim();

  const license = await db.get('SELECT * FROM licenses WHERE key = ?', [licenseKey]);

  if (!license) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Redeem License')
          .setDescription('❌ Invalid license key.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  if (license.redeemed_by) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Redeem License')
          .setDescription('❌ That key has already been redeemed.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  if (license.expires_at < Date.now()) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Redeem License')
          .setDescription('❌ That license key is expired.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  const existingUser = await db.get('SELECT * FROM users WHERE discord_id = ?', [interaction.user.id]);

  if (existingUser && existingUser.license_key) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Redeem License')
          .setDescription('❌ You already have a license linked.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  await db.run(
    'UPDATE licenses SET redeemed_by = ?, redeemed_at = ? WHERE key = ?',
    [interaction.user.id, Date.now(), licenseKey]
  );

  await db.run(
    `INSERT OR REPLACE INTO users (discord_id, license_key, redeemed_at, hwid, last_reset, scripts)
     VALUES (?, ?, ?, COALESCE((SELECT hwid FROM users WHERE discord_id = ?), NULL), COALESCE((SELECT last_reset FROM users WHERE discord_id = ?), 0), COALESCE((SELECT scripts FROM users WHERE discord_id = ?), 0))`,
    [interaction.user.id, licenseKey, Date.now(), interaction.user.id, interaction.user.id, interaction.user.id]
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Redeem License')
        .setDescription(
          `✅ License redeemed successfully.\n\n**Tier:** ${license.tier}\n**Key:** \`${licenseKey}\``
        )
        .setColor(0x00c853),
    ],
    ephemeral: true,
  });
}

async function generateLicense(interaction, tier, days) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Generate Key')
          .setDescription('❌ Admin only.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  if (!days || isNaN(days) || days <= 0) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Generate Key')
          .setDescription('❌ Please provide a valid number of days.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  const normalizedTier = tier ? tier.trim() : 'Premium';
  const key = await generateUniqueLicenseKey();
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;

  await db.run(
    'INSERT INTO licenses (key, tier, expires_at) VALUES (?, ?, ?)',
    [key, normalizedTier, expiresAt]
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('License Generated')
        .setColor(0x00c853)
        .addFields(
          { name: 'Key', value: `\`${key}\``, inline: false },
          { name: 'Tier', value: normalizedTier, inline: true },
          { name: 'Duration', value: `${days} day(s)`, inline: true },
          { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: false }
        ),
    ],
    ephemeral: true,
  });
}

// =========================
//   SCRIPT MANAGEMENT
// =========================
async function createScript(interaction, scriptName, scriptContent, obfuscate = false, host = false) {
  const user = await db.get('SELECT * FROM users WHERE discord_id = ?', [interaction.user.id]);
  
  if (!user || !user.license_key) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Create Script')
          .setDescription('❌ You need an active license to create scripts.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  const scriptCount = user.scripts || 0;
  if (scriptCount >= 25) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Create Script')
          .setDescription('❌ You cannot have more than 25 scripts.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

  let content = scriptContent;
  let obfuscated = 0;
  let hosted = 0;

  if (obfuscate) {
    content = obfuscateScript(scriptContent);
    obfuscated = 1;
  }

  if (host) {
    content = embedScript(content);
    hosted = 1;
  }

  await db.run(`
    INSERT INTO scripts (owner_id, script_name, script_content, created_at, is_obfuscated, is_hosted)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [interaction.user.id, scriptName, content, Date.now(), obfuscated, hosted]);

  await db.run(
    'UPDATE users SET scripts = scripts + 1 WHERE discord_id = ?',
    [interaction.user.id]
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Script Created')
        .setDescription(`✅ Script **${scriptName}** created successfully!`)
        .addFields(
          { name: 'Obfuscated', value: obfuscate ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Hosted', value: host ? '✅ Yes' : '❌ No', inline: true },
          { name: 'Scripts Used', value: `${scriptCount + 1}/25`, inline: true }
        )
        .setColor(0x00c853),
    ],
    ephemeral: true,
  });
}

// =========================
//   BAN MANAGEMENT
// =========================
async function banUser(interaction, userId, reason) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ You don\'t have permission to ban users.',
      ephemeral: true,
    });
  }

  const targetUser = await client.users.fetch(userId).catch(() => null);
  if (!targetUser) {
    return interaction.reply({
      content: '❌ User not found.',
      ephemeral: true,
    });
  }

  const existing = await db.get('SELECT * FROM bans WHERE user_id = ?', [userId]);
  if (existing) {
    return interaction.reply({
      content: '❌ User is already banned.',
      ephemeral: true,
    });
  }

  await db.run(
    'INSERT INTO bans (user_id, reason, banned_at, banned_by) VALUES (?, ?, ?, ?)',
    [userId, reason || 'No reason provided', Date.now(), interaction.user.id]
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('User Banned')
        .setDescription(`✅ **${targetUser.tag}** has been banned.`)
        .addFields(
          { name: 'Reason', value: reason || 'No reason provided', inline: false },
          { name: 'Banned By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor(0xff0000),
    ],
    ephemeral: false,
  });
}

// =========================
//   WEBHOOK MANAGEMENT
// =========================
async function createWebhook(interaction, channel) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ You don\'t have permission to create webhooks.',
      ephemeral: true,
    });
  }

  try {
    const webhook = await channel.createWebhook({
      name: 'License Bot Webhook',
      avatar: client.user.displayAvatarURL(),
    });

    await db.run(
      'INSERT OR REPLACE INTO webhooks (channel_id, webhook_url, created_at) VALUES (?, ?, ?)',
      [channel.id, webhook.url, Date.now()]
    );

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Webhook Created')
          .setDescription(`✅ Webhook created for ${channel.toString()}`)
          .addFields(
            { name: 'Webhook URL', value: `\`${webhook.url}\``, inline: false }
          )
          .setColor(0x00c853),
      ],
      ephemeral: true,
    });
  } catch (error) {
    return interaction.reply({
      content: `❌ Failed to create webhook: ${error.message}`,
      ephemeral: true,
    });
  }
}

// =========================
//   MODALS
// =========================
async function showRedeemModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('redeem_modal')
    .setTitle('Redeem License Key');

  const keyInput = new TextInputBuilder()
    .setCustomId('license_key')
    .setLabel('Enter your license key')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('XXXX-XXXX-XXXX')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
  await interaction.showModal(modal);
}

async function showGenerateModal(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ Admin only.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('generate_modal')
    .setTitle('Generate License Key');

  const tierInput = new TextInputBuilder()
    .setCustomId('tier')
    .setLabel('Tier')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Premium')
    .setRequired(true);

  const daysInput = new TextInputBuilder()
    .setCustomId('days')
    .setLabel('Duration in days')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('30')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(tierInput),
    new ActionRowBuilder().addComponents(daysInput)
  );

  await interaction.showModal(modal);
}

async function showCreateScriptModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('create_script_modal')
    .setTitle('Create Script');

  const nameInput = new TextInputBuilder()
    .setCustomId('script_name')
    .setLabel('Script Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('My Script')
    .setRequired(true);

  const contentInput = new TextInputBuilder()
    .setCustomId('script_content')
    .setLabel('Script Content (loadstring)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('loadstring(game:HttpGet("https://example.com/script.lua"))()')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(contentInput)
  );

  await interaction.showModal(modal);
}

// =========================
//   SLASH COMMANDS
// =========================
const commands = [
  new SlashCommandBuilder()
    .setName('panelsetup')
    .setDescription('Setup the license panel with custom title and description (Admin only)')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Custom title for the panel')
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option
        .setName('description')
        .setDescription('Custom description for the panel (use \\n for new lines)')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('View your license stats'),

  new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reset your HWID')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to reset HWID for (Admin only)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a license key')
    .addStringOption(option =>
      option
        .setName('key')
        .setDescription('Your license key')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('generatekey')
    .setDescription('Generate a new license key (Admin only)')
    .addStringOption(option =>
      option
        .setName('tier')
        .setDescription('License tier')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('Duration in days')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(365)
    ),

  new SlashCommandBuilder()
    .setName('createscript')
    .setDescription('Create a new script')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Script name')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('content')
        .setDescription('Script content (loadstring or code)')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('obfuscate')
        .setDescription('Obfuscate the script')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('host')
        .setDescription('Host the script (Luarmor embed)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate a script (Admin only)')
    .addStringOption(option =>
      option
        .setName('script')
        .setDescription('Script content to obfuscate')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('hostscript')
    .setDescription('Host a script (Admin only)')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('Script URL to host')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Script name')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('create_webhook')
    .setDescription('Create a webhook for a channel (Admin only)')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to create webhook in')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildNews)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user (Admin only)')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Ban reason')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Ask the AI assistant a question')
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Your question')
        .setRequired(true)
        .setMaxLength(500)
    ),
];

// =========================
//   READY
// =========================
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await setupDatabase();
  console.log('Database ready');

  try {
    await client.application.commands.set(commands);
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// =========================
//   BIND HWID
// =========================
async function bindHWID(licenseKey, hwid) {
  const license = await db.get('SELECT * FROM licenses WHERE key = ?', [licenseKey]);

  if (!license || !license.redeemed_by) {
    return { success: false, error: 'Invalid license' };
  }

  const user = await db.get('SELECT * FROM users WHERE discord_id = ?', [license.redeemed_by]);
  const hashed = hashHWID(hwid);

  if (user?.hwid && user.hwid !== hashed) {
    return { success: false, error: 'HWID mismatch. Reset HWID from Discord first.' };
  }

  await db.run(
    'UPDATE users SET hwid = ? WHERE discord_id = ?',
    [hashed, license.redeemed_by]
  );

  return {
    success: true,
    tier: license.tier,
    expiresAt: license.expires_at,
  };
}

// =========================
//   INTERACTIONS
// =========================
client.on('interactionCreate', async interaction => {
  try {
    // Check if user is banned
    if (await isBanned(interaction.user.id)) {
      return interaction.reply({
        content: '❌ You are banned from using this bot.',
        ephemeral: true,
      });
    }

    if (interaction.isChatInputCommand()) {
      // Panel Setup Command
      if (interaction.commandName === 'panelsetup') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: '❌ You don\'t have permission to use this command.',
            ephemeral: true,
          });
        }

        const title = interaction.options.getString('title', true);
        const description = interaction.options.getString('description', true);

        await db.run(
          'UPDATE panel_config SET title = ?, description = ? WHERE id = 1',
          [title, description]
        );

        const config = await getPanelConfig();
        const embed = new EmbedBuilder()
          .setTitle(config.title)
          .setDescription(config.description.replace(/\\n/g, '\n'))
          .setColor(0x5865f2)
          .setFooter({ text: 'License Manager' })
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          components: [createButtons()],
        });
      }

      if (interaction.commandName === 'mystats') {
        return sendMyStats(interaction);
      }

      if (interaction.commandName === 'resethwid') {
        const user = interaction.options.getUser('user');
        return resetHWID(interaction, user?.id);
      }

      if (interaction.commandName === 'redeem') {
        const key = interaction.options.getString('key', true);
        return redeemLicenseByKey(interaction, key);
      }

      if (interaction.commandName === 'generatekey') {
        const tier = interaction.options.getString('tier', true);
        const days = interaction.options.getInteger('days', true);
        return generateLicense(interaction, tier, days);
      }

      if (interaction.commandName === 'createscript') {
        const name = interaction.options.getString('name', true);
        const content = interaction.options.getString('content', true);
        const obfuscate = interaction.options.getBoolean('obfuscate') || false;
        const host = interaction.options.getBoolean('host') || false;
        return createScript(interaction, name, content, obfuscate, host);
      }

      if (interaction.commandName === 'obfuscate') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: '❌ Admin only.',
            ephemeral: true,
          });
        }
        const script = interaction.options.getString('script', true);
        const obfuscated = obfuscateScript(script);
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('Script Obfuscated')
              .setDescription('```lua\n' + obfuscated.slice(0, 1900) + '```')
              .setColor(0x00c853),
          ],
          ephemeral: true,
        });
      }

      if (interaction.commandName === 'hostscript') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: '❌ Admin only.',
            ephemeral: true,
          });
        }
        const url = interaction.options.getString('url', true);
        const name = interaction.options.getString('name', true);
        const hosted = embedScript(`loadstring(game:HttpGet("${url}"))()`);
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`Script Hosted: ${name}`)
              .setDescription('✅ Script hosted successfully!')
              .addFields(
                { name: 'URL', value: `\`${url}\``, inline: false },
                { name: 'Embedded Script', value: '```lua\n' + hosted.slice(0, 1000) + '...\n```', inline: false }
              )
              .setColor(0x00c853),
          ],
          ephemeral: true,
        });
      }

      if (interaction.commandName === 'create_webhook') {
        const channel = interaction.options.getChannel('channel', true);
        return createWebhook(interaction, channel);
      }

      if (interaction.commandName === 'ban') {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason');
        return banUser(interaction, user.id, reason);
      }

      if (interaction.commandName === 'ai') {
        const question = interaction.options.getString('question', true);
        await interaction.deferReply({ ephemeral: true });
        
        const response = await askAI(question, 'Discord bot user asking for help');
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('AI Assistant')
              .setDescription(response)
              .setColor(0x5865f2)
              .setFooter({ text: 'AI Powered' })
              .setTimestamp(),
          ],
        });
      }
    }

    if (interaction.isButton()) {
      switch (interaction.customId) {
        case 'redeem_key':
          return showRedeemModal(interaction);

        case 'my_stats':
          return sendMyStats(interaction);

        case 'reset_hwid':
          return resetHWID(interaction);

        case 'generate_key':
          return showGenerateModal(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'redeem_modal') {
        const key = interaction.fields.getTextInputValue('license_key');
        return redeemLicenseByKey(interaction, key);
      }

      if (interaction.customId === 'generate_modal') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({
            content: '❌ Admin only.',
            ephemeral: true,
          });
        }

        const tier = interaction.fields.getTextInputValue('tier');
        const days = parseInt(interaction.fields.getTextInputValue('days'), 10);
        return generateLicense(interaction, tier, days);
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
