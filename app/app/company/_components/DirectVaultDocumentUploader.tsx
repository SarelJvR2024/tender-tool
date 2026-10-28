"use client";

import { useState, useTransition } from "react";
import { ACCEPTED_EXTENSIONS } from "@/lib/onboardingScan";
import { MAX_UPLOAD_BYTES, vaultDocumentMismatchWarning, type VaultDocumentKind } from "@/lib/vaultDocuments";
import { uploadVaultDocument } from "../actions";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { Button } from "@/components/ui/button";

/**
 * One-button upload for 'coid', the one vault kind VaultDocumentUploader
 * doesn't cover (see lib/vaultDocuments.ts's VAULT_KIND_TO_DOCUMENT_KIND
 * comment: no AI classifier entry exists for it yet - that's a Python/schema
 * change, out of scope here). Sarel's own live feedback on this exact
 * section: "it is confusing having two buttons for files, make this easier
 * with just one button to click to upload a file" - the old DocumentRow
 * form paired a native <input type="file"> with a separate Submit button.
 *
 * Same FileDropzone UI every other row uses (spec v3 O12: one control opens
 * selection and starts upload - no second "Upload" click), wired to the
 * EXISTING uploadVaultDocument server action instead of the AI-classify
 * pipeline - same storage path, same companies.* column write, same
 * replace-old-copy-after-new-one-lands behaviour as before, just invoked
 * directly instead of via a <form> submit. No AI review step after, because
 * there's no classifier result to review - this is still a direct write,
 * same as it always was, only the interaction is now one click.
 *
 * MAX_UPLOAD_BYTES (4.4 MB), not onboarding's 25 MB: this still goes through
 * the Server Action's own request body, which VaultDocumentUploader's AI
 * path avoids by uploading straight to storage from the browser first.
 */
export function DirectVaultDocumentUploader({
  companyId,
  kind,
  title,
  hasExisting,
}: {
  companyId: string;
  kind: VaultDocumentKind;
  title: string;
  hasExisting: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_UPLOAD_BYTES, maxFiles: 1 });
    if (bad) return setError(bad);
    // Filename-only heuristic (lib/vaultDocuments.ts's own comment explains
    // why - no PDF/DOCX content reading in this app) - a real "Tender Ready
    // live incident" caught by this exact check: a file named
    // "...BBBEE_Affidavit.docx" uploaded into this slot. Never a hard block:
    // the same window.confirm pattern ConfirmSubmitButton already uses
    // elsewhere in this app, so a real, correctly-chosen file with an
    // unusual name is never trapped.
    const warning = vaultDocumentMismatchWarning(kind, files[0].name);
    if (warning && !window.confirm(`${warning}\n\nUpload it anyway?`)) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", files[0]);
      if (warning) fd.append("acknowledge_mismatch", "true");
      // uploadVaultDocument redirects to /company?saved=doc on success (and
      // to /company?error=... on failure) - same as every other caller of
      // this action, so a thrown redirect here is expected, not an error.
      await uploadVaultDocument(companyId, fd);
    });
  }

  return (
    <div className="mt-2">
      <FileDropzone
        title={pending ? "Uploading…" : hasExisting ? `Upload or replace ${title}` : `Upload ${title}`}
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
    </div>
  );
}
