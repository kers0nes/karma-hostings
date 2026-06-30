import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { createStore } from './db.js';

const PORT = Number(process.env.PORT || 3000);
const MAX_SCRIPT_BYTES = Number(process.env.MAX_SCRIPT_BYTES || 256_000);
const REQUIRE_HWID = String(process.env.REQUIRE_HWID || 'false').toLowerCase() === 'true';
const ALLOWED_HOST_ROLE_ID = process.env.ALLOWED_HOST_ROLE_ID || '';
const BOT_OWNER_IDS = new Set((process.env.BOT_OWNER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean));

const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const db = createStore();

function publicBaseUrl() {
  const base = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  return base.replace(/\/+$/, '');
}

function randomScriptId() {
  return `scr_${crypto.randomBytes(5).toString('hex')}`;
}

function randomLicenseKey() {
  const hex = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `KEY-${hex.match(/.{1,4}/g).join('-')}`;
}

function escapeLuaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function luaError(message) {
  return `error("${escapeLuaString(message)}")`;
}

function truncate(text, max = 1800) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n...truncated...`;
}

function mask(value) {
  if (!value) return 'none';
  if (value.length <= 10) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function makeLoadstring(scriptId, { key = 'PUT_KEY_HERE', isPublic = false } = {}) {
  const scriptUrl = `${publicBaseUrl()}/s/${encodeURIComponent(scriptId)}`;

  if (isPublic) {
    return [
      `local url = "${escapeLuaString(scriptUrl)}"`,
      'loadstring(http_get(url))()',
    ].join('\n');
  }

  return [
    `local key = "${escapeLuaString(key)}"`,
    'local hwid = "PUT_DEVICE_ID_HERE"',
    `local url = "${escapeLuaString(scriptUrl)}?key=" .. key .. "&hwid=" .. hwid`,
    'loadstring(http_get(url))()',
  ].join('\n');
}

function isExpired(license) {
  return license.expires_at && new Date(license.expires_at).getTime() <= Date.now();
}

function hasHostPermission(interaction) {
  if (BOT_OWNER_IDS.has(interaction.user.id)) return true;
  if (!ALLOWED_HOST_ROLE_ID) return true;

  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(ALLOWED_HOST_ROLE_ID);
  return roles.cache?.has(ALLOWED_HOST_ROLE_ID) || false;
}

async function requireHostPermission(interaction) {
  if (hasHostPermission(interaction)) return true;
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `You do not have permission to host/manage scripts. Required role: \`${ALLOWED_HOST_ROLE_ID}\`.`,
  });
  return false;
}

async function readScriptFromInteraction(interaction) {
  const code = interaction.options.getString('code');
  const file = interaction.options.getAttachment('file');

  if (!code && !file) {
    throw new Error('Provide either the `code` option or a `.lua`/`.txt` file attachment.');
  }

  if (code && Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) {
    throw new Error(`Script is too large. Max size is ${MAX_SCRIPT_BYTES} bytes.`);
  }

  if (code) return code;

  if (file.size > MAX_SCRIPT_BYTES) {
    throw new Error(`File is too large. Max size is ${MAX_SCRIPT_BYTES} bytes.`);
  }

  const allowedExtensions = ['.lua', '.txt'];
  const lowerName = file.name.toLowerCase();
  if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
    throw new Error('Only `.lua` or `.txt` attachments are accepted.');
  }

  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Could not download attachment: HTTP ${response.status}`);

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_SCRIPT_BYTES) {
    throw new Error(`File is too large after download. Max size is ${MAX_SCRIPT_BYTES} bytes.`);
  }
  return text;
}

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('hostscript')
      .setDescription('Host an authorized Lua script and get a Render loadstring.')
      .addStringOption((option) => option
        .setName('name')
        .setDescription('Friendly script name')
        .setRequired(true)
        .setMaxLength(80))
      .addStringOption((option) => option
        .setName('code')
        .setDescription('Lua code for small scripts. Use file for bigger scripts.')
        .setRequired(false)
        .setMaxLength(4000))
      .addAttachmentOption((option) => option
        .setName('file')
        .setDescription('A .lua or .txt file')
        .setRequired(false))
      .addBooleanOption((option) => option
        .setName('public')
        .setDescription('If true, no license key is required')
        .setRequired(false)),

    new SlashCommandBuilder()
      .setName('listscripts')
      .setDescription('List scripts you own.'),

    new SlashCommandBuilder()
      .setName('scriptinfo')
      .setDescription('Show info and loadstring for one of your scripts.')
      .addStringOption((option) => option
        .setName('script_id')
        .setDescription('Script ID from /hostscript')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('deletescript')
      .setDescription('Delete one of your hosted scripts and its keys.')
      .addStringOption((option) => option
        .setName('script_id')
        .setDescription('Script ID from /hostscript')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('genkey')
      .setDescription('Generate license key(s) for one of your scripts.')
      .addStringOption((option) => option
        .setName('script_id')
        .setDescription('Script ID from /hostscript')
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('count')
        .setDescription('How many keys to create, 1-25')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25))
      .addIntegerOption((option) => option
        .setName('duration_days')
        .setDescription('Days until expiry. Omit for lifetime.')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(3650))
      .addIntegerOption((option) => option
        .setName('max_uses')
        .setDescription('Max successful fetches. Omit for unlimited.')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(1_000_000)),

    new SlashCommandBuilder()
      .setName('listkeys')
      .setDescription('List recent keys for one of your scripts.')
      .addStringOption((option) => option
        .setName('script_id')
        .setDescription('Script ID from /hostscript')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('deletekey')
      .setDescription('Delete/revoke a license key you created.')
      .addStringOption((option) => option
        .setName('key')
        .setDescription('License key')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('reset-hwid')
      .setDescription('Clear the saved HWID on a license key you created.')
      .addStringOption((option) => option
        .setName('key')
        .setDescription('License key')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('redeem')
      .setDescription('Redeem a license key to your Discord account and get the loadstring.')
      .addStringOption((option) => option
        .setName('key')
        .setDescription('License key')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('hosthelp')
      .setDescription('Show bot usage help.'),
  ].map((command) => command.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = buildCommands();

  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log(`Registered ${commands.length} guild slash commands.`);
  } else {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`Registered ${commands.length} global slash commands. Global updates can take a while to appear.`);
  }
}

async function validateAccess(script, key, hwid) {
  if (script.is_public) return { ok: true, license: null };

  if (!key) return { ok: false, status: 401, reason: 'Missing license key' };
  const license = await db.getLicenseKey(key);
  if (!license || license.script_id !== script.id) return { ok: false, status: 403, reason: 'Invalid license key' };
  if (!license.active) return { ok: false, status: 403, reason: 'License key is inactive' };
  if (isExpired(license)) return { ok: false, status: 403, reason: 'License key has expired' };
  if (license.max_uses !== null && license.max_uses !== undefined && license.uses >= license.max_uses) {
    return { ok: false, status: 403, reason: 'License key use limit reached' };
  }

  if (REQUIRE_HWID && !hwid) return { ok: false, status: 403, reason: 'Missing HWID' };
  if (license.hwid && hwid && license.hwid !== hwid) return { ok: false, status: 403, reason: 'HWID mismatch' };
  if (license.hwid && REQUIRE_HWID && !hwid) return { ok: false, status: 403, reason: 'Missing HWID' };

  return { ok: true, license };
}

function sendLuaError(res, status, message) {
  res.status(status)
    .type('text/plain; charset=utf-8')
    .set('Cache-Control', 'no-store')
    .send(luaError(message));
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'hosthelp') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: [
          '**Lua Host Bot commands**',
          '`/hostscript name code|file public:false` - host a script and get a loadstring.',
          '`/genkey script_id count duration_days max_uses` - create license keys.',
          '`/redeem key` - bind a key to your Discord account and get the loadstring.',
          '`/reset-hwid key` - clear a key HWID if a buyer changes device.',
          '`/listscripts`, `/scriptinfo`, `/listkeys`, `/deletekey`, `/deletescript` - manage your stuff.',
          '',
          `Public base URL: \`${publicBaseUrl()}\``,
          'Note: replace `http_get` in the generated Lua snippet with the HTTP GET function for your authorized Lua runtime.',
        ].join('\n'),
      });
      return;
    }

    if (interaction.commandName === 'hostscript') {
      if (!(await requireHostPermission(interaction))) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name', true).trim();
      const content = await readScriptFromInteraction(interaction);
      const isPublic = interaction.options.getBoolean('public') || false;
      const script = await db.createScript({
        id: randomScriptId(),
        owner_id: interaction.user.id,
        guild_id: interaction.guildId,
        name,
        content,
        is_public: isPublic,
      });

      const snippet = makeLoadstring(script.id, { isPublic: script.is_public });
      await interaction.editReply({
        content: truncate([
          '✅ **Script hosted.**',
          `Name: \`${script.name}\``,
          `ID: \`${script.id}\``,
          `Protected: \`${script.is_public ? 'no/public' : 'yes/key required'}\``,
          `Raw URL: \`${publicBaseUrl()}/s/${script.id}\``,
          '',
          '**Loadstring:**',
          '```lua',
          snippet,
          '```',
          script.is_public ? '' : `Create keys with: \`/genkey script_id:${script.id}\``,
        ].filter(Boolean).join('\n')),
      });
      return;
    }

    if (interaction.commandName === 'listscripts') {
      const scripts = await db.listScripts(interaction.user.id);
      if (!scripts.length) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have any hosted scripts yet. Use `/hostscript`.' });
        return;
      }
      const lines = scripts.map((script) => `• \`${script.id}\` — **${script.name}** — ${script.is_public ? 'public' : 'keyed'} — ${script.content_bytes ?? '?'} bytes`);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: truncate(lines.join('\n')) });
      return;
    }

    if (interaction.commandName === 'scriptinfo') {
      const scriptId = interaction.options.getString('script_id', true);
      const script = await db.getScript(scriptId);
      if (!script || script.owner_id !== interaction.user.id) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Script not found, or you do not own it.' });
        return;
      }
      const snippet = makeLoadstring(script.id, { isPublic: script.is_public });
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: truncate([
          `**${script.name}**`,
          `ID: \`${script.id}\``,
          `Protected: \`${script.is_public ? 'no/public' : 'yes/key required'}\``,
          `Created: \`${script.created_at}\``,
          `Raw URL: \`${publicBaseUrl()}/s/${script.id}\``,
          '',
          '```lua',
          snippet,
          '```',
        ].join('\n')),
      });
      return;
    }

    if (interaction.commandName === 'deletescript') {
      if (!(await requireHostPermission(interaction))) return;
      const scriptId = interaction.options.getString('script_id', true);
      const ok = await db.deleteScript(scriptId, interaction.user.id);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: ok ? `Deleted \`${scriptId}\`.` : 'Script not found, or you do not own it.' });
      return;
    }

    if (interaction.commandName === 'genkey') {
      if (!(await requireHostPermission(interaction))) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const scriptId = interaction.options.getString('script_id', true);
      const script = await db.getScript(scriptId);
      if (!script || script.owner_id !== interaction.user.id) {
        await interaction.editReply('Script not found, or you do not own it.');
        return;
      }

      const count = interaction.options.getInteger('count') || 1;
      const durationDays = interaction.options.getInteger('duration_days');
      const maxUses = interaction.options.getInteger('max_uses');
      const expiresAt = durationDays ? new Date(Date.now() + durationDays * 86_400_000).toISOString() : null;

      const created = [];
      for (let index = 0; index < count; index += 1) {
        created.push(await db.createLicenseKey({
          key: randomLicenseKey(),
          script_id: script.id,
          owner_id: interaction.user.id,
          expires_at: expiresAt,
          max_uses: maxUses,
        }));
      }

      const lines = created.map((license) => `\`${license.key}\``);
      await interaction.editReply({
        content: truncate([
          `✅ Created ${created.length} key(s) for **${script.name}**.`,
          expiresAt ? `Expires: \`${expiresAt}\`` : 'Expires: `lifetime`',
          maxUses ? `Max uses: \`${maxUses}\`` : 'Max uses: `unlimited`',
          '',
          ...lines,
          '',
          '**Loadstring using first key:**',
          '```lua',
          makeLoadstring(script.id, { key: created[0].key, isPublic: false }),
          '```',
        ].join('\n')),
      });
      return;
    }

    if (interaction.commandName === 'listkeys') {
      const scriptId = interaction.options.getString('script_id', true);
      const script = await db.getScript(scriptId);
      if (!script || script.owner_id !== interaction.user.id) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Script not found, or you do not own it.' });
        return;
      }
      const keys = await db.listLicenseKeys(scriptId, interaction.user.id);
      if (!keys.length) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No keys created for that script yet.' });
        return;
      }
      const lines = keys.map((license) => {
        const expiry = license.expires_at ? new Date(license.expires_at).toISOString().slice(0, 10) : 'lifetime';
        const hwid = license.hwid ? mask(license.hwid) : 'unbound';
        return `• \`${license.key}\` — uses ${license.uses}/${license.max_uses ?? '∞'} — expires ${expiry} — hwid ${hwid}`;
      });
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: truncate(lines.join('\n')) });
      return;
    }

    if (interaction.commandName === 'deletekey') {
      if (!(await requireHostPermission(interaction))) return;
      const key = interaction.options.getString('key', true);
      const ok = await db.deleteLicenseKey(key, interaction.user.id);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: ok ? 'Key deleted.' : 'Key not found, or you do not own it.' });
      return;
    }

    if (interaction.commandName === 'reset-hwid') {
      if (!(await requireHostPermission(interaction))) return;
      const key = interaction.options.getString('key', true);
      const license = await db.resetHwid(key, interaction.user.id);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: license ? `HWID reset for \`${key}\`.` : 'Key not found, or you do not own it.' });
      return;
    }

    if (interaction.commandName === 'redeem') {
      const key = interaction.options.getString('key', true);
      const license = await db.redeemLicenseKey(key, interaction.user.id);
      if (!license) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Invalid key.' });
        return;
      }
      if (license.redeem_denied) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That key has already been redeemed by another Discord account.' });
        return;
      }
      if (isExpired(license)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That key is expired.' });
        return;
      }
      const script = await db.getScript(license.script_id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: truncate([
          `✅ Redeemed key for **${script?.name || license.script_id}**.`,
          '```lua',
          makeLoadstring(license.script_id, { key: license.key, isPublic: false }),
          '```',
        ].join('\n')),
      });
      return;
    }
  } catch (error) {
    console.error(error);
    const content = `Error: ${error.message || 'Something went wrong.'}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: truncate(content) });
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: truncate(content) });
    }
  }
}

async function main() {
  await db.init();

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  app.get('/', (req, res) => {
    res.type('text/plain').send([
      'Lua Host Bot is running.',
      `Base URL: ${publicBaseUrl()}`,
      'Health: /healthz',
      'Raw scripts: /s/:script_id',
      'Loadstring helper: /loadstring/:script_id',
    ].join('\n'));
  });

  app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.get('/loadstring/:id', async (req, res) => {
    const script = await db.getScript(req.params.id);
    if (!script) {
      res.status(404).type('text/plain').send('Script not found');
      return;
    }
    const key = typeof req.query.key === 'string' ? req.query.key : 'PUT_KEY_HERE';
    res.type('text/plain; charset=utf-8').send(makeLoadstring(script.id, { key, isPublic: script.is_public }));
  });

  app.get('/s/:id', async (req, res) => {
    const script = await db.getScript(req.params.id);
    if (!script) {
      sendLuaError(res, 404, 'Script not found');
      return;
    }

    const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
    const hwid = typeof req.query.hwid === 'string' ? req.query.hwid.trim() : '';
    const access = await validateAccess(script, key, hwid);

    if (!access.ok) {
      sendLuaError(res, access.status, access.reason);
      return;
    }

    if (access.license) {
      await db.recordSuccessfulExecution(access.license.key, hwid);
    }

    res.status(200)
      .type('text/plain; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .send(script.content);
  });

  app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
  });

  await registerCommands();

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
  });
  client.on('interactionCreate', handleInteraction);
  await client.login(process.env.DISCORD_TOKEN);
}

process.on('SIGINT', async () => {
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await db.close();
  process.exit(0);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
