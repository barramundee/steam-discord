#!/usr/bin/env python3
import os
import json
from datetime import datetime, timedelta
from collections import defaultdict
import requests
from config import STEAM_API_KEY, DISCORD_WEBHOOK_URL, STEAM_IDS
from steam_api import (
    get_player_summaries, get_owned_games, get_recently_played_games,
    get_player_achievements, get_game_news, get_app_details
)

def send_discord_embed(title, description, color, fields=None, thumbnail_url=None):
    """Send an embed to Discord via webhook"""
    if not DISCORD_WEBHOOK_URL:
        print("⚠️ No webhook URL configured")
        return False
    
    payload = {
        "embeds": [{
            "title": title,
            "description": description,
            "color": color,
            "footer": {"text": "Steam Friend Activity"},
            "timestamp": datetime.now().isoformat()
        }]
    }
    
    if fields:
        payload["embeds"][0]["fields"] = fields
    
    if thumbnail_url:
        payload["embeds"][0]["thumbnail"] = {"url": thumbnail_url}
    
    try:
        resp = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"❌ Error sending webhook: {e}")
        return False

def get_rarity_color(rarity_percent):
    """Get color based on achievement rarity"""
    if rarity_percent < 5:
        return 0xFF0000
    elif rarity_percent < 10:
        return 0xFF7F00
    elif rarity_percent < 25:
        return 0xFFD700
    else:
        return 0x00FF00

def check_friend_achievements():
    """Check for newly unlocked achievements in last 24h"""
    count = 0
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        avatar = player.get("avatarfull")
        
        owned = get_owned_games(steamid)
        for game in owned[:20]:
            appid = game.get("appid")
            achievements_data = get_player_achievements(steamid, appid)
            if not achievements_data.get("playerstats"):
                continue
            
            achievements = achievements_data["playerstats"].get("achievements", [])
            for ach in achievements:
                unlocktime = ach.get("unlocktime", 0)
                if unlocktime == 0:
                    continue
                
                unlock_time = datetime.fromtimestamp(unlocktime)
                if unlock_time > datetime.now() - timedelta(hours=24):
                    rarity = ach.get("percent", 50)
                    success = send_discord_embed(
                        title=f"🏆 {name} unlocked an achievement!",
                        description=f"**{ach['displayName']}** in **{game.get('name', 'Unknown Game')}**",
                        color=get_rarity_color(rarity),
                        fields=[
                            {"name": "Rarity", "value": f"{rarity}%", "inline": True},
                            {"name": "Unlocked", "value": unlock_time.strftime("%b %d, %Y"), "inline": True}
                        ],
                        thumbnail_url=avatar
                    )
                    if success:
                        count += 1
                        print(f"✓ Sent achievement for {name}: {ach['displayName']}")
    return count

def check_first_play():
    """Check for first-time game plays"""
    count = 0
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        avatar = player.get("avatarfull")
        
        recent = get_recently_played_games(steamid)
        for game in recent:
            playtime = game.get("playtime_2weeks", 0)
            if 0 < playtime < 5:
                success = send_discord_embed(
                    title=f"🎮 {name} played a game for the first time!",
                    description=f"**{game.get('name', 'Unknown')}**",
                    color=0x00FF00,
                    fields=[
                        {"name": "Playtime (2 weeks)", "value": f"{playtime} min", "inline": True}
                    ],
                    thumbnail_url=avatar
                )
                if success:
                    count += 1
                    print(f"✓ Sent first play for {name}: {game.get('name')}")
    return count

def check_playtime_milestones():
    """Check for playtime milestones (10h, 50h, 100h)"""
    milestones = [(600, "10h"), (3000, "50h"), (6000, "100h")]
    count = 0
    
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        avatar = player.get("avatarfull")
        
        owned = get_owned_games(steamid)
        for game in owned:
            playtime = game.get("playtime_forever", 0)
            for milestone, label in milestones:
                if milestone - 60 <= playtime <= milestone + 60:
                    success = send_discord_embed(
                        title=f"⏱️ {name} hit a playtime milestone!",
                        description=f"**{game.get('name', 'Unknown')}**",
                        color=0xFFD700,
                        fields=[
                            {"name": "Playtime", "value": f"{playtime // 60}h {playtime % 60}m", "inline": True},
                            {"name": "Milestone", "value": label, "inline": True}
                        ],
                        thumbnail_url=avatar
                    )
                    if success:
                        count += 1
                        print(f"✓ Sent milestone for {name}: {game.get('name')} at {label}")
    return count

def check_friends_playing_same_game():
    """Check how many friends are playing the same game"""
    game_players = defaultdict(list)
    
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        avatar = player.get("avatarfull")
        
        recent = get_recently_played_games(steamid)
        for game in recent:
            if game.get("playtime_2weeks", 0) > 10:
                game_players[game["appid"]].append((name, avatar))
    
    count = 0
    for appid, players_list in game_players.items():
        if len(players_list) >= 2:
            game_details = get_app_details(appid)
            game_name = game_details.get("name", players_list[0][0])
            
            success = send_discord_embed(
                title=f"👥 {len(players_list)} friends are playing the same game!",
                description=f"**{game_name}**",
                color=0x00BFFF,
                fields=[
                    {"name": "Friends", "value": "\n".join([f"• {name}" for name, _ in players_list]), "inline": False}
                ],
                thumbnail_url=players_list[0][1]
            )
            if success:
                count += 1
                print(f"✓ Sent friends playing: {game_name} ({len(players_list)} friends)")
    return count

def check_games_friends_own():
    """Find popular games among friends"""
    game_owners = defaultdict(list)
    
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        
        owned = get_owned_games(steamid)
        for game in owned[:30]:
            game_owners[game["appid"]].append(name)
    
    count = 0
    for appid, owners in game_owners.items():
        if len(owners) >= 3:
            game_details = get_app_details(appid)
            game_name = game_details.get("name", "Unknown Game")
            
            success = send_discord_embed(
                title=f"🔔 A game your friends own!",
                description=f"**{game_name}**",
                color=0xFF6347,
                fields=[
                    {"name": f"{len(owners)} friends play this", "value": "\n".join([f"• {name}" for name in owners]), "inline": False}
                ]
            )
            if success:
                count += 1
                print(f"✓ Sent friends own: {game_name} ({len(owners)} friends)")
    return count

def check_steam_sales():
    """Check for major Steam sales"""
    news = get_game_news(1, limit=5)
    count = 0
    
    if news.get("appnews", {}).get("newsitems"):
        for item in news["appnews"]["newsitems"][:2]:
            title = item.get("title", "").lower()
            if "sale" in title or "deal" in title or "discount" in title:
                success = send_discord_embed(
                    title=f"🛍️ Major Steam Sale Started!",
                    description=f"**{item['title']}**",
                    color=0xFF4500,
                    fields=[
                        {"name": "Published", "value": item.get("date", ""), "inline": True}
                    ],
                    thumbnail_url=item.get("url")
                )
                if success:
                    count += 1
                    print(f"✓ Sent Steam sale: {item['title']}")
    return count

def generate_weekly_digest():
    """Generate weekly digest"""
    total_playtime = defaultdict(int)
    
    for steamid in STEAM_IDS:
        players = get_player_summaries([steamid])
        if not players:
            continue
        player = players[0]
        name = player.get("personaname", "Unknown")
        
        recent = get_recently_played_games(steamid)
        for game in recent:
            total_playtime[name] += game.get("playtime_2weeks", 0)
    
    if not total_playtime:
        print("⚠️ No playtime data for digest")
        return 0
    
    top_player = max(total_playtime.items(), key=lambda x: x[1])
    playtime_list = "\n".join([f"• {name}: {pts // 60}h {pts % 60}m" for name, pts in sorted(total_playtime.items(), key=lambda x: -x[1])[:5]])
    
    success = send_discord_embed(
        title="📊 Weekly Steam Digest",
        description="Here's what happened this week!",
        color=0x9932CC,
        fields=[
            {"name": "👑 Most Hours Played", "value": f"**{top_player[0]}** - {top_player[1] // 60}h {top_player[1] % 60}m", "inline": False},
            {"name": "⏱️ Top Playtime", "value": playtime_list, "inline": False}
        ]
    )
    
    if success:
        print("✓ Sent weekly digest")
        return 1
    return 0

def main():
    """Run all checks"""
    print("=" * 50)
    print(f"Steam Discord Bot - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Monitoring {len(STEAM_IDS)} friends")
    print("=" * 50)
    
    total_sent = 0
    
    print("\n🏆 Checking friend achievements...")
    total_sent += check_friend_achievements()
    
    print("\n🎮 Checking first plays...")
    total_sent += check_first_play()
    
    print("\n⏱️ Checking playtime milestones...")
    total_sent += check_playtime_milestones()
    
    print("\n👥 Checking friends playing same game...")
    total_sent += check_friends_playing_same_game()
    
    print("\n🔔 Checking games friends own...")
    total_sent += check_games_friends_own()
    
    print("\n🛍️ Checking Steam sales...")
    total_sent += check_steam_sales()
    
    print("\n" + "=" * 50)
    print(f"✅ Sent {total_sent} notifications")
    print("=" * 50)
    
    return total_sent

if __name__ == "__main__":
    main()
