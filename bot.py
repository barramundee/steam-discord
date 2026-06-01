import json
import os
from datetime import datetime
import requests
from bs4 import BeautifulSoup

from config import STEAM_IDS, DISCORD_WEBHOOK_URL

from steam_api import (
    get_player_summaries,
    get_owned_games,
    get_app_details
)

STATE_FILE = "state.json"


# ----------------------------
# STATE
# ----------------------------
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)

    return {
        "owned_games": {},
        "reviews": {},
        "achievements": [],
        "sales": [],
        "milestones": []
    }


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


STATE = load_state()


# ----------------------------
# DISCORD
# ----------------------------
def send_embed(embed):
    if not DISCORD_WEBHOOK_URL:
        print("Missing webhook")
        return

    requests.post(
        DISCORD_WEBHOOK_URL,
        json={"embeds": [embed]},
        timeout=10
    )


# ----------------------------
# 🛒 NEW GAME PURCHASES
# ----------------------------
def check_new_purchases():
    print("Checking purchases...")

    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue

        player = players[0]
        name = player.get("personaname", "Unknown")

        current = get_owned_games(steamid)
        current_ids = {str(g["appid"]): g for g in current}

        previous_ids = STATE["owned_games"].get(steamid, {})

        # First run baseline
        if not previous_ids:
            STATE["owned_games"][steamid] = list(current_ids.keys())
            continue

        for appid, game in current_ids.items():
            if appid not in previous_ids:

                details = get_app_details(appid)
                game_name = details.get("name", game.get("name", "Unknown"))

                embed = {
                    "title": "🛒 New Steam Purchase",
                    "description": f"**{name}** bought **{game_name}**",
                    "color": 0x57F287,
                    "timestamp": datetime.utcnow().isoformat()
                }

                send_embed(embed)

        STATE["owned_games"][steamid] = list(current_ids.keys())

    save_state(STATE)


# ----------------------------
# ✍️ STEAM REVIEWS (SCRAPE)
# ----------------------------
def get_reviews(steamid):
    url = f"https://steamcommunity.com/profiles/{steamid}/recommended"

    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    try:
        r = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")

        reviews = []

        for item in soup.select(".review_box"):
            link = item.find("a")
            if link and link.get("href"):
                reviews.append(link["href"])

        return reviews

    except Exception as e:
        print("Review scrape failed:", e)
        return []


def check_reviews():
    print("Checking reviews...")

    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue

        player = players[0]
        name = player.get("personaname", "Unknown")

        current_reviews = get_reviews(steamid)
        previous_reviews = STATE["reviews"].get(steamid, [])

        if not previous_reviews:
            STATE["reviews"][steamid] = current_reviews
            continue

        for r in current_reviews:
            if r not in previous_reviews:

                embed = {
                    "title": "✍️ New Steam Review",
                    "description": f"**{name}** posted a new review",
                    "url": r,
                    "color": 0x3498DB,
                    "timestamp": datetime.utcnow().isoformat()
                }

                send_embed(embed)

        STATE["reviews"][steamid] = current_reviews

    save_state(STATE)


# ----------------------------
# MAIN
# ----------------------------
def main():
    print("Running Steam bot (GitHub Actions mode)")

    check_new_purchases()
    check_reviews()

    print("Done")


if __name__ == "__main__":
    main()
