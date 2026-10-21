import Link from "next/link";
import { Logo } from "../_components/Logo";

export const metadata = {
  title: "Privacy notice - Tender Ready",
  description: "What personal information Tender Ready collects, why, who it is shared with, and how to exercise your rights under POPIA.",
};

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
    <div className="min-h-screen bg-background">
      <div className="bg-foreground px-5 py-4">
        <div className="mx-auto flex max-w-[760px] items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-white no-underline">
            <Logo size={28} variant="light" />
            <span className="text-base font-semibold">Tender Ready</span>
          </Link>
          <Link href="/signup" className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent no-underline">
            Start free &rarr;
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[760px] px-5 pb-16 pt-10">
        <h1 className="mb-1.5 font-display text-[26px] font-medium text-foreground">Privacy notice</h1>
        <p className="mb-8 text-[13px] text-muted-foreground">
          Last updated 19 October 2026. This explains what personal information Tender Ready handles, why, and how to
          exercise your rights under the Protection of Personal Information Act (POPIA, Act 4 of 2013).
        </p>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">Who this covers, and two different roles</h2>
          <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground">
            When your company signs up, your company is the <strong>responsible party</strong> for the personal
            information of its own staff - key people&apos;s ID numbers, qualifications, project history, phone
            numbers, CVs - and its directors&apos; details. Tender Ready processes that information on your
            company&apos;s behalf, which makes Tender Ready an <strong>operator</strong>, under your company&apos;s
            instruction.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For your own account - the email address and password (or Google/Microsoft login) you sign in with -
            Tender Ready is the responsible party.
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">What we collect, and why</h2>
          <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground">
            Only what a SANRAL or other public-sector tender submission actually requires: company registration
            details (CIPC number, VAT, tax, CIDB/CSD numbers), director details, key people&apos;s ID numbers,
            qualifications, project histories and CVs, and the compliance documents you upload (COID letters, tax
            clearance, insurance, BEE certificates). None of it is collected for any purpose beyond preparing and
            tracking your company&apos;s own tender submissions.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A CV you upload is read by an AI step to pull out structured fields (name, qualifications, project
            history) for your review before anything is saved - you confirm or correct every field, nothing is
            saved automatically. Any South African ID number is matched and removed from that text locally, on our
            own servers, before the remaining text is sent to Anthropic (the AI provider) for extraction - the ID
            number itself never leaves Tender Ready&apos;s own infrastructure for that step.
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">Who we share it with</h2>
          <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground">
            Your data is never shared with another company using Tender Ready. The product is built so that every
            customer&apos;s data is isolated from every other customer&apos;s - enforced at the database level, not
            just hidden in the interface, and independently tested for exactly that (ask us for the details if
            you&apos;d like them).
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A small number of infrastructure providers process data on our behalf, strictly to run the service:
            Supabase (database and file storage), Vercel (hosting the web app), and Anthropic (CV text extraction,
            as above, with ID numbers removed first). We are confirming each provider&apos;s hosting region and
            data-processing terms as part of finishing our POPIA documentation (see &quot;What&apos;s still in
            progress&quot; below).
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">Your rights</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You (or your company&apos;s admin) can view and correct every key person&apos;s details directly on
            their People page at any time. Deleting a person removes their record, including their uploaded and
            generated CV files. If you need help exercising any right under POPIA - access, correction, deletion,
            or raising a concern about how your information is handled - contact us at the address below.
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">Security</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every customer&apos;s data is scoped by row-level security in the database, not only by the app&apos;s
            interface - meaning even a direct database query from one company&apos;s session cannot read another
            company&apos;s rows. File storage paths are similarly confined to each company&apos;s own folder. These
            protections were independently audited and are covered by an automated test suite that runs on every
            change to the database.
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-warning/20 bg-warning/10 p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-warning">What&apos;s still in progress</h2>
          <p className="text-sm leading-relaxed text-warning">
            In the interest of being straightforward rather than overstating where things stand: we have not yet
            registered an Information Officer with the Information Regulator, finalised a data retention period for
            generated documents, or confirmed the hosting region for every provider above. None of these affect how
            your data is protected today - the technical safeguards above are already built and tested - but we are
            completing this paperwork and will update this notice as each item is finished.
          </p>
        </div>

        <div className="mb-4.5 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2.5 text-[17px] font-semibold text-foreground">Contact</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Questions about this notice, or a request relating to your personal information, can be sent to{" "}
            <a href="mailto:privacy@tendertool.co.za" className="font-semibold text-foreground">
              privacy@tendertool.co.za
            </a>
            .
          </p>
        </div>

        <Link href="/" className="mt-2 inline-block text-[13px] text-muted-foreground no-underline hover:text-foreground">
          &larr; Back to Tender Ready
        </Link>
      </div>
    </div>
  );
}
