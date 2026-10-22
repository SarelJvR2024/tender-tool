import Link from "next/link";

/**
 * Root not-found page (enterprise-readiness audit, 2026-10-20) - renders for
 * an explicit notFound() call in any route segment AND any unmatched URL
 * project-wide (Next.js 16's own convention: the root app/not-found.tsx
 * handles both). Deliberately self-contained, no app shell/data fetch - this
 * can render before auth is known to be valid, so it must not depend on
 * anything that could itself fail.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-card p-6 font-sans">
      <div className="max-w-[420px] text-center">
        <div className="mb-2 text-[15px] font-bold text-foreground">Page not found</div>
        <div className="mb-5 text-[13px] leading-normal text-muted-foreground">
          Nothing here - the link may be out of date, or this item may have been removed.
        </div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground no-underline"
        >
          Back to Tenders
        </Link>
      </div>
    </div>
  );
}
