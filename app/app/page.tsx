import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "./_components/Logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// This is the product's landing page, not a static marketing page: a
// signed-in visitor is still sent straight to /dashboard (nothing a
// returning user needs to see here), which means the session cookie has
// to be read per request - "instant = false" is Next.js 16's documented
// escape hatch for a route that must block on real, per-request data
// instead of being prerendered at build time. (Previously this whole
// route was just redirect(user ? "/dashboard" : "/login") with zero
// marketing content - that's what's being replaced.)
export const instant = false;

export const metadata = {
  title: "Tender Ready - SANRAL submission packs, built and checked page by page",
  description:
    "Tender Ready turns your company documents, people and past-project evidence into SANRAL's complete technical and financial envelope packs - checked page by page against the tender's own rules. No AI blabber, nothing missing, nothing expired.",
};

const SECTION = "mx-auto max-w-[1040px] px-5 py-16";
const H2 = "mb-2.5 text-center font-display text-[26px] font-medium text-foreground";
const LEDE = "mx-auto mb-9 max-w-[620px] text-center text-[15px] leading-relaxed text-muted-foreground";

const DIFFERENTIATION = [
  {
    title: "Tender-alert tools",
    body: "Tell you a tender exists, and when it closes. That's where the help stops - you still fill every workbook and form by hand.",
  },
  {
    title: "Generic AI proposal tools",
    body: "Write your methodology and executive summary for you. Every bid starts to read the same - and SANRAL's own workbooks and SBD forms aren't something an AI narrative tool fills at all.",
  },
  {
    title: "Tender Ready",
    body: "Reads the tender's own rules, fills SANRAL's workbooks and the standard SBD/MBD forms from your real company data, and shows you exactly what's missing before you submit. Your words stay yours.",
    highlight: true,
  },
];

const PROOF_POINTS = [
  {
    claim: "Every contents entry is checked against its real page number before the pack is built.",
    note: "Not a claim you have to take on trust - open the contents page against the PDF and count.",
  },
  {
    claim: "If SANRAL changes a template, the fill stops. It never guesses at a form it doesn't recognise.",
    note: "fingerprint.py compares every template against its last known baseline before touching it.",
  },
  {
    claim: "\"Not included, and why\" is printed in the pack itself - signatures, pricing, and anything only you can provide.",
    note: "Nothing silently left blank.",
  },
];

const FREE_TOOLS = [
  { href: "/tools/deadline-calculator", title: "Working-day deadline calculator", blurb: "Add or count working days excluding weekends and SA public holidays." },
  { href: "/tools/cidb-grade", title: "CIDB grade calculator", blurb: "Check the CIDB grade a tender's value requires, or whether yours is enough." },
  { href: "/tools/bee-preference-points", title: "B-BBEE preference points calculator", blurb: "The actual 80/20 or 90/10 points for a price and B-BBEE level, per the 2022 regulations." },
  { href: "/tools/b6-estimator", title: "SANRAL B6 functionality score estimator", blurb: "Estimate a key position's SANRAL functionality score from the real published Book 1 scoring matrices." },
];

// PRICING_TIERS content (names/prices/bullets) is left exactly as-is on
// purpose - a separate, dedicated piece of work is building real billing
// enforcement for these limits, and changing the copy now (even to soften
// it) would pre-empt that decision and create a merge conflict with it.
// Only this array's STYLING changed in this pass, not its words or numbers.
const PRICING_TIERS = [
  {
    name: "Tender Watch",
    price: "Free",
    cadence: "",
    bullets: ["Discovery, fit verdict and score outlook", "Vault with expiry, view only", "1 compliance report a month"],
  },
  {
    name: "Tender Pro",
    price: "R1,490",
    cadence: "/month",
    // "Pipeline" renamed to "Bids" here only - matching the app-wide label
    // rename ("Bids pipeline redesign") this bullet's own wording had fallen
    // behind; nothing else in this array touched.
    bullets: ["Everything in Watch, plus reminders", "General pack: SBD/MBD fill, merged pack (6/month)", "Experience Library and CV library", "Bids, tasks and role-based digest"],
  },
  {
    name: "SANRAL Pro",
    price: "R3,950",
    cadence: "/month",
    bullets: ["Everything in Pro, no pack limit", "SANRAL workbook fill, both envelopes", "Done-with-you onboarding"],
    highlight: true,
  },
];

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
      <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header + hero */}
      <header className="bg-foreground">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-3 text-white no-underline">
            <Logo size={28} variant="light" />
            <span className="text-base font-semibold">Tender Ready</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Link href="/tools" className="inline-flex min-h-11 items-center px-1 text-[13px] text-white/75 no-underline hover:text-white">
              Free tools
            </Link>
            <Link href="/login" className="inline-flex min-h-11 items-center px-1 text-[13px] font-semibold text-white/90 no-underline hover:text-white">
              Sign in
            </Link>
            <Link href="/signup" className={buttonVariants({ variant: "accent", className: "min-h-11 whitespace-nowrap px-4 text-[13px]" })}>
              Start free
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-[820px] px-5 pb-16 pt-14 text-center">
          <h1 className="mx-auto mb-4.5 max-w-[720px] text-balance font-display text-[clamp(26px,4.5vw,38px)] font-medium leading-[1.25] text-white">
            Your SANRAL technical and financial envelopes: built, numbered, bookmarked, and checked page by page.
          </h1>
          <p className="mx-auto mb-8 max-w-[640px] text-base leading-relaxed text-white/78">
            Complete, correct, and yours. Not AI-written - built from your own company documents, people and
            past-project evidence, with nothing missing, nothing expired, and nothing silently left blank.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/signup" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11 whitespace-nowrap px-6" })}>
              Start free
            </Link>
            <Link
              href="/tools"
              className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-white/35 px-6 text-[15px] font-semibold text-white no-underline hover:bg-white/10"
            >
              Try a free tool first
            </Link>
          </div>
        </div>
      </header>

      {/* Differentiation band */}
      <section className={SECTION}>
        <h2 className={H2}>Not another tender alert, not another AI proposal writer</h2>
        <p className={LEDE}>South African tender software mostly does one of two things. Tender Ready does the part neither one does.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIFFERENTIATION.map((d) => (
            <div
              key={d.title}
              className={cn(
                "rounded-xl border p-6",
                d.highlight ? "border-foreground bg-foreground" : "border-border bg-card",
              )}
            >
              <div className={cn("mb-2 text-[15px] font-semibold", d.highlight ? "text-white" : "text-foreground")}>{d.title}</div>
              <div className={cn("text-[13px] leading-relaxed", d.highlight ? "text-white/80" : "text-muted-foreground")}>{d.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The artefact */}
      <section className="border-y border-border bg-card">
        <div className={SECTION}>
          <h2 className={H2}>What actually comes out the other end</h2>
          <p className={LEDE}>Not a draft to tidy up. A submission pack, ready to print and sign.</p>
          <div className="mx-auto max-w-[480px] rounded-xl border border-border bg-background p-7">
            <div className="mb-3.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Inside a generated envelope
            </div>
            {[
              "Contents page - every entry checked against its real page number",
              "\"Page X of N\" printed on every page",
              "Bookmarks matching the contents page exactly",
              "Not included, and why - signatures, pricing, anything only you can provide",
            ].map((line, i, arr) => (
              <div key={line} className={cn("flex items-start gap-2.5 py-2.5 text-[13px] leading-snug text-foreground", i < arr.length - 1 && "border-b border-border")}>
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Proof section */}
      <section className={SECTION}>
        <h2 className={H2}>No customers yet. Here&apos;s what to check instead of a testimonial</h2>
        <p className={LEDE}>
          Tender Ready is new. Rather than a quote from someone you&apos;ve never met, here are specific,
          falsifiable claims you can check yourself in the pack it builds.
        </p>
        <div className="mx-auto mb-8 flex max-w-[680px] flex-col gap-3">
          {PROOF_POINTS.map((p) => (
            <div key={p.claim} className="rounded-xl border border-border bg-card p-6">
              <div className="mb-1 text-sm font-semibold leading-snug text-foreground">{p.claim}</div>
              <div className="text-xs leading-snug text-muted-foreground">{p.note}</div>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-[680px] rounded-xl bg-foreground p-7 text-center">
          <div className="mb-1.5 text-[15px] font-semibold text-white">Founding Firms Programme</div>
          <p className="mb-4 text-[13px] leading-relaxed text-white/78">
            The first 10 firms get SANRAL Pro at a locked founding rate, done-with-you onboarding, and a direct line
            back to how the product gets built next.
          </p>
          {/*
            Fix for the audited "Founding Firms" finding: this CTA used to say
            "Apply as a founding firm", implying a differentiated intake -
            there is no such mechanism anywhere in this app (no founding-firm
            field, no separate application flow, nothing but the plain /signup
            form a "Start free" click already reaches). Checked for a real
            contact mechanism to point this at instead - the only one that
            exists anywhere in the app is privacy@tendertool.co.za on the
            Privacy notice, and that's scoped to privacy/POPIA requests, not a
            general sales inbox, so redirecting a "talk to us about founding
            rates" click there would be just as dishonest in the other
            direction. Softened the wording instead: "Get in touch", still
            linking to the same /signup a visitor would reach anyway - true to
            what actually happens on click, no new flow invented.
          */}
          <Link href="/signup" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11 px-6" })}>
            Get in touch
          </Link>
        </div>
      </section>

      {/* Free tools */}
      <section className="border-y border-border bg-card">
        <div className={SECTION}>
          <h2 className={H2}>Free tools, no sign-up</h2>
          <p className={LEDE}>Correct against the actual South African regulation or public data table each is built on - not a guess.</p>
          <div className="mx-auto grid max-w-[820px] grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {FREE_TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="block rounded-xl border border-border bg-background p-6 no-underline hover:bg-muted/50">
                <div className="mb-1.5 text-sm font-semibold text-foreground">{t.title}</div>
                <div className="text-xs leading-snug text-muted-foreground">{t.blurb}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className={SECTION}>
        <h2 className={H2}>Pricing</h2>
        <p className={LEDE}>Excl. VAT. No credits to ration, no per-seat markup on the thing that actually creates the value.</p>
        <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "rounded-xl border bg-card p-6",
                tier.highlight ? "border-2 border-accent" : "border-border",
              )}
            >
              <div className="mb-1 text-sm font-semibold text-foreground">{tier.name}</div>
              <div className="mb-4">
                <span className="font-display text-[26px] font-medium text-foreground">{tier.price}</span>
                <span className="text-[13px] text-muted-foreground">{tier.cadence}</span>
              </div>
              <div className="mb-5 flex flex-col gap-2">
                {tier.bullets.map((b) => (
                  <CheckItem key={b}>{b}</CheckItem>
                ))}
              </div>
              <Link
                href="/signup"
                className={buttonVariants({
                  variant: tier.highlight ? "accent" : "default",
                  size: "lg",
                  className: "min-h-11 w-full",
                })}
              >
                {tier.price === "Free" ? "Start free" : "Get started"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-foreground">
        <div className="mx-auto max-w-[680px] px-5 py-14 text-center">
          <p className="mb-2.5 text-xl font-semibold leading-snug text-white">
            We don&apos;t promise to write your bid.
          </p>
          <p className="mb-7 text-xl font-semibold leading-snug text-accent">
            We promise nothing in it is missing, expired, or mis-filed.
          </p>
          <Link href="/signup" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11 px-6" })}>
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-5 py-6 text-center">
        <p className="mb-2 text-xs text-muted-foreground">Tender Ready - built for South African construction and engineering firms bidding public-sector tenders.</p>
        <Link href="/privacy" className="text-xs text-muted-foreground underline">
          Privacy notice
        </Link>
      </footer>
    </div>
  );
}
