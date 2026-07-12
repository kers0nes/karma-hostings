import asyncio
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiohttp
from aiohttp import web
import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
GUILD_ID = os.getenv("DISCORD_GUILD_ID", "").strip()
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8080"))
DB_PATH = os.getenv("DATABASE_PATH", "polsec_like.sqlite3")

UTC = timezone.utc


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value)


def make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(8)}".replace("-", "").replace("_", "_")


def make_key() -> str:
    return "PLS-" + secrets.token_urlsafe(18).replace("-", "").replace("_", "").upper()[:24]


class Store:
    def __init__(self, path: str):
        self.path = path
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = asyncio.Lock()
        self.init_db()

    def init_db(self):
        self.conn.executescript(
            """
            PRAGMA journal_mode=WAL;

            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                admin_role_id TEXT,
                customer_role_id TEXT,
                log_channel_id TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                name TEXT NOT NULL,
                api_secret TEXT NOT NULL,
                owner_user_id TEXT NOT NULL,
                webhook_url TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS license_keys (
                code TEXT PRIMARY KEY,
                script_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                duration_days INTEGER NOT NULL DEFAULT 30,
                max_uses INTEGER NOT NULL DEFAULT 1,
                uses INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                redeemed_by TEXT,
                redeemed_at TEXT,
                expires_at TEXT,
                hwid TEXT,
                revoked_reason TEXT,
                FOREIGN KEY(script_id) REFERENCES scripts(id)
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                actor_user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                created_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    async def execute(self, query: str, params=()):
        async with self.lock:
            cur = self.conn.execute(query, params)
            self.conn.commit()
            return cur

    async def fetchone(self, query: str, params=()):
        async with self.lock:
            cur = self.conn.execute(query, params)
            return cur.fetchone()

    async def fetchall(self, query: str, params=()):
        async with self.lock:
            cur = self.conn.execute(query, params)
            return cur.fetchall()


store = Store(DB_PATH)

intents = discord.Intents.default()
intents.guilds = True
intents.members = True
bot = commands.Bot(command_prefix="!", intents=intents)


async def get_settings(guild_id: int):
    return await store.fetchone("SELECT * FROM guild_settings WHERE guild_id = ?", (str(guild_id),))


async def is_staff(interaction: discord.Interaction) -> bool:
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        return False
    if interaction.user.guild_permissions.manage_guild or interaction.user.guild_permissions.administrator:
        return True
    settings = await get_settings(interaction.guild.id)
    if settings and settings["admin_role_id"]:
        return any(str(role.id) == settings["admin_role_id"] for role in interaction.user.roles)
    return False


async def audit(guild_id: int, actor_id: int, action: str, details: str = ""):
    await store.execute(
        "INSERT INTO audit_log (guild_id, actor_user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
        (str(guild_id), str(actor_id), action, details[:1500], now_iso()),
    )
    settings = await get_settings(guild_id)
    if settings and settings["log_channel_id"]:
        channel = bot.get_channel(int(settings["log_channel_id"]))
        if isinstance(channel, discord.TextChannel):
            try:
                await channel.send(f"**{action}** by <@{actor_id}>\n{details[:1800]}")
            except discord.DiscordException:
                pass


async def require_staff(interaction: discord.Interaction) -> bool:
    if await is_staff(interaction):
        return True
    await interaction.response.send_message("You need Manage Server or the configured admin role to use this.", ephemeral=True)
    return False


@bot.event
async def on_ready():
    if GUILD_ID:
        guild = discord.Object(id=int(GUILD_ID))
        bot.tree.copy_global_to(guild=guild)
        synced = await bot.tree.sync(guild=guild)
        print(f"Synced {len(synced)} commands to guild {GUILD_ID}")
    else:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} global commands")
    print(f"Logged in as {bot.user} ({bot.user.id})")


@bot.tree.command(description="Configure roles and logging for the licensing bot.")
@app_commands.describe(admin_role="Role allowed to manage scripts/keys", customer_role="Role assigned after redeem", log_channel="Channel for audit logs")
async def setup(
    interaction: discord.Interaction,
    admin_role: Optional[discord.Role] = None,
    customer_role: Optional[discord.Role] = None,
    log_channel: Optional[discord.TextChannel] = None,
):
    if not interaction.guild or not isinstance(interaction.user, discord.Member):
        await interaction.response.send_message("Run this in a server.", ephemeral=True)
        return
    if not interaction.user.guild_permissions.manage_guild and not interaction.user.guild_permissions.administrator:
        await interaction.response.send_message("You need Manage Server to run setup.", ephemeral=True)
        return

    await store.execute(
        """
        INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            admin_role_id=excluded.admin_role_id,
            customer_role_id=excluded.customer_role_id,
            log_channel_id=excluded.log_channel_id,
            updated_at=excluded.updated_at
        """,
        (
            str(interaction.guild.id),
            str(admin_role.id) if admin_role else None,
            str(customer_role.id) if customer_role else None,
            str(log_channel.id) if log_channel else None,
            now_iso(),
        ),
    )
    await audit(interaction.guild.id, interaction.user.id, "setup", "Updated guild settings")
    await interaction.response.send_message("Setup saved.", ephemeral=True)


@bot.tree.command(description="Create a script/product to license.")
@app_commands.describe(name="Script/product name", webhook_url="Optional webhook URL for your own notifications")
async def createscript(interaction: discord.Interaction, name: str, webhook_url: Optional[str] = None):
    if not interaction.guild:
        await interaction.response.send_message("Run this in a server.", ephemeral=True)
        return
    if not await require_staff(interaction):
        return
    script_id = make_id("scr")
    api_secret = secrets.token_urlsafe(32)
    await store.execute(
        "INSERT INTO scripts (id, guild_id, name, api_secret, owner_user_id, webhook_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (script_id, str(interaction.guild.id), name[:100], api_secret, str(interaction.user.id), webhook_url, now_iso()),
    )
    await audit(interaction.guild.id, interaction.user.id, "createscript", f"Created
