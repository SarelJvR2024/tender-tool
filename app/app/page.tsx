import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LogoLockup } from "./_components/Logo";
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

// Title/description rewritten alongside the hero (see "General-product
// positioning" below) - the old copy led with SANRAL ("SANRAL submission
// packs..."), which is exactly what app/AGENTS.md's new positioning rule
// says not to do at a top level, title tag included.
export const metadata = {
  title: "Tender Ready - Your tender department, without hiring one",
  description:
    "Tender Ready assembles your complete bid - compliance checks, company info, CVs and cover pages - from your own documents, then checks it page by page and flags anything that could get you disqualified. Includes built-in SANRAL technical and financial envelope automation.",
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
    note: "Every template is compared against its last known baseline before anything is touched.",
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

// Confirmed by Sarel directly (2026-10-22, in chat) after a real pricing
// conflict surfaced across sessions - see docs/specs/System-Status.md and
// lib/billing.ts's own header comment for the full story. This is the one
// place these numbers/words are written by hand; lib/billing.ts's
// PLAN_LIMITS/PLAN_MONTHLY_ZAR mirror them (and are cross-checked against
// them by that file's own test), migration 0083's tt_plan_limits() mirrors
// them again in SQL - three copies, deliberately never imported across the
// app/database boundary, each checked against the others rather than
// shared, same convention this array has used since it first existed.
// Every plan includes every capability (app/AGENTS.md positioning rule) -
// plans differ only in users and bid packs a month, so the feature list is
// shown once, shared across all tiers, rather than split into per-tier
// bullets that would wrongly imply CV tailoring, cover pages or SANRAL
// automation are locked to a higher plan.
const INCLUDED_IN_EVERY_PLAN = [
  "Tender discovery, AI compliance and opportunity checks",
  "Your company vault, with CV tailoring and cover pages",
  "Buyer-specific form and template completion, where supported",
  "Built-in SANRAL schedule automation",
  "Bid pipeline tracking, including win rate",
  "Email reminders for upcoming deadlines",
];

const PRICING_TIERS = [
  {
    name: "Starter",
    price: "R1,490",
    cadence: "/month",
    bullets: ["5 bid packs a month, 2 people"],
  },
  {
    name: "Professional",
    price: "R2,990",
    cadence: "/month",
    bullets: ["15 bid packs a month, 5 people", "For companies tendering regularly"],
    highlight: true,
  },
  {
    name: "Business",
    price: "R4,990",
    cadence: "/month",
    bullets: ["30 bid packs a month, 10 people"],
  },
  {
    name: "Enterprise",
    price: "Priced on request",
    cadence: "",
    bullets: ["For organisations with their own tender function", "Multiple entities or specific reporting needs", "Users, volume, integrations and training scoped with you"],
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
          <Link href="/" className="flex items-center text-white no-underline">
            <LogoLockup height={26} surface="dark" />
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

        {/*
          General-product positioning (app/AGENTS.md): the hero used to lead
          with "Your SANRAL technical and financial envelopes..." - framing
          the whole product as SANRAL-specific. SANRAL automation is one
          feature, not the product; the hero now sells Tender Ready to any
          company that submits tenders, with SANRAL repositioned as a named
          feature in the quiet callout below the CTAs, not the headline.
        */}
        <div className="mx-auto max-w-[820px] px-5 pb-16 pt-14 text-center">
          <h1 className="mx-auto mb-4.5 max-w-[720px] text-balance font-display text-[clamp(26px,4.5vw,38px)] font-medium leading-[1.25] text-white">
            Your tender department, without hiring one.
          </h1>
          <p className="mx-auto mb-8 max-w-[640px] text-base leading-relaxed text-white/78">
            Tender Ready assembles your complete bid - compliance checks, company info, CVs and cover pages - from
            your own documents, then checks it page by page and flags anything that could get you disqualified. You
            verify, price and sign.
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
          {/*
            SANRAL callout - a named feature, not the promise: deliberately
            quieter than the hero (a small tinted pill, not a headline-sized
            claim), brand-blue accent only. No href yet - the public SANRAL
            landing page this would link to doesn't exist (/sanral-schedules
            is a signed-in app page behind AppShell, not a marketing page) -
            link it once that page is built, per this prompt's own instruction
            to leave it off until then.
          */}
          <div className="mt-6 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-white/5 px-4 py-2 text-[13px] text-white/90">
              <Zap className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span>Built-in SANRAL automation: technical and financial envelopes built, numbered and bookmarked in minutes, not hours.</span>
            </div>
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
          <p className={LEDE}>See what Tender Ready checks before you submit - then you give it a final look, price it and sign.</p>
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
        <h2 className={H2}>Check it yourself, not a testimonial</h2>
        <p className={LEDE}>
          Rather than a quote from someone you&apos;ve never met, here are specific claims you can verify
          yourself in the pack it builds.
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
          {/*
            "SANRAL Pro" (this paragraph's own plan name until now) stopped
            existing once PR #71 renamed every plan_tier value to
            Starter/Professional/Business/Enterprise - this was the one
            place on the public homepage still advertising a plan that no
            longer exists. Fixed in passing while already editing this
            section for the SANRAL-positioning pass above; not a reworded
            promise, the same "top plan, locked rate" offer, just a name
            that's still real.
          */}
          <p className="mb-4 text-[13px] leading-relaxed text-white/78">
            The first 10 firms get our top plan at a locked founding rate, done-with-you onboarding, and a direct
            line back to how the product gets built next.
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
        <p className={LEDE}>
          Excl. VAT. Every plan gets every AI engine - plans differ only in how many people and how many bid packs a month.
          14-day trial, no card needed, with one full bid pack. Pay monthly or annually - annual is 2 months free.
        </p>
        <div className="mx-auto mb-8 max-w-[680px] rounded-xl border border-border bg-card p-6">
          <div className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Included in every plan</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {INCLUDED_IN_EVERY_PLAN.map((line) => (
              <CheckItem key={line}>{line}</CheckItem>
            ))}
          </div>
        </div>
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map((tier) => {
            const isCustom = tier.name === "Enterprise";
            return (
              <div
                key={tier.name}
                className={cn(
                  "rounded-xl border bg-card p-6",
                  tier.highlight ? "border-2 border-accent" : "border-border",
                )}
              >
                <div className="mb-1 text-sm font-semibold text-foreground">{tier.name}</div>
                <div className="mb-4">
                  <span className={cn("font-display font-medium text-foreground", isCustom ? "text-[18px]" : "text-[26px]")}>{tier.price}</span>
                  <span className="text-[13px] text-muted-foreground">{tier.cadence}</span>
                </div>
                <div className="mb-5 flex flex-col gap-2">
                  {tier.bullets.map((b) => (
                    <CheckItem key={b}>{b}</CheckItem>
                  ))}
                </div>
                <Link
                  href={isCustom ? "mailto:hello@tendertool.co.za?subject=Enterprise%20plan" : "/signup"}
                  className={buttonVariants({
                    variant: tier.highlight ? "accent" : "default",
                    size: "lg",
                    className: "min-h-11 w-full",
                  })}
                >
                  {isCustom ? "Contact us" : "Get started"}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-foreground">
        <div className="mx-auto max-w-[680px] px-5 py-14 text-center">
          <p className="mb-2.5 text-xl font-semibold leading-snug text-white">
            Tender Ready compiles your bid from your own company information and flags what&apos;s missing.
          </p>
          <p className="mb-7 text-xl font-semibold leading-snug text-white">
            You review it, price it and sign.
          </p>
          <Link href="/signup" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11 px-6" })}>
            Start free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-5 py-6 text-center">
        <p className="mb-2 text-xs text-muted-foreground">Tender Ready - built for South African companies that submit tenders.</p>
        <Link href="/privacy" className="text-xs text-muted-foreground underline">
          Privacy notice
        </Link>
      </footer>
    </div>
  );
}
