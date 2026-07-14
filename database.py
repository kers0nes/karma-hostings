import os
import secrets
import hashlib
import base64
from datetime import datetime, timedelta

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")

_conn = None


def get_db():
    global _conn
    if _conn is None or _conn.closed:
        _conn = psycopg2.connect(DATABASE_URL, sslmode="require")
        _conn.autocommit = True
    return _conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            discord_id TEXT UNIQUE,
            username TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            password_salt TEXT,
            avatar TEXT,
            access_token TEXT,
            provider TEXT,
            recovery_token TEXT,
            recovery_expires TEXT,
            deleted_at TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            key TEXT UNIQUE NOT NULL,
            name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TEXT
        );
        CREATE TABLE IF NOT EXISTS scripts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            code TEXT,
            obfuscated_code TEXT,
            version TEXT DEFAULT '1.0.0',
            status TEXT DEFAULT 'active',
            ffa_mode INTEGER DEFAULT 0,
            compress_mode INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS license_keys (
            id TEXT PRIMARY KEY,
            script_id TEXT NOT NULL REFERENCES scripts(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            key TEXT UNIQUE NOT NULL,
            hwid TEXT,
            note TEXT,
            expires_at TEXT,
            resettable TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TEXT
        );
        CREATE TABLE IF NOT EXISTS banned_hwids (
            hwid TEXT PRIMARY KEY,
            reason TEXT,
            banned_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS panels (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            description TEXT,
            channel_id TEXT NOT NULL,
            script_id TEXT NOT NULL REFERENCES scripts(id),
            hwid_cooldown INTEGER DEFAULT 180,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS whitelist (
            id TEXT PRIMARY KEY,
            script_id TEXT NOT NULL REFERENCES scripts(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            key TEXT UNIQUE NOT NULL,
            discord_id TEXT NOT NULL,
            username TEXT,
            hwid TEXT,
            expires_at TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            admin_role_id TEXT,
            customer_role_id TEXT,
            log_channel_id TEXT,
            panel_channel_id TEXT,
            panel_message_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS bot_scripts (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            api_secret_hash TEXT NOT NULL,
            api_secret_preview TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            redeemed_at TEXT
        );
    """)
    cur.close()


def fetchone(sql: str, params: tuple = ()) -> dict | None:
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    row = cur.fetchone()
    cur.close()
    return dict(row) if row else None


def fetchall(sql: str, params: tuple = ()) -> list:
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    return [dict(r) for r in rows]


def execute(sql: str, params: tuple = ()):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(sql, params)
    cur.close()


# ---- Helpers ----

def make_id(prefix: str = "script") -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def generate_key() -> str:
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    parts = ["KARMA"]
    for _ in range(4):
        parts.append("".join(secrets.choice(chars) for _ in range(4)))
    return "-".join(parts)


def generate_api_key() -> str:
    return "kp_" + secrets.token_hex(32)


def generate_recovery_token() -> str:
    return secrets.token_hex(32)


def mask_key(key: str) -> str:
    if not key:
        return "Invalid"
    return "KARMA-****-****-" + key[-4:].upper()


def add_hours(hours: int) -> str | None:
    if hours and hours > 0:
        return (datetime.utcnow() + timedelta(hours=hours)).isoformat()
    return None


def is_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return False
    try:
        exp = datetime.fromisoformat(expires_at)
        return exp.timestamp() < datetime.utcnow().timestamp()
    except (ValueError, TypeError):
        return False


def format_expiry(expires_at: str | None) -> str:
    if not expires_at:
        return "Permanent"
    try:
        dt = datetime.fromisoformat(expires_at)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return "Invalid"


def escape_html(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#039;"))


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000).hex()


def generate_salt() -> str:
    return secrets.token_hex(16)


def obfuscate_lua(code: str) -> str:
    b64 = base64.b64encode(code.encode()).decode()
    return f'--[[ Obfuscated by Karma Protection ]]\nlocal code = "{b64}"\nlocal decoded = (function(s) return (s:gsub("..", function(c) return string.char(tonumber(c, 16)) end)) end)(code)\nloadstring(decoded)()'


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def make_key(prefix: str = "PS") -> str:
    raw = secrets.token_urlsafe(18).upper()
    chunks = [raw[i:i+6] for i in range(0, len(raw), 6)]
    return f"{prefix}-{'-'.join(chunks)}"


def public_base_url() -> str:
    return os.environ.get("PUBLIC_BASE_URL", "http://localhost:5000").rstrip("/")


# ---- User queries ----

def get_user_by_email(email: str) -> dict | None:
    return fetchone("SELECT * FROM users WHERE email = %s AND deleted_at IS NULL", (email,))


def get_user_by_discord_id(discord_id: str) -> dict | None:
    return fetchone("SELECT * FROM users WHERE discord_id = %s AND deleted_at IS NULL", (discord_id,))


def get_user_by_recovery_token(token: str) -> dict | None:
    return fetchone(
        "SELECT * FROM users WHERE recovery_token = %s AND recovery_expires > NOW() AND deleted_at IS NULL",
        (token,)
    )


# ---- Script queries ----

def get_scripts_by_user(user_id: str) -> list:
    return fetchall(
        "SELECT * FROM scripts WHERE user_id = %s AND deleted_at IS NULL ORDER BY created_at DESC",
        (user_id,)
    )


def get_script_by_id(script_id: str) -> dict | None:
    return fetchone("SELECT * FROM scripts WHERE id = %s", (script_id,))


def get_script_by_id_and_user(script_id: str, user_id: str) -> dict | None:
    return fetchone("SELECT * FROM scripts WHERE id = %s AND user_id = %s", (script_id, user_id))


# ---- Panel queries ----

def get_panels_by_user(user_id: str) -> list:
    return fetchall("SELECT * FROM panels WHERE user_id = %s ORDER BY created_at DESC", (user_id,))


def get_panel_by_id_and_user(panel_id: str, user_id: str) -> dict | None:
    return fetchone("SELECT * FROM panels WHERE id = %s AND user_id = %s", (panel_id, user_id))


# ---- Key queries ----

def get_keys_by_user(user_id: str) -> list:
    return fetchall("SELECT * FROM license_keys WHERE user_id = %s ORDER BY created_at DESC", (user_id,))


def get_key_by_value(key_val: str) -> dict | None:
    return fetchone("SELECT * FROM license_keys WHERE key = %s", (key_val,))


def get_key_by_value_and_user(key_val: str, user_id: str) -> dict | None:
    return fetchone("SELECT * FROM license_keys WHERE key = %s AND user_id = %s", (key_val, user_id))


def get_key_by_value_and_script(key_val: str, script_id: str) -> dict | None:
    return fetchone("SELECT * FROM license_keys WHERE key = %s AND script_id = %s", (key_val, script_id))


# ---- HWID queries ----

def get_banned_hwids() -> list:
    return fetchall("SELECT * FROM banned_hwids ORDER BY created_at DESC")


def get_banned_hwid(hwid: str) -> dict | None:
    return fetchone("SELECT * FROM banned_hwids WHERE hwid = %s", (hwid,))


# ---- Whitelist queries ----

def get_whitelist_by_user(user_id: str) -> list:
    return fetchall("SELECT * FROM whitelist WHERE user_id = %s ORDER BY created_at DESC", (user_id,))


def get_whitelist_entry_by_id(id_val: str) -> dict | None:
    return fetchone("SELECT * FROM whitelist WHERE id = %s", (id_val,))


# ---- API Key queries ----

def get_api_keys_by_user(user_id: str) -> list:
    return fetchall(
        "SELECT id, key, name, created_at, last_used_at FROM api_keys WHERE user_id = %s ORDER BY created_at DESC",
        (user_id,)
    )


# ---- Discord bot queries (from db.js) ----

def get_settings(guild_id: str) -> dict | None:
    return fetchone("SELECT * FROM guild_settings WHERE guild_id = %s", (guild_id,))


def upsert_settings(guild_id: str, patch: dict) -> None:
    current = get_settings(guild_id) or {}
    merged = {**current, **patch}
    execute("""
        INSERT INTO guild_settings (guild_id, admin_role_id, customer_role_id, log_channel_id, panel_channel_id, panel_message_id, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (guild_id) DO UPDATE SET
            admin_role_id = EXCLUDED.admin_role_id,
            customer_role_id = EXCLUDED.customer_role_id,
            log_channel_id = EXCLUDED.log_channel_id,
            panel_channel_id = EXCLUDED.panel_channel_id,
            panel_message_id = EXCLUDED.panel_message_id,
            updated_at = NOW()
    """, (
        guild_id,
        merged.get("admin_role_id"),
        merged.get("customer_role_id"),
        merged.get("log_channel_id"),
        merged.get("panel_channel_id"),
        merged.get("panel_message_id"),
    ))


def create_script_entry(guild_id: str, name: str, created_by: str) -> dict:
    script_id = make_id("script")
    api_secret = f"ps_{secrets.token_urlsafe(32)}"
    execute("""
        INSERT INTO bot_scripts (id, guild_id, name, api_secret_hash, api_secret_preview, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        script_id,
        guild_id,
        name,
        hash_secret(api_secret),
        f"{api_secret[:8]}...{api_secret[-6:]}",
        created_by,
    ))
    return {"id": script_id, "name": name, "apiSecret": api_secret}


def verify_admin(member, settings: dict | None) -> bool:
    if not member:
        return False
    if member.guild_permissions.administrator:
        return True
    if settings and settings.get("admin_role_id"):
        role_ids = [str(r.id) for r in member.roles]
        return settings["admin_role_id"] in role_ids
    return False
