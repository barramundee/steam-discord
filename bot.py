import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime

from config import STEAM_IDS, DISCORD_WEBHOOK_URL
from steam_api import (
    get_player_summaries,
    get_owned_games,
    get_app_details
)

# ----------------------------
# FILE STATE (PERSISTENT)
# ----------------------------
REVIEWS_FILE = "state_reviews.json"
GAMES_FILE = "state_games.json"


def load_json(file, default):
    if os.path.exists(file):
        try:
            with open(file, "r") as f:
                return json.load(f)
        except:
            pass
    return default


def save_json(file, data):
    with open(file, "w") as f:
        json.dump(data, f, indent=2)


# ----------------------------
# DISCORD
# ----------------------------
def send_embed(embed):
    if not DISCORD_WEBHOOK_URL:
        return

    requests.post(
        DISCORD_WEBHOOK_URL,
        json={"embeds": [embed]},
        timeout=10
    )


# ----------------------------
# 🛒 NEW PURCHASES
# ----------------------------
def check_new_purchases():
    print("Checking purchases...")

    state = load_json(GAMES_FILE, {})

    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue

        player = players[0]
        name = player.get("personaname", "Unknown")

        games = get_owned_games(steamid)
        current = {str(g["appid"]): g for g in games}

        previous = set(state.get(steamid, []))

        if not previous:
            state[steamid] = list(current.keys())
            continue

        new_games = set(current.keys()) - previous

        for appid in new_games:
            game = current.get(appid)
            details = get_app_details(appid)

            game_name = details.get("name", game.get("name", "Unknown"))

            embed = {
                "title": "🛒 New Steam Purchase",
                "description": f"**{name}** bought **{game_name}**",
                "color": 0x57F287,
                "timestamp": datetime.utcnow().isoformat()
            }

            send_embed(embed)

        state[steamid] = list(current.keys())

    save_json(GAMES_FILE, state)


# ----------------------------
# ✍️ REVIEWS (FIXED)
# ----------------------------
def get_reviews(steamid):
    url = f"https://steamcommunity.com/profiles/{steamid}/recommended"

    try:
        r = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10
        )

        soup = BeautifulSoup(r.text, "html.parser")

        reviews = []

        for item in soup.select(".review_box"):
            link = item.find("a")
            if link and link.get("href"):
                reviews.append(link["href"])

        return reviews

    except:
        return []


def check_reviews():
    print("Checking reviews...")

    seen = set(load_json(REVIEWS_FILE, []))

    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue

        player = players[0]
        name = player.get("personaname", "Unknown")

        reviews = get_reviews(steamid)

        for r in reviews:
            key = f"{steamid}:{r}"

            if key in seen:
                continue

            seen.add(key)

            embed = {
                "title": "✍️ New Steam Review",
                "description": f"**{name}** posted a new review",
                "url": r,
                "color": 0x3498DB,
                "timestamp": datetime.utcnow().isoformat()
            }

            send_embed(embed)

    save_json(REVIEWS_FILE, list(seen))


# ----------------------------
# MAIN
# ----------------------------
def main():
    print("Steam bot running")

    check_new_purchases()
    check_reviews()

    print("Done")


if __name__ == "__main__":
    main()
