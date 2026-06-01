import os

# GitHub Secrets are injected as environment variables
STEAM_API_KEY = os.getenv("STEAM_API_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")
STEAM_IDS = [sid.strip() for sid in os.getenv("STEAM_IDS", "").split(",") if sid.strip()]

BASE_URL = "https://api.steampowered.com"

# Validate required secrets
if not STEAM_API_KEY:
    raise ValueError("STEAM_API_KEY not found in environment variables")
if not DISCORD_WEBHOOK_URL:
    raise ValueError("DISCORD_WEBHOOK_URL not found in environment variables")
if not STEAM_IDS:
    raise ValueError("STEAM_IDS not found in environment variables")
