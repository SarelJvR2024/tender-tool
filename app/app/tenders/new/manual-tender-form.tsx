"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_EXTENSIONS,
  MAX_TENDER_FILE_BYTES,
  TENDER_DOCS_BUCKET,
  hasAcceptedExtension,
  manualPrefix,
  privatePrefix,
  safeFileName,
  type UploadedTenderDocument,
} from "@/lib/manualTender";
import { addManualTenderDocuments, addPrivateTenderDocuments, registerManualTender } from "./actions";

const labelClass = "mb-1 block text-xs font-semibold text-foreground";
const helpClass = "mt-0.5 text-[11px] text-muted-foreground";
const inputClass = "box-border w-full min-h-10 rounded-lg border border-border bg-card px-[11px] py-[9px] font-sans text-[13px] text-foreground";
const primaryBtnClass = "min-h-11 cursor-pointer rounded-lg border-none bg-foreground px-[18px] text-sm font-semibold text-white";

/** Checks every file before anything is uploaded - a bad one fails the batch up front. */
function checkFiles(files: File[]): string | null {
  if (files.length === 0) return "Choose at least one of the tender's own documents.";
  for (const f of files) {
    if (!hasAcceptedExtension(f.name)) return `${f.name}: not a type the engines can read (${ACCEPTED_EXTENSIONS.join(", ")}).`;
    if (f.size > MAX_TENDER_FILE_BYTES) return `${f.name} is larger than 50 MB - split or compress it.`;
    if (f.size === 0) return `${f.name} is empty.`;
  }
  return null;
}

/**
 * Straight to Storage from the browser (0024's policy: own company's
 * manual/ prefix only; 0032: its private/ prefix), one file at a time so
 * progress is visible. If one fails, the ones already uploaded are removed
 * and nothing is registered.
 */
async function uploadAll(
  prefix: string,
  files: File[],
  onProgress: (msg: string) => void,
): Promise<{ docs: UploadedTenderDocument[] } | { error: string }> {
  const supabase = createClient();
  const done: UploadedTenderDocument[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(`Uploading ${i + 1} of ${files.length}: ${f.name}`);
    const path = `${prefix}${crypto.randomUUID().slice(0, 8)}-${safeFileName(f.name)}`;
    const { error } = await supabase.storage.from(TENDER_DOCS_BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) {
      console.error("tender document upload failed", f.name, error);
      if (done.length > 0) await supabase.storage.from(TENDER_DOCS_BUCKET).remove(done.map((d) => d.storage_path));
      return { error: `Could not upload ${f.name} - try again. If it keeps happening, let us know.` };
    }
    done.push({ title: f.name, storage_path: path });
  }
  return { docs: done };
}

export function ManualTenderForm({ companyId }: { companyId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const buyer = String(form.get("buyer") ?? "").trim();
    if (!title || !buyer) return setError("Give the tender a title and say who the buyer is.");
    if (String(form.get("closing_date") ?? "") && !String(form.get("closing_time") ?? ""))
      return setError("Enter the closing time from the tender notice too (or leave the closing date blank).");
    const bad = checkFiles(files);
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      const tenderId = crypto.randomUUID();
      const up = await uploadAll(manualPrefix(companyId, tenderId), files, setProgress);
      if ("error" in up) {
        setProgress(null);
        setError(up.error);
        return;
      }
      setProgress("Registering the tender and queueing the analysis…");
      const res = await registerManualTender({
        tenderId,
        title,
        buyer,
        reference: String(form.get("reference") ?? ""),
        ocid: String(form.get("ocid") ?? ""),
        closingDate: String(form.get("closing_date") ?? ""),
        closingTime: String(form.get("closing_time") ?? ""),
        documents: up.docs,
      });
      // On success the action redirects to the new tender; only a refusal returns.
      if (res?.error) {
        setProgress(null);
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <div>
        <label className={labelClass} htmlFor="title">Tender title *</label>
        <input id="title" name="title" required maxLength={300} placeholder="e.g. Consulting engineering services for the rehabilitation of N2 Section 7" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="buyer">Buyer *</label>
        <input id="buyer" name="buyer" required maxLength={200} placeholder="e.g. SANRAL, City of Tshwane, a private client" className={inputClass} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        <div>
          <label className={labelClass} htmlFor="reference">Tender / contract number</label>
          <input id="reference" name="reference" maxLength={100} placeholder="e.g. R.396-010-2025/1F" className={inputClass} />
          <div className={helpClass}>For a SANRAL tender it&apos;s read from the workbook if you leave it blank.</div>
        </div>
        <div>
          <label className={labelClass} htmlFor="ocid">eTenders OCDS id (if it has one)</label>
          <input id="ocid" name="ocid" maxLength={200} placeholder="ocds-9t57fa-…" className={inputClass} />
          <div className={helpClass}>Leave blank for a tender that isn&apos;t on eTenders.</div>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3.5">
        <div>
          <label className={labelClass} htmlFor="closing_date">Closing date</label>
          <input id="closing_date" name="closing_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="closing_time">Closing time (SAST)</label>
          <input id="closing_time" name="closing_time" type="time" className={inputClass} />
          <div className={helpClass}>As printed in the tender notice - needed with the closing date.</div>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="files">The tender&apos;s own documents *</label>
        <input
          id="files"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className={`${inputClass} px-2.5 py-2`}
        />
        <div className={helpClass}>
          Everything the buyer published: the tender document / RFQ, returnable forms (SBD/MBD or the buyer&apos;s own), and for SANRAL
          the Technical and Financial Submission workbooks (.xlsm) plus the C.1.1.1, C.1.2.3 and A-Forms Word files. PDF, Word, Excel or a
          .zip of them, up to 50 MB each. Scanned PDFs can&apos;t be read yet - include a text copy if you have one.
        </div>
        {files.length > 0 && (
          <ul className="mt-2 pl-[18px] text-xs text-muted-foreground">
            {files.map((f) => (
              <li key={f.name + f.size}>
                {f.name} <span className="text-muted-foreground">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
          {error}
        </div>
      )}
      {progress && (
        <div aria-live="polite" className="rounded-lg bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
          {progress}
        </div>
      )}

      <div>
        <button type="submit" disabled={pending} className={`${primaryBtnClass} ${pending ? "cursor-default opacity-60" : "cursor-pointer"}`}>
          {pending ? "Loading…" : "Load tender and analyse it"}
        </button>
      </div>
    </form>
  );
}

/** "Add documents" on the intake card of a manually loaded tender - re-runs the analysis. */
export function AddTenderDocumentsForm({ companyId, tenderId }: { companyId: string; tenderId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const bad = checkFiles(files);
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      const up = await uploadAll(manualPrefix(companyId, tenderId), files, setProgress);
      if ("error" in up) {
        setProgress(null);
        setError(up.error);
        return;
      }
      const res = await addManualTenderDocuments({ tenderId, documents: up.docs });
      if (res?.error) {
        setProgress(null);
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="max-w-full text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className={`min-h-9 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-foreground ${pending ? "cursor-default opacity-60" : "cursor-pointer"}`}
      >
        {pending ? "Uploading…" : "Add documents and re-analyse"}
      </button>
      {progress && <span className="text-xs text-warning">{progress}</span>}
      {error && <span role="alert" className="basis-full text-xs text-destructive">{error}</span>}
    </form>
  );
}

/**
 * "Your private documents" on a SHARED tender (one Discovery found, 0032):
 * the company's own copies - e.g. the bid document the buyer e-mailed it -
 * uploaded under tender-documents/private/<company>/<tender>/, recorded in
 * tender_private_documents and read together with the published documents.
 * No other company pursuing the tender can see them or what is read from them.
 */
export function AddPrivateDocumentsForm({ companyId, tenderId }: { companyId: string; tenderId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const bad = checkFiles(files);
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      const up = await uploadAll(privatePrefix(companyId, tenderId), files, setProgress);
      if ("error" in up) {
        setProgress(null);
        setError(up.error);
        return;
      }
      const res = await addPrivateTenderDocuments({ tenderId, documents: up.docs });
      if (res?.error) {
        setProgress(null);
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="max-w-full text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className={`min-h-9 rounded-lg border-none bg-foreground px-3.5 text-xs font-semibold text-white ${pending ? "cursor-default opacity-60" : "cursor-pointer"}`}
      >
        {pending ? "Uploading…" : "Add privately and re-read"}
      </button>
      {progress && <span className="text-xs text-warning">{progress}</span>}
      {error && <span role="alert" className="basis-full text-xs text-destructive">{error}</span>}
    </form>
  );
}
