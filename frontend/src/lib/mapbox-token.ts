/** Only public browser tokens are accepted. Never log token-bearing URLs. */
export function normalizeMapboxToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const token = value.trim();
  return token.length <= 2048 && /^pk\.[A-Za-z0-9._-]+$/.test(token) ? token : "";
}

export async function testMapboxToken(token: string): Promise<boolean> {
  if (!normalizeMapboxToken(token)) return false;
  const response = await fetch(`https://api.mapbox.com/styles/v1/mapbox/light-v10?access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(10000) });
  return response.ok;
}
