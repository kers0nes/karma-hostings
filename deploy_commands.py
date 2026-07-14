import os
import requests
from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.environ.get("DISCORD_TOKEN")
CLIENT_ID = os.environ.get("CLIENT_ID")
GUILD_ID = os.environ.get("GUILD_ID")

if not DISCORD_TOKEN or not CLIENT_ID:
    print("Missing DISCORD_TOKEN or CLIENT_ID in .env")
    exit(1)

commands = [
    {
        "name": "setup",
        "description": "Configure the license panel and roles",
        "options": [
            {"name": "admin_role", "description": "Admin role", "type": 8, "required": True},
            {"name": "customer_role", "description": "Customer role", "type": 8, "required": True},
            {"name": "panel_channel", "description": "Channel for panel", "type": 7, "required": True},
            {"name": "log_channel", "description": "Log channel (optional)", "type": 7, "required": False},
        ],
    },
    {
        "name": "createscript",
        "description": "Create a new protected script",
        "options": [
            {"name": "name", "description": "Script name", "type": 3, "required": True},
        ],
    },
    {
        "name": "scripts",
        "description": "List all scripts in this server",
    },
    {
        "name": "genkey",
        "description": "Generate license keys",
        "options": [
            {"name": "script_id", "description": "Script ID", "type": 3, "required": True},
            {"name": "days", "description": "Key duration in days", "type": 4, "required": True},
            {"name": "quantity", "description": "Number of keys (default 1)", "type": 4, "required": False},
        ],
    },
    {
        "name": "redeem",
        "description": "Redeem a license key",
        "options": [
            {"name": "key", "description": "License key", "type": 3, "required": True},
        ],
    },
    {
        "name": "reset-hwid",
        "description": "Reset HWID for a key",
        "options": [
            {"name": "key", "description": "License key", "type": 3, "required": True},
        ],
    },
    {
        "name": "revoke",
        "description": "Revoke a license key",
        "options": [
            {"name": "key", "description": "License key", "type": 3, "required": True},
        ],
    },
    {
        "name": "keyinfo",
        "description": "Get info about a license key",
        "options": [
            {"name": "key", "description": "License key", "type": 3, "required": True},
        ],
    },
    {
        "name": "mykeys",
        "description": "View your redeemed keys",
    },
    {
        "name": "loader",
        "description": "Get loader code for a script",
        "options": [
            {"name": "script_id", "description": "Script ID", "type": 3, "required": True},
        ],
    },
]

url = f"https://discord.com/api/v10/applications/{CLIENT_ID}/commands"
if GUILD_ID:
    url = f"https://discord.com/api/v10/applications/{CLIENT_ID}/guilds/{GUILD_ID}/commands"

headers = {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}

resp = requests.put(url, json=commands, headers=headers)

if resp.ok:
    print(f"Deployed {len(commands)} commands {'to guild ' + GUILD_ID if GUILD_ID else 'globally'}.")
else:
    print(f"Failed: {resp.status_code} {resp.text}")
