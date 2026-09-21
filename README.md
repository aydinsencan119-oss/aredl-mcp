# aredl-mcp

An MCP server that gives Claude direct, live access to the [AREDL](https://aredl.net) (All Rated Extreme Demons List) API — no more scraping the website.

## What it can do

Read-only tools, no AREDL login needed:

- `search_level` — find a level by (partial) name, get its current rank/id/points
- `list_levels_by_rank` — list levels in a rank range (e.g. "find something between rank 100-350")
- `get_level` — full details for a level by AREDL level id
- `get_level_history` — a level's rank history over time
- `get_level_records` — completions/records for a level (who beat it, when, video link)
- `get_custom_copies` — pre-approved LDMs / bugfixes / Globed 2P copies
- `get_leaderboard` — player leaderboard (filterable by name/country)
- `get_player_profile` — a player's profile by AREDL user id
- `get_bounty_board` — the current bounty board
- `get_changelog` — recent list changes

## Local development

```bash
npm install
npm run build
npm start
```

This starts an HTTP server on port 3000 (or `$PORT`) exposing the MCP endpoint at `POST /mcp`, plus a `GET /` health check.

## Deploying on Render

1. Push this folder to a new GitHub repo.
2. On [Render](https://render.com), click **New > Web Service** and connect that repo.
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Deploy. Render gives you a URL like `https://aredl-mcp.onrender.com`.
5. Your MCP endpoint is `https://aredl-mcp.onrender.com/mcp` — add that as a custom connector in Claude's settings.

Note: Render's free tier spins the service down after inactivity, so the first request after a while will be a bit slow (~30s) while it wakes back up. That's normal.

## Important: AREDL's API blocks non-browser requests

`api.aredl.net` has bot protection that returns a 403 to plain (non-browser) HTTP requests, even from a legitimate server like this one. Before this will work at all, you need your own AREDL personal API key:

1. Log into aredl.net (via Discord), then find the "API key" / developer option in your account or profile settings, and generate one. (If you can't find it, ask in AREDL's Discord #support.)
2. On Render, go to your service → **Environment**, and add an environment variable:
   - Key: `AREDL_API_KEY`
   - Value: the key you generated
3. Redeploy (Render does this automatically when you save an env var change).
4. Visit `https://<your-service>.onrender.com/debug/auth-check` in a browser. It makes one real request to AREDL and tells you plainly whether the key got past the block:
   - `"success": true` → it worked, the MCP tools will work too.
   - `"success": false` → still blocked even with the key. That means the bot protection applies regardless of authentication, and we'd need a different approach (routing through a scraping service like Nimble, which has its own cost).

Never commit your API key to the repo — always set it as an environment variable, not in the code.

## Adding more tools later

Personal/account-based AREDL features (your own records, submissions, notifications, clan actions) also use the same `AREDL_API_KEY`. Add new tools in `src/tools.ts` the same way as the existing ones — they'll automatically pick up the key via `aredlFetch`.
