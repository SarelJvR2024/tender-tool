import Link from "next/link";
import { Zap } from "lucide-react";
import { AppShell } from "../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";

export const metadata = {
  title: "Tools - Tender Ready",
};

// Spec v3 O03: before this page existed, the sidebar's "Tools" item sent a
// signed-in user out to the public, signed-out /tools catalogue (its own
// "Start free" CTA and all) - losing the app shell, nav and company
// context for calculators they could use without ever leaving. This is the
// in-app front door the nav item now points to; each calculator below is
// the exact same component /tools/* renders publicly, just embedded here
// without the public page's own chrome (see each Client component's
// `embedded` prop). The public pages stay as-is for signed-out visitors -
// this is additive, not a replacement.
const TOOLS = [
  {
    href: "/toolkit/deadline-calculator",
    title: "Working-day deadline calculator",
    blurb: "Add or count working days excluding weekends and South African public holidays.",
    badge: "DL",
  },
  {
    href: "/toolkit/cidb-grade",
    title: "CIDB grade calculator",
    blurb: "Look up the CIDB contractor grade a tender's value requires, or check whether the grade you hold is enough to bid.",
    badge: "CIDB",
  },
  {
    href: "/toolkit/bee-preference-points",
    title: "B-BBEE preference points calculator",
    blurb: "Work out the actual 80/20 or 90/10 preference points for a price and B-BBEE level.",
    badge: "%",
  },
  {
    href: "/toolkit/b6-estimator",
    title: "SANRAL B6 functionality score estimator",
    blurb: "Estimate a key position's SANRAL functionality score from the real published Book 1 scoring matrices.",
    badge: "B6",
  },
];

export default function ToolkitIndexPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <PageHeader
          title="Toolkit"
          description="The same calculators as Tender Ready's free tools, without leaving your company context."
        />

        {/* Phase 2 nav restructure (2026-10-23): SANRAL schedules moved out of
            the primary sidebar (it was cluttering a nav meant for every
            customer, SANRAL-focused or not) - this is its own new home, a
            featured card rather than just another row in the list below, so
            it stays as visible as it was in the sidebar. */}
        <Link
          href="/sanral-schedules"
          className="flex items-start gap-3.5 rounded-xl border border-accent/30 bg-accent/5 p-5 no-underline transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent hover:shadow-md"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
            <Zap className="size-4.5" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-base font-bold text-foreground">
              SANRAL schedules
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent uppercase">Featured</span>
            </div>
            <div className="text-[13px] leading-relaxed text-muted-foreground">
              Track every SANRAL tender&apos;s own publication schedule and upcoming closing dates in one place.
            </div>
          </div>
        </Link>

        <div className="flex flex-col gap-3">
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
      </div>
    </AppShell>
  );
}
