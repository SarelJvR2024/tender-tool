"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { WizardShell } from "./WizardShell";
import { UploadForm } from "../../company/document-scan/upload-form";
import { buttonVariants } from "@/components/ui/button";

/**
 * Screen 2 of 2 (spec v3 §3): "Add documents, or start now". Reuses
 * UploadForm unchanged (spec v3 Batch 2, #103) for the drop/upload/register
 * part. Onboarding UX review (2026-10-26): auto-redirecting a brand-new
 * user straight into /company/document-scan's review screen the moment
 * upload finishes - this screen's original behavior - forced AI-extraction
 * review before they'd even reached the product once. Now UploadForm's
 * onRegistered callback switches this screen to a short "Processing..."
 * state with an explicit "Go to your Workspace" action instead; the
 * classification job itself is unaffected (same async
 * process_onboarding_jobs.py pickup either way) - this only changes what
 * the person sees while it runs, not whether it keeps running if they
 * leave.
 *
 * The explicit "Skip for now" alternative straight to Home remains -
 * optional document capture must never block reaching Home (spec v3 O09).
 */
export function AddDocumentsScreen({ companyId }: { companyId: string }) {
  const [registeredCount, setRegisteredCount] = useState<number | null>(null);

  return (
    <WizardShell
      step={2}
      description="Drop what you already have - certificates, CVs, reference letters. We'll read them and show you what we found, so you don't have to retype it."
    >
      {registeredCount === null ? (
        <>
          <UploadForm companyId={companyId} onRegistered={setRegisteredCount} />
          <Link href="/dashboard" className={buttonVariants({ variant: "ghost", className: "mt-4 h-10 w-full text-muted-foreground" })}>
            Skip for now - I&apos;ll add documents later
          </Link>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-6 py-8 text-center">
          <Loader2 className="size-6 animate-spin text-accent" aria-hidden />
          <p className="text-sm font-medium text-foreground">
            Processing {registeredCount} document{registeredCount === 1 ? "" : "s"} with AI...
          </p>
          <p className="text-xs text-muted-foreground">
            We&apos;ll read what you dropped and have it ready to review in your Workspace.
          </p>
          <Link href="/dashboard?docsProcessing=1" className={buttonVariants({ variant: "accent", className: "mt-1 min-h-11 w-full" })}>
            Go to your Workspace
          </Link>
        </div>
      )}
    </WizardShell>
  );
}
