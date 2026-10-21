import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// This is the product's landing page, not a static marketing page: a
// signed-in visitor is still sent straight to /dashboard (nothing a
// returning user needs to see here), which means the session cookie has
// to be read per request - "instant = false" is Next.js 16's documented
// escape hatch for a route that must block on real, per-request data
// instead of being prerendered at build time. (Previously this whole
// route was just redirect(user ? "/dashboard" : "/login") with zero
// marketing content - that's what's being replaced.)
export const instant = false;

export const metadata = {
  title: "Tender Ready - SANRAL submission packs, built and checked page by page",
  description:
    "Tender Ready turns your company documents, people and past-project evidence into SANRAL's complete technical and financial envelope packs - checked page by page against the tender's own rules. No AI blabber, nothing missing, nothing expired.",
};

const NAVY = "#16233B";
const AMBER = "#D97706";
const CREAM = "#FFFFFF";
const INK_MUTED = "#5B6472";
const BORDER = "#E3E6EA";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "24px 22px", boxSizing: "border-box" };
const SECTION: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "64px 20px", boxSizing: "border-box" };
const H2: React.CSSProperties = { fontSize: 26, fontWeight: 700, color: NAVY, margin: "0 0 10px", textAlign: "center" };
const LEDE: React.CSSProperties = { fontSize: 15, color: INK_MUTED, margin: "0 auto 36px", maxWidth: 620, textAlign: "center", lineHeight: 1.6 };
const PRIMARY_BTN: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "0 24px", borderRadius: 8, background: AMBER, color: "#FFFFFF", fontSize: 15, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" };
const SECONDARY_BTN: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "0 24px", borderRadius: 8, background: "transparent", color: "#FFFFFF", fontSize: 15, fontWeight: 600, textDecoration: "none", border: "1px solid rgba(255,255,255,0.35)", whiteSpace: "nowrap" };

const DIFFERENTIATION = [
  {
    title: "Tender-alert tools",
    body: "Tell you a tender exists, and when it closes. That's where the help stops - you still fill every workbook and form by hand.",
  },
  {
    title: "Generic AI proposal tools",
    body: "Write your methodology and executive summary for you. Every bid starts to read the same - and SANRAL's own workbooks and SBD forms aren't something an AI narrative tool fills at all.",
  },
  {
    title: "Tender Ready",
    body: "Reads the tender's own rules, fills SANRAL's workbooks and the standard SBD/MBD forms from your real company data, and shows you exactly what's missing before you submit. Your words stay yours.",
    highlight: true,
  },
];

const PROOF_POINTS = [
  {
    claim: "Every contents entry is checked against its real page number before the pack is built.",
    note: "Not a claim you have to take on trust - open the contents page against the PDF and count.",
  },
  {
    claim: "If SANRAL changes a template, the fill stops. It never guesses at a form it doesn't recognise.",
    note: "fingerprint.py compares every template against its last known baseline before touching it.",
  },
  {
    claim: "\"Not included, and why\" is printed in the pack itself - signatures, pricing, and anything only you can provide.",
    note: "Nothing silently left blank.",
  },
];

const FREE_TOOLS = [
  { href: "/tools/deadline-calculator", title: "Working-day deadline calculator", blurb: "Add or count working days excluding weekends and SA public holidays." },
  { href: "/tools/cidb-grade", title: "CIDB grade calculator", blurb: "Check the CIDB grade a tender's value requires, or whether yours is enough." },
  { href: "/tools/bee-preference-points", title: "B-BBEE preference points calculator", blurb: "The actual 80/20 or 90/10 points for a price and B-BBEE level, per the 2022 regulations." },
  { href: "/tools/b6-estimator", title: "SANRAL B6 functionality score estimator", blurb: "Estimate a key position's SANRAL functionality score from the real published Book 1 scoring matrices." },
];

const PRICING_TIERS = [
  {
    name: "Tender Watch",
    price: "Free",
    cadence: "",
    bullets: ["Discovery, fit verdict and score outlook", "Vault with expiry, view only", "1 compliance report a month"],
  },
  {
    name: "Tender Pro",
    price: "R1,490",
    cadence: "/month",
    bullets: ["Everything in Watch, plus reminders", "General pack: SBD/MBD fill, merged pack (6/month)", "Experience Library and CV library", "Pipeline, tasks and role-based digest"],
  },
  {
    name: "SANRAL Pro",
    price: "R3,950",
    cadence: "/month",
    bullets: ["Everything in Pro, no pack limit", "SANRAL workbook fill, both envelopes", "Done-with-you onboarding"],
    highlight: true,
  },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <header style={{ background: NAVY }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "16px 20px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "#FFFFFF" }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: AMBER, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: NAVY, flexShrink: 0 }}>
              T
            </div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Tender Ready</div>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/tools" style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, textDecoration: "none", padding: "8px 4px" }}>
              Free tools
            </Link>
            <Link href="/login" style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 600, textDecoration: "none", padding: "8px 4px" }}>
              Sign in
            </Link>
            <Link href="/signup" style={{ ...PRIMARY_BTN, minHeight: 36, padding: "0 16px", fontSize: 13 }}>
              Start free
            </Link>
          </div>
        </div>

        {/* Hero */}
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "56px 20px 64px", boxSizing: "border-box", textAlign: "center" }}>
          <h1 style={{ fontSize: "clamp(26px, 4.5vw, 38px)", fontWeight: 700, color: "#FFFFFF", margin: "0 0 18px", lineHeight: 1.25 }}>
            Your SANRAL technical and financial envelopes: built, numbered, bookmarked, and checked page by page.
          </h1>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.78)", margin: "0 0 32px", lineHeight: 1.6 }}>
            Complete, correct, and yours. Not AI-written - built from your own company documents, people and
            past-project evidence, with nothing missing, nothing expired, and nothing silently left blank.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/signup" style={PRIMARY_BTN}>
              Start free
            </Link>
            <Link href="/tools" style={SECONDARY_BTN}>
              Try a free tool first
            </Link>
          </div>
        </div>
      </header>

      {/* Differentiation band */}
      <section style={SECTION}>
        <h2 style={H2}>Not another tender alert, not another AI proposal writer</h2>
        <p style={LEDE}>South African tender software mostly does one of two things. Tender Ready does the part neither one does.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {DIFFERENTIATION.map((d) => (
            <div
              key={d.title}
              style={{
                ...CARD,
                background: d.highlight ? NAVY : "#FFFFFF",
                border: d.highlight ? `1px solid ${NAVY}` : `1px solid ${BORDER}`,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: d.highlight ? "#FFFFFF" : NAVY, marginBottom: 8 }}>{d.title}</div>
              <div style={{ fontSize: 13, color: d.highlight ? "rgba(255,255,255,0.8)" : INK_MUTED, lineHeight: 1.6 }}>{d.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The artefact */}
      <section style={{ background: "#FFFFFF", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={SECTION}>
          <h2 style={H2}>What actually comes out the other end</h2>
          <p style={LEDE}>Not a draft to tidy up. A submission pack, ready to print and sign.</p>
          <div style={{ maxWidth: 480, margin: "0 auto", background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "28px 26px", boxSizing: "border-box" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK_MUTED, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 14 }}>
              Inside a generated envelope
            </div>
            {[
              "Contents page - every entry checked against its real page number",
              "\"Page X of N\" printed on every page",
              "Bookmarks matching the contents page exactly",
              "Not included, and why - signatures, pricing, anything only you can provide",
            ].map((line) => (
              <div key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderBottom: `1px solid ${BORDER}`, fontSize: 13, color: NAVY, lineHeight: 1.5 }}>
                <span style={{ color: AMBER, fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Proof section */}
      <section style={SECTION}>
        <h2 style={H2}>No customers yet. Here&apos;s what to check instead of a testimonial</h2>
        <p style={LEDE}>
          Tender Ready is new. Rather than a quote from someone you&apos;ve never met, here are specific,
          falsifiable claims you can check yourself in the pack it builds.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680, margin: "0 auto 32px" }}>
          {PROOF_POINTS.map((p) => (
            <div key={p.claim} style={CARD}>
              <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 4, lineHeight: 1.5 }}>{p.claim}</div>
              <div style={{ fontSize: 12, color: INK_MUTED, lineHeight: 1.5 }}>{p.note}</div>
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 680, margin: "0 auto", background: NAVY, borderRadius: 12, padding: "24px 26px", boxSizing: "border-box", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF", marginBottom: 6 }}>Founding Firms Programme</div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", margin: "0 0 16px", lineHeight: 1.6 }}>
            The first 10 firms get SANRAL Pro at a locked founding rate, done-with-you onboarding, and a direct line
            back to how the product gets built next.
          </p>
          <Link href="/signup" style={PRIMARY_BTN}>
            Apply as a founding firm
          </Link>
        </div>
      </section>

      {/* Free tools */}
      <section style={{ background: "#FFFFFF", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={SECTION}>
          <h2 style={H2}>Free tools, no sign-up</h2>
          <p style={LEDE}>Correct against the actual South African regulation or public data table each is built on - not a guess.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, maxWidth: 820, margin: "0 auto" }}>
            {FREE_TOOLS.map((t) => (
              <Link key={t.href} href={t.href} style={{ ...CARD, textDecoration: "none", display: "block" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 6 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: INK_MUTED, lineHeight: 1.5 }}>{t.blurb}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section style={SECTION}>
        <h2 style={H2}>Pricing</h2>
        <p style={LEDE}>Excl. VAT. No credits to ration, no per-seat markup on the thing that actually creates the value.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 900, margin: "0 auto" }}>
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.name}
              style={{
                ...CARD,
                border: tier.highlight ? `2px solid ${AMBER}` : `1px solid ${BORDER}`,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{tier.name}</div>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: NAVY }}>{tier.price}</span>
                <span style={{ fontSize: 13, color: INK_MUTED }}>{tier.cadence}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {tier.bullets.map((b) => (
                  <div key={b} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: INK_MUTED, lineHeight: 1.5 }}>
                    <span style={{ color: AMBER, fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
              <Link href="/signup" style={{ ...PRIMARY_BTN, width: "100%", background: tier.highlight ? AMBER : NAVY }}>
                {tier.price === "Free" ? "Start free" : "Get started"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section style={{ background: NAVY }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "56px 20px", boxSizing: "border-box", textAlign: "center" }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#FFFFFF", margin: "0 0 10px", lineHeight: 1.5 }}>
            We don&apos;t promise to write your bid.
          </p>
          <p style={{ fontSize: 20, fontWeight: 700, color: AMBER, margin: "0 0 28px", lineHeight: 1.5 }}>
            We promise nothing in it is missing, expired, or mis-filed.
          </p>
          <Link href="/signup" style={PRIMARY_BTN}>
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: "24px 20px", textAlign: "center" }}>
        <p style={{ fontSize: 12, color: INK_MUTED, margin: "0 0 8px" }}>Tender Ready - built for South African construction and engineering firms bidding public-sector tenders.</p>
        <Link href="/privacy" style={{ fontSize: 12, color: INK_MUTED, textDecoration: "underline" }}>
          Privacy notice
        </Link>
      </footer>
    </div>
  );
}
