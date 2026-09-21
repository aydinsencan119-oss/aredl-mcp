// Wrapper around Nimble's Extract API (https://docs.nimbleway.com), used
// to fetch AREDL's public website pages through a stealth browser driver.
// This is necessary because api.aredl.net itself hard-blocks non-browser
// requests at the Cloudflare edge, even with a valid AREDL API key.

const NIMBLE_ENDPOINT = "https://sdk.nimbleway.com/v2/extract";

export async function fetchPage(url: string): Promise<string> {
  const key = process.env.NIMBLE_API_KEY;
  if (!key) {
    throw new Error(
      "NIMBLE_API_KEY is not set. This server scrapes aredl.net through Nimble's stealth browser " +
        "because AREDL's own API blocks plain server requests. Set NIMBLE_API_KEY as an environment " +
        "variable (free tier: 5,000 requests/month at nimbleway.com)."
    );
  }

  const res = await fetch(NIMBLE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      driver: "vx10", // stealth driver — vx6/vx8 get a real 403 from aredl.net
      formats: ["markdown"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Nimble Extract ${res.status} fetching ${url}: ${await res.text()}`);
  }
  const json = (await res.json()) as any;
  const content = json?.data?.markdown;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`Nimble Extract returned no content for ${url}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return content;
}
