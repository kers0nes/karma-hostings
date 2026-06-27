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
} = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const crypto = require('crypto');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

let db;

/* =========================
   DATABASE
========================= */
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
      last_reset INTEGER DEFAULT 0
    )
  `);

  // Make sure last_reset exists for older DBs
  try {
    await db.exec(`ALTER TABLE users ADD COLUMN last_reset INTEGER DEFAULT 0`);
  } catch (_) {}
}

/* =========================
   HELPERS
========================= */
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
  let key;
  let exists = true;

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

/* =========================
   CORE ACTIONS
========================= */
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
  const maskedKey =
    `${license.key.slice(0, 4)}-****-${license.key.slice(-4)}`;

  const embed = new EmbedBuilder()
    .setTitle('Your License Stats')
    .setColor(active ? 0x00c853 : 0xff5252)
    .addFields(
      { name: 'Status', value: active ? '✅ Active' : '❌ Expired', inline: true },
      { name: 'Tier', value: license.tier, inline: true },
      { name: 'Expires In', value: formatDuration(remaining), inline: true },
      { name: 'HWID', value: user.hwid ? '✅ Bound' : '❌ Not bound', inline: true },
      { name: 'Key', value: maskedKey, inline: false }
    )
    .setFooter({ text: 'Only you can see this' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function resetHWID(interaction) {
  const user = await db.get('SELECT * FROM users WHERE discord_id = ?', [interaction.user.id]);

  if (!user || !user.license_key) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Reset HWID')
          .setDescription('❌ You need an active license first.')
          .setColor(0xff0000),
      ],
      ephemeral: true,
    });
  }

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

  await db.run(
    'UPDATE users SET hwid = NULL, last_reset = ? WHERE discord_id = ?',
    [Date.now(), interaction.user.id]
  );

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Reset HWID')
        .setDescription('✅ Your HWID has been reset successfully.')
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
    `INSERT OR REPLACE INTO users (discord_id, license_key, redeemed_at, hwid, last_reset)
     VALUES (?, ?, ?, COALESCE((SELECT hwid FROM users WHERE discord_id = ?), NULL), COALESCE((SELECT last_reset FROM users WHERE discord_id = ?), 0))`,
    [interaction.user.id, licenseKey, Date.now(), interaction.user.id, interaction.user.id]
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

/* =========================
   MODALS
========================= */
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

/* =========================
   SLASH COMMANDS
========================= */
const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the license panel'),

  new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('View your license stats'),

  new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reset your HWID'),

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
    ),
];

/* =========================
   READY
========================= */
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

/* =========================
   BIND HWID
========================= */
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

/* =========================
   INTERACTIONS
========================= */
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'panel') {
        return interaction.reply({
          embeds: [createLicensePanel()],
          components: [createButtons()],
        });
      }

      if (interaction.commandName === 'mystats') {
        return sendMyStats(interaction);
      }

      if (interaction.commandName === 'resethwid') {
        return resetHWID(interaction);
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
