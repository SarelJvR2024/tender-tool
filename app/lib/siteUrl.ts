import { headers } from "next/headers";

// Standing-review pass, 2026-11-09 (follow-up to Finding 267 - "any other
// place that trusts something a browser/client sent instead of this app's
// own known-good value?"): this file was previously skipped by a
// mention-count sweep as "trivial" purely by its 21-line size, never
// actually read for this. The Host header on an incoming HTTP request is
// NOT something the server can trust as "this app's own" domain - it's
// exactly as attacker-controlled as a query param or form field (any raw
// HTTP client can send any Host value it likes; confirmed directly:
// mocking next/headers' headers().get("host") to return
// "evil.attacker.example" made the pre-fix function return
// "https://evil.attacker.example" verbatim, no validation at all). The one
// real caller (app/app/onboarding/actions.ts's welcome email, right after
// signup) builds a clickable link from this value and emails it to the
// signed-up user - exactly the kind of value this app's own OTHER
// email-link builders never trust blindly: every other caller in this repo
// that needs this app's base URL for an email link uses an explicit,
// trusted value instead - scripts/send-deadline-reminders.ts,
// send-discovered-tenders.ts and send-operational-alerts.ts all read
// `process.env.APP_URL`, and lib/emailBrand.ts's own layout() default is
// the literal production domain, "https://tenderready.app" - never the
// Host header of whatever request happened to trigger the send. This file
// was the one exception.
//
// Fixed by validating the Host header against a known-good allowlist
// before trusting it - the exact same production domain every other
// email-link caller above already hardcodes, plus every legitimate
// *.vercel.app deployment (prod alias + every preview) and localhost for
// `npm run dev` - instead of accepting any string a client sends. An
// unrecognised Host now falls through to the same VERCEL_URL/localhost
// fallback this function already had for when the header is missing
// entirely, rather than ever being used verbatim.
const KNOWN_GOOD_HOSTS = [/^tenderready\.app$/, /^www\.tenderready\.app$/, /\.vercel\.app$/];

// Standing-review pass, 2026-11-09 (Finding 268-fix bypass, found one pass
// later): this used to split on ":" to strip a real port before checking
// the hostname, then let `siteUrl()` below substitute the ORIGINAL,
// un-stripped host string back into the returned URL. That let a Host
// header like "tenderready.app:@evil.attacker.example" pass this check
// (its pre-colon part is the real domain) while the URL every real browser
// and mail client actually resolves from the result is evil.attacker.example -
// confirmed directly: `new URL("https://tenderready.app:@evil.attacker.example").host`
// is "evil.attacker.example", because a WHATWG URL parser reads
// "tenderready.app:" as userinfo (text before a trailing "@"), not a port.
// Now this function itself decides what, if anything, follows the
// hostname - a real numeric port, or nothing - so there is no longer a
// second, unvalidated use of the raw header anywhere in this file.
function knownGoodHostAndPort(host: string): string | null {
  const parts = host.split(":");
  if (parts.length > 2) return null; // more than one ":" is never a plain host[:port]
  const hostname = parts[0];
  const port = parts[1]; // undefined when there was no ":" at all
  if (port !== undefined && !/^\d+$/.test(port)) return null; // anything but digits (e.g. "@evil.com") - reject
  const isGoodHostname =
    hostname === "localhost" || hostname === "127.0.0.1" || KNOWN_GOOD_HOSTS.some((re) => re.test(hostname));
  if (!isGoodHostname) return null;
  return port === undefined ? hostname : `${hostname}:${port}`;
}

/**
 * This app's own public base URL, for a link inside a transactional email
 * (Server Actions have no `request` object to read an origin from the way
 * a Route Handler's NextRequest does). Reads the incoming request's own
 * Host header first (correct on a real custom domain, not just vercel.app)
 * - but only once it's checked against the known-good hosts above, never
 * trusted verbatim - falling back to Vercel's own VERCEL_URL (always set
 * on Vercel, including every preview deployment) and then a plain
 * localhost default for `npm run dev`.
 */
export async function siteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const goodHostAndPort = host ? knownGoodHostAndPort(host) : null;
  if (goodHostAndPort) {
    const isLocal = goodHostAndPort.startsWith("localhost") || goodHostAndPort.startsWith("127.0.0.1");
    return `${isLocal ? "http" : "https"}://${goodHostAndPort}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
