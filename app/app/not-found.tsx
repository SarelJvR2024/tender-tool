import Link from "next/link";

/**
 * Root not-found page (enterprise-readiness audit, 2026-10-20) - renders for
 * an explicit notFound() call in any route segment AND any unmatched URL
 * project-wide (Next.js 16's own convention: the root app/not-found.tsx
 * handles both). Deliberately self-contained, no SiteNav/data fetch - this
 * can render before auth is known to be valid, so it must not depend on
 * anything that could itself fail.
 */
export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#FFFFFF", padding: "24px" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 8 }}>Page not found</div>
        <div style={{ fontSize: 13, color: "#5B6472", marginBottom: 20, lineHeight: 1.5 }}>
          Nothing here - the link may be out of date, or this item may have been removed.
        </div>
        <Link
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 20px", borderRadius: 9, fontSize: 14, fontWeight: 600, textDecoration: "none", background: "#D97706", color: "#FFFFFF" }}
        >
          Back to Tenders
        </Link>
      </div>
    </div>
  );
}
