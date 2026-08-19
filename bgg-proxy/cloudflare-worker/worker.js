/*
 * Family Game Shelf — BoardGameGeek lookup proxy (Cloudflare Worker version)
 *
 * WHY THIS EXISTS: BoardGameGeek's public API (xmlapi2) doesn't send CORS
 * headers, so the app's browser JS can't call it directly — the request
 * gets blocked before it even leaves the phone. This Worker runs on
 * Cloudflare's servers instead of in the browser, so CORS doesn't apply to
 * ITS request to BGG, and it adds the CORS headers the app needs on the way
 * back out.
 *
 * DEPLOY (no account setup beyond a free Cloudflare sign-up, no credit card):
 *   1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create →
 *      "Create Worker".
 *   2. Give it a name (e.g. "game-shelf-bgg-proxy") → Deploy.
 *   3. Click "Edit code" and paste this entire file in, replacing the
 *      sample code → Save and Deploy.
 *   4. Copy the worker's URL (looks like
 *      https://game-shelf-bgg-proxy.YOURNAME.workers.dev) and paste it into
 *      the app's Household tab → "BoardGameGeek Lookup Service" field.
 *
 * Routes:
 *   GET /search?q=catan          → { results: [{id, name, yearPublished}] }
 *   GET /game?id=13              → { game: {...}, expansions: [{id, name, minPlayers, maxPlayers}] }
 */

const BGG_BASE = "https://boardgamegeek.com/xmlapi2";
const MAX_EXPANSIONS = 40;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------- XML parsing --

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function attr(block, tag, attrName = "value") {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attrName}="([^"]*)"[^>]*/?>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1].trim()) : null;
}

function splitItemBlocks(xml) {
  const blocks = [];
  const re = /<item\b[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml))) blocks.push(m[0]);
  return blocks;
}

function parseSearchResults(xml) {
  return splitItemBlocks(xml)
    .map((block) => {
      const idMatch = block.match(/<item\b[^>]*\bid="(\d+)"/i);
      return {
        id: idMatch ? idMatch[1] : null,
        name: attr(block, "name", "value"),
        yearPublished: attr(block, "yearpublished", "value"),
      };
    })
    .filter((r) => r.id && r.name);
}

function parseExpansionLinks(block) {
  const results = [];
  const re = /<link\b([^>]*\btype="boardgameexpansion"[^>]*)\/?>/g;
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (/\binbound="true"/.test(attrs)) continue;
    const idMatch = attrs.match(/\bid="(\d+)"/);
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/);
    if (idMatch && valueMatch) {
      results.push({ id: idMatch[1], name: decodeEntities(valueMatch[1]) });
    }
  }
  return results;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseItemBlock(block, fallbackId) {
  const idMatch = block.match(/<item\b[^>]*\bid="(\d+)"/i);
  const primaryNameMatch = block.match(/<name\b[^>]*\btype="primary"[^>]*\bvalue="([^"]*)"/i);
  const statsBlockMatch = block.match(/<statistics\b[^>]*>[\s\S]*?<\/statistics>/i);
  const statsBlock = statsBlockMatch ? statsBlockMatch[0] : "";
  const weightStr = attr(statsBlock, "averageweight", "value");
  const weightVotesStr = attr(statsBlock, "numweights", "value");

  return {
    id: idMatch ? idMatch[1] : fallbackId,
    name: primaryNameMatch ? decodeEntities(primaryNameMatch[1]) : attr(block, "name", "value"),
    description: tagText(block, "description"),
    image: tagText(block, "image"),
    thumbnail: tagText(block, "thumbnail"),
    minPlayers: numOrNull(attr(block, "minplayers")),
    maxPlayers: numOrNull(attr(block, "maxplayers")),
    minAge: numOrNull(attr(block, "minage")),
    minPlayTime: numOrNull(attr(block, "minplaytime")),
    maxPlayTime: numOrNull(attr(block, "maxplaytime")),
    playingTime: numOrNull(attr(block, "playingtime")),
    weight: weightStr ? Number(weightStr) : null,
    weightVotes: weightVotesStr ? Number(weightVotesStr) : 0,
    expansions: parseExpansionLinks(block),
  };
}

function parseGameDetail(xml, wantedId) {
  const blocks = splitItemBlocks(xml);
  const block = wantedId
    ? blocks.find((b) => new RegExp(`<item\\b[^>]*\\bid="${wantedId}"`).test(b))
    : blocks[0];
  if (!block) return null;
  return parseItemBlock(block, wantedId);
}

function parseGameDetails(xml) {
  return splitItemBlocks(xml).map((block) => parseItemBlock(block));
}

// ------------------------------------------------------------ BGG fetch --

async function bggFetch(path) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await fetch(`${BGG_BASE}${path}`, {
      headers: { "User-Agent": "FamilyGameShelf/1.0 (personal project)" },
    });
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) throw new Error(`BGG responded ${res.status}`);
    return await res.text();
  }
  throw new Error("BGG is still processing this request — try again in a few seconds.");
}

// --------------------------------------------------------------- routes --

async function handleSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ error: "Missing ?q= search term" }, 400);
  const xml = await bggFetch(`/search?type=boardgame&query=${encodeURIComponent(q)}`);
  return json({ results: parseSearchResults(xml) });
}

async function handleGame(url) {
  const id = (url.searchParams.get("id") || "").trim();
  if (!id || !/^\d+$/.test(id)) return json({ error: "Missing or invalid ?id=" }, 400);

  const xml = await bggFetch(`/thing?id=${id}&stats=1`);
  const game = parseGameDetail(xml, id);
  if (!game) return json({ error: "Game not found" }, 404);

  let expansions = [];
  if (game.expansions.length) {
    const ids = game.expansions.slice(0, MAX_EXPANSIONS).map((e) => e.id);
    const expXml = await bggFetch(`/thing?id=${ids.join(",")}`);
    const details = parseGameDetails(expXml);
    expansions = game.expansions.map((e) => {
      const d = details.find((x) => x.id === e.id);
      return {
        id: e.id,
        name: e.name,
        minPlayers: d ? d.minPlayers : null,
        maxPlayers: d ? d.maxPlayers : null,
      };
    });
  }

  return json({ game, expansions });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    try {
      if (url.pathname === "/search") return await handleSearch(url);
      if (url.pathname === "/game") return await handleGame(url);
      return json({ error: "Not found. Use /search?q= or /game?id=" }, 404);
    } catch (err) {
      return json({ error: err.message || "Lookup failed" }, 502);
    }
  },
};
