import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPage } from "./nimble.js";

// ---------------------------------------------------------------------
// AREDL's real API (api.aredl.net) blocks all non-browser requests at the
// Cloudflare edge, even with a valid personal API key. So instead, these
// tools scrape the public website (aredl.net) through Nimble's stealth
// browser driver. This means: best-effort text parsing instead of clean
// JSON, and only the FIRST PAGE of paginated data (records, leaderboard)
// since further pages are loaded via client-side JS this scrape doesn't
// drive. Good enough for lookups; not a full API replacement.
// ---------------------------------------------------------------------

const LIST_URL = "https://aredl.net/list";
const LEADERBOARD_URL = "https://aredl.net/leaderboard";
const levelPageUrl = (id: string) => `https://aredl.net/list/${id}`;

interface LevelSummary {
  rank: number;
  name: string;
  id: string;
}

let listCache: { data: LevelSummary[]; fetchedAt: number } | null = null;
const LIST_TTL_MS = 10 * 60 * 1000; // 10 minutes

function dedupeRepeatedHalf(s: string): string {
  const n = s.length;
  if (n > 0 && n % 2 === 0 && s.slice(0, n / 2) === s.slice(n / 2)) {
    return s.slice(0, n / 2);
  }
  return s;
}

async function getLevelList(): Promise<LevelSummary[]> {
  if (listCache && Date.now() - listCache.fetchedAt < LIST_TTL_MS) {
    return listCache.data;
  }
  const text = await fetchPage(LIST_URL);
  const pattern = /\[#(\d+)\s*\n\n(.*?)\]\(https:\/\/aredl\.net\/list\/(\d+)\)/g;
  const results: LevelSummary[] = [];
  for (const m of text.matchAll(pattern)) {
    results.push({ rank: Number(m[1]), name: m[2].trim(), id: m[3] });
  }
  if (results.length === 0) {
    throw new Error("Could not parse the AREDL list page — its layout may have changed.");
  }
  listCache = { data: results, fetchedAt: Date.now() };
  return results;
}

interface LevelDetail {
  rank: number | null;
  name: string;
  description: string | null;
  levelId: string | null;
  listPoints: string | null;
  publisherRaw: string | null;
  verifiersRaw: string | null;
  creatorsRaw: string | null;
  recordsTotal: number | null;
  firstPageRecords: { submitter: string; date: string; platform: string }[];
}

// The scraped page text has no real line breaks or delimiters between UI
// elements — it's all one run-on string. This boilerplate appears
// verbatim (the scroll-area accessibility CSS repeats multiple times per
// page) and gets in the way of finding real content, so strip it first.
const VIEWPORT_JUNK =
  "[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}";

function stripBoilerplate(s: string): string {
  return s
    .replaceAll(VIEWPORT_JUNK, "")
    .replace(/:root\{[^}]*\}/g, "")
    .replace(/DEMON LIST.*?LOGINDiscordLOGIN/gs, "")
    .replace(/classicplatformer/g, "");
}

// The site renders the level name twice in a row (main heading + a second
// element right after it) with nothing between them once boilerplate is
// stripped — so the name is whatever prefix of the remaining text repeats
// immediately. This also matches how player names double up on the
// leaderboard (see dedupeRepeatedHalf), so it's a consistent site quirk,
// not a one-off hack.
function findRepeatedPrefixLength(s: string, maxLen = 80): number | null {
  for (let L = 1; L <= maxLen && L * 2 <= s.length; L++) {
    if (s.slice(0, L) === s.slice(L, 2 * L)) return L;
  }
  return null;
}

function parseLevelPage(text: string): LevelDetail {
  const rankMatch = text.match(/#(\d+)\s*-\s*/);
  let rank: number | null = null;
  let name = "Unknown";
  let description: string | null = null;

  if (rankMatch) {
    rank = Number(rankMatch[1]);
    let rest = stripBoilerplate(text.slice(rankMatch.index! + rankMatch[0].length));
    const nameLen = findRepeatedPrefixLength(rest);
    if (nameLen) {
      name = rest.slice(0, nameLen);
      rest = rest.slice(2 * nameLen);
      // Description runs up to the GD difficulty rating (e.g. "2.1") that
      // always immediately follows it on the page.
      const descMatch = rest.match(/^(.*?)\d\.\d/s);
      if (descMatch) description = descMatch[1].trim() || null;
    }
  }

  const levelIdMatch = text.match(/LEVEL ID\s*(\d+)/);
  const listPointsMatch = text.match(/list points\s*([\d.]+)/i);
  const publisherMatch = text.match(/Publisher\s*([^\n]+?)Verifiers/);
  const verifiersMatch = text.match(/Verifiers\s*([^\n]+?)Creators/);
  const creatorsMatch = text.match(/Creators\s*([^\n]+?)(?:Position History|Records)/);

  const recordsHeaderMatch = text.match(/Records \((\d+)\)/);
  const recordsTotal = recordsHeaderMatch ? Number(recordsHeaderMatch[1]) : null;

  const firstPageRecords: { submitter: string; date: string; platform: string }[] = [];
  if (recordsHeaderMatch) {
    const body = text.slice(recordsHeaderMatch.index! + recordsHeaderMatch[0].length);
    const anchor = /(\d{1,2}\/\d{1,2}\/\d{4})(YouTube|Twitch|Medal|Vimeo|BiliBili|Outplayed)/g;
    let prevEnd = 0;
    for (const m of body.matchAll(anchor)) {
      const submitter = body.slice(prevEnd, m.index).trim();
      if (submitter) {
        firstPageRecords.push({ submitter, date: m[1], platform: m[2] });
      }
      prevEnd = m.index! + m[0].length;
    }
  }

  return {
    rank,
    name,
    description,
    levelId: levelIdMatch ? levelIdMatch[1] : null,
    listPoints: listPointsMatch ? listPointsMatch[1] : null,
    // Publisher/verifiers/creators run together with zero separator between
    // names (e.g. "CybertronDiamondSkull..."), and there's no reliable way
    // to split arbitrary usernames apart — mixed case, digits, symbols all
    // appear inside real names. Rather than guess and mangle them, these
    // come back as the raw blob; still useful to read, just not an array.
    publisherRaw: publisherMatch ? publisherMatch[1].trim() : null,
    verifiersRaw: verifiersMatch ? verifiersMatch[1].trim() : null,
    creatorsRaw: creatorsMatch ? creatorsMatch[1].trim() : null,
    recordsTotal,
    firstPageRecords,
  };
}

interface LeaderboardEntry {
  rank: number;
  player: string;
  points: string;
  hardest: string;
  extremesCount: number;
}

function parseLeaderboard(text: string): LeaderboardEntry[] {
  const pattern = /#(\d+)(.*?)([\d,.]+)\s*pts[\d,.]+\s*points(.*?)(\d+)\s*extremes/g;
  const results: LeaderboardEntry[] = [];
  for (const m of text.matchAll(pattern)) {
    results.push({
      rank: Number(m[1]),
      player: dedupeRepeatedHalf(m[2].trim()),
      points: m[3],
      hardest: m[4].trim(),
      extremesCount: Number(m[5]),
    });
  }
  return results;
}

export function createServer() {
  const server = new McpServer({
    name: "aredl",
    version: "2.0.0",
  });

  server.registerTool(
    "search_level",
    {
      title: "Search AREDL level by name",
      description:
        "Find a level on the All Rated Extreme Demons List by (partial, case-insensitive) name. Returns matching levels with current rank and AREDL page id. Rank 1 is the hardest.",
      inputSchema: {
        query: z.string().describe("Level name or partial name to search for"),
        limit: z.number().int().min(1).max(25).default(10),
      },
    },
    async ({ query, limit }) => {
      const levels = await getLevelList();
      const q = query.toLowerCase();
      const matches = levels.filter((l) => l.name.toLowerCase().includes(q)).slice(0, limit);
      return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] };
    }
  );

  server.registerTool(
    "list_levels_by_rank",
    {
      title: "List AREDL levels in a rank range",
      description:
        "Get levels ranked between min_rank and max_rank (inclusive). Rank 1 is the hardest. Useful for finding a level of similar or greater difficulty than another.",
      inputSchema: {
        min_rank: z.number().int().min(1),
        max_rank: z.number().int().min(1),
      },
    },
    async ({ min_rank, max_rank }) => {
      const levels = await getLevelList();
      const lo = Math.min(min_rank, max_rank);
      const hi = Math.max(min_rank, max_rank);
      const results = levels.filter((l) => l.rank >= lo && l.rank <= hi).sort((a, b) => a.rank - b.rank);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.registerTool(
    "get_level",
    {
      title: "Get AREDL level details",
      description:
        "Get details for a level by its AREDL page id (from search_level/list_levels_by_rank): rank, description, list points, and the most recent page of completion records. publisherRaw/verifiersRaw/creatorsRaw are usernames concatenated with no separator (a scraping limitation) — still readable, just not a clean array.",
      inputSchema: { level_id: z.string().describe("The AREDL page id, e.g. '71216292'") },
    },
    async ({ level_id }) => {
      const text = await fetchPage(levelPageUrl(level_id));
      const detail = parseLevelPage(text);
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    }
  );

  server.registerTool(
    "get_level_records",
    {
      title: "Get AREDL level completions (first page)",
      description:
        "Get the most recent page of completion records for a level (submitter, date, video platform). Only the first page is available (roughly the oldest ~50 records as AREDL orders them) — this is a scraping limitation, not a filter.",
      inputSchema: { level_id: z.string() },
    },
    async ({ level_id }) => {
      const text = await fetchPage(levelPageUrl(level_id));
      const detail = parseLevelPage(text);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { recordsTotal: detail.recordsTotal, records: detail.firstPageRecords },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_leaderboard",
    {
      title: "Get AREDL player leaderboard (first page)",
      description:
        "Get the top of the AREDL player leaderboard, ranked by list points. Only the first page (top 20) is available — a scraping limitation, not a filter.",
      inputSchema: {},
    },
    async () => {
      const text = await fetchPage(LEADERBOARD_URL);
      const entries = parseLeaderboard(text);
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  );

  return server;
}
