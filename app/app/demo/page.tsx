import Link from "next/link";
import { LogoLockup } from "../_components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { SectionCard } from "@/components/tt/section-card";
import { ChipBadge } from "../company/_components/shared";
import { RequirementRow } from "@/components/tt/requirement-row";
import { PositionPersonSelect } from "../tenders/[id]/position-person-select";
import { CvCompareView } from "../tenders/[id]/cv-compare";
import { PackChecklist } from "../tenders/[id]/pack-checklist";
import { CoverPagePreview } from "../tenders/[id]/cover-page-preview";
import {
  DEMO_COMPANY,
  DEMO_CV_ORIGINAL,
  DEMO_CV_TAILORED,
  DEMO_PACK_CHECKLIST,
  DEMO_POSITION_PEOPLE,
  DEMO_POSITION_SUGGESTIONS,
  DEMO_REQUIREMENTS,
  DEMO_TENDER,
} from "@/lib/demoData";

export const metadata = {
  title: "Try Tender Ready with a sample tender - no sign-up needed",
  description:
    "See exactly how Tender Ready checks a tender, suggests documents and people, tailors a CV and assembles the final pack - on a sample company and tender, no account needed.",
};

/**
 * No-signup interactive demo (spec §6, item 1). Public, server-rendered,
 * zero auth required - every section below renders through the SAME real
 * component the authenticated tender workspace uses (CvCompareView,
 * PackChecklist, CoverPagePreview, PositionPersonSelect, ChipBadge, and the
 * real expiryStatus()/whySuggested()/suggestForPosition() functions), fed a
 * hand-built sample dataset (lib/demoData.ts) instead of a live Supabase
 * read - not a separate "looks similar" mockup screen. See app/AGENTS.md's
 * "No-signup interactive demo" entry for exactly which components are
 * reused vs. lightly adjusted to accept injected data.
 */
export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-foreground px-5 py-4 text-white">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex w-fit items-center text-white no-underline">
            <LogoLockup height={24} surface="dark" />
          </Link>
          <Link href="/signup" className={buttonVariants({ variant: "accent", className: "min-h-11 whitespace-nowrap px-4 text-[13px]" })}>
            Start free
          </Link>
        </div>
      </header>

      <div className="border-b border-info/20 bg-info/10 px-5 py-3 text-center text-sm text-info">
        <span className="font-semibold">Sample company and tender.</span> Nothing below is a real customer - this is
        exactly how Tender Ready would read your own tenders once you sign up.
      </div>

      <main className="mx-auto max-w-[860px] px-5 py-10">
        <h1 className="mb-2 font-display text-2xl font-medium text-foreground">
          {DEMO_COMPANY.legal_name} <span className="font-sans text-base font-normal text-muted-foreground">(sample company)</span>
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {DEMO_TENDER.contract_no} - {DEMO_TENDER.description}
        </p>

        <div className="flex flex-col gap-5">
          <SectionCard title="What this tender needs" description="Traced to the exact words in the tender's own documents.">
            <div className="flex flex-col">
              {DEMO_REQUIREMENTS.map((r) => (
                <RequirementRow key={r.label} label={r.label} detail={r.detail} quote={r.quote} fromOcr={r.fromOcr} status={r.status} />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Who should fill this position"
            description="Ranked from your own People page - with the reason for each, not just a name."
          >
            <PositionPersonSelect
              tenderId="demo"
              tenderPackId="demo"
              positionCode="RE-1"
              confirmedPersonId={null}
              tagged={DEMO_POSITION_PEOPLE}
              others={[]}
              roleTitle="Resident Engineer"
              suggestions={DEMO_POSITION_SUGGESTIONS}
              demo
            />
          </SectionCard>

          <SectionCard title="CV tailored to this tender" description="Your own uploaded CV, next to the version built for this position.">
            <CvCompareView original={DEMO_CV_ORIGINAL} tailored={DEMO_CV_TAILORED} />
          </SectionCard>

          <SectionCard title="Caught before you submit" description="A document on file, but past its own expiry date.">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
              <span className="text-sm font-medium text-foreground">COID Letter of Good Standing</span>
              <ChipBadge status={DEMO_REQUIREMENTS[2].status} />
            </div>
          </SectionCard>

          <div>
            <CoverPagePreview
              contractNo={DEMO_TENDER.contract_no}
              nraReference={DEMO_TENDER.nra_reference}
              description={DEMO_TENDER.description}
              buyer={DEMO_TENDER.buyer}
              closingDate={DEMO_TENDER.closing_date}
              company={DEMO_COMPANY}
            />
            <SectionCard title="What's in the final pack" description="Every document the pack holds, in submission order - included, flagged, or not included and why.">
              <PackChecklist rows={DEMO_PACK_CHECKLIST} />
            </SectionCard>
          </div>
        </div>

        <div className="mt-10 rounded-xl bg-foreground p-7 text-center">
          <div className="mb-1.5 text-[15px] font-semibold text-white">This is what your own tenders would look like</div>
          <p className="mb-4 text-[13px] leading-relaxed text-white/78">
            14-day trial &middot; no card needed &middot; one full bid pack, assembled from your own company&apos;s documents.
          </p>
          <Link href="/signup" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11 px-6" })}>
            Start free
          </Link>
        </div>
      </main>
    </div>
  );
}
