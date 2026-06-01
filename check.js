const https = require("https");
const fs = require("fs");

// ─── Config ────────────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const API_KEY = process.env.STEAM_API_KEY;
const STEAM_IDS = (process.env.STEAM_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const STATE_FILE = "state.json";

if (!WEBHOOK_URL) throw new Error("Missing DISCORD_WEBHOOK_URL");
if (!API_KEY) throw new Error("Missing STEAM_API_KEY");
if (!STEAM_IDS.length) throw new Error("Missing STEAM_IDS");

// ─── HTTP helpers ──────────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "steam-discord-bot/1.0" } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on("error", reject);
  });
}

function httpsPost(url, body) {
  const data = JSON.stringify(body);
  const urlObj = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let out = "";
      res.on("data", c => out += c);
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function postEmbed(embed) {
  try {
    const res = await httpsPost(WEBHOOK_URL, { embeds: [embed] });
    if (res.status !== 204 && res.status !== 200) {
      console.error(`Webhook error ${res.status}:`, res.body);
    }
    await sleep(1000);
  } catch (err) {
    console.error("Failed to post embed:", err.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Steam API ─────────────────────────────────────────────────────────────
const STEAM = {
  playerSummaries: async (ids) => {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${API_KEY}&steamids=${ids.join(",")}`;
    const data = await httpsGet(url);
    return data?.response?.players || [];
  },
  ownedGames: async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`;
    const data = await httpsGet(url);
    return data?.response?.games || [];
  },
  recentlyPlayed: async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${API_KEY}&steamid=${steamId}&count=10`;
    const data = await httpsGet(url);
    return data?.response?.games || [];
  },
  achievements: async (steamId, appId) => {
    const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${API_KEY}&steamid=${steamId}&appid=${appId}`;
    const data = await httpsGet(url);
    return data?.playerstats?.achievements || [];
  },
  globalAchievements: async (appId) => {
    const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`;
    const data = await httpsGet(url);
    return data?.achievementpercentages?.achievements || [];
  },
  gameSchema: async (appId) => {
    const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${API_KEY}&appid=${appId}`;
    const data = await httpsGet(url);
    return data?.game?.availableGameStats?.achievements || [];
  },
  playerLevel: async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${API_KEY}&steamid=${steamId}`;
    const data = await httpsGet(url);
    return data?.response?.player_level || 0;
  },
  wishlist: async (steamId) => {
    const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/`;
    const data = await httpsGet(url);
    return data || {};
  },
  appDetails: async (appId) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=gb&l=en`;
    const data = await httpsGet(url);
    return data?.[appId]?.data || null;
  },
  featuredCategories: async () => {
    const url = `https://store.steampowered.com/api/featuredcategories?cc=gb&l=en`;
    return await httpsGet(url);
  },
};

// ─── State ─────────────────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  fs.writeFileSync("changed.txt", "1");
}

// ─── Embeds ────────────────────────────────────────────────────────────────
function gameThumb(appId) {
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/header.jpg`;
}

function profileUrl(steamId) {
  return `https://steamcommunity.com/profiles/${steamId}`;
}

function buildAchievementEmbed(player, achievement, rarity, appName, appId) {
  const rarityText = rarity != null ? `${rarity.toFixed(1)}% of players have this` : null;
  return {
    color: 0xF5A623,
    author: { name: `${player.personaname} unlocked an achievement`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: achievement.displayName || achievement.apiname,
    description: achievement.description || null,
    fields: [
      { name: "Game", value: appName, inline: true },
      ...(rarityText ? [{ name: "Rarity", value: rarityText, inline: true }] : []),
    ],
    thumbnail: { url: gameThumb(appId) },
  };
}

function buildNewGameEmbed(player, game) {
  return {
    color: 0x1b2838,
    author: { name: `${player.personaname} got a new game`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildMilestoneEmbed(player, game, hours) {
  return {
    color: 0x1b2838,
    author: { name: `${player.personaname} hit a playtime milestone`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    fields: [{ name: "Hours played", value: `${hours} hours`, inline: true }],
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildFirstPlayEmbed(player, game) {
  return {
    color: 0x00b4db,
    author: { name: `${player.personaname} played a game for the first time`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildLevelEmbed(player, level) {
  return {
    color: 0x8B78E6,
    author: { name: `${player.personaname} reached a new Steam level`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: `Level ${level}`,
    description: `${player.personaname} is now Steam level **${level}**!`,
  };
}

function build100PercentEmbed(player, game) {
  return {
    color: 0xFFD700,
    author: { name: `${player.personaname} 100% completed a game!`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    description: "Every achievement unlocked! 🏆",
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildSaleEmbed(appName, appId, discount, finalPrice, taggedUsers) {
  const mentions = taggedUsers.length > 0 ? taggedUsers.map(u => u.personaname).join(", ") + " — this is on your wishlist!" : null;
  return {
    color: 0x4CAF50,
    title: `💸 ${appName} is on sale!`,
    url: `https://store.steampowered.com/app/${appId}`,
    description: mentions,
    fields: [
      { name: "Discount", value: `-${discount}%`, inline: true },
      { name: "Price", value: finalPrice, inline: true },
    ],
    thumbnail: { url: gameThumb(appId) },
  };
}

function buildSteamSaleEmbed(saleName) {
  return {
    color: 0x1b2838,
    title: `🛍️ ${saleName} has started on Steam!`,
    url: "https://store.steampowered.com/specials",
    description: "Head to the Steam store to check out the deals.",
  };
}

function buildFriendsPlayingEmbed(gameName, appId, players) {
  return {
    color: 0x00b4db,
    title: `👥 ${players.length} friends are playing ${gameName} right now`,
    url: `https://store.steampowered.com/app/${appId}`,
    description: players.map(p => p.personaname).join(", "),
    thumbnail: { url: gameThumb(appId) },
  };
}

// ─── Weekly digest ─────────────────────────────────────────────────────────
function buildWeeklyDigest(playerStats) {
  const sorted = [...playerStats].sort((a, b) => b.weeklyMinutes - a.weeklyMinutes);
  const crown = sorted[0];
  const fields = sorted.map((p, i) => ({
    name: i === 0 ? `👑 ${p.name}` : p.name,
    value: p.weeklyMinutes > 0
      ? `${(p.weeklyMinutes / 60).toFixed(1)}h played${p.topGame ? ` · ${p.topGame}` : ""}${p.newGames > 0 ? ` · ${p.newGames} new game${p.newGames > 1 ? "s" : ""}` : ""}${p.achievements > 0 ? ` · ${p.achievements} achievement${p.achievements > 1 ? "s" : ""}` : ""}`
      : "Nothing played this week",
    inline: false,
  }));

  return {
    color: 0x1b2838,
    title: "📊 Weekly Steam Digest",
    description: crown && crown.weeklyMinutes > 0
      ? `👑 ${crown.name} put in the most hours this week with ${(crown.weeklyMinutes / 60).toFixed(1)}h!`
      : "A quiet week for the group.",
    fields,
    footer: { text: "Week ending " + new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) },
  };
}

// ─── Checks ────────────────────────────────────────────────────────────────
const MILESTONES = [10, 25, 50, 100, 200, 500, 1000];

async function checkFriendActivity(players, state, isFirstRun) {
  for (const player of players) {
    const sid = player.steamid;
    if (!state[sid]) state[sid] = { games: {}, level: 0, achievements: {}, weeklyMinutes: 0, lastWeekGames: {} };
    const ps = state[sid];

    // ── Level up ──────────────────────────────────────────────────────────
    try {
      const level = await STEAM.playerLevel(sid);
      if (!isFirstRun && level > (ps.level || 0)) {
        await postEmbed(buildLevelEmbed(player, level));
      }
      ps.level = level;
    } catch {}
    await sleep(300);

    // ── Owned games ───────────────────────────────────────────────────────
    let ownedGames = [];
    try {
      ownedGames = await STEAM.ownedGames(sid);
    } catch { continue; }
    await sleep(300);

    for (const game of ownedGames) {
      const appId = String(game.appid);
      const hours = Math.floor((game.playtime_forever || 0) / 60);
      const prevData = ps.games[appId];

      // New game
      if (!prevData && !isFirstRun) {
        await postEmbed(buildNewGameEmbed(player, game));
        await sleep(500);
      }

      // First time played
      if (prevData && prevData.playtime === 0 && game.playtime_forever > 0 && !isFirstRun) {
        await postEmbed(buildFirstPlayEmbed(player, game));
        await sleep(500);
      }

      // Playtime milestones
      if (prevData && !isFirstRun) {
        const prevHours = Math.floor((prevData.playtime || 0) / 60);
        for (const milestone of MILESTONES) {
          if (prevHours < milestone && hours >= milestone) {
            await postEmbed(buildMilestoneEmbed(player, game, milestone));
            await sleep(500);
          }
        }
      }

      // Achievements (only check recently played games to save API calls)
      if (game.playtime_2weeks > 0) {
        try {
          const achievements = await STEAM.achievements(sid, appId);
          const unlocked = achievements.filter(a => a.achieved === 1);
          const prevUnlocked = new Set(ps.achievements[appId] || []);

          // On first run, ps.achievements[appId] is undefined — seed without posting
          // On subsequent runs, detect newly unlocked achievements and post them
          const hasSeenAchievements = ps.achievements[appId] !== undefined;
          if (hasSeenAchievements) {
            const newlyUnlocked = unlocked.filter(a => !prevUnlocked.has(a.apiname));
            if (newlyUnlocked.length > 0) {
              // Check for 100%
              if (unlocked.length === achievements.length && achievements.length > 0) {
                await postEmbed(build100PercentEmbed(player, game));
                await sleep(500);
              } else {
                // Get schema for display names
                const schema = await STEAM.gameSchema(appId);
                await sleep(300);
                const globalPcts = await STEAM.globalAchievements(appId);
                await sleep(300);
                const schemaMap = Object.fromEntries(schema.map(a => [a.name, a]));
                const globalMap = Object.fromEntries(globalPcts.map(a => [a.name, a.percent]));

                for (const ach of newlyUnlocked.slice(0, 3)) { // cap at 3 per run
                  const schemaAch = schemaMap[ach.apiname] || {};
                  const rarity = globalMap[ach.apiname] ?? null;
                  await postEmbed(buildAchievementEmbed(player, { ...ach, ...schemaAch }, rarity, game.name, appId));
                  await sleep(500);
                }
              }
            }
          }

          ps.achievements[appId] = unlocked.map(a => a.apiname);
          await sleep(300);
        } catch {}
      }

      ps.games[appId] = { playtime: game.playtime_forever, name: game.name };
    }

    // Weekly playtime tracking
    const totalMinutes = ownedGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
    const prevTotal = ps.weeklyTotal || totalMinutes;
    ps.weeklyMinutes = totalMinutes - prevTotal;
    ps.weeklyTotal = totalMinutes;

    // Top game this week
    const recentGames = await STEAM.recentlyPlayed(sid).catch(() => []);
    ps.weeklyTopGame = recentGames[0]?.name || null;
    ps.weeklyAchievements = Object.values(ps.achievements).flat().length;
    await sleep(300);
  }
}

async function checkWishlists(players, state, isFirstRun) {
  if (isFirstRun) return;
  const wishlistsByApp = {};

  for (const player of players) {
    try {
      const wishlist = await STEAM.wishlist(player.steamid);
      for (const appId of Object.keys(wishlist)) {
        if (!wishlistsByApp[appId]) wishlistsByApp[appId] = [];
        wishlistsByApp[appId].push(player);
      }
      await sleep(500);
    } catch {}
  }

  for (const [appId, wishlistPlayers] of Object.entries(wishlistsByApp)) {
    try {
      const details = await STEAM.appDetails(appId);
      await sleep(300);
      if (!details?.price_overview) continue;
      const price = details.price_overview;
      if (price.discount_percent > 0) {
        const saleKey = `sale_${appId}_${price.discount_percent}`;
        if (!state.sales) state.sales = {};
        if (!state.sales[saleKey]) {
          await postEmbed(buildSaleEmbed(
            details.name,
            appId,
            price.discount_percent,
            price.final_formatted,
            wishlistPlayers
          ));
          state.sales[saleKey] = true;
        }
      }
    } catch {}
  }
}

async function checkFriendsPlayingTogether(players, state) {
  const playingNow = {};
  for (const player of players) {
    if (player.gameid) {
      if (!playingNow[player.gameid]) playingNow[player.gameid] = [];
      playingNow[player.gameid].push(player);
    }
  }

  if (!state.playingTogether) state.playingTogether = {};

  for (const [gameId, gamePlayers] of Object.entries(playingNow)) {
    if (gamePlayers.length >= 2) {
      const key = `${gameId}_${gamePlayers.map(p => p.steamid).sort().join("_")}`;
      if (!state.playingTogether[key]) {
        const gameName = gamePlayers[0].gameextrainfo || `App ${gameId}`;
        await postEmbed(buildFriendsPlayingEmbed(gameName, gameId, gamePlayers));
        state.playingTogether[key] = Date.now();
      }
    }
  }

  // Clear old playing-together keys after 2 hours
  const now = Date.now();
  for (const key of Object.keys(state.playingTogether)) {
    if (now - state.playingTogether[key] > 2 * 60 * 60 * 1000) {
      delete state.playingTogether[key];
    }
  }
}

async function checkSteamSales(state) {
  try {
    const featured = await STEAM.featuredCategories();
    if (!featured) return;
    if (!state.steamSales) state.steamSales = {};

    // Check for major sale banner
    const specials = featured.specials;
    if (specials?.name && specials.name !== state.steamSales.lastSaleName) {
      const saleName = specials.name;
      if (saleName && saleName.toLowerCase().includes("sale")) {
        await postEmbed(buildSteamSaleEmbed(saleName));
        state.steamSales.lastSaleName = saleName;
      }
    }
  } catch {}
}

async function checkWeeklyDigest(players, state) {
  const now = new Date();
  const isSunday = now.getDay() === 0;
  const currentHour = now.getUTCHours();

  if (!isSunday || currentHour < 18 || currentHour > 19) return;

  const weekKey = `digest_${now.getUTCFullYear()}_${Math.floor((now - new Date(now.getUTCFullYear(), 0, 1)) / 604800000)}`;
  if (!state.digests) state.digests = {};
  if (state.digests[weekKey]) return;

  const playerStats = players.map(p => {
    const ps = state[p.steamid] || {};
    return {
      name: p.personaname,
      weeklyMinutes: ps.weeklyMinutes || 0,
      topGame: ps.weeklyTopGame || null,
      newGames: Object.keys(ps.games || {}).length - Object.keys(ps.lastWeekGames || ps.games || {}).length,
      achievements: 0,
    };
  });

  await postEmbed(buildWeeklyDigest(playerStats));
  state.digests[weekKey] = true;

  // Reset weekly counters
  for (const player of players) {
    if (state[player.steamid]) {
      state[player.steamid].weeklyMinutes = 0;
      state[player.steamid].lastWeekGames = { ...state[player.steamid].games };
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const state = loadState();
  const isFirstRun = Object.keys(state).length === 0;
  if (isFirstRun) console.log("First run — seeding state without posting.");

  // Fetch all player summaries in one call
  const players = await STEAM.playerSummaries(STEAM_IDS);
  if (!players.length) {
    console.error("No players returned — check STEAM_IDS and profile visibility");
    process.exit(1);
  }

  console.log(`Checking ${players.length} players...`);

  await checkFriendActivity(players, state, isFirstRun);
  await checkWishlists(players, state, isFirstRun);
  await checkFriendsPlayingTogether(players, state);
  await checkSteamSales(state);
  await checkWeeklyDigest(players, state);

  saveState(state);
  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
