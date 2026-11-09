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
// later, THEN a second real bug found one pass after that - Finding 271):
// this used to split on ":" by hand to strip a real port before checking
// the hostname (Finding 270's own fix), then a separate ad-hoc
// `.startsWith("localhost")` substring check below decided the scheme
// (Finding 271's own bug - see `siteUrl()`'s own history comment). Both
// were narrow, hand-rolled re-implementations of what a URL parser already
// does correctly, and both were wrong in a different way. Rewritten once
// more, this time to stop hand-parsing the authority component at all:
// feed the Host header through the SAME `URL` constructor every real
// browser/mail client/WHATWG-compliant parser uses (with a throwaway
// "http://" scheme prefix purely so `URL` has something to parse - the
// scheme itself is decided afterwards, below, from the validated hostname,
// never from this placeholder), then validate and rebuild from its own
// `.hostname`/`.port` exclusively. This closes Finding 270's bypass at the
// root rather than patching around it again (`new URL("tenderready.app:@evil.attacker.example")`'s
// own `.username` is non-empty, so it is rejected outright here, not
// merely prevented from being echoed back), AND Finding 271's bug (equality
// against the parser's own `.hostname`, never a substring match) - one
// parser, one place, no second hand-rolled interpretation of the same
// string anywhere in this file.
function knownGoodHostAndPort(host: string): { hostname: string; port: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return null; // not a parseable host[:port] at all (e.g. a literal comma-joined value)
  }
  // A bare Host header is never allowed to carry userinfo ("user:pass@host") -
  // if it does, something is already being smuggled past this check, exactly
  // how Finding 270's own bypass worked ("tenderready.app:" read as userinfo,
  // not a port). Reject outright instead of silently ignoring it and
  // returning the real (post-"@") host anyway, which - while not actually
  // exploitable, since that real host still has to pass the allowlist below
  // on its own merits - would otherwise return a needlessly confusing
  // string with a misleading, attacker-chosen prefix visible in it.
  if (parsed.username || parsed.password) return null;
  const hostname = parsed.hostname; // WHATWG-normalized: lowercased, trailing dot preserved, IPv6 kept bracketed
  const port = parsed.port; // "" when absent
  const isGoodHostname =
    hostname === "localhost" || hostname === "127.0.0.1" || KNOWN_GOOD_HOSTS.some((re) => re.test(hostname));
  if (!isGoodHostname) return null;
  return { hostname, port };
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
  const good = host ? knownGoodHostAndPort(host) : null;
  if (good) {
    // Finding 271: this used to be `goodHostAndPort.startsWith("localhost")` -
    // a substring check against the whole (possibly-ported) string, which a
    // real, already-allowlisted *.vercel.app host whose name merely STARTS
    // WITH the text "localhost" (a legal Vercel project/preview name) also
    // matched, downgrading it to "http://" instead of "https://". Now an
    // exact-equality check against the parser's own validated `.hostname`.
    const isLocal = good.hostname === "localhost" || good.hostname === "127.0.0.1";
    const hostAndPort = good.port ? `${good.hostname}:${good.port}` : good.hostname;
    return `${isLocal ? "http" : "https"}://${hostAndPort}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
