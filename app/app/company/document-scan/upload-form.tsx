"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACCEPTED_EXTENSIONS, MAX_ONBOARDING_FILE_BYTES, ONBOARDING_BUCKET, uploadPrefix } from "@/lib/onboardingScan";
import { registerOnboardingBatch } from "./actions";
import { Button } from "@/components/ui/button";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { uploadBatch, partitionBatch, type FileUploadState } from "../../_components/document-intake/uploadBatch";

/**
 * Straight to Storage from the browser, one file at a time so progress is
 * visible - same reason and the same pattern as
 * app/app/tenders/new/manual-tender-form.tsx (a Server Action's request body
 * is capped at 4.5 MB on Vercel; a batch of certificates and reference
 * letters together would blow past that easily). Per-file upload/retry logic
 * now lives in ../../_components/document-intake/uploadBatch.ts, shared with
 * DocumentRow's single-file vault uploader (spec v3 Batch 2).
 *
 * Spec v3 §17: "Starting upload after selection is automatic" - registering
 * a batch for AI classification is no longer its own manual "Upload N
 * documents" click; it happens the moment every file in that drop has
 * finished uploading. The only button in this component is the recovery
 * action for a failed file - never a second generic "Upload" button.
 */
export function UploadForm({
  companyId,
  redirectTo = "/company/document-scan?saved=uploaded",
  title,
  hint,
}: {
  companyId: string;
  /** Where to send the user once every file in a drop has registered for AI review. Spec v3 Batch 4: reused as-is from Experience, which stays on its own page instead of bouncing to /company/document-scan. */
  redirectTo?: string;
  title?: string;
  hint?: string;
}) {
  const [states, setStates] = useState<FileUploadState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function runBatch(files: File[]) {
    setError(null);
    startTransition(async () => {
      const settled = await uploadBatch(files, ONBOARDING_BUCKET, uploadPrefix(companyId), (next) =>
        setStates((prev) => [...prev.filter((s) => !files.includes(s.file)), ...next]),
      );
      const { succeeded } = partitionBatch(settled);
      if (succeeded.length === 0) return; // everything in this drop failed - nothing to register; failures stay visible to retry
      const res = await registerOnboardingBatch({
        batchId: crypto.randomUUID(),
        files: succeeded.map((s) => ({ storagePath: s.storagePath, originalFilename: s.file.name })),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      setStates((prev) => prev.filter((s) => !succeeded.some((ok) => ok.file === s.file)));
      router.push(redirectTo);
      router.refresh();
    });
  }

  function addFiles(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_ONBOARDING_FILE_BYTES });
    if (bad) return setError(bad);
    runBatch(files);
  }

  const { failed, pending: stillUploading } = partitionBatch(states);

  function retryFailed() {
    runBatch(failed.map((f) => f.file));
  }

  return (
    <div>
      <FileDropzone
        title={title ?? "Drop a folder's worth of documents here, or click to choose"}
        hint={
          hint ??
          "CIDB certificate, B-BBEE certificate/affidavit, SARS TCS PIN letter, ID documents, CVs, bank confirmation letter, PI insurance, ISO 9001 certificate, project reference letters - whatever you already have, one upload at a time or all at once. PDF, Word or an image, up to 25 MB each."
        }
        acceptedExtensions={ACCEPTED_EXTENSIONS}
        multiple
        disabled={pending}
        onFilesChosen={addFiles}
      />

      {states.length > 0 && (
        <ul className="my-2.5 list-none pl-0 text-xs text-foreground">
          {states.map((s, i) => (
            <li key={s.file.name + s.file.size + i} className="flex max-w-[480px] items-center justify-between gap-2 py-1">
              <span className="truncate">
                {s.file.name} <span className="text-muted-foreground">({(s.file.size / 1024).toFixed(0)} KB)</span>
              </span>
              {(s.status === "uploading" || s.status === "queued") && <span className="shrink-0 text-warning">Uploading…</span>}
              {s.status === "uploaded" && <span className="shrink-0 text-success">Registering…</span>}
              {s.status === "failed" && <span className="shrink-0 text-destructive">Failed</span>}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div role="alert" className="mt-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}
      {failed.length > 0 && (
        <div aria-live="polite" className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <span>{failed.length} file{failed.length === 1 ? "" : "s"} could not be uploaded - everything else here is safe.</span>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={retryFailed}>
            Retry {failed.length === 1 ? "it" : "them"}
          </Button>
        </div>
      )}
      {stillUploading && (
        <div aria-live="polite" className="mt-1.5 text-[11px] text-muted-foreground">
          Uploading…
        </div>
      )}

      <div className="mt-1.5 text-[11px] text-muted-foreground">
        Nothing is filed into your company profile yet - each document is read and classified, then you confirm or correct it below
        before anything is saved.
      </div>
    </div>
  );
}
