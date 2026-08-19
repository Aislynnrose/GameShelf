# BoardGameGeek lookup proxy

This tiny service lets "Add a Game" in the app search BoardGameGeek and auto-fill a game's name,
description, player count, play time, age rating, an estimated difficulty, and its known
expansions (with their player counts) — instead of typing everything in by hand.

## Why this extra piece is needed

BoardGameGeek's public API doesn't send the CORS headers browsers require, so the app's
JavaScript can't call `boardgamegeek.com` directly — the request gets blocked before it even
leaves your phone (confirmed against BGG's own developer forum). The fix is small: run a tiny
proxy that fetches from BGG server-side (where CORS doesn't apply) and hands clean, CORS-enabled
JSON back to the app. That's all the code in this folder does — two routes, `/search` and
`/game`, both documented in `bgg-lib.reference.js`.

This does mean the auto-fill feature is online-only, which matches what you asked for — no
offline requirement here.

Pick **one** of the two options below. Both are genuinely free (no usage-based surprise bills for
a family's worth of lookups) and take about 5 minutes.

## Option A — Cloudflare Worker (recommended: fastest, no credit card)

There are two ways to deploy this. **Use the CLI method (A1)** — it's the reliable one. The
dashboard has a "Pages" section and a "Workers" section that live under the same "Workers &
Pages" nav item, and it's easy to end up in the Pages flow by mistake, which expects a whole
static-site build (hence errors like "Output directory not found" if you paste a single script
path in) — Pages is for hosting sites, not for a one-file backend script like this one. The CLI
skips that ambiguity entirely.

### A1. Command line (Wrangler) — do this one

Needs Node.js installed on your computer (not your phone). No global install required.

```
cd bgg-proxy/cloudflare-worker
npx wrangler login      # opens a browser tab to connect your free Cloudflare account
npx wrangler deploy     # reads wrangler.toml + worker.js and deploys, prints your URL
```

That's it — no dashboard clicking at all. It'll print a URL like
`https://game-shelf-bgg-proxy.YOURNAME.workers.dev`. Paste that into the app's Household tab →
"BoardGameGeek Lookup Service" → Save → Test Connection.

(`wrangler.toml` is already set up in this folder pointing at `worker.js` — you shouldn't need to
change anything.)

### A2. Dashboard only, if you'd rather not touch a command line

1. Go to https://dash.cloudflare.com/ and sign up (email only, no card required for the free
   Workers plan — 100,000 requests/day free).
2. **Workers & Pages → Create application.** On the screen that follows, make sure you're on the
   **"Workers"** tab, not "Pages" — pick **"Create Worker"** (sometimes labeled "Hello World"),
   name it `game-shelf-bgg-proxy`, and click **Deploy**. Don't use "Import a repository," "Upload
   assets," or anything that asks for a build command / output directory — those are the Pages
   flow and are the wrong path for this.
3. Once it's deployed with the default sample code, open it and click **"Edit code"** to reach the
   in-browser editor. Delete everything in there and paste in the entire contents of
   `cloudflare-worker/worker.js` from this folder → **Save and deploy**.
4. Copy the URL it gives you (looks like `https://game-shelf-bgg-proxy.YOURNAME.workers.dev`).
5. In the app: Household tab → "BoardGameGeek Lookup Service" → paste the URL → Save → Test
   Connection.

If step 2 ever dead-ends into a screen asking for a "build command" or "output directory," you're
in the Pages flow — back out and use A1 instead.

## Option B — Azure Function

Since you're already looking at Azure for the household-sync backend, this can live in the same
subscription. Azure Functions' free grant (1 million executions/month, forever) easily covers
this.

**Via the Azure Portal (no local tools needed):**
1. Create a Function App: Consumption (Serverless) plan, Runtime stack "Node.js" (LTS), Region
   near you.
2. In the Function App → Functions → Create → author code in the portal isn't ideal for
   multi-file projects, so for this one it's easier to deploy from your computer — see the CLI
   steps below. (If you'd rather stay portal-only, use Option A instead.)
3. Once deployed, go to your Function App → CORS (under API in the left nav) and add `*` (or
   your app's exact URL) as an allowed origin.

**Via the Azure Functions Core Tools CLI** (`npm install -g azure-functions-core-tools@4`,
plus the Azure CLI logged in via `az login`):
```
cd bgg-proxy/azure-function
npm install
func azure functionapp publish <your-function-app-name>
```
Then copy the base URL Azure gives you (looks like `https://<your-function-app-name>.azurewebsites.net/api`)
and paste that into the app's Household tab → "BoardGameGeek Lookup Service" field.

## Testing it yourself before deploying

Both `azure-function/` and `cloudflare-worker/` share the same parsing logic
(`bgg-lib.reference.js`) and were tested against sample BoardGameGeek XML responses before
delivery — search results, a full game lookup with expansions, HTML-entity decoding in
descriptions, and error cases (missing params, BGG's occasional "still processing" 202 response)
all passed. You don't need to test them again, just deploy and paste the URL in.

## What gets auto-filled vs. what stays yours to fill in

BoardGameGeek gives us: name, description, image, player count, play time, minimum age, and a
community "weight" rating that the app converts into the 1–5 difficulty scale (you can always
override it). It also lists expansions — the app shows those as a checklist so you can tick only
the ones your household actually owns, and estimates how many extra players each adds from BGG's
own player-count data for that expansion.

Things BGG doesn't know and that stay under your control either way: where the game lives in your
house, whether it's a favorite, and any custom keywords you want searchable that aren't already in
the description.
