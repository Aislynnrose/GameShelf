/*
 * Reference implementation of the BoardGameGeek XML parsing + fetch logic.
 * This file is not deployed anywhere itself — it's copy-pasted into both
 * bgg-proxy/azure-function/ and bgg-proxy/cloudflare-worker/ so each can be
 * deployed as a single standalone file with no build step. Keep changes to
 * the parsing logic in sync across all three copies.
 *
 * Why this exists at all: BoardGameGeek's XML API (xmlapi2) does not send
 * CORS headers, so a browser calling it directly gets blocked. This module
 * fetches BGG server-side (where CORS doesn't apply) and returns clean,
 * CORS-enabled JSON to the app.
 */

const BGG_BASE = "https://boardgamegeek.com/xmlapi2";

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
  return splitItemBlocks(xml).map((block) => {
    const idMatch = block.match(/<item\b[^>]*\bid="(\d+)"/i);
    return {
      id: idMatch ? idMatch[1] : null,
      name: attr(block, "name", "value"),
      yearPublished: attr(block, "yearpublished", "value"),
    };
  }).filter((r) => r.id && r.name);
}

function parseExpansionLinks(block) {
  const results = [];
  const re = /<link\b([^>]*\btype="boardgameexpansion"[^>]*)\/?>/g;
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    const isInbound = /\binbound="true"/.test(attrs);
    if (isInbound) continue; // inbound links point FROM an expansion back to its base
    const idMatch = attrs.match(/\bid="(\d+)"/);
    const valueMatch = attrs.match(/\bvalue="([^"]*)"/);
    if (idMatch && valueMatch) {
      results.push({ id: idMatch[1], name: decodeEntities(valueMatch[1]) });
    }
  }
  return results;
}

function parseItemBlock(block, fallbackId) {
  const idMatch = block.match(/<item\b[^>]*\bid="(\d+)"/i);
  // primary name: <name type="primary" ... value="..."/>
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

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function bggFetch(path, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BGG_BASE}${path}`, {
      headers: { "User-Agent": "FamilyGameShelf/1.0 (personal project; contact via app)" },
    });
    if (res.status === 202) {
      // BGG is queuing the request server-side; wait and retry.
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) throw new Error(`BGG responded ${res.status}`);
    return await res.text();
  }
  throw new Error("BGG is still processing this request, please try again in a few seconds.");
}

module.exports = {
  decodeEntities,
  parseSearchResults,
  parseGameDetail,
  parseGameDetails,
  bggFetch,
};
