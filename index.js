require('dotenv').config();

const express = require('express');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  db,
  addDays,
  createScript,
  getSettings,
  hashSecret,
  isExpired,
  makeKey,
  upsertSettings,
  verifyAdmin
} = require('./db');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

function panelEmbed() {
  return new EmbedBuilder()
    .setTitle('🔐 License Panel')
    .setDescription('Use the buttons below to manage your script access.')
    .addFields(
      { name: '✅ Redeem Key', value: 'Claim a license key and get the customer role.' },
      { name: '🖥️ Reset HWID', value: 'Clear the device lock on your redeemed key.' },
      { name: '🔑 My Keys', value: 'View your redeemed licenses.' }
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Polsec-like license system' });
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_redeem').setLabel('Redeem Key').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('panel_reset_hwid').setLabel('Reset HWID').setEmoji('🖥️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('panel_mykeys').setLabel('My Keys').setEmoji('🔑').setStyle(ButtonStyle.Secondary)
  );
}

async function logGuild(guild, text) {
  const settings = getSettings(guild.id);
  if (!settings || !settings.log_channel_id) return;

  const channel = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
  if (channel && channel.isTextBased()) {
    await channel.send(text).catch(() => null);
  }
}

function requireAdmin(interaction) {
  const settings = getSettings(interaction.guildId);
  return verifyAdmin(interaction.member, settings);
}

function keyStatus(license) {
  if (!license) return 'Missing';
  if (license.revoked) return 'Revoked';
  if (isExpired(license.expires_at)) return 'Expired';
  if (license.discord_user_id) return 'Redeemed';
  return 'Unused';
}

async function redeemKey({ guild, member, userId, key }) {
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, guild.id);

  if (!license) return { ok: false, message: 'That key does not exist in this server.' };
  if (license.revoked) return { ok: false, message: 'That key has been revoked.' };
  if (isExpired(license.expires_at)) return { ok: false, message: 'That key is expired.' };
  if (license.discord_user_id && license.discord_user_id !== userId) {
    return { ok: false, message: 'That key was already redeemed by someone else.' };
  }

  db.prepare('UPDATE licenses SET discord_user_id = ?, redeemed_at = COALESCE(redeemed_at, CURRENT_TIMESTAMP) WHERE license_key = ?')
    .run(userId, key);

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
  if (!admin && license.discord_user_id !== userId) {
    return { ok: false, message: 'You can only reset HWID for your own redeemed key.' };
  }

  db.prepare('UPDATE licenses SET hwid = NULL WHERE license_key = ?').run(key);
  await logGuild(guild, `🖥️ HWID reset for key \`${key}\` by <@${userId}>.`);

  return { ok: true, message: 'HWID reset successfully.' };
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startApiServer();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    if (interaction.isButton()) await handleButton(interaction);
    if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong. Check your bot console.', ephemeral: true };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

async function handleCommand(interaction) {
  const commandName = interaction.commandName;

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

    const panelMessage = await panelChannel.send({
      embeds: [panelEmbed()],
      components: [panelButtons()]
    });

    upsertSettings(interaction.guildId, { panel_message_id: panelMessage.id });

    await interaction.reply({
      ephemeral: true,
      content: `Setup complete. Panel posted in ${panelChannel}. Admin role: ${adminRole}. Customer role: ${customerRole}.`
    });

    await logGuild(interaction.guild, `⚙️ License panel setup by <@${interaction.user.id}>.`);
    return;
  }

  const adminCommands = ['createscript', 'scripts', 'genkey', 'revoke', 'keyinfo', 'loader'];
  if (adminCommands.includes(commandName) && !requireAdmin(interaction)) {
    await interaction.reply({ ephemeral: true, content: 'You need Administrator or the configured admin role to use this command.' });
    return;
  }

  if (commandName === 'createscript') {
    const name = interaction.options.getString('name', true);
    const script = createScript({ guildId: interaction.guildId, name, createdBy: interaction.user.id });

    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('Script Created')
          .setColor(0x57f287)
          .setDescription('Save the API secret now. It is only shown once.')
          .addFields(
            { name: 'Name', value: script.name, inline: true },
            { name: 'Script ID', value: `\`${script.id}\``, inline: true },
            { name: 'API Secret', value: `\`${script.apiSecret}\`` }
          )
      ]
    });

    await logGuild(interaction.guild, `📦 Script \`${name}\` created by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'scripts') {
    const scripts = db.prepare('SELECT id, name, api_secret_preview FROM scripts WHERE guild_id = ? ORDER BY created_at DESC').all(interaction.guildId);

    if (!scripts.length) {
      await interaction.reply({ ephemeral: true, content: 'No scripts yet. Use `/createscript`.' });
      return;
    }

    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('Scripts')
          .setColor(0x5865f2)
          .setDescription(scripts.map(s => `**${s.name}**\nID: \`${s.id}\`\nSecret: \`${s.api_secret_preview}\``).join('\n\n'))
      ]
    });
    return;
  }

  if (commandName === 'genkey') {
    const scriptId = interaction.options.getString('script_id', true);
    const days = interaction.options.getInteger('days', true);
    const quantity = interaction.options.getInteger('quantity') || 1;

    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND guild_id = ?').get(scriptId, interaction.guildId);
    if (!script) {
      await interaction.reply({ ephemeral: true, content: 'Invalid script ID.' });
      return;
    }

    const expiresAt = addDays(days);
    const insert = db.prepare('INSERT INTO licenses (license_key, script_id, guild_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?)');
    const keys = [];

    for (let i = 0; i < quantity; i++) {
      const key = makeKey('PS');
      insert.run(key, scriptId, interaction.guildId, expiresAt, interaction.user.id);
      keys.push(key);
    }

    await interaction.reply({
      ephemeral: true,
      content: `Generated ${keys.length} key(s) for **${script.name}**:\n\n${keys.map(k => `\`${k}\``).join('\n')}\n\nExpiry: ${expiresAt || 'Lifetime'}`
    });

    await logGuild(interaction.guild, `🔑 ${keys.length} key(s) generated for \`${script.name}\` by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'redeem') {
    const key = interaction.options.getString('key', true).trim();
    const result = await redeemKey({ guild: interaction.guild, member: interaction.member, userId: interaction.user.id, key });
    await interaction.reply({ ephemeral: true, content: result.message });
    return;
  }

  if (commandName === 'reset-hwid') {
    const key = interaction.options.getString('key', true).trim();
    const admin = requireAdmin(interaction);
    const result = await resetHwid({ guild: interaction.guild, userId: interaction.user.id, key, admin });
    await interaction.reply({ ephemeral: true, content: result.message });
    return;
  }

  if (commandName === 'revoke') {
    const key = interaction.options.getString('key', true).trim();
    const info = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND guild_id = ?').get(key, interaction.guildId);

    if (!info) {
      await interaction.reply({ ephemeral: true, content: 'Key not found.' });
      return;
    }

    db.prepare('UPDATE licenses SET revoked = 1 WHERE license_key = ?').run(key);
    await interaction.reply({ ephemeral: true, content: `Revoked \`${key}\`.` });
    await logGuild(interaction.guild, `⛔ Key \`${key}\` revoked by <@${interaction.user.id}>.`);
    return;
  }

  if (commandName === 'keyinfo') {
    const key = interaction.options.getString('key', true).trim();
    const info = db.prepare(`
      SELECT l.*, s.name AS script_name
      FROM licenses l
      JOIN scripts s ON s.id = l.script_id
      WHERE l.license_key = ? AND l.guild_id = ?
    `).get(key, interaction.guildId);

    if (!info) {
      await interaction.reply({ ephemeral: true, content: 'Key not found.' });
      return;
    }

    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('Key Info')
          .setColor(0xfee75c)
          .addFields(
            { name: 'Key', value: `\`${info.license_key}\`` },
            { name: 'Script', value: `${info.script_name} (\`${info.script_id}\`)`, inline: true },
            { name: 'Status', value: keyStatus(info), inline: true },
            { name: 'User', value: info.discord_user_id ? `<@${info.discord_user_id}>` : 'None', inline: true },
            { name: 'HWID', value: info.hwid ? `\`${info.hwid}\`` : 'None', inline: true },
            { name: 'Expires', value: info.expires_at || 'Lifetime', inline: true }
          )
      ]
    });
    return;
  }

  if (commandName === 'mykeys') {
    await sendMyKeys(interaction, interaction.user.id);
    return;
  }

  if (commandName === 'loader') {
    const scriptId = interaction.options.getString('script_id', true);
    const script = db.prepare('SELECT * FROM scripts WHERE id = ? AND guild_id = ?').get(scriptId, interaction.guildId);

    if (!script) {
      await interaction.reply({ ephemeral: true, content: 'Invalid script ID.' });
      return;
    }

    const example = `-- Generic Lua example. Change request/http_request for your executor/environment.\nlocal key = "PASTE_USER_KEY"\nlocal hwid = "PUT_HWID_HERE"\nlocal apiUrl = "http://YOUR_SERVER_IP:${process.env.API_PORT || 3000}/api/verify"\n\nlocal body = '{"script_id":"${scriptId}","key":"' .. key .. '","hwid":"' .. hwid .. '"}'\n\nlocal res = request({\n  Url = apiUrl,\n  Method = "POST",\n  Headers = {\n    ["Content-Type"] = "application/json",\n    ["X-API-Secret"] = "PASTE_SCRIPT_API_SECRET"\n  },\n  Body = body\n})\n\nprint(res.Body)`;

    await interaction.reply({ ephemeral: true, content: `\`\`\`lua\n${example}\n\`\`\`` });
  }
}

async function sendMyKeys(interaction, userId) {
  const rows = db.prepare(`
    SELECT l.*, s.name AS script_name
    FROM licenses l
    JOIN scripts s ON s.id = l.script_id
    WHERE l.guild_id = ? AND l.discord_user_id = ?
    ORDER BY l.redeemed_at DESC
  `).all(interaction.guildId, userId);

  const content = rows.length
    ? rows.map(r => `**${r.script_name}** — \`${r.license_key}\` — ${keyStatus(r)} — expires: ${r.expires_at || 'Lifetime'} — HWID: ${r.hwid ? 'set' : 'not set'}`).join('\n')
    : 'You have no redeemed keys.';

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ephemeral: true, content });
  } else {
    await interaction.reply({ ephemeral: true, content });
  }
}

async function handleButton(interaction) {
  if (interaction.customId === 'panel_redeem') {
    const modal = new ModalBuilder().setCustomId('modal_redeem').setTitle('Redeem License Key');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'panel_reset_hwid') {
    const modal = new ModalBuilder().setCustomId('modal_reset_hwid').setTitle('Reset HWID');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('key').setLabel('License key').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'panel_mykeys') {
    await sendMyKeys(interaction, interaction.user.id);
  }
}

async function handleModal(interaction) {
  const key = interaction.fields.getTextInputValue('key').trim();

  if (interaction.customId === 'modal_redeem') {
    const result = await redeemKey({ guild: interaction.guild, member: interaction.member, userId: interaction.user.id, key });
    await interaction.reply({ ephemeral: true, content: result.message });
    return;
  }

  if (interaction.customId === 'modal_reset_hwid') {
    const result = await resetHwid({ guild: interaction.guild, userId: interaction.user.id, key, admin: false });
    await interaction.reply({ ephemeral: true, content: result.message });
  }
}

function startApiServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/verify', (req, res) => {
    const globalToken = process.env.GLOBAL_API_TOKEN;

    if (globalToken && req.header('X-Global-Token') !== globalToken) {
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

    if (!license.hwid) {
      db.prepare('UPDATE licenses SET hwid = ? WHERE license_key = ?').run(hwid, key);
    }

    return res.json({
      ok: true,
      message: 'License verified',
      discord_user_id: license.discord_user_id,
      expires_at: license.expires_at,
      script_id
    });
  });

  const host = process.env.API_HOST || '0.0.0.0';
  const port = Number(process.env.API_PORT || 3000);

  app.listen(port, host, () => {
    console.log(`Verification API listening on http://${host}:${port}`);
  });
}

client.login(TOKEN);
