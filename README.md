# 🎮 Steam Discord Bot

Posts to a Discord channel when friends unlock achievements, buy games, hit playtime milestones, and more. Runs free on GitHub Actions — no server required.

## Features

**Friend activity**
- 🏆 Friend unlocks an achievement — name and rarity %
- 🎮 Friend plays a game for the first time
- 🛒 Friend buys a new game
- ⏱️ Friend hits a playtime milestone (10h, 25h, 50h, 100h, 200h, 500h, 1000h)
- 💯 Friend 100% completes a game
- 🥇 Friend reaches a new Steam level

**Social**
- 👥 2+ friends playing the same game at the same time

**Wishlist & deals**
- 💸 A wishlisted game goes on sale — tags friends who have it wishlisted

**Platform events**
- 🛍️ Major Steam sales detected

**Weekly digest** (Sundays at 6pm UTC)
- 📊 Everyone's playtime, top game, new games, achievements
- 👑 Crown for most hours played

---

## Setup

### 1. Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |
| `STEAM_API_KEY` | Your Steam API key from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| `STEAM_IDS` | Comma-separated Steam ID64s, e.g. `76561198012345678,76561198087654321` |

### 2. Upload files

Add these files to your repo:
- `check.js`
- `state.json` (initial content: `{}`)
- `.github/workflows/check.yml`

### 3. Run manually first

Go to **Actions → Steam Checker → Run workflow** to trigger the first run. This seeds the state without posting anything.

### 4. Set up cron-job.org

Since GitHub's scheduler can be slow to start, use [cron-job.org](https://cron-job.org) to trigger it reliably:

1. Create a free account
2. Create a new cronjob with:
   - **URL:** `https://api.steampowered.com/repos/YOUR_USERNAME/steam-discord/actions/workflows/check.yml/dispatches`
   - Actually use: `https://api.github.com/repos/YOUR_USERNAME/steam-discord/actions/workflows/check.yml/dispatches`
   - **Method:** POST
   - **Headers:** `Authorization: Bearer YOUR_GITHUB_TOKEN`, `Accept: application/vnd.github+json`, `Content-Type: application/json`
   - **Body:** `{"ref":"main"}`
   - **Schedule:** every 5 minutes

### 5. Add/remove friends

To add or remove a Steam ID, update the `STEAM_IDS` secret in GitHub.

---

## Notes

- All tracked profiles must be set to **public** on Steam
- Achievements are only checked for games played in the last 2 weeks (to stay within API limits)
- The weekly digest posts on Sundays between 6–7pm UTC
