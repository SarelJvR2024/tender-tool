import Link from "next/link";
import { ToolsHeader } from "./_components/ToolsHeader";

// Free standalone tools - lead magnets, no sign-in, no company/tender
// context required. Deliberately separate from the signed-in app shell
// (these must work for someone who has never heard of Tender Ready yet,
// same positioning as TenderFlow's own free tools) - the app shell's own
// "Tools" sidebar item links here too, so a signed-in visitor briefly
// leaves the shell; see app/AGENTS.md ("App shell").
export const metadata = {
  title: "Free tender tools - Tender Ready",
  description: "Free South African public-sector tender calculators: working-day deadlines, CIDB grading, B-BBEE preference points.",
};

const TOOLS = [
  {
    href: "/tools/deadline-calculator",
    title: "Working-day deadline calculator",
    blurb: "Add or count working days excluding weekends and South African public holidays - for tender closing dates, briefing notices and query deadlines.",
    badge: "DL",
  },
  {
    href: "/tools/cidb-grade",
    title: "CIDB grade calculator",
    blurb: "Look up the CIDB contractor grade a tender's value requires, or check whether the grade you hold is enough to bid.",
    badge: "CIDB",
  },
  {
    href: "/tools/bee-preference-points",
    title: "B-BBEE preference points calculator",
    blurb: "Work out the actual 80/20 or 90/10 preference points (PPPFA Preferential Procurement Regulations, 2022) for a price and B-BBEE level.",
    badge: "%",
  },
  {
    href: "/tools/b6-estimator",
    title: "SANRAL B6 functionality score estimator",
    blurb: "Estimate a key position's SANRAL functionality score from the real published Book 1 scoring matrices - no SANRAL competitor covers this at all.",
    badge: "B6",
  },
];

// Design-system migration (2026-10-21): was raw inline-CSSProperties with
// the old navy/amber pairing (a hover highlight on each card used the old
// gold #D97706) - now Tailwind + tokens throughout. The card badges read
// bg-foreground/text-white (the deep navy ink, same pairing ToolsHeader
// itself uses), and the one hover highlight reads the blue accent token
// (hover:border-accent) rather than reintroducing gold - consistent with
// "accent is the one highlight color" everywhere else in the app. Page
// background moved from a flat white to bg-background (the app's own
// neutral grey canvas) so the white tool cards read as lifted surfaces,
// same card-on-canvas layering every other migrated page already uses.
export default function ToolsIndexPage() {
  return (
    <div className="min-h-screen bg-background">
      <ToolsHeader showBackLink={false} />

      <main className="mx-auto max-w-[720px] px-4 pt-10 pb-16">
        <h1 className="mb-2 font-display text-2xl font-bold text-foreground">Free tender tools</h1>
        <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
          No sign-up required. Each tool is correct against the actual South African regulation or public data table
          it&apos;s built on, not a guess - sources are cited on each page.
        </p>

        <div className="flex flex-col gap-3.5">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-start gap-3.5 rounded-xl border border-border border-l-4 border-l-foreground bg-card p-5 no-underline transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent hover:border-l-accent hover:shadow-md"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-bold text-white">
                {tool.badge}
              </div>
              <div>
                <div className="mb-1.5 text-base font-bold text-foreground">{tool.title}</div>
                <div className="text-[13px] leading-relaxed text-muted-foreground">{tool.blurb}</div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          Built by{" "}
          <Link href="/" className="font-semibold text-foreground">
            Tender Ready
          </Link>{" "}
          - correct, not AI-guessed. These calculators are free and standalone; Tender Ready itself helps SA
          engineering/construction firms find, track and prepare public-sector tender submissions.
        </p>
      </main>
    </div>
  );
}
