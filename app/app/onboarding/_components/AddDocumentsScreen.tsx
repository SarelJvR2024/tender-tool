import Link from "next/link";
import { WizardShell } from "./WizardShell";
import { UploadForm } from "../../company/document-scan/upload-form";
import { buttonVariants } from "@/components/ui/button";

/**
 * Screen 2 of 2 (spec v3 §3): "Add documents, or start now". Reuses
 * UploadForm unchanged (spec v3 Batch 2, #103) - it already does the whole
 * job this screen needs: drop files, upload, auto-register for AI
 * classification, and redirect to /company/document-scan's review screen
 * the moment every file in the drop finishes uploading. That redirect IS
 * this screen's "Review extracted details" primary action - no second
 * button needed, matching spec §17's "starting upload after selection is
 * automatic".
 *
 * The only thing this screen adds on top of UploadForm is the explicit
 * "Skip for now" alternative straight to Home - optional document capture
 * must never block reaching Home (spec v3 O09).
 */
export function AddDocumentsScreen({ companyId }: { companyId: string }) {
  return (
    <WizardShell
      step={2}
      description="Drop what you already have - certificates, CVs, reference letters. We'll read them and show you what we found, so you don't have to retype it."
    >
      <UploadForm companyId={companyId} />
      <Link href="/dashboard" className={buttonVariants({ variant: "ghost", className: "mt-4 h-10 w-full text-muted-foreground" })}>
        Skip for now - I&apos;ll add documents later
      </Link>
    </WizardShell>
  );
}
