import Link from "next/link";
import { LogoLockup } from "../../_components/Logo";

// Shared header for the individual free-tool pages (deadline calculator,
// CIDB grade, B-BBEE preference points, B6 estimator). Before this, every
// one of them was a dead end for conversion - the only link anywhere on
// the page was "<- Free tools" back to the index, with no path from a
// direct visit (search, a shared link) to actually signing up, even though
// these tools exist specifically as the lead magnets the landing page's
// "Try a free tool first" button sends people to.
// `showBackLink` (default true, matching the four tool pages) renders the
// "<- Free tools" link on the left. The index page itself has nowhere to
// go back to, so it passes false to get the real brand lockup instead.
//
// Logo fixed (2026-10-22, standing UI/UX pass): this header still had its
// own hand-coded "T" badge - a leftover from before the real brand asset
// pack existed (PR #75, same day), which replaced the Logo component and
// every other public-page header but never touched this file. A visitor
// who reached a free tool directly (search, a shared link) saw a
// different brand than every other page - now uses the same LogoLockup
// every other dark-surface header already renders.
//
// Design-system migration (2026-10-21): was raw inline-CSSProperties with
// the old Civic Navy (#16233B) / gold accent (#D97706) pairing, from
// before the "confident & premium" direction shipped. Now reads
// bg-foreground/text-white (same navy-panel-with-white-text pairing
// AuthShell already established) and bg-accent/text-accent-foreground for
// the one solid CTA - the blue accent, not the old gold. Links bumped to
// a 44px touch target (min-h-11) to match this app's convention - the old
// 36px CTA predates that convention being written down.
export function ToolsHeader({ showBackLink = true }: { showBackLink?: boolean } = {}) {
  return (
    <header className="bg-foreground px-5 py-4 text-white">
      <div className="mx-auto flex max-w-[640px] flex-wrap items-center justify-between gap-3">
        {showBackLink ? (
          <Link href="/tools" className="flex min-h-11 items-center text-[13px] text-white/75 no-underline">
            &larr; Free tools
          </Link>
        ) : (
          <Link href="/" className="flex w-fit items-center text-white no-underline">
            <LogoLockup height={24} surface="dark" />
          </Link>
        )}
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-accent px-4 text-[13px] font-bold text-accent-foreground no-underline"
        >
          Start free
        </Link>
      </div>
    </header>
  );
}

// The four free tools, for the cross-link footer below - same titles as the
// /tools index. Kept here (not duplicated per page) so adding a fifth tool
// only means editing one list.
export const OTHER_TOOLS = [
  { href: "/tools/deadline-calculator", label: "Working-day deadline calculator" },
  { href: "/tools/cidb-grade", label: "CIDB grade calculator" },
  { href: "/tools/bee-preference-points", label: "B-BBEE preference points calculator" },
  { href: "/tools/b6-estimator", label: "SANRAL B6 functionality score estimator" },
] as const;

// Small "Other free tools" footer, linking each tool page to the other
// three - before this, each of the four pages was a dead end unless you
// went back through /tools (or /signup). `except` is the current page's
// own href, so it never links to itself.
export function OtherTools({ except }: { except: string }) {
  const others = OTHER_TOOLS.filter((t) => t.href !== except);
  return (
    <div className="mt-8">
      <div className="mb-2.5 text-xs font-bold text-foreground">Other free tools</div>
      <div className="flex flex-wrap gap-2">
        {others.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground no-underline"
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
