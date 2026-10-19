import { Logo } from "./Logo";

const PROOF_POINTS = [
  "Checks every contents entry against its real page number before the pack is built",
  "Builds your full SANRAL submission pack - forms, financials and CVs",
  "Flags every expired, missing or mismatched document before you submit",
];

/**
 * Shared split-screen shell for /login, /signup, /forgot-password and
 * /reset-password - replaces the plain centered-card look all four had
 * (flagged directly as "bland and boring"). Left panel carries the brand
 * and the one-line promise from the landing page hero, so a visitor who
 * clicked through from there sees the same product, not a different one;
 * right panel is whatever that specific page needs (its own form/card).
 *
 * No new dependency: still inline CSSProperties everywhere, like the rest
 * of this codebase. The one thing inline styles can't do - hiding the left
 * panel below a breakpoint - is handled by the single <style> block below,
 * not by introducing Tailwind or CSS modules here.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <style>{`
        @media (max-width: 860px) {
          .auth-left-panel { display: none; }
          .auth-right-panel { flex: 1 1 100% !important; }
        }
      `}</style>

      <div
        className="auth-left-panel"
        style={{
          flex: "0 0 44%",
          minWidth: 360,
          maxWidth: 560,
          background: "#16233B",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "56px 56px",
          boxSizing: "border-box",
        }}
      >
        {/* A large, faint version of the mark itself as texture - not a
            stock photo, not a gradient blob, just the product's own shape
            oversized and cropped into the corner. */}
        <div style={{ position: "absolute", right: -90, bottom: -90, opacity: 0.08, pointerEvents: "none" }}>
          <Logo size={420} variant="light" />
        </div>

        <div style={{ position: "relative", zIndex: 1, fontFamily: "system-ui, sans-serif" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
            <Logo size={36} variant="light" />
            <span style={{ fontSize: 17, fontWeight: 700, color: "#F6F5F1" }}>Tender Tool</span>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 700, color: "#F6F5F1", margin: "0 0 16px", lineHeight: 1.3, maxWidth: 420 }}>
            Find government tenders, build complete submissions, never miss a deadline.
          </h1>

          <ul style={{ listStyle: "none", margin: "32px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            {PROOF_POINTS.map((point) => (
              <li key={point} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, color: "rgba(246, 245, 241, 0.8)" }}>
                <span style={{ color: "#D97706", fontWeight: 700, marginTop: 1 }}>&#10003;</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        className="auth-right-panel"
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F6F5F1",
          padding: 16,
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}
