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
    const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${API_KEY}&steamid=${steamId}&count=5`;
    const data = await httpsGet(url);
    return data?.response?.games || [];
  },
  playerLevel: async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${API_KEY}&steamid=${steamId}`;
    const data = await httpsGet(url);
    return data?.response?.player_level ?? null;
  },
  wishlist: async (steamId) => {
    const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/`;
    const data = await httpsGet(url);
    return (data && typeof data === "object" && !data.success) ? data : {};
  },
  appDetails: async (appId) => {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=gb&l=en`;
    const data = await httpsGet(url);
    return data?.[appId]?.data || null;
  },
  featuredCategories: async () => {
    return await httpsGet(`https://store.steampowered.com/api/featuredcategories?cc=gb&l=en`);
  },
};

// ─── State ─────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  fs.writeFileSync("changed.txt", "1");
}

// ─── Embeds ────────────────────────────────────────────────────────────────
function gameThumb(appId) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

function profileUrl(steamId) {
  return `https://steamcommunity.com/profiles/${steamId}`;
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

function buildFirstPlayEmbed(player, game) {
  return {
    color: 0x00b4db,
    author: { name: `${player.personaname} played a game for the first time`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildMilestoneEmbed(player, game, hours) {
  return {
    color: 0xF5A623,
    author: { name: `${player.personaname} hit a playtime milestone`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: game.name,
    url: `https://store.steampowered.com/app/${game.appid}`,
    fields: [{ name: "Hours played", value: `${hours}h`, inline: true }],
    thumbnail: { url: gameThumb(game.appid) },
  };
}

function buildLevelEmbed(player, level) {
  return {
    color: 0x8B78E6,
    author: { name: `${player.personaname} reached a new Steam level`, url: profileUrl(player.steamid), icon_url: player.avatar },
    title: `Level ${level} 🥇`,
    description: `${player.personaname} is now Steam level **${level}**!`,
    thumbnail: { url: player.avatarfull },
  };
}

function buildSaleEmbed(appName, appId, discount, finalPrice, wishlistPlayers) {
  const who = wishlistPlayers.map(p => p.personaname).join(", ");
  return {
    color: 0x4CAF50,
    title: `💸 ${appName} is on sale!`,
    url: `https://store.steampowered.com/app/${appId}`,
    description: `${who} — this is on your wishlist!`,
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
    title: `🛍️ ${saleName} is on now!`,
    url: "https://store.steampowered.com/specials",
    description: "Head to the Steam store to check out the deals.",
    thumbnail: { url: "https://store.steampowered.com/favicon.ico" },
  };
}

function buildWeeklyDigest(playerStats) {
  const sorted = [...playerStats].sort((a, b) => b.weeklyMinutes - a.weeklyMinutes);
  const crown = sorted.find(p => p.weeklyMinutes > 0);

  const fields = sorted.map((p, i) => {
    const hrs = (p.weeklyMinutes / 60).toFixed(1);
    let value = p.weeklyMinutes > 0 ? `${hrs}h played` : "Nothing played this week";
    if (p.topGame) value += ` · ${p.topGame}`;
    if (p.newGames > 0) value += ` · ${p.newGames} new game${p.newGames > 1 ? "s" : ""}`;
    return { name: crown && p.name === crown.name ? `👑 ${p.name}` : p.name, value, inline: false };
  });

  return {
    color: 0x1b2838,
    title: "📊 Weekly Steam Digest",
    description: crown
      ? `👑 ${crown.name} led the group this week with ${(crown.weeklyMinutes / 60).toFixed(1)}h!`
      : "A quiet week for the group.",
    fields,
    footer: {
      text: "Week ending " + new Date().toLocaleDateString("en-GB", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      })
    },
  };
}

// ─── Checks ────────────────────────────────────────────────────────────────
const MILESTONES = [10, 25, 50, 100, 200, 500, 1000];

async function checkFriendActivity(players, state, isFirstRun) {
  for (const player of players) {
    const sid = player.steamid;
    if (!state[sid]) state[sid] = { games: {}, level: null, weeklyMinutes: 0, weeklyTotal: null, weeklyTopGame: null, newGames: 0 };
    const ps = state[sid];

    console.log(`  Checking ${player.personaname}...`);

    // ── Level ──────────────────────────────────────────────────────────────
    try {
      const level = await STEAM.playerLevel(sid);
      if (level !== null) {
        if (!isFirstRun && ps.level !== null && level > ps.level) {
          console.log(`    Level up: ${ps.level} -> ${level}`);
          await postEmbed(buildLevelEmbed(player, level));
        }
        ps.level = level;
      }
    } catch (e) { console.log(`    Level check failed: ${e.message}`); }
    await sleep(300);

    // ── Owned games ────────────────────────────────────────────────────────
    let ownedGames = [];
    try {
      ownedGames = await STEAM.ownedGames(sid);
    } catch (e) { console.log(`    Owned games failed: ${e.message}`); continue; }
    await sleep(300);

    console.log(`    ${ownedGames.length} games owned, ${ownedGames.filter(g => g.playtime_2weeks > 0).length} played recently`);

    let newGamesThisRun = 0;
    for (const game of ownedGames) {
      const appId = String(game.appid);
      const prevData = ps.games[appId];
      const prevHours = Math.floor((prevData?.playtime || 0) / 60);
      const currHours = Math.floor((game.playtime_forever || 0) / 60);

      // New game (in library but not seen before)
      if (!prevData) {
        if (!isFirstRun) {
          console.log(`    New game: ${game.name}`);
          await postEmbed(buildNewGameEmbed(player, game));
          await sleep(500);
          newGamesThisRun++;
        }
        ps.games[appId] = { playtime: game.playtime_forever, name: game.name, firstPlayPosted: false };
        continue;
      }

      // First time played (had the game but playtime was 0, now it's > 0)
      if (!prevData.firstPlayPosted && prevData.playtime === 0 && game.playtime_forever > 0) {
        if (!isFirstRun) {
          console.log(`    First play: ${game.name}`);
          await postEmbed(buildFirstPlayEmbed(player, game));
          await sleep(500);
        }
        ps.games[appId].firstPlayPosted = true;
      }

      // Playtime milestones
      if (!isFirstRun) {
        for (const milestone of MILESTONES) {
          if (prevHours < milestone && currHours >= milestone) {
            console.log(`    Milestone: ${game.name} - ${milestone}h`);
            await postEmbed(buildMilestoneEmbed(player, game, milestone));
            await sleep(500);
          }
        }
      }

      ps.games[appId] = { ...ps.games[appId], playtime: game.playtime_forever, name: game.name };
    }

    // ── Weekly tracking ────────────────────────────────────────────────────
    const totalMinutes = ownedGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
    if (ps.weeklyTotal === null) ps.weeklyTotal = totalMinutes;
    ps.weeklyMinutes = Math.max(0, totalMinutes - ps.weeklyTotal);
    ps.weeklyTotal = totalMinutes;
    ps.newGames = newGamesThisRun;

    try {
      const recent = await STEAM.recentlyPlayed(sid);
      ps.weeklyTopGame = recent[0]?.name || null;
    } catch {}
    await sleep(300);
  }
}

async function checkWishlists(players, state, isFirstRun) {
  if (isFirstRun) return;
  if (!state.sales) state.sales = {};

  // Build a map of appId -> players who have it wishlisted
  const wishlistMap = {};
  for (const player of players) {
    try {
      const wishlist = await STEAM.wishlist(player.steamid);
      for (const appId of Object.keys(wishlist)) {
        if (!wishlistMap[appId]) wishlistMap[appId] = [];
        wishlistMap[appId].push(player);
      }
      await sleep(500);
    } catch {}
  }

  console.log(`  Checking ${Object.keys(wishlistMap).length} wishlisted apps for sales...`);

  // Check each wishlisted app for a sale — sample up to 20 to stay within rate limits
  const appIds = Object.keys(wishlistMap).slice(0, 20);
  for (const appId of appIds) {
    try {
      const details = await STEAM.appDetails(appId);
      await sleep(400);
      if (!details?.price_overview) continue;
      const price = details.price_overview;
      if (price.discount_percent > 0) {
        const saleKey = `${appId}_${price.discount_percent}`;
        if (!state.sales[saleKey]) {
          console.log(`  Sale found: ${details.name} -${price.discount_percent}%`);
          await postEmbed(buildSaleEmbed(details.name, appId, price.discount_percent, price.final_formatted, wishlistMap[appId]));
          state.sales[saleKey] = true;
        }
      } else {
        // Clear old sale keys when no longer on sale
        const oldKey = Object.keys(state.sales).find(k => k.startsWith(`${appId}_`));
        if (oldKey) delete state.sales[oldKey];
      }
    } catch {}
  }
}

async function checkSteamSales(state) {
  if (!state.steamSales) state.steamSales = {};
  try {
    const featured = await STEAM.featuredCategories();
    if (!featured) return;
    const saleName = featured?.specials?.name;
    if (saleName && saleName.toLowerCase().includes("sale") && saleName !== state.steamSales.lastName) {
      console.log(`  Steam sale detected: ${saleName}`);
      await postEmbed(buildSteamSaleEmbed(saleName));
      state.steamSales.lastName = saleName;
    }
  } catch {}
}

async function checkWeeklyDigest(players, state) {
  const now = new Date();
  if (now.getDay() !== 0) return; // Sunday only
  const hour = now.getUTCHours();
  if (hour < 18 || hour >= 19) return; // 6-7pm UTC

  if (!state.digests) state.digests = {};
  const weekKey = `${now.getUTCFullYear()}_${Math.floor(now / 604800000)}`;
  if (state.digests[weekKey]) return;

  console.log("  Posting weekly digest...");

  const playerStats = players.map(p => ({
    name: p.personaname,
    weeklyMinutes: state[p.steamid]?.weeklyMinutes || 0,
    topGame: state[p.steamid]?.weeklyTopGame || null,
    newGames: state[p.steamid]?.newGames || 0,
  }));

  await postEmbed(buildWeeklyDigest(playerStats));
  state.digests[weekKey] = true;

  // Reset weekly counters
  for (const player of players) {
    if (state[player.steamid]) {
      state[player.steamid].weeklyMinutes = 0;
      state[player.steamid].weeklyTotal = null;
      state[player.steamid].newGames = 0;
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const state = loadState();
  const isFirstRun = Object.keys(state).length === 0;
  if (isFirstRun) console.log("First run — seeding state without posting.");

  const players = await STEAM.playerSummaries(STEAM_IDS);
  if (!players.length) {
    console.error("No players returned — check STEAM_IDS and profile visibility");
    process.exit(1);
  }

  console.log(`Checking ${players.length} players...`);

  await checkFriendActivity(players, state, isFirstRun);
  await checkWishlists(players, state, isFirstRun);
  await checkSteamSales(state);
  await checkWeeklyDigest(players, state);

  saveState(state);
  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
