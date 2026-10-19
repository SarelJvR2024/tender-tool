import Link from "next/link";

// Free standalone tools - lead magnets, no sign-in, no company/tender
// context required. Deliberately separate from the signed-in app's
// SiteNav (these must work for someone who has never heard of Tender
// Tool yet, same positioning as TenderFlow's own free tools).
export const metadata = {
  title: "Free tender tools - Tender Tool",
  description: "Free South African public-sector tender calculators: working-day deadlines, CIDB grading, B-BBEE preference points.",
};

const TOOLS = [
  {
    href: "/tools/deadline-calculator",
    title: "Working-day deadline calculator",
    blurb: "Add or count working days excluding weekends and South African public holidays - for tender closing dates, briefing notices and query deadlines.",
  },
  {
    href: "/tools/cidb-grade",
    title: "CIDB grade calculator",
    blurb: "Look up the CIDB contractor grade a tender's value requires, or check whether the grade you hold is enough to bid.",
  },
  {
    href: "/tools/bee-preference-points",
    title: "B-BBEE preference points calculator",
    blurb: "Work out the actual 80/20 or 90/10 preference points (PPPFA Preferential Procurement Regulations, 2022) for a price and B-BBEE level.",
  },
  {
    href: "/tools/b6-estimator",
    title: "SANRAL B6 functionality score estimator",
    blurb: "Estimate a key position's SANRAL functionality score from the real published Book 1 scoring matrices - no SANRAL competitor covers this at all.",
  },
];

export default function ToolsIndexPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#F6F5F1", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ background: "#16233B", color: "#FFFFFF", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "#FFFFFF", width: "fit-content" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#16233B" }}>
              T
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
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

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 16px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#16233B", margin: "0 0 8px" }}>Free tender tools</h1>
        <p style={{ fontSize: 14, color: "#6B6758", margin: "0 0 32px", lineHeight: 1.5 }}>
          No sign-up required. Each tool is correct against the actual South African regulation or public data table
          it&apos;s built on, not a guess - sources are cited on each page.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              style={{
                display: "block",
                background: "#FFFFFF",
                border: "1px solid #E5E1D5",
                borderRadius: 12,
                padding: "20px 22px",
                textDecoration: "none",
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "#16233B", marginBottom: 6 }}>{tool.title}</div>
              <div style={{ fontSize: 13, color: "#6B6758", lineHeight: 1.5 }}>{tool.blurb}</div>
            </Link>
          ))}
        </div>

        <p style={{ fontSize: 12, color: "#6B6758", marginTop: 40, lineHeight: 1.5 }}>
          Built by <Link href="/" style={{ color: "#16233B", fontWeight: 600 }}>Tender Tool</Link> - correct, not
          AI-guessed. These calculators are free and standalone; Tender Tool itself helps SA engineering/construction
          firms find, track and prepare public-sector tender submissions.
        </p>
      </main>
    </div>
  );
}
