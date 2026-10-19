import Link from "next/link";

// Shared header for the individual free-tool pages (deadline calculator,
// CIDB grade, B-BBEE preference points, B6 estimator). Before this, every
// one of them was a dead end for conversion - the only link anywhere on
// the page was "<- Free tools" back to the index, with no path from a
// direct visit (search, a shared link) to actually signing up, even though
// these tools exist specifically as the lead magnets the landing page's
// "Try a free tool first" button sends people to.
// `showBackLink` (default true, matching the four tool pages) renders the
// "<- Free tools" link on the left. The index page itself has nowhere to
// go back to, so it passes false to get the logo + wordmark instead - the
// same amber-badge "T" mark the rest of the public site uses.
export function ToolsHeader({ showBackLink = true }: { showBackLink?: boolean } = {}) {
  return (
    <header style={{ background: "#16233B", color: "#FFFFFF", padding: "16px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {showBackLink ? (
          <Link href="/tools" style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, textDecoration: "none" }}>
            &larr; Free tools
          </Link>
        ) : (
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "#FFFFFF", width: "fit-content" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#16233B" }}>
              T
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
          </Link>
        )}
        <Link
          href="/signup"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 36,
            padding: "0 16px",
            borderRadius: 8,
            background: "#D97706",
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Start free
        </Link>
      </div>
    </header>
  );
}

// The four free tools, for the cross-link footer below - same titles as the
// /tools index. Kept here (not duplicated per page) so adding a fifth tool
// only means editing one list.
export const OTHER_TOOLS = [
  { href: "/tools/deadline-calculator", label: "Working-day deadline calculator" },
  { href: "/tools/cidb-grade", label: "CIDB grade calculator" },
  { href: "/tools/bee-preference-points", label: "B-BBEE preference points calculator" },
  { href: "/tools/b6-estimator", label: "SANRAL B6 functionality score estimator" },
] as const;

// Small "Other free tools" footer, linking each tool page to the other
// three - before this, each of the four pages was a dead end unless you
// went back through /tools (or /signup). `except` is the current page's
// own href, so it never links to itself.
export function OtherTools({ except }: { except: string }) {
  const others = OTHER_TOOLS.filter((t) => t.href !== except);
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#16233B", marginBottom: 10 }}>Other free tools</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {others.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 14px",
              borderRadius: 100,
              background: "#FFFFFF",
              border: "1px solid #E3E6EA",
              color: "#16233B",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
