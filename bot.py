import os
import requests
from bs4 import BeautifulSoup
from datetime import datetime

from config import STEAM_IDS, DISCORD_WEBHOOK_URL
from steam_api import get_player_summaries, get_owned_games

# ----------------------------
# IN-MEMORY STATE (NO FILES)
# ----------------------------
STATE = {
    "owned_games": {},
    "reviews": set()
}

# ----------------------------
# DISCORD WEBHOOK
# ----------------------------
def send_embed(embed):
    if not DISCORD_WEBHOOK_URL:
        print("Missing DISCORD_WEBHOOK_URL")
        return

    try:
        requests.post(
            DISCORD_WEBHOOK_URL,
            json={"embeds": [embed]},
            timeout=10
        )
    except Exception as e:
        print("Discord webhook error:", e)


# ----------------------------
# 🛒 NEW GAME PURCHASES
# ----------------------------
def check_new_purchases():
    print("Checking new purchases...")

    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue

        player = players[0]
        name = player.get("personaname", "Unknown")

        games = get_owned_games(steamid)
        current_ids = {str(g["appid"]): g for g in games}

        previous_ids = STATE["owned_games"].get(steamid)

        # First run baseline (no alerts)
        if not previous_ids:
            STATE["owned_games"][steamid] = set(current_ids.keys())
            continue

        previous_ids = STATE["owned_games"][steamid]

        new_games = set(current_ids.keys()) - previous_ids

        for appid in new_games:
            game = current_ids.get(appid)

            embed = {
                "title": "🛒 New Steam Purchase",
                "description": f"**{name}** bought **{game.get('name', 'Unknown Game')}**",
                "color": 0x57F287,
                "timestamp": datetime.utcnow().isoformat()
            }

            send_embed(embed)

        STATE["owned_games"][steamid] = set(current_ids.keys())


# ----------------------------
# ✍️ STEAM REVIEWS (SCRAPE)
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

        reviews = get_reviews(steamid)

        for review_url in reviews:
            key = f"{steamid}:{review_url}"

            if key in STATE["reviews"]:
                continue

            STATE["reviews"].add(key)

            embed = {
                "title": "✍️ New Steam Review",
                "description": f"**{name}** posted a new review",
                "url": review_url,
                "color": 0x3498DB,
                "timestamp": datetime.utcnow().isoformat()
            }

            send_embed(embed)


# ----------------------------
# MAIN ENTRY (GitHub Actions safe)
# ----------------------------
def main():
    print("Steam bot running (cron-job / Actions mode)")

    check_new_purchases()
    check_reviews()

    print("Done")


if __name__ == "__main__":
    main()
