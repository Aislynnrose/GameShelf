const { app } = require("@azure/functions");
const { bggFetch, parseSearchResults } = require("../lib/bgg-lib");

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

app.http("bggSearch", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "search",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 200, headers: CORS_HEADERS };
    }
    const q = (request.query.get("q") || "").trim();
    if (!q) {
      return { status: 400, jsonBody: { error: "Missing ?q= search term" }, headers: CORS_HEADERS };
    }
    try {
      const xml = await bggFetch(`/search?type=boardgame&query=${encodeURIComponent(q)}`);
      return { status: 200, jsonBody: { results: parseSearchResults(xml) }, headers: CORS_HEADERS };
    } catch (err) {
      context.error(err);
      return { status: 502, jsonBody: { error: err.message || "Lookup failed" }, headers: CORS_HEADERS };
    }
  },
});
