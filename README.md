# aredl-mcp

An MCP server that gives Claude access to [AREDL](https://aredl.net) (All Rated Extreme Demons List) data.

## Important: how this actually works

AREDL's real API (`api.aredl.net`) is blocked by Cloudflare bot-protection for any non-browser request — even with a valid personal API key, confirmed by testing directly. So instead, this server scrapes AREDL's public website (`aredl.net`) through [Nimble](https://www.nimbleway.com)'s stealth browser API, which gets past that protection.

Consequences of this approach, to set expectations:
- You need a **Nimble API key** (free tier: 5,000 requests/month, no card required) — see setup below.
- Data comes from parsing page text, not a clean JSON API, so a couple of fields (`publisherRaw`, `verifiersRaw`, `creatorsRaw`) come back as one concatenated blob of usernames with no separator — there's no reliable way to split arbitrary usernames apart from plain text. Still readable, just not a clean array.
- Records and leaderboard tools only return the **first page** (the site loads further pages via client-side JS this scraper doesn't drive).
- If AREDL redesigns their website, the text-parsing logic here will likely need updating (unlike a real API, which would keep the same shape).

## What it can do

- `search_level` — find a level by (partial) name, get its current rank + AREDL page id
- `list_levels_by_rank` — list levels in a rank range (e.g. "find something between rank 100-350")
- `get_level` — level details: rank, description, list points, publisher/verifiers/creators (raw), first page of records
- `get_level_records` — just the records/completions list for a level
- `get_leaderboard` — top of the player leaderboard (first page, top ~20)

## Setup

1. Get a free Nimble API key at [nimbleway.com](https://www.nimbleway.com) (sign up, no card needed for the free tier).
2. Set it as an environment variable: `NIMBLE_API_KEY`.

## Local development

```bash
npm install
npm run build
NIMBLE_API_KEY=your-key-here npm start
```

Starts an HTTP server on port 3000 (or `$PORT`) with the MCP endpoint at `POST /mcp`, a health check at `GET /`, and a one-click check at `GET /debug/nimble-check` that confirms Nimble is actually reaching aredl.net.

## Deploying on Render

1. Push this folder to a GitHub repo.
2. On [Render](https://render.com), **New > Web Service**, connect the repo.
3. Build command: `npm install && npm run build`
4. Start command: `node dist/server.js`
5. Add environment variable `NIMBLE_API_KEY` with your key.
6. Deploy, then visit `https://<your-service>.onrender.com/debug/nimble-check` to confirm it's working.
7. Add `https://<your-service>.onrender.com/mcp` as a custom connector in Claude's settings.

Render's free tier spins down after inactivity — the first request after a while takes ~30-50s to wake up. Normal, not broken.
