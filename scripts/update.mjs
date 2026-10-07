// Regenerates data.js with current 2026 F1 data.
// Sources: Jolpica F1 API (schedule, results, standings) and the official FORMULA 1 YouTube RSS feed (highlights).
// To add a video manually: MANUAL_ROUND=17 MANUAL_VIDEO=<VIDEO_ID> node scripts/update.mjs

import { readFile, writeFile } from "node:fs/promises";

const SEASON = 2026;
const API = `https://api.jolpi.ca/ergast/f1/${SEASON}`;
const F1_CHANNEL_ID = "UCB_qr75-ydFVKSF9Dmo6izg";
const F1_CHANNEL_NAME = "FORMULA 1";
const F1_SITE = process.env.F1_SITE || "https://www.formula1.com";
const DATA_FILE = new URL("../data.js", import.meta.url);

// API race name → official F1 name (shown on the page and used in YouTube highlights titles).
// Races not listed here use the API name as is.
const RACE_NAMES = {
  "Barcelona Grand Prix": "Barcelona-Catalunya Grand Prix",
  "Brazilian Grand Prix": "São Paulo Grand Prix"
};

// API constructorId → team key on the page (for colours) and the name used on formula1.com.
const TEAMS = {
  mercedes:     { key: "mercedes",    name: "Mercedes" },
  ferrari:      { key: "ferrari",     name: "Ferrari" },
  mclaren:      { key: "mclaren",     name: "McLaren" },
  red_bull:     { key: "redbull",     name: "Red Bull Racing" },
  rb:           { key: "racingbulls", name: "Racing Bulls" },
  alpine:       { key: "alpine",      name: "Alpine" },
  haas:         { key: "haas",        name: "Haas F1 Team" },
  audi:         { key: "audi",        name: "Audi" },
  williams:     { key: "williams",    name: "Williams" },
  aston_martin: { key: "astonmartin", name: "Aston Martin" },
  cadillac:     { key: "cadillac",    name: "Cadillac" }
};

// Three-letter country codes as used on formula1.com.
const NATIONALITY = {
  Italian: "ITA", British: "GBR", Monegasque: "MON", Dutch: "NED", Australian: "AUS", French: "FRA",
  "New Zealander": "NZL", Argentine: "ARG", Brazilian: "BRA", German: "GER", Spanish: "ESP", Thai: "THA",
  Japanese: "JPN", Canadian: "CAN", Finnish: "FIN", Mexican: "MEX", American: "USA", Danish: "DEN",
  Chinese: "CHN", Swiss: "SUI", Belgian: "BEL", Austrian: "AUT", Polish: "POL", Estonian: "EST"
};

// Match the names used on formula1.com.
const DRIVER_NAMES = { antonelli: "Kimi Antonelli" };

/* ---------- helpers ---------- */

async function get(url, as = "json") {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "f1-2026-season-hub" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === "json" ? await res.json() : await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr.message}`);
}

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const iso = (date, time) => `${date}T${time ? time.replace(/Z?$/, "Z") : "00:00:00Z"}`;
const teamOf = id => TEAMS[id] || { key: id, name: id };

async function readExisting() {
  try {
    const src = await readFile(DATA_FILE, "utf8");
    return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  } catch {
    return { races: [] };
  }
}

const htmlText = s => s.replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

// Reads stats, facts and the headshot from a formula1.com driver page. Returns null if nothing parses.
function parseProfile(html, url) {
  const out = { url, season: [], career: [] };
  const bio = {};
  let section = "";
  const tokens = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
  for (const m of html.matchAll(tokens)) {
    if (m[1]) {
      const h = htmlText(m[2]).toLowerCase();
      section = h.includes("season") ? "season" : h.includes("career") ? "career" : h.includes("biography") ? "bio" : "";
      continue;
    }
    const pair = [htmlText(m[3]), htmlText(m[4])];
    if (section === "season" || section === "career") out[section].push(pair);
    else if (section === "bio") bio[pair[0]] = pair[1];
  }
  if (!out.season.length && !out.career.length) return null;

  out.photo = html.match(/https:\/\/media\.formula1\.com\/image\/upload\/[^"'\s]*?\/common\/f1\/\d{4}\/[a-z0-9]+\/[a-z0-9]+\/\d{4}[a-z0-9]+right\.webp/)?.[0] || null;
  out.country = html.match(/<title>Flag of ([^<]+)<\/title>/)?.[1]?.trim() || null;
  out.dob = bio["Date of Birth"] || null;
  out.birthplace = bio["Place of Birth"] || null;
  return out;
}

// Refreshes formula1.com profiles; keeps the previous profile for any driver whose page fails.
async function fetchProfiles(drivers, previous) {
  const listing = await get(`${F1_SITE}/en/drivers`, "text");
  const slugs = [...new Set([...listing.matchAll(/href="\/en\/drivers\/([a-z0-9-]+)"/g)].map(m => m[1]))];
  if (!slugs.length) throw new Error("no driver links found on the drivers page");

  const profiles = new Map();
  for (const d of drivers) {
    const keepPrevious = () => { if (previous.get(d.id)?.profile) profiles.set(d.id, previous.get(d.id).profile); };
    const slug = slugs.find(s => norm(s) === norm(d.name));
    if (!slug) { keepPrevious(); continue; } // e.g. a driver no longer on the current grid
    try {
      const url = `${F1_SITE}/en/drivers/${slug}`;
      const profile = parseProfile(await get(url, "text"), url);
      if (!profile) throw new Error("page structure not recognised");
      profiles.set(d.id, profile);
    } catch (err) {
      console.warn(`Profile for ${d.name} not updated: ${err.message}`);
      keepPrevious();
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return profiles;
}

async function isOfficialVideo(id) {
  try {
    const o = await get(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
    return o.author_name === F1_CHANNEL_NAME ? o.title : null;
  } catch {
    return null;
  }
}

/* ---------- main ---------- */

const existing = await readExisting();
const knownVideo = new Map(existing.races.filter(r => r.yt).map(r => [r.n, r.yt]));

const [schedule, results, lastRace, driverSt, teamSt, feed] = await Promise.all([
  get(`${API}/`),
  get(`${API}/results/1/?limit=100`),
  get(`${API}/last/results/?limit=100`),
  get(`${API}/driverstandings/`),
  get(`${API}/constructorstandings/`),
  get(`https://www.youtube.com/feeds/videos.xml?channel_id=${F1_CHANNEL_ID}`, "text").catch(err => {
    console.warn(`YouTube feed unavailable, skipping video search this run: ${err.message}`);
    return "";
  })
]);

const apiRaces = schedule.MRData.RaceTable.Races;
if (apiRaces.length < 20) throw new Error(`Unexpected number of races in schedule: ${apiRaces.length}`);

const winners = new Map(results.MRData.RaceTable.Races.map(r => [Number(r.round), r.Results[0]]));

// "Race Highlights | 2026 ..." videos in the YouTube feed
const feedVideos = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: e.match(/<yt:videoId>([^<]+)/)?.[1],
  title: (e.match(/<title>([^<]+)/)?.[1] || "").replace(/&amp;/g, "&"),
  published: e.match(/<published>([^<]+)/)?.[1]
})).filter(v => v.id && new RegExp(`^Race Highlights \\| ${SEASON} `, "i").test(v.title));

// Does a "Race Highlights | 2026 X Grand Prix" title belong to this round?
const titleWanted = new Map(apiRaces.map(r =>
  [Number(r.round), [r.raceName, RACE_NAMES[r.raceName]].filter(Boolean).map(norm)]));
const titleMatches = (n, title) =>
  titleWanted.get(n).includes(norm(title.replace(new RegExp(`^Race Highlights \\| ${SEASON} `, "i"), "")));

const races = apiRaces.map(r => {
  const n = Number(r.round);
  const start = iso(r.date, r.time);
  const { circuitName, Location } = r.Circuit;
  const race = {
    n,
    gp: RACE_NAMES[r.raceName] || r.raceName,
    circuit: circuitName.includes(Location.locality) ? circuitName : `${circuitName}, ${Location.locality}`,
    start,
    fp1: r.FirstPractice ? iso(r.FirstPractice.date, r.FirstPractice.time) : null,
    sprint: Boolean(r.Sprint)
  };

  const win = winners.get(n);
  if (win) {
    race.winner = DRIVER_NAMES[win.Driver.driverId] || `${win.Driver.givenName} ${win.Driver.familyName}`;
    race.team = teamOf(win.Constructor.constructorId).key;
  }

  let yt = knownVideo.get(n);
  if (!yt) {
    const hit = feedVideos.find(v => titleMatches(n, v.title) && new Date(v.published) >= new Date(start));
    if (hit) {
      yt = hit.id;
      console.log(`Round ${n}: highlights found → ${hit.title} (${hit.id})`);
    }
  }
  if (yt) race.yt = yt;
  return race;
});

// Manual video (workflow_dispatch input)
const manualRound = Number(process.env.MANUAL_ROUND || 0);
const manualVideo = (process.env.MANUAL_VIDEO || "").trim();
if (manualRound || manualVideo) {
  const race = races.find(r => r.n === manualRound);
  if (!race || !/^[\w-]{11}$/.test(manualVideo)) throw new Error("A valid round number and an 11-character video ID are required.");
  const title = await isOfficialVideo(manualVideo);
  if (!title) throw new Error(`${manualVideo} was not found or is not from the official ${F1_CHANNEL_NAME} channel.`);
  if (!titleMatches(manualRound, title)) throw new Error(`Video title does not match round ${manualRound} (${race.gp}): "${title}"`);
  race.yt = manualVideo;
  console.log(`Round ${manualRound}: added manually → ${title}`);
}

// Current line-up and team: whoever raced for which team in the latest race.
const lastTeam = new Map(lastRace.MRData.RaceTable.Races[0]?.Results.map(x => [x.Driver.driverId, x.Constructor.constructorId]) || []);

const dList = driverSt.MRData.StandingsTable.StandingsLists[0];
const drivers = dList.DriverStandings.map(x => {
  const id = x.Driver.driverId;
  const teamId = lastTeam.get(id) || x.Constructors.at(-1).constructorId;
  const d = {
    id,
    name: DRIVER_NAMES[id] || `${x.Driver.givenName} ${x.Driver.familyName}`,
    number: x.Driver.permanentNumber || null,
    nat: NATIONALITY[x.Driver.nationality] || x.Driver.nationality.slice(0, 3).toUpperCase(),
    nationality: x.Driver.nationality,
    team: teamOf(teamId).key,
    pts: Number(x.points)
  };
  if (!lastTeam.has(id)) d.roster = false;
  return d;
});

const teams = teamSt.MRData.StandingsTable.StandingsLists[0].ConstructorStandings.map(x => ({
  ...teamOf(x.Constructor.constructorId),
  pts: Number(x.points)
}));

// Driver profiles change only after a race, so formula1.com is only visited when the standings
// round moves on, a new driver appears, or the previous refresh failed.
const standingsRound = Number(dList.round);
const previousDrivers = new Map((existing.drivers || []).map(d => [d.id, d]));
let profilesRound = existing.profilesRound ?? null;
let profiles = new Map([...previousDrivers].filter(([, d]) => d.profile).map(([id, d]) => [id, d.profile]));
if (profilesRound !== standingsRound || drivers.some(d => !previousDrivers.has(d.id))) {
  try {
    profiles = await fetchProfiles(drivers, previousDrivers);
    profilesRound = standingsRound;
    console.log(`Driver profiles refreshed (${profiles.size}/${drivers.length}).`);
  } catch (err) {
    console.warn(`Driver profiles not refreshed, keeping previous ones: ${err.message}`);
  }
}
for (const d of drivers) if (profiles.has(d.id)) d.profile = profiles.get(d.id);

const data = { season: SEASON, standingsRound, profilesRound, races, teams, drivers };
const out = `// Generated automatically by scripts/update.mjs — do not edit by hand.\nwindow.F1DATA = ${JSON.stringify(data, null, 2)};\n`;

const before = await readFile(DATA_FILE, "utf8").catch(() => "");
if (before === out) {
  console.log("No changes.");
} else {
  await writeFile(DATA_FILE, out);
  console.log(`data.js updated (standings after round ${data.standingsRound}).`);
}
