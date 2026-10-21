import { headers } from "next/headers";

/**
 * This app's own public base URL, for a link inside a transactional email
 * (Server Actions have no `request` object to read an origin from the way
 * a Route Handler's NextRequest does). Reads the incoming request's own
 * Host header first (correct on a real custom domain, not just vercel.app),
 * falling back to Vercel's own VERCEL_URL (always set on Vercel, including
 * every preview deployment) and then a plain localhost default for `npm
 * run dev`.
 */
export async function siteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (host) {
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return `${isLocal ? "http" : "https"}://${host}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
