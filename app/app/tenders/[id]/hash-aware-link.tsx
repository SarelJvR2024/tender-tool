import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Renders `href` as a plain <a> when it's a same-page "#anchor", or as
 * next/link's <Link> for an actual page navigation ("/company",
 * "/experience", "/company#bee-cidb", ...).
 *
 * QA finding, 2026-10-26 (real tenders GG12700238 / N.007-030-2026/1F): the
 * "Change"/"Fix" hrefs here come from classifyComplianceItem()
 * (bid-task-status.ts) and pack-review-data.ts/general-pack-review-data.ts's
 * section()/failedSection(), which both mix same-page hashes
 * ("#tender-templates", "#form-b7", "#key-positions") with real cross-page
 * paths in the same field. A single next/link <Link> for both silently
 * broke the hash case: WorkspaceTabs (workspace-tabs.tsx) switches tabs by
 * listening for the native `hashchange` event, which a same-page
 * history.pushState navigation - what <Link> does for a hash-only href -
 * never fires. An ordinary <a> click does fire it, so that case is kept as
 * a plain anchor; a real route change still goes through <Link> as before.
 */
/** True only for a same-page "#anchor" href - NOT "/path#anchor", which still needs a real page navigation first. */
export function isSamePageHash(href: string): boolean {
  return href.startsWith("#");
}

export function HashAwareLink({
  href,
  className,
  style,
  children,
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (isSamePageHash(href)) {
    return (
      <a href={href} className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} style={style}>
      {children}
    </Link>
  );
}
