import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE = "https://api.aredl.net/api/aredl";

// Simple in-memory cache for the full level list (it's ~1500 entries and
// doesn't change often; refetching on every call would be wasteful).
let levelListCache: { data: any[]; fetchedAt: number } | null = null;
const LEVEL_LIST_TTL_MS = 5 * 60 * 1000; // 5 minutes

function authHeaders(): Record<string, string> {
  const key = process.env.AREDL_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function aredlFetch(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`AREDL API ${res.status} on ${url.pathname}: ${await res.text()}`);
  }
  return res.json();
}

async function getLevelList(): Promise<any[]> {
  if (levelListCache && Date.now() - levelListCache.fetchedAt < LEVEL_LIST_TTL_MS) {
    return levelListCache.data;
  }
  const data = (await aredlFetch("/levels")) as any[];
  levelListCache = { data, fetchedAt: Date.now() };
  return data;
}

export function createServer() {
  const server = new McpServer({
    name: "aredl",
    version: "1.0.0",
  });

  server.registerTool(
    "search_level",
    {
      title: "Search AREDL level by name",
      description:
        "Find a level on the All Rated Extreme Demons List by (partial, case-insensitive) name. Returns matching levels with their current rank, id, and points.",
      inputSchema: {
        query: z.string().describe("Level name or partial name to search for"),
        limit: z.number().int().min(1).max(25).default(10),
      },
    },
    async ({ query, limit }) => {
      const levels = await getLevelList();
      const q = query.toLowerCase();
      const matches = levels
        .filter((l) => (l.name ?? "").toLowerCase().includes(q))
        .slice(0, limit)
        .map((l) => ({ id: l.id, name: l.name, rank: l.position, points: l.points }));
      return {
        content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      };
    }
  );

  server.registerTool(
    "list_levels_by_rank",
    {
      title: "List AREDL levels in a rank range",
      description:
        "Get levels ranked between min_rank and max_rank (inclusive) on the AREDL. Rank 1 is the hardest. Useful for finding a level of similar or greater difficulty than another.",
      inputSchema: {
        min_rank: z.number().int().min(1),
        max_rank: z.number().int().min(1),
      },
    },
    async ({ min_rank, max_rank }) => {
      const levels = await getLevelList();
      const lo = Math.min(min_rank, max_rank);
      const hi = Math.max(min_rank, max_rank);
      const results = levels
        .filter((l) => l.position >= lo && l.position <= hi)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ id: l.id, name: l.name, rank: l.position, points: l.points }));
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get_level",
    {
      title: "Get AREDL level details",
      description: "Get full details for a specific level by its AREDL level id (not the GD level id).",
      inputSchema: { level_id: z.string() },
    },
    async ({ level_id }) => {
      const data = await aredlFetch(`/levels/${level_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_level_history",
    {
      title: "Get AREDL level rank history",
      description: "Get the historical rank changes for a level over time.",
      inputSchema: { level_id: z.string() },
    },
    async ({ level_id }) => {
      const data = await aredlFetch(`/levels/${level_id}/history`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_level_records",
    {
      title: "Get AREDL level completions",
      description: "Get accepted completion records for a level: who beat it, when, and their video link.",
      inputSchema: {
        level_id: z.string(),
        submitter_filter: z.string().optional().describe("Filter by submitter name"),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ level_id, submitter_filter, page, per_page }) => {
      const data = await aredlFetch(`/levels/${level_id}/records`, {
        submitter_filter,
        page,
        per_page,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_custom_copies",
    {
      title: "Get AREDL pre-approved custom copies",
      description:
        "Get pre-approved custom copies (LDMs, bugfixes, Globed 2P copies) for a level. Pass level_id to filter to one level; omit to browse all.",
      inputSchema: {
        level_id: z.string().optional(),
        description: z.string().optional().describe("Free-text filter on the copy's description"),
      },
    },
    async ({ level_id, description }) => {
      const data = (await aredlFetch("/levels/custom-copies", { description })) as any[];
      const filtered = level_id ? data.filter((c) => c.level_id === level_id) : data;
      return { content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }] };
    }
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Get AREDL player leaderboard",
      description: "Get the player leaderboard ranked by list points. Can filter by player name or country.",
      inputSchema: {
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(100).default(25),
        name_filter: z.string().optional(),
        country_filter: z.number().int().optional(),
      },
    },
    async ({ page, per_page, name_filter, country_filter }) => {
      const data = await aredlFetch("/leaderboard", {
        page,
        per_page,
        name_filter,
        country_filter,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_player_profile",
    {
      title: "Get AREDL player profile",
      description: "Get a player's AREDL profile (levels beaten, points, rank) by their AREDL user id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const data = await aredlFetch(`/profile/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_bounty_board",
    {
      title: "Get AREDL bounty board",
      description: "Get the current AREDL bounty board (community challenges/bounties).",
      inputSchema: {},
    },
    async () => {
      const data = await aredlFetch("/bounty-board");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_changelog",
    {
      title: "Get AREDL changelog",
      description: "Get recent list changes (levels added, moved, or removed).",
      inputSchema: {
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ page, per_page }) => {
      const data = await aredlFetch("/changelog", { page, per_page });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}
