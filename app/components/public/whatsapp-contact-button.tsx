"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Public-marketing-only contact channel (brief, 2026-10-26): South African
// contractors prefer WhatsApp over a contact form. Deliberately scoped to
// the public marketing/tool routes named across both briefs - "/", "/demo",
// and "/tools" (+ every nested calculator under it, e.g.
// "/tools/b6-estimator") - not every unauthenticated route (not /login,
// /signup, /privacy). There is no separate public-vs-authenticated layout
// segment in this app (AppShell is a client wrapper each authenticated
// page mounts itself, not a layout.tsx route group), so this reads the
// pathname itself and renders nothing outside those routes, rather than
// needing a new layout split just for this.
//
// "/pricing" in the brief doesn't exist as a route - pricing is a section
// of "/" (id="pricing", see app/page.tsx), not its own page. Treated as
// "on / with the #pricing hash" below rather than silently dropped or
// invented as a new route.
//
// Refinement pass (2026-10-26) also named "/billing" as a pricing-message
// route - that one's deliberately NOT added: /billing is the real,
// existing route in this app, and it's the authenticated subscription
// page behind AppShell, not a public marketing page. Showing a public
// contact widget there would break this same component's own "never
// inside the authenticated workspace" rule - the two instructions
// conflicted, and the authenticated-area exclusion is the one that
// protects a real user from UI noise while they're signed in, so it wins.
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

const DEMO_MESSAGE = "Hi Sarel, I'm reviewing the Tender Ready demo and have a question.";
const PRICING_MESSAGE = "Hi Sarel, I'd like to find out more about Tender Ready subscription pricing.";
// Exported: app/page.tsx's own footer WhatsApp link reuses this exact
// message (same "find out more" intent as this widget's own default) -
// one source of truth, not a second hand-typed copy that could drift.
export const HOME_MESSAGE = "Hi Sarel, I'd like to find out more about Tender Ready.";

function messageFor(pathname: string, onPricingSection: boolean): string {
  if (pathname === "/demo") return DEMO_MESSAGE;
  if (onPricingSection) return PRICING_MESSAGE;
  return HOME_MESSAGE;
}

/**
 * Real, official WhatsApp glyph (not a generic lucide "message" icon - the
 * brief specifically asked for the recognisable brand mark), white on the
 * button's own brand-green fill - the same two-tone convention the real
 * WhatsApp app icon uses. Inlined so no icon-font/image round-trip is
 * needed for one small always-visible mark.
 */
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("fill-white", className)} aria-hidden>
      <path d="M16.004 0C7.164 0 0 7.163 0 16c0 3.21 0.954 6.195 2.588 8.692L0.76 32l7.52-1.971A15.93 15.93 0 0 0 16.004 32C24.84 32 32 24.837 32 16S24.84 0 16.004 0Zm0 29.09a13.03 13.03 0 0 1-6.65-1.822l-0.477-0.283-4.464 1.17 1.192-4.35-0.31-0.448A13.04 13.04 0 0 1 2.91 16c0-7.218 5.876-13.09 13.094-13.09 7.218 0 13.09 5.872 13.09 13.09 0 7.219-5.872 13.09-13.09 13.09Z" />
      <path d="M23.273 19.13c-0.398-0.2-2.354-1.162-2.72-1.296-0.364-0.133-0.63-0.2-0.896 0.2-0.265 0.398-1.027 1.296-1.26 1.562-0.232 0.265-0.464 0.298-0.862 0.1-0.398-0.199-1.68-0.619-3.198-1.973-1.182-1.054-1.979-2.357-2.212-2.755-0.232-0.398-0.025-0.613 0.166-0.828 0.166-0.199 0.398-0.53 0.597-0.796 0.2-0.265 0.266-0.465 0.4-0.763 0.133-0.298 0.066-0.531-0.067-0.763-0.133-0.232-1.127-2.71-1.394-3.308-0.26-0.597-0.531-0.53-0.73-0.53-0.199 0-0.431-0.034-0.663-0.034-0.232 0-0.63 0.1-0.962 0.465-0.332 0.364-1.26 1.229-1.26 2.993 0 1.763 1.293 3.46 1.46 3.71 0.166 0.232 2.23 3.593 5.542 4.9 2.753 1.06 3.315 0.878 3.913 0.829 0.597-0.05 1.945-0.796 2.22-1.562 0.265-0.763 0.265-1.43 0.199-1.562-0.067-0.133-0.264-0.2-0.562-0.365Z" />
    </svg>
  );
}

function subscribeToHashChange(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

export function WhatsAppContactButton() {
  const pathname = usePathname();
  // Hash isn't available server-side and doesn't trigger a navigation
  // (usePathname alone never sees "#pricing") - useSyncExternalStore reads
  // it reactively (same pattern as components/ui/sidebar.tsx's own
  // useIsMobile - a plain useEffect+setState for this trips
  // react-hooks/set-state-in-effect, a real lint error in this repo).
  // getServerSnapshot returns false since there's no hash to read
  // server-side; the real check only matters once hydrated anyway.
  const onPricingSection = useSyncExternalStore(
    subscribeToHashChange,
    () => pathname === "/" && window.location.hash === "#pricing",
    () => false,
  );

  const onToolsPage = pathname === "/tools" || pathname.startsWith("/tools/");
  if (pathname !== "/" && pathname !== "/demo" && !onToolsPage) return null;
  if (!WHATSAPP_NUMBER) return null; // No real number configured - a live link to a made-up number would misdirect a real prospect, never shown.

  const message = messageFor(pathname, onPricingSection);
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Tender Ready on WhatsApp"
      className={cn(
        "fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-white/20 bg-[#25D366] text-white shadow-lg transition-all duration-200 hover:scale-105 hover:bg-[#20BA5A] hover:shadow-xl focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#25D366]/40",
        "size-12 justify-center p-0 md:h-auto md:w-auto md:justify-start md:rounded-full md:px-4 md:py-2.5",
      )}
    >
      <WhatsAppGlyph className="size-6 shrink-0" />
      <span className="hidden flex-col items-start leading-tight md:flex">
        <span className="text-sm font-semibold">Chat on WhatsApp</span>
        <span className="text-[11px] font-normal text-white/85">Business hours (SAST)</span>
      </span>
    </a>
  );
}
