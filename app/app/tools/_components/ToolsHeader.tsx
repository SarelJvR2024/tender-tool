import Link from "next/link";

// Shared header for the individual free-tool pages (deadline calculator,
// CIDB grade, B-BBEE preference points, B6 estimator). Before this, every
// one of them was a dead end for conversion - the only link anywhere on
// the page was "<- Free tools" back to the index, with no path from a
// direct visit (search, a shared link) to actually signing up, even though
// these tools exist specifically as the lead magnets the landing page's
// "Try a free tool first" button sends people to.
export function ToolsHeader() {
  return (
    <header style={{ background: "#16233B", color: "#FFFFFF", padding: "16px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Link href="/tools" style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, textDecoration: "none" }}>
          &larr; Free tools
        </Link>
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
