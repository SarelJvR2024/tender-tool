"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_EXTENSIONS,
  MAX_ONBOARDING_FILE_BYTES,
  ONBOARDING_BUCKET,
  hasAcceptedExtension,
  safeFileName,
  uploadPrefix,
} from "@/lib/onboardingScan";
import { registerOnboardingBatch } from "./actions";
import { Button } from "@/components/ui/button";

function checkFiles(files: File[]): string | null {
  if (files.length === 0) return "Choose at least one document, or drop a whole folder's worth at once.";
  for (const f of files) {
    if (!hasAcceptedExtension(f.name)) return `${f.name}: not a type this can read yet (${ACCEPTED_EXTENSIONS.join(", ")}).`;
    if (f.size > MAX_ONBOARDING_FILE_BYTES) return `${f.name} is larger than 25 MB.`;
    if (f.size === 0) return `${f.name} is empty.`;
  }
  return null;
}

/**
 * Straight to Storage from the browser, one file at a time so progress is
 * visible - same reason and the same pattern as
 * app/app/tenders/new/manual-tender-form.tsx (a Server Action's request body
 * is capped at 4.5 MB on Vercel; a batch of certificates and reference
 * letters together would blow past that easily).
 */
async function uploadAll(
  companyId: string,
  files: File[],
  onProgress: (msg: string) => void,
): Promise<{ files: { storagePath: string; originalFilename: string }[] } | { error: string }> {
  const supabase = createClient();
  const done: { storagePath: string; originalFilename: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
    const path = `${uploadPrefix(companyId)}${crypto.randomUUID().slice(0, 8)}-${safeFileName(f.name)}`;
    const { error } = await supabase.storage.from(ONBOARDING_BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) {
      console.error("onboarding document upload failed", f.name, error);
      if (done.length > 0) await supabase.storage.from(ONBOARDING_BUCKET).remove(done.map((d) => d.storagePath));
      return { error: `Could not upload ${f.name} - try again. If it keeps happening, let us know.` };
    }
    done.push({ storagePath: path, originalFilename: f.name });
  }
  return { files: done };
}

export function UploadForm({ companyId }: { companyId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function addFiles(list: FileList | File[]) {
    setFiles((prev) => [...prev, ...Array.from(list)]);
    setError(null);
  }

  function submit() {
    const bad = checkFiles(files);
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      const batchId = crypto.randomUUID();
      const up = await uploadAll(companyId, files, setProgress);
      if ("error" in up) {
        setProgress(null);
        setError(up.error);
        return;
      }
      setProgress("Registering the batch for AI classification…");
      const res = await registerOnboardingBatch({ batchId, files: up.files });
      setProgress(null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setFiles([]);
      router.push("/company/document-scan?saved=uploaded");
      router.refresh();
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center ${dragOver ? "border-accent bg-accent/5" : "border-border bg-muted/30"}`}
      >
        <div className="text-sm font-semibold text-foreground">Drop a folder&apos;s worth of documents here, or click to choose</div>
        <div className="mt-1 text-xs text-muted-foreground">
          CIDB certificate, B-BBEE certificate/affidavit, SARS TCS PIN letter, ID documents, CVs, bank confirmation letter, PI insurance,
          ISO 9001 certificate, project reference letters - whatever you already have, one upload at a time or all at once.
          PDF, Word or an image, up to 25 MB each.
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <ul className="my-2.5 list-none pl-0 text-xs text-foreground">
          {files.map((f, i) => (
            <li key={f.name + f.size + i} className="flex max-w-[480px] justify-between py-1">
              <span>{f.name} <span className="text-muted-foreground">({(f.size / 1024).toFixed(0)} KB)</span></span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="cursor-pointer border-none bg-transparent text-xs text-destructive">
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div role="alert" className="mt-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}
      {progress && (
        <div aria-live="polite" className="mt-2.5 rounded-lg border border-warning/20 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
          {progress}
        </div>
      )}

      <Button type="button" onClick={submit} disabled={pending || files.length === 0} variant="accent" size="lg" className="mt-3 min-h-11 px-5">
        {pending ? "Uploading…" : `Upload ${files.length || ""} document${files.length === 1 ? "" : "s"} for AI review`}
      </Button>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        Nothing is filed into your company profile yet - each document is read and classified, then you confirm or correct it below
        before anything is saved.
      </div>
    </div>
  );
}
