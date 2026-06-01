import os

STEAM_API_KEY = os.environ.get("STEAM_API_KEY")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

STEAM_IDS = [
    sid.strip()
    for sid in os.environ.get("STEAM_IDS", "").split(",")
    if sid.strip()
]

BASE_URL = "https://api.steampowered.com"
WEBSTORE_URL = "https://store.steampowered.com"
