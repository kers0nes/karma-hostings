// ═══════════════════════════════════════════════════════════════════════════════
//  KARMA HOSTING BOT — server.js
//  Discord.js v14 · Prisma · SQLite
// ═══════════════════════════════════════════════════════════════════════════════

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  PresenceUpdateStatus,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { PrismaClient } = require("@prisma/client");

// ─── Configuration ────────────────────────────────────────────────────────────
const PREFIX       = "/";
const BRAND_COLOR  = 0xD4AF37;
const COOLDOWN_MS  = 24 * 60 * 60 * 1000;
const TOKEN        = "YOUR_BOT_TOKEN_HERE";
const OWNER_ID     = "YOUR_DISCORD_ID_HERE";
const BASE_URL     = "https://karma-hosting.space-z.ai";
const DB_PATH      = "file:./db/custom.db";

const prisma = new PrismaClient({ datasourceUrl: DB_PATH });
const bannedHwids = new Set();

// ─── Helper Functions ─────────────────────────────────────────────────────────

function maskKey(key) {
  return "KARMA-****-****-" + key.slice(-4).toUpperCase();
}

function timeRemaining(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return h + "h " + m + "m";
  return m + "m " + Math.floor((ms % 60000) / 1000) + "s";
}

function formatExpiry(d) {
  if (!d) return "Permanent";
  if (d.getTime() < Date.now()) return "Expired";
  return "<t:" + Math.floor(d.getTime() / 1000) + ":R>";
}

function embed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setFooter({ text: "Karma Hosting" })
    .setTimestamp();
}

function ok(title, desc) {
  return embed().setTitle("\u2705 " + title).setDescription(desc).setColor(0x22c55e);
}

function err(title, desc) {
  return embed().setTitle("\u274c " + title).setDescription(desc).setColor(0xef4444);
}

function generateKey() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let r = "KARMA-";
  for (let i = 0; i < 4; i++) {
    if (i > 0) r += "-";
    for (let j = 0; j < 4; j++) {
      r += c.charAt(Math.floor(Math.random() * c.length));
    }
  }
  return r;
}

async function resolveUser(discordId) {
  return prisma.user.findFirst({ where: { discordId } });
}

async function findScript(userId, q) {
  return prisma.script.findFirst({
    where: {
      userId,
      OR: [{ id: q }, { name: { equals: q, mode: "insensitive" } }],
    },
  });
}

async function safeSend(msg, content) {
  try {
    await msg.reply(content);
  } catch {
    try {
      await msg.channel.send(content);
    } catch {}
  }
}

async function safeDm(msg, content) {
  try {
    await msg.author.send(content);
    return true;
  } catch {
    return false;
  }
}

function epErr(title, desc) {
  return { embeds: [err(title, desc)], ephemeral: true };
}

function epOk(title, desc) {
  return { embeds: [ok(title, desc)], ephemeral: true };
}

function epEmbed(e) {
  return { embeds: [e], ephemeral: true };
}

// ─── Button Handler ───────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const customId = interaction.customId;
  if (customId.length < 3 || customId[0] !== "p") return;

  const action = customId[1];
  const scriptId = customId.substring(3);

  try {
    switch (action) {
      case "v": {
        await interaction.deferReply({ ephemeral: true });
        const script = await prisma.script.findUnique({
          where: { id: scriptId },
          include: { _count: { select: { keys: true } } },
        });
        if (!script) {
          await interaction.editReply(epErr("Not Found", "Script not found."));
          return;
        }
        const e = embed()
          .setTitle(script.name)
          .addFields(
            { name: "Version", value: String(script.version || "1.0.0"), inline: true },
            { name: "Status", value: script.status, inline: true },
            { name: "Keys", value: String(script._count.keys), inline: true },
            { name: "Created", value: "<t:" + Math.floor(script.createdAt.getTime() / 1000) + ":R>", inline: true },
            { name: "ID", value: script.id, inline: true }
          );
        await interaction.editReply(epEmbed(e));
        break;
      }

      case "r": {
        const modal = new ModalBuilder()
          .setCustomId("rm_" + scriptId)
          .setTitle("Redeem Key");
        const input = new TextInputBuilder()
          .setCustomId("key_input")
          .setLabel("Enter your license key")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        break;
      }

      case "i": {
        await interaction.deferReply({ ephemeral: true });
        const user = await resolveUser(interaction.user.id);
        if (!user) {
          await interaction.editReply(epErr("Not Registered", "Use /setup first."));
          return;
        }
        const keys = await prisma.key.findMany({
          where: { scriptId, userId: user.id },
          orderBy: { createdAt: "desc" },
        });
        if (!keys.length) {
          await interaction.editReply(epEmbed(embed().setTitle("Key Info").setDescription("No keys found for this script.")));
          return;
        }
        const lines = keys.map(function (k) {
          const isExpired = k.expiresAt && k.expiresAt.getTime() < Date.now();
          const status = isExpired ? "Expired" : "Active";
          const expiry = formatExpiry(k.expiresAt);
          const hwid = k.hwid ? k.hwid.slice(0, 12) + "..." : "None";
          const note = k.note ? " | Note: " + k.note : "";
          return status + " | " + maskKey(k.key) + " | HWID: " + hwid + " | " + expiry + note;
        });
        await interaction.editReply(epEmbed(embed().setTitle("Key Info").setDescription(lines.join("\n"))));
        break;
      }

      case "l": {
        await interaction.deferReply({ ephemeral: true });
        const user = await resolveUser(interaction.user.id);
        if (!user) {
          await interaction.editReply(epErr("Not Registered", "Use /setup first."));
          return;
        }
        const keyRecord = await prisma.key.findFirst({
          where: { scriptId, userId: user.id },
          orderBy: { createdAt: "desc" },
        });
        if (!keyRecord) {
          await interaction.editReply(epErr("No Key", "No active key found for this script."));
          return;
        }
        const loadstring = 'loadstring(game:HttpGet("' + BASE_URL + "/api/loader?scriptId=" + scriptId + "&key=" + keyRecord.key + '"))()';
        await interaction.editReply(epEmbed(embed().setTitle("Get Loader").setDescription(loadstring)));
        break;
      }

      case "h": {
        const modal = new ModalBuilder()
          .setCustomId("hm_" + scriptId)
          .setTitle("Reset HWID");
        const input = new TextInputBuilder()
          .setCustomId("key_input")
          .setLabel("Enter your key")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        break;
      }
    }
  } catch (e) {
    console.error("[" + new Date().toISOString() + "] Button error:", e.message || e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(epErr("Error", "Something went wrong."));
      } else {
        await interaction.reply(epErr("Error", "Something went wrong."));
      }
    } catch {}
  }
}

// ─── Modal Handler ────────────────────────────────────────────────────────────

async function handleModal(interaction) {
  const customId = interaction.customId;

  try {
    if (customId.startsWith("rm_")) {
      const scriptId = customId.substring(3);
      const user = await resolveUser(interaction.user.id);
      if (!user) {
        await interaction.reply(epErr("Not Registered", "Use /setup first."));
        return;
      }
      const keyVal = interaction.fields.getTextInputValue("key_input").toUpperCase();
      const keyRecord = await prisma.key.findFirst({
        where: {
          scriptId,
          userId: user.id,
          OR: [
            { key: { equals: keyVal, mode: "insensitive" } },
            { key: { endsWith: keyVal.replace("KARMA-", "") } },
          ],
        },
        include: { script: true },
      });
      if (!keyRecord) {
        await interaction.reply(epErr("Invalid Key", "That key does not exist or is not for this script."));
        return;
      }
      if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() < Date.now()) {
        await interaction.reply(epErr("Expired", "That key has expired."));
        return;
      }
      await prisma.key.update({ where: { id: keyRecord.id }, data: { lastUsedAt: new Date() } });
      await interaction.reply(epOk("Key Redeemed", "Key for " + keyRecord.script.name + " is valid and has been activated."));
    } else if (customId.startsWith("hm_")) {
      const scriptId = customId.substring(3);
      const user = await resolveUser(interaction.user.id);
      if (!user) {
        await interaction.reply(epErr("Not Registered", "Use /setup first."));
        return;
      }
      const keyVal = interaction.fields.getTextInputValue("key_input").toUpperCase();
      const keyRecord = await prisma.key.findFirst({
        where: {
          scriptId,
          userId: user.id,
          OR: [
            { key: { equals: keyVal, mode: "insensitive" } },
            { key: { endsWith: keyVal.replace("KARMA-", "") } },
          ],
        },
        include: { script: true },
      });
      if (!keyRecord) {
        await interaction.reply(epErr("Not Found", "No key matching that input."));
        return;
      }
      if (keyRecord.resettable) {
        const elapsed = Date.now() - keyRecord.resettable.getTime();
        if (elapsed < COOLDOWN_MS) {
          await interaction.reply(epErr("Cooldown", "HWID reset on cooldown. Try again in " + timeRemaining(COOLDOWN_MS - elapsed) + "."));
          return;
        }
      }
      await prisma.key.update({ where: { id: keyRecord.id }, data: { hwid: null, resettable: new Date() } });
      await interaction.reply(epOk("HWID Reset", "HWID for " + maskKey(keyRecord.key) + " on " + keyRecord.script.name + " has been cleared."));
    }
  } catch (e) {
    console.error("[" + new Date().toISOString() + "] Modal error:", e.message || e);
    try {
      await interaction.reply(epErr("Error", "Something went wrong. Try again."));
    } catch {}
  }
}

// ─── Bot Setup ────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
  presence: {
    status: PresenceUpdateStatus.Online,
    activities: [{ name: "/help | Karma Hosting", type: ActivityType.Watching }],
  },
});

client.on("ready", function () {
  console.log(
    "[" + new Date().toISOString() + "] Karma Bot online as " +
    client.user.tag + " | Prefix: " + PREFIX + " | Commands: 13"
  );
});

// ─── Message Commands ─────────────────────────────────────────────────────────

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const args = parts;

  try {
    switch (cmd) {

      /* /panelsetup <script> */
      case "panelsetup": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const scriptName = args.join(" ");
        if (!scriptName) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /panelsetup <script name>")] });
          return;
        }
        const script = await findScript(user.id, scriptName);
        if (!script) {
          await safeSend(msg, { embeds: [err("Not Found", "No script found matching that name.")] });
          return;
        }
        const panelEmbed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle(script.name)
          .setDescription("Use the buttons below to manage your key.")
          .setFooter({ text: "Karma Hosting | v1" })
          .setTimestamp();
        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("pv_" + script.id).setLabel("View Script").setStyle(ButtonStyle.Primary).setEmoji("\uD83D\uDCC4"),
          new ButtonBuilder().setCustomId("pr_" + script.id).setLabel("Redeem Key").setStyle(ButtonStyle.Success).setEmoji("\uD83D\uDD11")
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("pi_" + script.id).setLabel("Key Info").setStyle(ButtonStyle.Secondary).setEmoji("\uD83D\uDCCA"),
          new ButtonBuilder().setCustomId("pl_" + script.id).setLabel("Get Loader").setStyle(ButtonStyle.Secondary).setEmoji("\uD83D\uDD17")
        );
        const row3 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ph_" + script.id).setLabel("Reset HWID").setStyle(ButtonStyle.Danger).setEmoji("\u2699\uFE0F")
        );
        await msg.reply({ embeds: [panelEmbed], components: [row1, row2, row3] });
        break;
      }

      /* /setup */
      case "setup": {
        let user = await resolveUser(msg.author.id);
        const isNew = !user;
        if (!user) {
          user = await prisma.user.create({
            data: {
              discordId: msg.author.id,
              username: msg.author.username,
              avatar: msg.author.displayAvatarURL() || null,
              accessToken: "setup",
              provider: "discord",
            },
          });
        }
        const scriptCount = await prisma.script.count({ where: { userId: user.id } });
        const keyCount = await prisma.key.count({ where: { userId: user.id } });
        const info = (isNew ? "Account created!" : "Welcome back!") + "\n\n" + "Scripts: " + scriptCount + "\n" + "Keys: " + keyCount;
        await safeSend(msg, { embeds: [ok("Karma Hosting - Setup", info)] });
        break;
      }

      /* /help */
      case "help": {
        const helpText =
          "**Commands**\n" +
          "/setup - Create account or view info\n" +
          "/panelsetup <script> - Spawn panel for a script\n" +
          "/scripts - List your scripts\n" +
          "/keys <script> - List keys for a script\n" +
          "/createkey <script> [note] [hours] - Generate a key\n" +
          "/generate <id> <hours> [note] - Generate by script ID\n" +
          "/revoke <key> - Revoke a key\n" +
          "/reset-hwid <key> - Reset HWID (24h cooldown)\n" +
          "/ban <hwid> - Ban a HWID (owner only)\n" +
          "/unban <hwid> - Unban a HWID (owner only)";
        const helpEmbed = embed().setTitle("Karma Hosting - Commands").setDescription(helpText);
        const dmSent = await safeDm(msg, { embeds: [helpEmbed] });
        if (dmSent) {
          await safeSend(msg, { embeds: [ok("Help Sent", "Check your DMs.")] });
        } else {
          await safeSend(msg, { embeds: [helpEmbed] });
        }
        break;
      }

      /* /scripts */
      case "scripts": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const scripts = await prisma.script.findMany({
          where: { userId: user.id },
          include: { _count: { select: { keys: true } } },
          orderBy: { createdAt: "desc" },
        });
        if (!scripts.length) {
          await safeSend(msg, { embeds: [embed().setTitle("Your Scripts (0)").setDescription("No scripts found.")] });
          return;
        }
        const lines = scripts.map(function (s, idx) {
          const status = s.status === "active" ? "Active" : "Inactive";
          return (idx + 1) + ". " + s.name + " - v" + s.version + " - " + s._count.keys + " keys - " + status + " - ID: " + s.id;
        });
        await safeSend(msg, { embeds: [embed().setTitle("Your Scripts (" + scripts.length + ")").setDescription(lines.join("\n"))] });
        break;
      }

      /* /keys <script> */
      case "keys": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const scriptName = args.join(" ");
        if (!scriptName) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /keys <script name>")] });
          return;
        }
        const script = await findScript(user.id, scriptName);
        if (!script) {
          await safeSend(msg, { embeds: [err("Not Found", "No script found matching that name.")] });
          return;
        }
        const keys = await prisma.key.findMany({
          where: { scriptId: script.id, userId: user.id },
          orderBy: { createdAt: "desc" },
        });
        if (!keys.length) {
          await safeSend(msg, { embeds: [embed().setTitle("Keys: " + script.name + " (0)").setDescription("No keys found. Use /createkey.")] });
          return;
        }
        const lines = keys.map(function (k) {
          const isExpired = k.expiresAt && k.expiresAt.getTime() < Date.now();
          const note = k.note ? " - " + k.note : "";
          const expiry = formatExpiry(k.expiresAt);
          return (isExpired ? "Expired" : "Active") + " | " + maskKey(k.key) + note + " | " + expiry;
        });
        await safeSend(msg, { embeds: [embed().setTitle("Keys: " + script.name + " (" + keys.length + ")").setDescription(lines.join("\n"))] });
        break;
      }

      /* /createkey <script> [note] [hours] */
      case "createkey": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const scriptName = args[0] || "";
        if (!scriptName) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /createkey <script> [note] [hours]")] });
          return;
        }
        let note = null;
        let hours = null;
        if (args.length >= 2) {
          const lastArg = args[args.length - 1];
          const parsed = parseInt(lastArg);
          if (!isNaN(parsed) && String(parsed) === lastArg) {
            hours = parsed;
            if (args.length > 2) note = args.slice(1, -1).join(" ");
          } else {
            note = args.slice(1).join(" ");
          }
        }
        const script = await findScript(user.id, scriptName);
        if (!script) {
          await safeSend(msg, { embeds: [err("Not Found", "No script found matching that name.")] });
          return;
        }
        const expiresAt = hours ? new Date(Date.now() + hours * 3600000) : null;
        const kv = generateKey();
        await prisma.key.create({
          data: { scriptId: script.id, userId: user.id, key: kv, note, expiresAt },
        });
        const keyEmbed = embed().setTitle("Key Generated").setColor(0x22c55e).setDescription(
          "Script: " + script.name + "\nKey: " + kv +
          (note ? "\nNote: " + note : "") +
          (expiresAt ? "\nExpires: " + formatExpiry(expiresAt) : "\nDuration: Permanent")
        );
        const dmSent = await safeDm(msg, { embeds: [keyEmbed] });
        if (dmSent) {
          await safeSend(msg, { embeds: [ok("Key Created", "Key for " + script.name + " sent to your DMs.")] });
        } else {
          await safeSend(msg, { embeds: [ok("Key Created", "Key for " + script.name + " (DMs off):\n" + kv)] });
        }
        break;
      }

      /* /generate <id> <hours> [note] */
      case "generate": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const id = args[0] || "";
        const hoursVal = args[1] ? parseInt(args[1]) : NaN;
        const note = args.length > 2 ? args.slice(2).join(" ") : null;
        if (!id || isNaN(hoursVal)) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /generate <id> <hours> [note]")] });
          return;
        }
        const script = await prisma.script.findFirst({ where: { id: id, userId: user.id } });
        if (!script) {
          await safeSend(msg, { embeds: [err("Not Found", "No script with ID: " + id)] });
          return;
        }
        const expiresAt = hoursVal === 0 ? null : new Date(Date.now() + hoursVal * 3600000);
        const info = hoursVal === 0 ? "Permanent" : hoursVal + "h";
        const kv = generateKey();
        await prisma.key.create({
          data: { scriptId: script.id, userId: user.id, key: kv, note, expiresAt },
        });
        const keyEmbed = embed().setTitle("Key Generated").setColor(0x22c55e).setDescription(
          "Script: " + script.name + "\nKey: " + kv + "\nDuration: " + info +
          (note ? "\nNote: " + note : "")
        );
        const dmSent = await safeDm(msg, { embeds: [keyEmbed] });
        if (dmSent) {
          await safeSend(msg, { embeds: [ok("Key Generated", "Key for " + script.name + " (" + info + ") sent to DMs.")] });
        } else {
          await safeSend(msg, { embeds: [ok("Key Generated", "Key for " + script.name + " (" + info + "):\n" + kv)] });
        }
        break;
      }

      /* /revoke <key> */
      case "revoke": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const raw = (args[0] || "").toUpperCase();
        if (!raw) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /revoke <key>")] });
          return;
        }
        const kr = await prisma.key.findFirst({
          where: {
            userId: user.id,
            OR: [
              { key: { equals: raw, mode: "insensitive" } },
              { key: { endsWith: raw.replace("KARMA-", "") } },
            ],
          },
          include: { script: true },
        });
        if (!kr) {
          await safeSend(msg, { embeds: [err("Not Found", "No key matching that input.")] });
          return;
        }
        await prisma.key.delete({ where: { id: kr.id } });
        await safeSend(msg, { embeds: [ok("Key Revoked", maskKey(kr.key) + " for " + kr.script.name + " deleted.")] });
        break;
      }

      /* /reset-hwid <key> */
      case "reset-hwid": {
        const user = await resolveUser(msg.author.id);
        if (!user) {
          await safeSend(msg, { embeds: [err("Not Registered", "Use /setup first.")] });
          return;
        }
        const raw = (args[0] || "").toUpperCase();
        if (!raw) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /reset-hwid <key>")] });
          return;
        }
        const kr = await prisma.key.findFirst({
          where: {
            userId: user.id,
            OR: [
              { key: { equals: raw, mode: "insensitive" } },
              { key: { endsWith: raw.replace("KARMA-", "") } },
            ],
          },
          include: { script: true },
        });
        if (!kr) {
          await safeSend(msg, { embeds: [err("Not Found", "No key matching that input.")] });
          return;
        }
        if (kr.resettable) {
          const elapsed = Date.now() - kr.resettable.getTime();
          if (elapsed < COOLDOWN_MS) {
            await safeSend(msg, { embeds: [err("Cooldown", "Try again in " + timeRemaining(COOLDOWN_MS - elapsed) + ".")] });
            return;
          }
        }
        await prisma.key.update({ where: { id: kr.id }, data: { hwid: null, resettable: new Date() } });
        await safeSend(msg, { embeds: [ok("HWID Reset", "HWID for " + maskKey(kr.key) + " on " + kr.script.name + " cleared.")] });
        break;
      }

      /* /ban <hwid> */
      case "ban": {
        if (msg.author.id !== OWNER_ID) {
          await safeSend(msg, { embeds: [err("No Permission", "Owner only.")] });
          return;
        }
        const hwid = (args[0] || "").toUpperCase();
        if (!hwid) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /ban <hwid>")] });
          return;
        }
        if (bannedHwids.has(hwid)) {
          await safeSend(msg, { embeds: [err("Already Banned", hwid + " is already banned.")] });
          return;
        }
        bannedHwids.add(hwid);
        await safeSend(msg, { embeds: [ok("HWID Banned", hwid + " added to ban list.")] });
        break;
      }

      /* /unban <hwid> */
      case "unban": {
        if (msg.author.id !== OWNER_ID) {
          await safeSend(msg, { embeds: [err("No Permission", "Owner only.")] });
          return;
        }
        const hwid = (args[0] || "").toUpperCase();
        if (!hwid) {
          await safeSend(msg, { embeds: [err("Missing Argument", "Usage: /unban <hwid>")] });
          return;
        }
        if (!bannedHwids.has(hwid)) {
          await safeSend(msg, { embeds: [err("Not Found", hwid + " not in ban list.")] });
          return;
        }
        bannedHwids.delete(hwid);
        await safeSend(msg, { embeds: [ok("HWID Unbanned", hwid + " removed from ban list.")] });
        break;
      }
    }
  } catch (e) {
    console.error("[" + new Date().toISOString() + "] Command error:", e.message || e);
    try {
      await safeSend(msg, { embeds: [err("Error", "Something went wrong.")] });
    } catch {}
  }
});

// ─── Interaction Handler (Buttons + Modals) ───────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isModalSubmit()) {
    await handleModal(interaction);
    return;
  }
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }
});

// ─── Error Handlers ───────────────────────────────────────────────────────────

process.on("unhandledRejection", function (r) {
  console.error("[" + new Date().toISOString() + "] Rejection:", r);
});
process.on("uncaughtException", function (e) {
  console.error("[" + new Date().toISOString() + "] Uncaught:", e.message || e);
});

// ─── Login ────────────────────────────────────────────────────────────────────

console.log("[" + new Date().toISOString() + "] Starting Karma Bot...");
client
  .login(TOKEN)
  .then(function () {
    console.log("[" + new Date().toISOString() + "] Login OK, connecting...");
  })
  .catch(function (e) {
    console.error("[" + new Date().toISOString() + "] Login failed:", e.message);
    setTimeout(function () { process.exit(1); }, 10000);
  });
