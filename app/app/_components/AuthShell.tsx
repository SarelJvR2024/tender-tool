import Link from "next/link";
import { FileCheck2, AlarmClock, ShieldCheck } from "lucide-react";
import { Logo, LogoLockup } from "./Logo";
import { StatusBadge } from "@/components/tt/status-badge";

const PROOF_POINTS = [
  { icon: ShieldCheck, text: "Checks every contents entry against its real page number before the pack is built" },
  { icon: FileCheck2, text: "Builds your full SANRAL submission pack - forms, financials and CVs" },
  { icon: AlarmClock, text: "Flags every expired, missing or mismatched document before you submit" },
];

/**
 * A small, static preview of the real dashboard look (navy ink, status
 * chips, a deadline) - not a screenshot image (none exists to drop in here),
 * but built from the same tt/ components a visitor sees seconds after
 * signing in, so the promise and the product are visibly the same thing.
 */
function ProductPreview() {
  return (
    <div className="w-full max-w-[360px] rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-lg backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-sm font-medium text-white">Tenders</span>
        <span className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">Load a tender</span>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "Tracked", value: "12" },
          { label: "Complete", value: "7" },
          { label: "Due soon", value: "2" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <div className="text-[10px] text-white/50">{s.label}</div>
            <div className="font-display text-lg font-medium text-white">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-white/70">SANRAL/NRA/2026/014</span>
          <StatusBadge status="ready">Complete</StatusBadge>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-white/70">SANRAL/NRA/2026/022</span>
          <StatusBadge status="needs-docs">Needs documents</StatusBadge>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared split-screen shell for /login, /signup, /forgot-password,
 * /reset-password and /onboarding. Left panel carries the brand promise
 * (so a visitor who clicked through from the landing page sees the same
 * product, not a different one); right panel is whatever that page needs.
 * The right panel sets its own content width (a 360px auth card, or the
 * onboarding wizard's wider one) - this shell only centers it.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[44%] min-w-[360px] max-w-[560px] shrink-0 flex-col justify-center overflow-hidden bg-foreground px-14 py-14 md:flex relative">
        {/* A large, faint version of the mark itself as texture - not a stock
            photo, not a gradient blob, just the product's own shape oversized
            and cropped into the corner. */}
        <div className="pointer-events-none absolute -bottom-24 -right-24 opacity-[0.07]">
          <Logo size={420} />
        </div>

        <div className="relative z-10">
          <div className="mb-10 flex items-center">
            <LogoLockup height={32} surface="dark" />
          </div>

          <h1 className="mb-6 max-w-[420px] font-display text-[28px] font-medium leading-[1.25] text-white">
            Win more tenders. Miss fewer deadlines.
          </h1>

          <ul className="mb-9 flex flex-col gap-3.5">
            {PROOF_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-[13.5px] text-white/75">
                <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {text}
              </li>
            ))}
          </ul>

          <ProductPreview />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background p-4">
        {/* The left panel (and its logo) is hidden below md: on mobile the
            brand otherwise disappears entirely from account screens (spec
            §3) - a small linked wordmark above the form keeps it present. */}
        <Link href="/" className="md:hidden">
          <LogoLockup height={28} surface="light" />
        </Link>
        {children}
      </div>
    </div>
  );
}
