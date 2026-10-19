import Link from "next/link";

export const metadata = {
  title: "Privacy notice - Tender Tool",
  description: "What personal information Tender Tool collects, why, who it is shared with, and how to exercise your rights under POPIA.",
};

const NAVY = "#16233B";
const AMBER = "#D97706";
const CREAM = "#F6F5F1";
const INK = "#16233B";
const INK_MUTED = "#6B6758";
const BORDER = "#E5E1D5";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 11, padding: "22px 24px", marginBottom: 18 };
const H2: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: INK, margin: "0 0 10px" };
const P: React.CSSProperties = { fontSize: 14, color: "#6B6758", lineHeight: 1.7, margin: "0 0 10px" };

/**
 * A real POPIA privacy notice was one of the biggest gaps a prospective-customer
 * review flagged (2026-10-19): this product collects ID numbers, CVs, director
 * details and bank info, and nothing public said what happens to any of it.
 * Content here is drawn only from what docs/specs/POPIA-Security-Audit.md
 * documents as actually true and already built (section 6's assessment, the
 * safeguards in sections 3-5) - it does not claim anything not yet done (no
 * Information Officer is registered yet, no retention period is set, hosting
 * regions for Supabase/Vercel are not yet confirmed - all listed honestly
 * below as in progress, not glossed over). This is a draft for Sarel to
 * complete (Information Officer name/contact, retention periods, hosting
 * region confirmation) and have reviewed before it is relied on as a
 * finished compliance document - not a substitute for that review.
 */
export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: NAVY, padding: "16px 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "#FFFFFF" }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: AMBER, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: NAVY, flexShrink: 0 }}>
              T
            </div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Tender Tool</div>
          </Link>
          <Link href="/signup" style={{ color: AMBER, fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
            Start free &rarr;
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 64px", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: "0 0 6px" }}>Privacy notice</h1>
        <p style={{ fontSize: 13, color: INK_MUTED, margin: "0 0 32px" }}>
          Last updated 19 October 2026. This explains what personal information Tender Tool handles, why, and how to
          exercise your rights under the Protection of Personal Information Act (POPIA, Act 4 of 2013).
        </p>

        <div style={CARD}>
          <h2 style={H2}>Who this covers, and two different roles</h2>
          <p style={P}>
            When your company signs up, your company is the <strong>responsible party</strong> for the personal
            information of its own staff - key people&apos;s ID numbers, qualifications, project history, phone
            numbers, CVs - and its directors&apos; details. Tender Tool processes that information on your
            company&apos;s behalf, which makes Tender Tool an <strong>operator</strong>, under your company&apos;s
            instruction.
          </p>
          <p style={P}>
            For your own account - the email address and password (or Google/Microsoft login) you sign in with -
            Tender Tool is the responsible party.
          </p>
        </div>

        <div style={CARD}>
          <h2 style={H2}>What we collect, and why</h2>
          <p style={P}>
            Only what a SANRAL or other public-sector tender submission actually requires: company registration
            details (CIPC number, VAT, tax, CIDB/CSD numbers), director details, key people&apos;s ID numbers,
            qualifications, project histories and CVs, and the compliance documents you upload (COID letters, tax
            clearance, insurance, BEE certificates). None of it is collected for any purpose beyond preparing and
            tracking your company&apos;s own tender submissions.
          </p>
          <p style={P}>
            A CV you upload is read by an AI step to pull out structured fields (name, qualifications, project
            history) for your review before anything is saved - you confirm or correct every field, nothing is
            saved automatically. Any South African ID number is matched and removed from that text locally, on our
            own servers, before the remaining text is sent to Anthropic (the AI provider) for extraction - the ID
            number itself never leaves Tender Tool&apos;s own infrastructure for that step.
          </p>
        </div>

        <div style={CARD}>
          <h2 style={H2}>Who we share it with</h2>
          <p style={P}>
            Your data is never shared with another company using Tender Tool. The product is built so that every
            customer&apos;s data is isolated from every other customer&apos;s - enforced at the database level, not
            just hidden in the interface, and independently tested for exactly that (ask us for the details if
            you&apos;d like them).
          </p>
          <p style={P}>
            A small number of infrastructure providers process data on our behalf, strictly to run the service:
            Supabase (database and file storage), Vercel (hosting the web app), and Anthropic (CV text extraction,
            as above, with ID numbers removed first). We are confirming each provider&apos;s hosting region and
            data-processing terms as part of finishing our POPIA documentation (see &quot;What&apos;s still in
            progress&quot; below).
          </p>
        </div>

        <div style={CARD}>
          <h2 style={H2}>Your rights</h2>
          <p style={P}>
            You (or your company&apos;s admin) can view and correct every key person&apos;s details directly on
            their People page at any time. Deleting a person removes their record, including their uploaded and
            generated CV files. If you need help exercising any right under POPIA - access, correction, deletion,
            or raising a concern about how your information is handled - contact us at the address below.
          </p>
        </div>

        <div style={CARD}>
          <h2 style={H2}>Security</h2>
          <p style={P}>
            Every customer&apos;s data is scoped by row-level security in the database, not only by the app&apos;s
            interface - meaning even a direct database query from one company&apos;s session cannot read another
            company&apos;s rows. File storage paths are similarly confined to each company&apos;s own folder. These
            protections were independently audited and are covered by an automated test suite that runs on every
            change to the database.
          </p>
        </div>

        <div style={{ ...CARD, background: "#FFFBEB", borderColor: "#FDE68A" }}>
          <h2 style={{ ...H2, color: "#92400E" }}>What&apos;s still in progress</h2>
          <p style={{ ...P, color: "#78350F" }}>
            In the interest of being straightforward rather than overstating where things stand: we have not yet
            registered an Information Officer with the Information Regulator, finalised a data retention period for
            generated documents, or confirmed the hosting region for every provider above. None of these affect how
            your data is protected today - the technical safeguards above are already built and tested - but we are
            completing this paperwork and will update this notice as each item is finished.
          </p>
        </div>

        <div style={CARD}>
          <h2 style={H2}>Contact</h2>
          <p style={P}>
            Questions about this notice, or a request relating to your personal information, can be sent to{" "}
            <a href="mailto:privacy@tendertool.co.za" style={{ color: NAVY, fontWeight: 600 }}>
              privacy@tendertool.co.za
            </a>
            .
          </p>
        </div>

        <Link href="/" style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: INK_MUTED, textDecoration: "none" }}>
          &larr; Back to Tender Tool
        </Link>
      </div>
    </div>
  );
}
