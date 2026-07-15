"""
Standalone Discord bot with slash commands (from index.js).
Also starts a verification API server for license checks.
Run separately from app.py if you need both.
"""
import os
import secrets
import threading
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from dotenv import load_dotenv
import discord
from discord import Embed, ButtonStyle, ActionRow, Button, Modal, InputText, InputTextStyle
from discord.ext import commands

import database as db

load_dotenv()

TOKEN = os.environ.get("DISCORD_TOKEN")
API_PORT = int(os.environ.get("API_PORT", "3000"))
API_HOST = os.environ.get("API_HOST", "0.0.0.0")

if not TOKEN:
    print("Missing DISCORD_TOKEN in .env")
    exit(1)

intents = discord.Intents.default()
intents.members = True
bot = commands.Bot(intents=intents)


# ---- Panel helpers ----

def panel_embed():
    return Embed(
        title="License Panel",
        description="Use the buttons below to manage your script access.",
        color=0x5865f2,
    ).add_field(
        name="Redeem Key", 
        value="Claim a license key and get the customer role.", 
        inline=False
    ).add_field(
        name="Reset HWID", 
        value="Clear the device lock on your redeemed key.", 
        inline=False
    ).add_field(
        name="My Keys", 
        value="View your redeemed licenses.", 
        inline=False
    ).set_footer(text="Polsec-like license system")


def panel_buttons():
    return [
        ActionRow(
            Button(style=ButtonStyle.success, label="Redeem Key", emoji="✅", custom_id="panel_redeem"),
            Button(style=ButtonStyle.primary, label="Reset HWID", emoji="🖥️", custom_id="panel_reset_hwid"),
            Button(style=ButtonStyle.secondary, label="My Keys", emoji="🔑", custom_id="panel_mykeys"),
        )
    ]


def key_status(license_data):
    if not license_data:
        return "Missing"
    if license_data.get("revoked"):
        return "Revoked"
    if db.is_expired(license_data.get("expires_at")):
        return "Expired"
    if license_data.get("discord_user_id"):
        return "Redeemed"
    return "Unused"


async def log_guild(guild, text):
    settings = db.get_settings(str(guild.id))
    if not settings or not settings.get("log_channel_id"):
        return
    channel = guild.get_channel(int(settings["log_channel_id"]))
    if channel and channel.type == discord.ChannelType.text:
        try:
            await channel.send(text)
        except:
            pass


def require_admin(interaction):
    settings = db.get_settings(str(interaction.guild_id))
    return db.verify_admin(interaction.author, settings)


async def redeem_key(guild, member, user_id, key):
    license_data = db.fetchone(
        "SELECT * FROM licenses WHERE license_key = %s AND guild_id = %s",
        (key, str(guild.id)),
    )
    if not license_data:
        return False, "That key does not exist in this server."
    if license_data.get("revoked"):
        return False, "That key has been revoked."
    if db.is_expired(license_data.get("expires_at")):
        return False, "That key is expired."
    if license_data.get("discord_user_id") and license_data["discord_user_id"] != user_id:
        return False, "That key was already redeemed by someone else."

    db.execute(
        "UPDATE licenses SET discord_user_id = %s, redeemed_at = COALESCE(redeemed_at, NOW()) WHERE license_key = %s",
        (user_id, key),
    )
    settings = db.get_settings(str(guild.id))
    if settings and settings.get("customer_role_id") and member:
        role = guild.get_role(int(settings["customer_role_id"]))
        if role:
            try:
                await member.add_roles(role)
            except:
                pass
    await log_guild(guild, f"User <@{user_id}> redeemed key `{key}`.")
    return True, "Key redeemed successfully."


async def reset_hwid(guild, user_id, key, admin=False):
    license_data = db.fetchone(
        "SELECT * FROM licenses WHERE license_key = %s AND guild_id = %s",
        (key, str(guild.id)),
    )
    if not license_data:
        return False, "That key does not exist in this server."
    if not admin and license_data.get("discord_user_id") != user_id:
        return False, "You can only reset HWID for your own redeemed key."
    db.execute("UPDATE licenses SET hwid = NULL WHERE license_key = %s", (key,))
    await log_guild(guild, f"HWID reset for key `{key}` by <@{user_id}>.")
    return True, "HWID reset successfully."


# ---- Events ----

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    start_api_server()


@bot.event
async def on_interaction(interaction):
    try:
        if interaction.type == discord.InteractionType.application_command:
            await handle_command(interaction)
        elif interaction.type == discord.InteractionType.component:
            await handle_button(interaction)
        elif interaction.type == discord.InteractionType.modal_submit:
            await handle_modal(interaction)
    except Exception as e:
        print(e)
        payload = {"content": "Something went wrong. Check your bot console.", "ephemeral": True}
        try:
            if interaction.response.is_done():
                await interaction.followup(**payload)
            else:
                await interaction.response.send_message(**payload)
        except:
            pass


# ---- Commands ----

async def handle_command(interaction):
    cmd = interaction.data["name"]

    if cmd == "setup":
        admin_role = interaction.data["resolved"]["roles"][interaction.data["options"][0]["value"]]
        customer_role = interaction.data["resolved"]["roles"][interaction.data["options"][1]["value"]]
        panel_channel = interaction.data["resolved"]["channels"][interaction.data["options"][2]["value"]]

        log_channel_id = None
        if len(interaction.data["options"]) > 3:
            log_channel = interaction.data["resolved"]["channels"].get(interaction.data["options"][3]["value"])
            if log_channel:
                log_channel_id = str(log_channel["id"])

        db.upsert_settings(str(interaction.guild_id), {
            "admin_role_id": str(admin_role["id"]),
            "customer_role_id": str(customer_role["id"]),
            "log_channel_id": log_channel_id,
            "panel_channel_id": str(panel_channel["id"]),
        })

        panel_msg = await interaction.channel.send(embed=panel_embed(), components=panel_buttons())
        db.upsert_settings(str(interaction.guild_id), {"panel_message_id": str(panel_msg.id)})

        await interaction.response.send_message(
            content=f"Setup complete. Panel posted in {panel_channel['name']}. Admin: {admin_role['name']}. Customer: {customer_role['name']}.",
            ephemeral=True,
        )
        await log_guild(interaction.guild, f"License panel setup by <@{interaction.user.id}>.")
        return

    admin_cmds = ["createscript", "scripts", "genkey", "revoke", "keyinfo", "loader"]
    if cmd in admin_cmds and not require_admin(interaction):
        await interaction.response.send_message(content="You need Administrator or the configured admin role to use this command.", ephemeral=True)
        return

    if cmd == "createscript":
        name = interaction.data["options"][0]["value"]
        script = db.create_script_entry(str(interaction.guild_id), name, str(interaction.user.id))
        embed = Embed(title="Script Created", color=0x57f287,
                      description="Save the API secret now. It is only shown once.")
        embed.add_field(name="Name", value=script["name"], inline=True)
        embed.add_field(name="Script ID", value=f"`{script['id']}`", inline=True)
        embed.add_field(name="API Secret", value=f"`{script['apiSecret']}`")
        await interaction.response.send_message(embed=embed, ephemeral=True)
        await log_guild(interaction.guild, f"Script `{name}` created by <@{interaction.user.id}>.")
        return

    if cmd == "scripts":
        scripts = db.fetchall("SELECT id, name, api_secret_preview FROM bot_scripts WHERE guild_id = %s ORDER BY created_at DESC",
                               (str(interaction.guild_id),))
        if not scripts:
            await interaction.response.send_message(content="No scripts yet. Use `/createscript`.", ephemeral=True)
            return
        lines = "\n\n".join(f"**{s['name']}**\nID: `{s['id']}`\nSecret: `{s['api_secret_preview']}`" for s in scripts)
        embed = Embed(title="Scripts", color=0x5865f2, description=lines)
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    if cmd == "genkey":
        opts = {o["name"]: o["value"] for o in interaction.data["options"]}
        script_id = opts["script_id"]
        days = int(opts["days"])
        quantity = int(opts.get("quantity", 1))

        script = db.fetchone("SELECT * FROM bot_scripts WHERE id = %s AND guild_id = %s",
                              (script_id, str(interaction.guild_id)))
        if not script:
            await interaction.response.send_message(content="Invalid script ID.", ephemeral=True)
            return

        expires_at = db.add_days(days)
        keys = []
        for _ in range(quantity):
            key = db.make_key("PS")
            db.execute(
                "INSERT INTO licenses (license_key, script_id, guild_id, expires_at, created_by) VALUES (%s, %s, %s, %s, %s)",
                (key, script_id, str(interaction.guild_id), expires_at, str(interaction.user.id)),
            )
            keys.append(key)

        content = f"Generated {len(keys)} key(s) for **{script['name']}**:\n\n" + "\n".join(f"`{k}`" for k in keys) + f"\n\nExpiry: {expires_at or 'Lifetime'}"
        await interaction.response.send_message(content=content, ephemeral=True)
        await log_guild(interaction.guild, f"{len(keys)} key(s) generated for `{script['name']}` by <@{interaction.user.id}>.")
        return

    if cmd == "redeem":
        key = interaction.data["options"][0]["value"].strip()
        ok, msg = await redeem_key(interaction.guild, interaction.author, str(interaction.user.id), key)
        await interaction.response.send_message(content=msg, ephemeral=True)
        return

    if cmd == "reset-hwid":
        key = interaction.data["options"][0]["value"].strip()
        admin = require_admin(interaction)
        ok, msg = await reset_hwid(interaction.guild, str(interaction.user.id), key, admin)
        await interaction.response.send_message(content=msg, ephemeral=True)
        return

    if cmd == "revoke":
        key = interaction.data["options"][0]["value"].strip()
        info = db.fetchone("SELECT * FROM licenses WHERE license_key = %s AND guild_id = %s",
                            (key, str(interaction.guild_id)))
        if not info:
            await interaction.response.send_message(content="Key not found.", ephemeral=True)
            return
        db.execute("UPDATE licenses SET revoked = 1 WHERE license_key = %s", (key,))
        await interaction.response.send_message(content=f"Revoked `{key}`.", ephemeral=True)
        await log_guild(interaction.guild, f"Key `{key}` revoked by <@{interaction.user.id}>.")
        return

    if cmd == "keyinfo":
        key = interaction.data["options"][0]["value"].strip()
        info = db.fetchone(
            "SELECT l.*, s.name AS script_name FROM licenses l JOIN bot_scripts s ON s.id = l.script_id WHERE l.license_key = %s AND l.guild_id = %s",
            (key, str(interaction.guild_id)),
        )
        if not info:
            await interaction.response.send_message(content="Key not found.", ephemeral=True)
            return
        embed = Embed(title="Key Info", color=0xfee75c)
        embed.add_field(name="Key", value=f"`{info['license_key']}`")
        embed.add_field(name="Script", value=f"{info['script_name']} (`{info['script_id']}`)", inline=True)
        embed.add_field(name="Status", value=key_status(info), inline=True)
        embed.add_field(name="User", value=f"<@{info['discord_user_id']}>" if info.get("discord_user_id") else "None", inline=True)
        embed.add_field(name="HWID", value=f"`{info['hwid']}`" if info.get("hwid") else "None", inline=True)
        embed.add_field(name="Expires", value=info.get("expires_at") or "Lifetime", inline=True)
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return

    if cmd == "mykeys":
        rows = db.fetchall(
            "SELECT l.*, s.name AS script_name FROM licenses l JOIN bot_scripts s ON s.id = l.script_id WHERE l.guild_id = %s AND l.discord_user_id = %s ORDER BY l.redeemed_at DESC",
            (str(interaction.guild_id), str(interaction.user.id)),
        )
        if rows:
            content = "\n".join(
                f"**{r['script_name']}** — `{r['license_key']}` — {key_status(r)} — expires: {r.get('expires_at') or 'Lifetime'} — HWID: {'set' if r.get('hwid') else 'not set'}"
                for r in rows
            )
        else:
            content = "You have no redeemed keys."
        await interaction.response.send_message(content=content, ephemeral=True)
        return

    if cmd == "loader":
        script_id = interaction.data["options"][0]["value"]
        script = db.fetchone("SELECT * FROM bot_scripts WHERE id = %s AND guild_id = %s",
                              (script_id, str(interaction.guild_id)))
        if not script:
            await interaction.response.send_message(content="Invalid script ID.", ephemeral=True)
            return
        example = (
            f'-- Generic Lua example. Change request/http_request for your executor/environment.\n'
            f'local key = "PASTE_USER_KEY"\n'
            f'local hwid = "PUT_HWID_HERE"\n'
            f'local apiUrl = "http://YOUR_SERVER_IP:{API_PORT}/api/verify"\n\n'
            f'local body = \'{{"script_id":"{script_id}","key":"\' .. key .. \'","hwid":"\' .. hwid .. \'"}}\'\n\n'
            f'local res = request({{\n'
            f'  Url = apiUrl,\n'
            f'  Method = "POST",\n'
            f'  Headers = {{\n'
            f'    ["Content-Type"] = "application/json",\n'
            f'    ["X-API-Secret"] = "PASTE_SCRIPT_API_SECRET"\n'
            f'  }},\n'
            f'  Body = body\n'
            f'}})\n\n'
            f'print(res.Body)'
        )
        await interaction.response.send_message(content=f"```lua\n{example}\n```", ephemeral=True)
        return


# ---- Buttons ----

async def handle_button(interaction):
    custom_id = interaction.data["custom_id"]

    if custom_id == "panel_redeem":
        modal = Modal(title="Redeem License Key", custom_id="modal_redeem")
        modal.add_item(InputText(label="License key", custom_id="key", style=InputTextStyle.short, required=True))
        await interaction.response.send_modal(modal)
        return

    if custom_id == "panel_reset_hwid":
        modal = Modal(title="Reset HWID", custom_id="modal_reset_hwid")
        modal.add_item(InputText(label="License key", custom_id="key", style=InputTextStyle.short, required=True))
        await interaction.response.send_modal(modal)
        return

    if custom_id == "panel_mykeys":
        rows = db.fetchall(
            "SELECT l.*, s.name AS script_name FROM licenses l JOIN bot_scripts s ON s.id = l.script_id WHERE l.guild_id = %s AND l.discord_user_id = %s ORDER BY l.redeemed_at DESC",
            (str(interaction.guild_id), str(interaction.user.id)),
        )
        content = "\n".join(
            f"**{r['script_name']}** — `{r['license_key']}` — {key_status(r)} — expires: {r.get('expires_at') or 'Lifetime'} — HWID: {'set' if r.get('hwid') else 'not set'}"
            for r in rows
        ) if rows else "You have no redeemed keys."
        await interaction.response.send_message(content=content, ephemeral=True)
        return


# ---- Modals ----

async def handle_modal(interaction):
    key = interaction.data["components"][0]["components"][0]["value"].strip()

    if interaction.data["custom_id"] == "modal_redeem":
        ok, msg = await redeem_key(interaction.guild, interaction.user, str(interaction.user.id), key)
        await interaction.response.send_message(content=msg, ephemeral=True)
        return

    if interaction.data["custom_id"] == "modal_reset_hwid":
        ok, msg = await reset_hwid(interaction.guild, str(interaction.user.id), key, admin=False)
        await interaction.response.send_message(content=msg, ephemeral=True)
        return


# ---- API Server ----

verification_app = Flask(__name__)


@verification_app.route("/health")
def health():
    return jsonify({"ok": True})


@verification_app.route("/api/verify", methods=["POST"])
def api_verify():
    global_token = os.environ.get("GLOBAL_API_TOKEN")
    if global_token and request.headers.get("X-Global-Token") != global_token:
        return jsonify({"ok": False, "message": "Invalid global token"}), 401

    data = request.get_json() or {}
    script_id = data.get("script_id")
    key = data.get("key")
    hwid = data.get("hwid")
    api_secret = request.headers.get("X-API-Secret")

    if not script_id or not key or not hwid or not api_secret:
        return jsonify({"ok": False, "message": "Missing script_id, key, hwid, or X-API-Secret"}), 400

    script = db.fetchone("SELECT * FROM bot_scripts WHERE id = %s", (script_id,))
    if not script or script["api_secret_hash"] != db.hash_secret(api_secret):
        return jsonify({"ok": False, "message": "Invalid script or API secret"}), 401

    license_data = db.fetchone("SELECT * FROM licenses WHERE license_key = %s AND script_id = %s", (key, script_id))
    if not license_data:
        return jsonify({"ok": False, "message": "Invalid key"}), 404
    if license_data.get("revoked"):
        return jsonify({"ok": False, "message": "Key revoked"}), 403
    if db.is_expired(license_data.get("expires_at")):
        return jsonify({"ok": False, "message": "Key expired"}), 403
    if not license_data.get("discord_user_id"):
        return jsonify({"ok": False, "message": "Key not redeemed"}), 403
    if license_data.get("hwid") and license_data["hwid"] != hwid:
        return jsonify({"ok": False, "message": "HWID mismatch"}), 403

    if not license_data.get("hwid"):
        db.execute("UPDATE licenses SET hwid = %s WHERE license_key = %s", (hwid, key))

    return jsonify({
        "ok": True,
        "message": "License verified",
        "discord_user_id": license_data["discord_user_id"],
        "expires_at": license_data.get("expires_at"),
        "script_id": script_id,
    })


def start_api_server():
    verification_app.run(host=API_HOST, port=API_PORT, debug=False)


def run_api_in_thread():
    t = threading.Thread(target=start_api_server, daemon=True)
    t.start()


# ---- Start ----

if __name__ == "__main__":
    run_api_in_thread()
    bot.run(TOKEN)
