// A single shared "is this a safe same-origin redirect target" check - the
// same open-redirect guard duplicated (and each time, incompletely) at 3
// real call sites that read a redirect target from user-controlled input
// (a `?next=` query param on /login and /signup, a hidden `return_to` form
// field in app/company/document-scan/actions.ts) and a 4th, the actual
// redirect SINK (app/auth/callback/route.ts), that had no guard at all.
//
// Every one of the first 3 used only `value.startsWith("/")` (actions.ts
// also excluded `"//"`) to rule out an absolute URL - that stops the plain
// protocol-relative case ("//evil.com") but not the WHATWG URL spec's own
// "backslash is a path separator for a special scheme" rule, which every
// real browser implements: "/\\evil.com" also starts with a single "/", so
// it passed every one of those checks, but a browser resolves it to
// "https://evil.com" all the same (confirmed with node's own WHATWG-
// compliant URL parser: `new URL("/\\evil.com", base).href` is
// "https://evil.com/", not a path on the real site). QA pass, 2026-10-23.
//
// This also protects a caller that forgets to validate at all (the real
// case found at /auth/callback/route.ts, which built a redirect straight
// from an unchecked `next` query param): requiring the SINK to validate
// its own input too, not only whatever called it, is the same
// defense-in-depth this project already applies to path-traversal checks
// (POPIA-Security-Audit.md) and payload validation generally.
//
// Deliberately permissive otherwise - any same-origin path (with its own
// query string / hash) is fine; this is not a route allowlist.
export function isSafeRedirectPath(value: string | null | undefined): value is string {
  return !!value && /^\/(?!\/|\\)/.test(value);
}

/** `value` if it's a safe same-origin path, else `fallback`. */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  return isSafeRedirectPath(value) ? value : fallback;
}
