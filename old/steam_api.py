import requests
from config import STEAM_API_KEY, BASE_URL


def get_player_summaries(steamids):
    url = f"{BASE_URL}/ISteamUser/GetPlayerSummaries/v2/"
    params = {
        "key": STEAM_API_KEY,
        "steamids": ",".join(steamids)
    }

    try:
        r = requests.get(url, params=params, timeout=10)
        return r.json().get("response", {}).get("players", [])
    except:
        return []


def get_owned_games(steamid):
    url = f"{BASE_URL}/IPlayerService/GetOwnedGames/v1/"
    params = {
        "key": STEAM_API_KEY,
        "steamid": steamid,
        "include_appinfo": 1
    }

    try:
        r = requests.get(url, params=params, timeout=10)
        return r.json().get("response", {}).get("games", [])
    except:
        return []


def get_app_details(appid):
    url = "https://store.steampowered.com/api/appdetails"
    params = {"appids": appid}

    try:
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
        if data.get(str(appid), {}).get("success"):
            return data[str(appid)]["data"]
    except:
        return {}

    return {}
