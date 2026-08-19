const { app } = require("@azure/functions");
const { bggFetch, parseGameDetail, parseGameDetails } = require("../lib/bgg-lib");

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };
const MAX_EXPANSIONS = 40;

app.http("bggGame", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  route: "game",
  handler: async (request, context) => {
    if (request.method === "OPTIONS") {
      return { status: 200, headers: CORS_HEADERS };
    }
    const id = (request.query.get("id") || "").trim();
    if (!id || !/^\d+$/.test(id)) {
      return { status: 400, jsonBody: { error: "Missing or invalid ?id=" }, headers: CORS_HEADERS };
    }
    try {
      const xml = await bggFetch(`/thing?id=${id}&stats=1`);
      const game = parseGameDetail(xml, id);
      if (!game) {
        return { status: 404, jsonBody: { error: "Game not found" }, headers: CORS_HEADERS };
      }

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

      return { status: 200, jsonBody: { game, expansions }, headers: CORS_HEADERS };
    } catch (err) {
      context.error(err);
      return { status: 502, jsonBody: { error: err.message || "Lookup failed" }, headers: CORS_HEADERS };
    }
  },
});
