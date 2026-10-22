"use client";

// Plain relative imports with explicit extensions, not the "@/lib/..." alias
// - this module is loaded directly by uploadBatch.test.ts via plain Node
// (node --experimental-strip-types, no bundler, no tsconfig path mapping),
// same constraint lib/deadlineReminders.ts's own header comment documents.
// The alias broke app-ci.yml's own "run every *.test.ts file directly" step
// (confirmed live: 3 consecutive red runs on main - QA pass, 2026-10-22).
import { createClient } from "../../../lib/supabase/client.ts";
import { safeFileName } from "../../../lib/onboardingScan.ts";

// Shared document-intake upload engine (spec v3 Batch 2). Extracted from
// app/app/company/document-scan/upload-form.tsx's original uploadAll(), with
// one real behaviour fix: a failed file used to roll back and discard every
// OTHER file already uploaded in the same batch, then abort the whole batch
// with one generic error - directly against spec v3 §17's "a failed file
// must not discard successfully received files". Per-file state is now
// independent: one file's failure never touches another's.

export type FileUploadState =
  | { file: File; status: "queued" }
  | { file: File; status: "uploading" }
  | { file: File; status: "uploaded"; storagePath: string }
  | { file: File; status: "failed"; error: string };

/** Pure: start every not-yet-attempted file in this batch uploading. No I/O. */
export function markUploading(states: FileUploadState[]): FileUploadState[] {
  return states.map((s) => (s.status === "queued" || s.status === "failed" ? { file: s.file, status: "uploading" } : s));
}

/** Pure: apply one file's upload outcome to its own slot, leaving every other slot untouched. */
export function applyUploadResult(
  states: FileUploadState[],
  index: number,
  result: { ok: true; storagePath: string } | { ok: false; error: string },
): FileUploadState[] {
  const next = states.slice();
  next[index] = result.ok
    ? { file: states[index].file, status: "uploaded", storagePath: result.storagePath }
    : { file: states[index].file, status: "failed", error: result.error };
  return next;
}

/** Pure: split a batch into what's ready to register and what still needs the user's attention. */
export function partitionBatch(states: FileUploadState[]): {
  succeeded: { file: File; storagePath: string }[];
  failed: { file: File; error: string }[];
  pending: boolean;
} {
  const succeeded: { file: File; storagePath: string }[] = [];
  const failed: { file: File; error: string }[] = [];
  let pending = false;
  for (const s of states) {
    if (s.status === "uploaded") succeeded.push({ file: s.file, storagePath: s.storagePath });
    else if (s.status === "failed") failed.push({ file: s.file, error: s.error });
    else pending = true;
  }
  return { succeeded, failed, pending };
}

/**
 * Uploads every file in `files` to `bucket` under `prefix`, independently -
 * straight from the browser, same reason as every other Storage upload in
 * this app (a Server Action body is capped at 4.5 MB; a batch of
 * certificates together would blow past that). Calls `onUpdate` after every
 * single file's own outcome so a caller can render live per-file progress;
 * never aborts the remaining queue and never removes an already-uploaded
 * sibling because one file failed.
 */
export async function uploadBatch(
  files: File[],
  bucket: string,
  prefix: string,
  onUpdate: (states: FileUploadState[]) => void,
): Promise<FileUploadState[]> {
  const supabase = createClient();
  let states: FileUploadState[] = files.map((file) => ({ file, status: "queued" }));
  states = markUploading(states);
  onUpdate(states);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = `${prefix}${crypto.randomUUID().slice(0, 8)}-${safeFileName(f.name)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, f, { contentType: f.type || "application/octet-stream" });
    states = applyUploadResult(
      states,
      i,
      error ? { ok: false, error: `Could not upload ${f.name} - try again.` } : { ok: true, storagePath: path },
    );
    if (error) console.error("document-intake upload failed", f.name, error);
    onUpdate(states);
  }
  return states;
}
