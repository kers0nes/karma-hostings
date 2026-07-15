import os
import secrets
import asyncio
import threading
from datetime import datetime, timedelta

from flask import Flask, request, session, redirect, render_template, jsonify
from flask_session import Session
from dotenv import load_dotenv
import requests as http_requests
import discord
from discord import Embed, ButtonStyle, ActionRow, Button, Modal, InputText, InputTextStyle
from discord.ext import commands

import database as db

load_dotenv()

DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN")
CLIENT_ID = os.environ.get("CLIENT_ID")
CLIENT_SECRET = os.environ.get("CLIENT_SECRET")
SESSION_SECRET = os.environ.get("SESSION_SECRET", secrets.token_hex(32))
OWNER_ID = os.environ.get("OWNER_ID", "")
BRAND_COLOR = int(os.environ.get("BRAND_COLOR", "0x1a3a6b"), 16)
PREFIX = os.environ.get("PREFIX", "/")
BOT_PERMISSIONS = os.environ.get("BOT_PERMISSIONS", "8")
COOLDOWN_MS = 24 * 60 * 60 * 1000

if not DISCORD_TOKEN or not CLIENT_SECRET:
    print("Missing DISCORD_TOKEN or CLIENT_SECRET")
    exit(1)

db.init_db()

# ---- Flask App ----

app = Flask(__name__)
app.secret_key = SESSION_SECRET
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# ---- Discord Bot Client (embedded, like original server.js) ----

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.dm_messages = True

bot = commands.Bot(intents=intents, activity=discord.Activity(type=discord.ActivityType.watching, name="Karma Protection | /help"))


@bot.event
async def on_ready():
    print(f"Bot online as {bot.user}")


@bot.event
async def on_message(msg):
    if msg.author.bot or not msg.content.startswith(PREFIX):
        return
    parts = msg.content[len(PREFIX):].strip().split()
    cmd = parts[0].lower() if parts else ""
    args = parts[1:]
    user = db.get_user_by_discord_id(str(msg.author.id))

    if cmd == "help":
        embed = Embed(color=BRAND_COLOR, title="Karma Protection – Commands")
        embed.description = (
            f"**General**\n{PREFIX}setup – Create/load account\n{PREFIX}scripts – List scripts\n{PREFIX}keys – List keys\n\n"
            f"**Key Management**\n{PREFIX}createkey <script> [hours] – Generate key\n{PREFIX}revoke <key> – Revoke key\n"
            f"{PREFIX}reset-hwid <key> – Reset HWID (24h)\n\n"
            f"**Whitelist**\n{PREFIX}whitelist <script> <@user> [hours] – Whitelist user\n"
            f"{PREFIX}removewhitelist <@user> – Remove\n{PREFIX}whitelistlist – List whitelisted\n\n"
            f"**Panels**\n{PREFIX}panelsetup <script> – Spawn panel\n\n"
            f"**Owner**\n{PREFIX}ban <hwid>\n{PREFIX}unban <hwid>\n{PREFIX}checkhwid <hwid>"
        )
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        try:
            await msg.author.send(embed=embed)
            await msg.reply("Check DMs.")
        except:
            await msg.reply(embed=embed)
        return

    if cmd == "setup":
        if not user:
            uid = f"user_{secrets.token_hex(8)}"
            db.execute(
                "INSERT INTO users (id, discord_id, username, avatar, provider) VALUES (%s, %s, %s, %s, %s)",
                (uid, str(msg.author.id), msg.author.name, msg.author.display_avatar.url or "", "discord"),
            )
            user = db.get_user_by_discord_id(str(msg.author.id))
        sc = db.fetchone("SELECT COUNT(*) as c FROM scripts WHERE user_id = %s", (user["id"],))["c"]
        kc = db.fetchone("SELECT COUNT(*) as c FROM license_keys WHERE user_id = %s", (user["id"],))["c"]
        wc = db.fetchone("SELECT COUNT(*) as c FROM whitelist WHERE user_id = %s", (user["id"],))["c"]
        embed = Embed(color=BRAND_COLOR, title="Account Ready", description=f"Welcome {msg.author.name}.")
        embed.add_field(name="Scripts", value=str(sc), inline=True)
        embed.add_field(name="Keys", value=str(kc), inline=True)
        embed.add_field(name="Whitelisted", value=str(wc), inline=True)
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        await msg.reply(embed=embed)
        return

    if cmd == "scripts":
        if not user:
            await msg.reply("Use /setup first.")
            return
        scripts = db.get_scripts_by_user(user["id"])
        if not scripts:
            await msg.reply("No scripts.")
            return
        lines = [f"{i+1}. {s['name']} - v{s.get('version','1.0.0')} - {'Active' if s['status']=='active' else 'Disabled'}" for i, s in enumerate(scripts)]
        embed = Embed(color=BRAND_COLOR, title=f"Your Scripts ({len(scripts)})", description="\n".join(lines))
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        await msg.reply(embed=embed)
        return

    if cmd == "createkey":
        if not user:
            await msg.reply("Use /setup first.")
            return
        script_name = args[0] if args else ""
        if not script_name:
            await msg.reply("Usage: /createkey <script> [hours]")
            return
        hours = int(args[1]) if len(args) > 1 and args[1].isdigit() else None
        script = db.fetchone("SELECT * FROM scripts WHERE user_id = %s AND name = %s", (user["id"], script_name))
        if not script:
            await msg.reply(f'No script "{script_name}"')
            return
        key = db.generate_key()
        expires_at = db.add_hours(hours) if hours else None
        kid = db.make_id("key")
        db.execute("INSERT INTO license_keys (id, script_id, user_id, key, expires_at) VALUES (%s, %s, %s, %s, %s)",
                    (kid, script["id"], user["id"], key, expires_at))
        embed = Embed(color=BRAND_COLOR, title="Key Generated",
                      description=f"**Script:** {script['name']}\n**Key:** `{key}`\n{'Expires: ' + db.format_expiry(expires_at) if hours else 'Permanent'}")
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        try:
            await msg.author.send(embed=embed)
            await msg.reply("Key sent to DMs.")
        except:
            await msg.reply(embed=embed)
        return

    if cmd == "keys":
        if not user:
            await msg.reply("Use /setup first.")
            return
        keys = db.get_keys_by_user(user["id"])
        if not keys:
            await msg.reply("No keys.")
            return
        lines = []
        for k in keys:
            expired = k["expires_at"] and db.is_expired(k["expires_at"])
            status = "Expired" if expired else ("HWID-Locked" if k["hwid"] else "Active")
            lines.append(f"{status} {db.mask_key(k['key'])} - {db.format_expiry(k['expires_at'])}")
        embed = Embed(color=BRAND_COLOR, title=f"Your Keys ({len(keys)})", description="\n".join(lines))
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        await msg.reply(embed=embed)
        return

    if cmd == "revoke":
        if not user:
            await msg.reply("Use /setup first.")
            return
        raw_key = args[0] if args else ""
        if not raw_key:
            await msg.reply("Usage: /revoke <key>")
            return
        kr = db.get_key_by_value_and_user(raw_key, user["id"])
        if not kr:
            await msg.reply("Key not found.")
            return
        db.execute("DELETE FROM license_keys WHERE key = %s AND user_id = %s", (raw_key, user["id"]))
        db.execute("DELETE FROM whitelist WHERE key = %s AND user_id = %s", (raw_key, user["id"]))
        await msg.reply(f"Key {db.mask_key(raw_key)} revoked.")
        return

    if cmd == "reset-hwid":
        if not user:
            await msg.reply("Use /setup first.")
            return
        raw_key = args[0] if args else ""
        if not raw_key:
            await msg.reply("Usage: /reset-hwid <key>")
            return
        kr = db.get_key_by_value_and_user(raw_key, user["id"])
        if not kr:
            await msg.reply("Key not found.")
            return
        if kr.get("resettable"):
            elapsed = datetime.utcnow().timestamp() * 1000 - datetime.fromisoformat(kr["resettable"]).timestamp() * 1000
            if elapsed < COOLDOWN_MS:
                rem = COOLDOWN_MS - elapsed
                h, m = int(rem // 3600000), int((rem % 3600000) // 60000)
                await msg.reply(f"Cooldown: {h}h {m}m remaining.")
                return
        db.execute("UPDATE license_keys SET hwid = NULL, resettable = NOW() WHERE key = %s", (raw_key,))
        wl = db.fetchone("SELECT * FROM whitelist WHERE key = %s AND user_id = %s", (raw_key, user["id"]))
        if wl:
            db.execute("UPDATE whitelist SET hwid = NULL WHERE id = %s", (wl["id"],))
        await msg.reply(f"HWID reset for {db.mask_key(raw_key)}.")
        return

    if cmd == "whitelist":
        if not user:
            await msg.reply("Use /setup first.")
            return
        if len(args) < 2:
            await msg.reply("Usage: /whitelist <script> <@user> [hours]")
            return
        script_name = args[0]
        mention = args[1]
        hours = int(args[2]) if len(args) > 2 and args[2].isdigit() else 0
        script = db.fetchone("SELECT * FROM scripts WHERE user_id = %s AND name = %s", (user["id"], script_name))
        if not script:
            await msg.reply(f'No script "{script_name}"')
            return
        target_id = mention.replace("<@!", "").replace("<@", "").replace(">", "")
        target_user = db.get_user_by_discord_id(target_id)
        if not target_user:
            tuid = f"user_{secrets.token_hex(8)}"
            try:
                member = await msg.guild.fetch_member(int(target_id))
                tname = member.name
            except:
                tname = "Unknown"
            db.execute("INSERT INTO users (id, discord_id, username, provider) VALUES (%s, %s, %s, %s)",
                        (tuid, target_id, tname, "discord"))
            target_user = db.get_user_by_discord_id(target_id)
        key = db.generate_key()
        expires_at = db.add_hours(hours) if hours > 0 else None
        wid = db.make_id("wl")
        existing = db.fetchone("SELECT * FROM whitelist WHERE script_id = %s AND discord_id = %s",
                                (script["id"], target_id))
        if existing:
            await msg.reply("User already whitelisted.")
            return
        db.execute("INSERT INTO whitelist (id, script_id, user_id, key, discord_id, username, expires_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (wid, script["id"], user["id"], key, target_id, target_user["username"], expires_at))
        db.execute("INSERT INTO license_keys (id, script_id, user_id, key, note, expires_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (db.make_id("key"), script["id"], user["id"], key, f"Whitelisted for {target_user['username']}", expires_at))
        embed = Embed(color=BRAND_COLOR, title="User Whitelisted",
                      description=f"**Script:** {script['name']}\n**User:** <@{target_id}>\n**Key:** `{key}`\n**Status:** {'Expires in '+str(hours)+'h' if hours > 0 else 'Permanent'}")
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        await msg.reply(embed=embed)
        return

    if cmd in ("removewhitelist", "unwhitelist"):
        if not user:
            await msg.reply("Use /setup first.")
            return
        mention = args[0] if args else ""
        if not mention:
            await msg.reply("Usage: /removewhitelist <@user>")
            return
        target_id = mention.replace("<@!", "").replace("<@", "").replace(">", "")
        entries = db.fetchall("SELECT * FROM whitelist WHERE discord_id = %s AND user_id = %s", (target_id, user["id"]))
        if not entries:
            await msg.reply("User not whitelisted.")
            return
        for e in entries:
            db.execute("DELETE FROM whitelist WHERE id = %s", (e["id"],))
            db.execute("DELETE FROM license_keys WHERE key = %s AND user_id = %s", (e["key"], user["id"]))
        await msg.reply(f"Removed <@{target_id}> from whitelist.")
        return

    if cmd in ("whitelistlist", "wllist"):
        if not user:
            await msg.reply("Use /setup first.")
            return
        entries = db.fetchall("SELECT * FROM whitelist WHERE user_id = %s ORDER BY created_at DESC", (user["id"],))
        if not entries:
            await msg.reply("No users whitelisted.")
            return
        lines = []
        for e in entries:
            expired = e["expires_at"] and db.is_expired(e["expires_at"])
            status = "Expired" if expired else ("HWID-Locked" if e["hwid"] else "Active")
            lines.append(f"{status} <@{e['discord_id']}> - {e['username']} - Expires: {db.format_expiry(e['expires_at'])}")
        embed = Embed(color=BRAND_COLOR, title=f"Whitelist ({len(entries)})", description="\n".join(lines))
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        await msg.reply(embed=embed)
        return

    if cmd == "panelsetup":
        if not user:
            await msg.reply("Use /setup first.")
            return
        script_name = " ".join(args)
        if not script_name:
            await msg.reply("Usage: /panelsetup <script name>")
            return
        script = db.fetchone("SELECT * FROM scripts WHERE user_id = %s AND name = %s", (user["id"], script_name))
        if not script:
            await msg.reply(f'No script "{script_name}"')
            return
        embed = Embed(color=BRAND_COLOR, title=script["name"], description="Use the buttons below.")
        embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
        sid = script["id"]
        row1 = ActionRow(Button(style=ButtonStyle.primary, label="View", custom_id=f"pv_{sid}"))
        row2 = ActionRow(Button(style=ButtonStyle.success, label="Redeem", custom_id=f"pr_{sid}"))
        row3 = ActionRow(Button(style=ButtonStyle.secondary, label="Keys", custom_id=f"pi_{sid}"))
        row4 = ActionRow(Button(style=ButtonStyle.secondary, label="Loader", custom_id=f"pl_{sid}"))
        row5 = ActionRow(Button(style=ButtonStyle.danger, label="Reset HWID", custom_id=f"ph_{sid}"))
        await msg.reply(embed=embed, components=[row1, row2, row3, row4, row5])
        return

    if str(msg.author.id) == OWNER_ID:
        if cmd == "ban":
            hwid = args[0] if args else ""
            if not hwid:
                await msg.reply("Usage: /ban <hwid>")
                return
            db.execute("INSERT INTO banned_hwids (hwid, banned_by) VALUES (%s, %s) ON CONFLICT (hwid) DO UPDATE SET banned_by = EXCLUDED.banned_by",
                        (hwid, str(msg.author.id)))
            await msg.reply(f"HWID {hwid} banned.")
            return
        if cmd == "unban":
            hwid = args[0] if args else ""
            if not hwid:
                await msg.reply("Usage: /unban <hwid>")
                return
            db.execute("DELETE FROM banned_hwids WHERE hwid = %s", (hwid,))
            await msg.reply(f"HWID {hwid} unbanned.")
            return
        if cmd == "checkhwid":
            hwid = args[0] if args else ""
            if not hwid:
                await msg.reply("Usage: /checkhwid <hwid>")
                return
            banned = db.get_banned_hwid(hwid)
            await msg.reply(f"HWID {hwid} is {'BANNED' if banned else 'NOT banned'}.")
            return


@bot.event
async def on_interaction(interaction):
    if interaction.type == discord.InteractionType.component:
        custom_id = interaction.data["custom_id"]
        action = custom_id[1]
        script_id = custom_id[3:]
        user = db.get_user_by_discord_id(str(interaction.user.id))
        if not user:
            await interaction.response.send_message("Use /setup first.", ephemeral=True)
            return
        script = db.get_script_by_id_and_user(script_id, user["id"])
        if not script:
            await interaction.response.send_message("Script not found.", ephemeral=True)
            return

        if action == "v":
            kc = db.fetchone("SELECT COUNT(*) as c FROM license_keys WHERE script_id = %s AND user_id = %s", (script_id, user["id"]))["c"]
            wc = db.fetchone("SELECT COUNT(*) as c FROM whitelist WHERE script_id = %s AND user_id = %s", (script_id, user["id"]))["c"]
            embed = Embed(color=BRAND_COLOR, title=script["name"])
            embed.add_field(name="Version", value=script.get("version", "1.0.0"), inline=True)
            embed.add_field(name="Status", value="Active" if script["status"] == "active" else "Disabled", inline=True)
            embed.add_field(name="Keys", value=str(kc), inline=True)
            embed.add_field(name="Whitelisted", value=str(wc), inline=True)
            embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
            await interaction.response.send_message(embed=embed, ephemeral=True)
        elif action == "r":
            modal = Modal(title="Redeem Key", custom_id=f"rm_{script_id}")
            modal.add_item(InputText(label="Enter license key", custom_id="key_input", style=InputTextStyle.short, required=True))
            await interaction.response.send_modal(modal)
        elif action == "i":
            keys = db.fetchall("SELECT * FROM license_keys WHERE script_id = %s AND user_id = %s ORDER BY created_at DESC",
                                (script_id, user["id"]))
            if not keys:
                await interaction.response.send_message("No keys.", ephemeral=True)
                return
            lines = []
            for k in keys:
                expired = k["expires_at"] and db.is_expired(k["expires_at"])
                status = "Expired" if expired else ("HWID-Locked" if k["hwid"] else "Active")
                lines.append(f"{status} {db.mask_key(k['key'])} - {db.format_expiry(k['expires_at'])}")
            embed = Embed(color=BRAND_COLOR, title="Keys", description="\n".join(lines))
            embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
            await interaction.response.send_message(embed=embed, ephemeral=True)
        elif action == "l":
            key = db.fetchone("SELECT * FROM license_keys WHERE script_id = %s AND user_id = %s ORDER BY created_at DESC",
                               (script_id, user["id"]))
            if not key:
                await interaction.response.send_message("No active key.", ephemeral=True)
                return
            url = f'{db.public_base_url()}/loader/{script_id}?key={key["key"]}'
            await interaction.response.send_message(f"```lua\nloadstring(game:HttpGet(\"{url}\"))()\n```", ephemeral=True)
        elif action == "h":
            modal = Modal(title="Reset HWID", custom_id=f"hm_{script_id}")
            modal.add_item(InputText(label="Enter license key", custom_id="key_input", style=InputTextStyle.short, required=True))
            await interaction.response.send_modal(modal)

    elif interaction.type == discord.InteractionType.modal_submit:
        custom_id = interaction.data["custom_id"]
        key_val = interaction.data["components"][0]["components"][0]["value"].strip()
        user = db.get_user_by_discord_id(str(interaction.user.id))
        if not user:
            await interaction.response.send_message("Use /setup first.", ephemeral=True)
            return
        if custom_id.startswith("rm_"):
            script_id = custom_id[3:]
            kr = db.fetchone("SELECT * FROM license_keys WHERE key = %s AND script_id = %s AND user_id = %s",
                              (key_val.upper(), script_id, user["id"]))
            if not kr:
                await interaction.response.send_message("Invalid key.", ephemeral=True)
                return
            if kr["expires_at"] and db.is_expired(kr["expires_at"]):
                await interaction.response.send_message("Key expired.", ephemeral=True)
                return
            db.execute("UPDATE license_keys SET last_used_at = NOW() WHERE key = %s", (key_val.upper(),))
            await interaction.response.send_message("Key redeemed successfully.", ephemeral=True)
        elif custom_id.startswith("hm_"):
            script_id = custom_id[3:]
            kr = db.fetchone("SELECT * FROM license_keys WHERE key = %s AND script_id = %s AND user_id = %s",
                              (key_val.upper(), script_id, user["id"]))
            if not kr:
                await interaction.response.send_message("Invalid key.", ephemeral=True)
                return
            if kr.get("resettable"):
                elapsed = datetime.utcnow().timestamp() * 1000 - datetime.fromisoformat(kr["resettable"]).timestamp() * 1000
                if elapsed < COOLDOWN_MS:
                    rem = COOLDOWN_MS - elapsed
                    h, m = int(rem // 3600000), int((rem % 3600000) // 60000)
                    await interaction.response.send_message(f"Cooldown: {h}h {m}m remaining.", ephemeral=True)
                    return
            db.execute("UPDATE license_keys SET hwid = NULL, resettable = NOW() WHERE key = %s", (key_val.upper(),))
            wl = db.fetchone("SELECT * FROM whitelist WHERE key = %s AND user_id = %s", (key_val.upper(), user["id"]))
            if wl:
                db.execute("UPDATE whitelist SET hwid = NULL WHERE id = %s", (wl["id"],))
            await interaction.response.send_message("HWID reset successfully.", ephemeral=True)


# ---- Slash Commands ----

@bot.slash_command(name="register", description="Create your Karma Protection account")
async def register(ctx: discord.ApplicationContext,
    username: discord.Option(str, "Choose a username", required=True),
    password: discord.Option(str, "Choose a password", required=True)):
    existing = db.get_user_by_discord_id(str(ctx.author.id))
    if existing:
        await ctx.respond("You already have an account linked to your Discord.", ephemeral=True)
        return
    email_check = db.fetchone("SELECT * FROM users WHERE username = %s", (username,))
    if email_check:
        await ctx.respond("Username already taken.", ephemeral=True)
        return
    uid = f"user_{secrets.token_hex(8)}"
    salt = db.generate_salt()
    pw_hash = db.hash_password(password, salt)
    db.execute(
        "INSERT INTO users (id, discord_id, username, avatar, password_hash, password_salt, provider) VALUES (%s, %s, %s, %s, %s, %s, 'discord')",
        (uid, str(ctx.author.id), username, ctx.author.display_avatar.url or "", pw_hash, salt),
    )
    embed = Embed(color=BRAND_COLOR, title="Account Created",
                  description=f"Welcome **{username}**!\nYour Discord is now linked to your Karma Protection account.\nUse `/login` or visit the website to manage your scripts.")
    embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
    await ctx.respond(embed=embed, ephemeral=True)


@bot.slash_command(name="login", description="Login to your Karma Protection account with username or email")
async def login(ctx: discord.ApplicationContext,
    username_or_email: discord.Option(str, "Your username or email", required=True),
    password: discord.Option(str, "Your password", required=True)):
    user_record = db.fetchone(
        "SELECT * FROM users WHERE (username = %s OR email = %s) AND deleted_at IS NULL",
        (username_or_email, username_or_email),
    )
    if not user_record:
        await ctx.respond("Invalid credentials.", ephemeral=True)
        return
    pw_hash = db.hash_password(password, user_record["password_salt"])
    if pw_hash != user_record["password_hash"]:
        await ctx.respond("Invalid credentials.", ephemeral=True)
        return
    if not user_record["discord_id"]:
        db.execute("UPDATE users SET discord_id = %s, avatar = %s WHERE id = %s",
                    (str(ctx.author.id), ctx.author.display_avatar.url or "", user_record["id"]))
    elif user_record["discord_id"] != str(ctx.author.id):
        await ctx.respond("This account is linked to a different Discord user.", ephemeral=True)
        return
    embed = Embed(color=BRAND_COLOR, title="Logged In",
                  description=f"Welcome back **{user_record['username']}**!\nYour Discord is now linked. Use `/register` if you need a new account.")
    embed.set_footer(text="Karma Protection").timestamp = discord.utils.utcnow()
    await ctx.respond(embed=embed, ephemeral=True)


def run_bot():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    bot.run(DISCORD_TOKEN)


# ---- Flask Routes ----

@app.route("/")
def landing():
    if session.get("user"):
        return redirect("/dashboard")
    return render_template("landing.html")


@app.route("/dashboard")
def dashboard():
    user = session.get("user")
    if not user:
        return redirect("/")
    username = db.escape_html(user.get("global_name") or user.get("username") or user.get("email", ""))
    avatar_url = f"https://cdn.discordapp.com/avatars/{user['discord_id']}/{user['avatar']}.png?size=128" if user.get("avatar") else "https://cdn.discordapp.com/embed/avatars/0.png"
    bot_invite_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&permissions={BOT_PERMISSIONS}&scope=bot"
    return render_template("dashboard.html", username=username, avatar_url=avatar_url, bot_invite_url=bot_invite_url)


@app.route("/script/<script_id>")
def script_detail(script_id):
    user = session.get("user")
    if not user:
        return redirect("/")
    script = db.get_script_by_id_and_user(script_id, user["id"])
    if not script:
        return "Script not found", 404
    return render_template("script_detail.html", script=script, base_url=db.public_base_url())


@app.route("/health")
def health():
    return jsonify({"ok": True, "name": "Karma Protection v6.8"})


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ---- API Routes ----

@app.route("/api/data")
def api_data():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"})
    scripts = db.get_scripts_by_user(user["id"])
    panels = db.get_panels_by_user(user["id"])
    keys = db.get_keys_by_user(user["id"])
    banned = db.get_banned_hwids()
    whitelist = db.get_whitelist_by_user(user["id"])
    api_keys = db.get_api_keys_by_user(user["id"])
    return jsonify({
        "scripts": scripts,
        "panels": panels,
        "keys": keys,
        "bannedHWIDs": banned,
        "whitelist": whitelist,
        "apiKeys": api_keys,
        "serverTime": int(datetime.utcnow().timestamp() * 1000),
    })


@app.route("/api/create-script", methods=["POST"])
def api_create_script():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    name = data.get("name")
    code = data.get("code")
    compress_mode = data.get("compressMode", False)
    if not name or not code:
        return jsonify({"error": "Missing name or code"}), 400
    sid = db.make_id("script")
    obfuscated = db.obfuscate_lua(code)
    db.execute(
        "INSERT INTO scripts (id, user_id, name, code, obfuscated_code, version, status, compress_mode) VALUES (%s, %s, %s, %s, %s, '1.0.0', 'active', %s)",
        (sid, user["id"], name, code, obfuscated, 1 if compress_mode else 0),
    )
    return jsonify({"success": True, "id": sid})


@app.route("/api/update-script", methods=["POST"])
def api_update_script():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    sid = data.get("id")
    name = data.get("name")
    code = data.get("code")
    if not sid or not name or not code:
        return jsonify({"error": "Missing fields"}), 400
    existing = db.get_script_by_id_and_user(sid, user["id"])
    if not existing:
        return jsonify({"error": "Script not found"}), 404
    obfuscated = db.obfuscate_lua(code)
    db.execute(
        "UPDATE scripts SET name = %s, code = %s, obfuscated_code = %s, updated_at = NOW() WHERE id = %s AND user_id = %s",
        (name, code, obfuscated, sid, user["id"]),
    )
    return jsonify({"success": True})


@app.route("/api/script/<script_id>")
def api_get_script(script_id):
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    script = db.get_script_by_id_and_user(script_id, user["id"])
    if not script:
        return jsonify({"error": "Script not found"}), 404
    return jsonify({"script": script})


@app.route("/api/scripts/<script_id>/toggle", methods=["PUT"])
def api_toggle_script(script_id):
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    script = db.get_script_by_id_and_user(script_id, user["id"])
    if not script:
        return jsonify({"error": "Script not found"}), 404
    new_status = "disabled" if script["status"] == "active" else "active"
    db.execute("UPDATE scripts SET status = %s WHERE id = %s AND user_id = %s", (new_status, script_id, user["id"]))
    return jsonify({"success": True, "status": new_status})


@app.route("/api/scripts/<script_id>/ffa", methods=["PUT"])
def api_toggle_ffa(script_id):
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    script = db.get_script_by_id_and_user(script_id, user["id"])
    if not script:
        return jsonify({"error": "Script not found"}), 404
    new_ffa = 0 if script["ffa_mode"] else 1
    db.execute("UPDATE scripts SET ffa_mode = %s WHERE id = %s AND user_id = %s", (new_ffa, script_id, user["id"]))
    return jsonify({"success": True, "ffa_mode": new_ffa})


@app.route("/api/delete-script", methods=["POST"])
def api_delete_script():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    db.execute("DELETE FROM scripts WHERE id = %s AND user_id = %s", (data["id"], user["id"]))
    return jsonify({"success": True})


@app.route("/api/create-panel", methods=["POST"])
def api_create_panel():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    name = data.get("name")
    channel_id = data.get("channelId")
    script_id = data.get("scriptId")
    if not name or not channel_id or not script_id:
        return jsonify({"error": "Missing fields"}), 400
    pid = db.make_id("panel")
    db.execute(
        "INSERT INTO panels (id, user_id, name, description, channel_id, script_id, hwid_cooldown) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (pid, user["id"], name, data.get("description", ""), channel_id, script_id, data.get("hwidCooldown", 180)),
    )
    return jsonify({"success": True, "id": pid})


@app.route("/api/delete-panel", methods=["POST"])
def api_delete_panel():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    db.execute("DELETE FROM panels WHERE id = %s AND user_id = %s", (data["id"], user["id"]))
    return jsonify({"success": True})


@app.route("/api/send-panel", methods=["POST"])
def api_send_panel():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    panel = db.get_panel_by_id_and_user(data["panelId"], user["id"])
    if not panel:
        return jsonify({"error": "Panel not found"}), 404
    return jsonify({"success": True})


@app.route("/api/generate-key", methods=["POST"])
def api_generate_key():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    panel_id = data.get("panelId")
    if not panel_id:
        return jsonify({"error": "Panel ID required"}), 400
    panel = db.get_panel_by_id_and_user(panel_id, user["id"])
    if not panel:
        return jsonify({"error": "Panel not found"}), 404
    key = db.generate_key()
    expires_at = db.add_hours(int(data["durationHours"])) if data.get("durationHours", 0) > 0 else None
    kid = db.make_id("key")
    db.execute(
        "INSERT INTO license_keys (id, script_id, user_id, key, note, expires_at) VALUES (%s, %s, %s, %s, %s, %s)",
        (kid, panel["script_id"], user["id"], key, data.get("note", ""), expires_at),
    )
    return jsonify({"success": True, "key": key})


@app.route("/api/delete-key", methods=["POST"])
def api_delete_key():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    db.execute("DELETE FROM license_keys WHERE key = %s AND user_id = %s", (data["key"], user["id"]))
    return jsonify({"success": True})


@app.route("/api/add-time-all", methods=["POST"])
def api_add_time_all():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    hours = data.get("hours")
    if not hours or not isinstance(hours, (int, float)):
        return jsonify({"error": "Invalid hours"}), 400
    keys = db.fetchall("SELECT * FROM license_keys WHERE user_id = %s AND expires_at IS NOT NULL", (user["id"],))
    for k in keys:
        current = datetime.fromisoformat(k["expires_at"])
        new_expiry = current + timedelta(hours=int(hours))
        db.execute("UPDATE license_keys SET expires_at = %s WHERE key = %s", (new_expiry.isoformat(), k["key"]))
    return jsonify({"success": True})


@app.route("/api/ban-hwid", methods=["POST"])
def api_ban_hwid():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    hwid = data.get("hwid")
    if not hwid:
        return jsonify({"error": "HWID required"}), 400
    db.execute("INSERT INTO banned_hwids (hwid, banned_by) VALUES (%s, %s) ON CONFLICT (hwid) DO UPDATE SET banned_by = EXCLUDED.banned_by",
                (hwid, user["id"]))
    return jsonify({"success": True})


@app.route("/api/unban-hwid", methods=["POST"])
def api_unban_hwid():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    db.execute("DELETE FROM banned_hwids WHERE hwid = %s", (data["hwid"],))
    return jsonify({"success": True})


@app.route("/api/delete-whitelist", methods=["POST"])
def api_delete_whitelist():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    entry = db.get_whitelist_entry_by_id(data["id"])
    if not entry or entry["user_id"] != user["id"]:
        return jsonify({"error": "Entry not found"}), 404
    db.execute("DELETE FROM whitelist WHERE id = %s AND user_id = %s", (data["id"], user["id"]))
    db.execute("DELETE FROM license_keys WHERE key = %s AND user_id = %s", (entry["key"], user["id"]))
    return jsonify({"success": True})


@app.route("/api/create-api-key", methods=["POST"])
def api_create_api_key():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    key = db.generate_api_key()
    kid = db.make_id("apikey")
    db.execute("INSERT INTO api_keys (id, user_id, key, name) VALUES (%s, %s, %s, %s)",
                (kid, user["id"], key, data.get("name", "My API Key")))
    return jsonify({"success": True, "key": key, "id": kid})


@app.route("/api/delete-api-key", methods=["POST"])
def api_delete_api_key():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    db.execute("DELETE FROM api_keys WHERE id = %s AND user_id = %s", (data["id"], user["id"]))
    return jsonify({"success": True})


@app.route("/api/delete-account", methods=["POST"])
def api_delete_account():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json()
    if data.get("confirm") != "DELETE":
        return jsonify({"error": "Confirmation required"}), 400
    db.execute("UPDATE users SET deleted_at = NOW() WHERE id = %s", (user["id"],))
    session.clear()
    return jsonify({"success": True})


@app.route("/api/initiate-recovery", methods=["POST"])
def api_initiate_recovery():
    data = request.get_json()
    email = data.get("email")
    if not email:
        return jsonify({"error": "Email required"}), 400
    user_record = db.get_user_by_email(email)
    if not user_record:
        return jsonify({"error": "User not found"}), 404
    token = db.generate_recovery_token()
    expires = (datetime.utcnow() + timedelta(days=1)).isoformat()
    db.execute("UPDATE users SET recovery_token = %s, recovery_expires = %s WHERE id = %s",
                (token, expires, user_record["id"]))
    link = f"{db.public_base_url()}/api/recover-account?token={token}"
    print(f"[RECOVERY] User: {user_record['username']}, Link: {link}")
    return jsonify({"success": True, "message": "Recovery link generated. Check console or your email."})


@app.route("/api/recover-account")
def api_recover_account():
    token = request.args.get("token")
    if not token:
        return "Missing token", 400
    user_record = db.get_user_by_recovery_token(token)
    if not user_record:
        return "Invalid or expired token", 404
    session["user"] = {
        "id": user_record["id"],
        "discord_id": user_record["discord_id"],
        "username": user_record["username"],
        "email": user_record["email"],
        "avatar": user_record["avatar"],
    }
    db.execute("UPDATE users SET recovery_token = NULL, recovery_expires = NULL WHERE id = %s", (user_record["id"],))
    return redirect("/dashboard")


# ---- Email Auth ----

@app.route("/api/auth/email/register", methods=["POST"])
def api_email_register():
    data = request.get_json()
    email = data.get("email")
    username = data.get("username")
    password = data.get("password")
    if not email or not username or not password:
        return jsonify({"error": "Missing fields"}), 400
    existing = db.fetchone("SELECT * FROM users WHERE email = %s OR username = %s", (email, username))
    if existing:
        return jsonify({"error": "Email or username already taken."}), 400
    salt = db.generate_salt()
    pw_hash = db.hash_password(password, salt)
    uid = f"user_{secrets.token_hex(8)}"
    db.execute("INSERT INTO users (id, username, email, password_hash, password_salt, provider) VALUES (%s, %s, %s, %s, %s, 'email')",
                (uid, username, email, pw_hash, salt))
    return jsonify({"success": True, "message": "Account created. Please login."})


@app.route("/api/auth/email/login", methods=["POST"])
def api_email_login():
    data = request.get_json()
    login_id = data.get("email") or data.get("username") or data.get("login")
    password = data.get("password")
    if not login_id or not password:
        return jsonify({"error": "Missing fields"}), 400
    user_record = db.fetchone(
        "SELECT * FROM users WHERE (email = %s OR username = %s) AND deleted_at IS NULL",
        (login_id, login_id),
    )
    if not user_record or not user_record.get("password_hash"):
        return jsonify({"error": "Invalid credentials"}), 400
    pw_hash = db.hash_password(password, user_record["password_salt"])
    if pw_hash != user_record["password_hash"]:
        return jsonify({"error": "Invalid credentials"}), 400
    session["user"] = {
        "id": user_record["id"],
        "discord_id": user_record["discord_id"],
        "username": user_record["username"],
        "email": user_record["email"],
        "avatar": user_record["avatar"],
    }
    return jsonify({"success": True})


# ---- Discord OAuth ----

@app.route("/api/auth/discord")
def api_discord_auth():
    state = secrets.token_hex(18)
    session["oauth_state"] = state
    redirect_uri = f"{db.public_base_url()}/api/auth/discord/callback"
    params = f"client_id={CLIENT_ID}&redirect_uri={redirect_uri}&response_type=code&scope=identify%20guilds&state={state}"
    return redirect(f"https://discord.com/oauth2/authorize?{params}")


@app.route("/api/auth/discord/callback")
def api_discord_callback():
    code = request.args.get("code")
    state = request.args.get("state")
    if not code or not state or state != session.get("oauth_state"):
        return "Invalid OAuth state", 400
    try:
        redirect_uri = f"{db.public_base_url()}/api/auth/discord/callback"
        token_resp = http_requests.post("https://discord.com/api/oauth2/token", data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }, headers={"Content-Type": "application/x-www-form-urlencoded"})
        token_data = token_resp.json()
        if not token_resp.ok:
            raise Exception("Failed to get token")
        user_resp = http_requests.get("https://discord.com/api/users/@me", headers={
            "Authorization": f"Bearer {token_data['access_token']}"
        })
        discord_user = user_resp.json()
        db_user = db.get_user_by_discord_id(str(discord_user["id"]))
        if not db_user:
            uid = f"user_{secrets.token_hex(8)}"
            db.execute(
                "INSERT INTO users (id, discord_id, username, avatar, access_token, provider) VALUES (%s, %s, %s, %s, %s, 'discord')",
                (uid, str(discord_user["id"]), discord_user["username"], discord_user.get("avatar", ""), token_data["access_token"]),
            )
            db_user = db.get_user_by_discord_id(str(discord_user["id"]))
        else:
            db.execute(
                "UPDATE users SET username = %s, avatar = %s, access_token = %s, updated_at = NOW() WHERE discord_id = %s",
                (discord_user["username"], discord_user.get("avatar", ""), token_data["access_token"], str(discord_user["id"])),
            )
        session["user"] = {
            "id": db_user["id"],
            "discord_id": str(discord_user["id"]),
            "username": discord_user["username"],
            "global_name": discord_user.get("global_name"),
            "avatar": discord_user.get("avatar"),
            "email": db_user["email"],
        }
        return redirect("/dashboard")
    except Exception as e:
        print("Auth error:", e)
        return "Authentication failed", 500


# ---- Loader Routes ----

@app.route("/loader/<script_id>")
def loader(script_id):
    script = db.get_script_by_id(script_id)
    if not script:
        return "-- Script not found", 404, {"Content-Type": "text/plain"}
    if script["status"] == "disabled":
        return "-- Script disabled", 403, {"Content-Type": "text/plain"}
    key = request.args.get("key")
    if not key:
        return "-- Missing key", 403, {"Content-Type": "text/plain"}
    kr = db.get_key_by_value_and_script(key, script_id)
    if not kr:
        return "-- Invalid key", 403, {"Content-Type": "text/plain"}
    if kr["expires_at"] and db.is_expired(kr["expires_at"]):
        return "-- Key expired", 403, {"Content-Type": "text/plain"}
    hwid = request.args.get("hwid")
    if hwid:
        banned = db.get_banned_hwid(hwid)
        if banned:
            return "-- HWID banned", 403, {"Content-Type": "text/plain"}
        if not kr["hwid"]:
            db.execute("UPDATE license_keys SET hwid = %s, last_used_at = NOW() WHERE key = %s", (hwid, key))
            wl = db.fetchone("SELECT * FROM whitelist WHERE key = %s", (key,))
            if wl:
                db.execute("UPDATE whitelist SET hwid = %s WHERE id = %s", (hwid, wl["id"]))
        elif kr["hwid"] != hwid:
            return "-- HWID mismatch. Use /reset-hwid <key>", 403, {"Content-Type": "text/plain"}
    db.execute("UPDATE license_keys SET last_used_at = NOW() WHERE key = %s", (key,))
    base_url = db.public_base_url()
    return f'--[[ Karma Protection Loader ]]\nreturn (function()\n  local url = "{base_url}/script/{script_id}?hwid={hwid or ""}&key={key}"\n  local src = game:HttpGet(url)\n  if not src or #src < 10 then error("Invalid payload") end\n  local func, err = loadstring(src, "@Karma")\n  if not func then error(err) end\n  return func()\nend)()', 200, {"Content-Type": "text/plain"}


@app.route("/script/<script_id>")
def serve_script(script_id):
    script = db.get_script_by_id(script_id)
    if not script:
        return "-- Script not found", 404, {"Content-Type": "text/plain"}
    if script["status"] == "disabled":
        return "-- Script disabled", 403, {"Content-Type": "text/plain"}
    if script["ffa_mode"]:
        return script.get("code", "-- Empty"), 200, {"Content-Type": "text/plain", "Cache-Control": "no-store"}
    key = request.args.get("key")
    hwid = request.args.get("hwid")
    if not key:
        return "-- Missing key", 403, {"Content-Type": "text/plain"}
    kr = db.get_key_by_value_and_script(key, script_id)
    if not kr:
        return "-- Invalid key", 403, {"Content-Type": "text/plain"}
    if kr["expires_at"] and db.is_expired(kr["expires_at"]):
        return "-- Key expired", 403, {"Content-Type": "text/plain"}
    if hwid:
        banned = db.get_banned_hwid(hwid)
        if banned:
            return "-- HWID banned", 403, {"Content-Type": "text/plain"}
        if kr["hwid"] and kr["hwid"] != hwid:
            return "-- HWID mismatch. Use /reset-hwid", 403, {"Content-Type": "text/plain"}
        if not kr["hwid"]:
            db.execute("UPDATE license_keys SET hwid = %s, last_used_at = NOW() WHERE key = %s", (hwid, key))
            wl = db.fetchone("SELECT * FROM whitelist WHERE key = %s", (key,))
            if wl:
                db.execute("UPDATE whitelist SET hwid = %s WHERE id = %s", (hwid, wl["id"]))
    db.execute("UPDATE license_keys SET last_used_at = NOW() WHERE key = %s", (key,))
    return script.get("code", "-- Empty"), 200, {"Content-Type": "text/plain", "Cache-Control": "no-store"}


# ---- Start (runs even with gunicorn) ----

def start_bot_in_thread():
    t = threading.Thread(target=run_bot, daemon=True)
    t.start()


print("Karma Protection v6.8 – Dark Blue Edition starting...")
start_bot_in_thread()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
