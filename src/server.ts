import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, aredlFetch } from "./tools.js";

const app = express();
app.use(express.json());

// Simple health check for Render (and for you, to confirm it's alive).
app.get("/", (_req, res) => {
  res.json({ ok: true, name: "aredl-mcp", message: "AREDL MCP server is running." });
});

// Visit this in a browser after setting AREDL_API_KEY to check whether
// AREDL's bot protection is letting authenticated requests through.
app.get("/debug/auth-check", async (_req, res) => {
  const hasKey = Boolean(process.env.AREDL_API_KEY);
  try {
    const data = (await aredlFetch("/leaderboard", { per_page: 1 })) as any;
    res.json({
      hasKey,
      success: true,
      message: hasKey
        ? "It worked! Your API key is getting past AREDL's bot protection."
        : "It worked, but no AREDL_API_KEY is set — AREDL may just be allowing this request anyway.",
      sample: data,
    });
  } catch (err: any) {
    res.status(200).json({
      hasKey,
      success: false,
      message: hasKey
        ? "Still blocked even with the API key set. The bot protection likely applies regardless of auth."
        : "Blocked, as expected without an API key set. Set AREDL_API_KEY and try again.",
      error: String(err?.message ?? err),
    });
  }
});

// Stateless MCP endpoint: a fresh server + transport per request is the
// simplest correct thing for a read-only API wrapper like this one, and it
// plays nicely with a host that may run multiple instances.
app.post("/mcp", async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling /mcp request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode doesn't support GET (server->client stream) or DELETE
// (session termination) — respond politely instead of a bare 404.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless." },
    id: null,
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`AREDL MCP server listening on port ${PORT}`);
});
