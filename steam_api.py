import requests
from config import STEAM_API_KEY, BASE_URL

def get_player_summaries(steamids):
    """Get player info (name, avatar, account created)"""
    url = f"{BASE_URL}/ISteamUser/GetPlayerSummaries/v2/"
    params = {"key": STEAM_API_KEY, "steamids": ",".join(steamids)}
    try:
        resp = requests.get(url, params=params, timeout=10)
        return resp.json().get("response", {}).get("players", [])
    except:
        return []

def get_owned_games(steamid):
    """Get list of games owned by a user"""
    url = f"{BASE_URL}/IPlayerService/GetOwnedGames/v1/"
    params = {"key": STEAM_API_KEY, "steamid": steamid, "include_appinfo": 1}
    try:
        resp = requests.get(url, params=params, timeout=10)
        return resp.json().get("response", {}).get("games", [])
    except:
        return []

def get_recently_played_games(steamid):
    """Get games played in the last 2 weeks"""
    url = f"{BASE_URL}/IPlayerService/GetRecentlyPlayedGames/v1/"
    params = {"key": STEAM_API_KEY, "steamid": steamid}
    try:
        resp = requests.get(url, params=params, timeout=10)
        return resp.json().get("response", {}).get("games", [])
    except:
        return []

def get_player_achievements(steamid, appid):
    """Get achievements for a specific game"""
    url = f"{BASE_URL}/ISteamUserStats/GetPlayerAchievements/v1/"
    params = {"key": STEAM_API_KEY, "steamid": steamid, "appid": appid}
    try:
        resp = requests.get(url, params=params, timeout=10)
        return resp.json()
    except:
        return {}

def get_game_news(appid, limit=3):
    """Get recent news for a game"""
    url = f"{BASE_URL}/ISteamNews/GetNewsForApp/v1/"
    params = {"key": STEAM_API_KEY, "appid": appid, "format": "json", "limit": limit}
    try:
        resp = requests.get(url, params=params, timeout=10)
        return resp.json()
    except:
        return {}

def get_app_details(appid):
    """Get app details including price and review score"""
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}&currency=USD"
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if appid in data and data[appid].get("success"):
            return data[appid].get("data", {})
    except:
        pass
    return {}
