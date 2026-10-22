"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACCEPTED_EXTENSIONS, MAX_ONBOARDING_FILE_BYTES, ONBOARDING_BUCKET, uploadPrefix } from "@/lib/onboardingScan";
import { registerOnboardingBatch } from "../document-scan/actions";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { uploadBatch, partitionBatch } from "../../_components/document-intake/uploadBatch";
import { Button } from "@/components/ui/button";

/**
 * Replaces DocumentRow's old uploadVaultDocument() direct-to-column write
 * for the 6 vault kinds the AI document-scan pipeline already classifies
 * (see lib/vaultDocuments.ts's VAULT_KIND_TO_DOCUMENT_KIND - 'coid' keeps
 * the old direct form, it has no classifier entry). Spec v3 §4/§17: a new
 * document "must NOT silently overwrite verified company or person
 * information" - the old action did exactly that the instant a file was
 * chosen. Now: upload -> real AI classification -> the existing
 * document-scan review screen, where ticking a field is what writes it
 * (an untouched field keeps its current value - confirmVaultDocument's own
 * existing behaviour, unchanged by this component).
 *
 * Deliberately NOT a full-page dropzone here (see FileDropzone's `compact`
 * prop) - this sits inside one row of a 7-row list; a tall drop panel per
 * row would make an already-long Company vault page worse (spec v3 O06).
 */
export function VaultDocumentUploader({ companyId, title }: { companyId: string; title: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function upload(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_ONBOARDING_FILE_BYTES, maxFiles: 1 });
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      const settled = await uploadBatch(files, ONBOARDING_BUCKET, uploadPrefix(companyId), () => {});
      const { succeeded, failed } = partitionBatch(settled);
      if (failed.length > 0) {
        setError(failed[0].error);
        return;
      }
      const res = await registerOnboardingBatch({
        batchId: crypto.randomUUID(),
        files: succeeded.map((s) => ({ storagePath: s.storagePath, originalFilename: s.file.name })),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push("/company/document-scan?saved=uploaded");
    });
  }

  return (
    <div className="mt-2">
      <FileDropzone
        title={pending ? "Uploading…" : `Upload or replace ${title}`}
        acceptedExtensions={ACCEPTED_EXTENSIONS}
        multiple={false}
        compact
        disabled={pending}
        onFilesChosen={upload}
      />
      {error && (
        <div role="alert" className="mt-1.5 flex items-center gap-2 text-xs text-destructive">
          {error}
          <Button type="button" variant="outline" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted-foreground">
        Read and classified by AI first - you confirm or correct what it found on the next screen before anything here changes.
      </div>
    </div>
  );
}
