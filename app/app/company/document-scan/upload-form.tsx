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

const NAVY = "#16233B";
const AMBER = "#D97706";
const BORDER = "#E3E6EA";
const MUTED = "#5B6472";

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
        style={{
          border: `2px dashed ${dragOver ? AMBER : BORDER}`,
          borderRadius: 12,
          padding: "28px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "#FFFBEB" : "#FAFAF7",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>Drop a folder&apos;s worth of documents here, or click to choose</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
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
          style={{ display: "none" }}
        />
      </div>

      {files.length > 0 && (
        <ul style={{ margin: "10px 0", paddingLeft: 18, fontSize: 12, color: "#4B5563" }}>
          {files.map((f, i) => (
            <li key={f.name + f.size + i} style={{ display: "flex", justifyContent: "space-between", maxWidth: 480 }}>
              <span>{f.name} <span style={{ color: "#8A93A0" }}>({(f.size / 1024).toFixed(0)} KB)</span></span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#B91C1C", cursor: "pointer", fontSize: 12 }}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div role="alert" style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#B91C1C", marginTop: 10 }}>
          {error}
        </div>
      )}
      {progress && (
        <div aria-live="polite" style={{ background: "#FEF3C7", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#B45309", marginTop: 10 }}>
          {progress}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || files.length === 0}
        style={{
          marginTop: 12, minHeight: 44, padding: "0 18px", borderRadius: 9,
          background: pending || files.length === 0 ? "#D9D5C7" : AMBER, color: "#FFFFFF",
          fontSize: 14, fontWeight: 600, border: "none", cursor: pending || files.length === 0 ? "default" : "pointer",
        }}
      >
        {pending ? "Uploading…" : `Upload ${files.length || ""} document${files.length === 1 ? "" : "s"} for AI review`}
      </button>
      <div style={{ fontSize: 11, color: "#8A93A0", marginTop: 6 }}>
        Nothing is filed into your company profile yet - each document is read and classified, then you confirm or correct it below
        before anything is saved.
      </div>
    </div>
  );
}
