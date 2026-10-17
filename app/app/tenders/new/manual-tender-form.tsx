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

const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#16233B", marginBottom: 4 };
const help: React.CSSProperties = { fontSize: 11, color: "#6B6758", marginTop: 3 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit", background: "#FFFFFF", color: "#16233B" };
const primaryBtn: React.CSSProperties = { minHeight: 44, padding: "0 18px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" };

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
      if (done.length > 0) await supabase.storage.from(TENDER_DOCS_BUCKET).remove(done.map((d) => d.storage_path));
      return { error: `Could not upload ${f.name}: ${error.message}` };
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
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={label} htmlFor="title">Tender title *</label>
        <input id="title" name="title" required maxLength={300} placeholder="e.g. Consulting engineering services for the rehabilitation of N2 Section 7" style={input} />
      </div>
      <div>
        <label style={label} htmlFor="buyer">Buyer *</label>
        <input id="buyer" name="buyer" required maxLength={200} placeholder="e.g. SANRAL, City of Tshwane, a private client" style={input} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div>
          <label style={label} htmlFor="reference">Tender / contract number</label>
          <input id="reference" name="reference" maxLength={100} placeholder="e.g. R.396-010-2025/1F" style={input} />
          <div style={help}>For a SANRAL tender it&apos;s read from the workbook if you leave it blank.</div>
        </div>
        <div>
          <label style={label} htmlFor="ocid">eTenders OCDS id (if it has one)</label>
          <input id="ocid" name="ocid" maxLength={200} placeholder="ocds-9t57fa-…" style={input} />
          <div style={help}>Leave blank for a tender that isn&apos;t on eTenders.</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <div>
          <label style={label} htmlFor="closing_date">Closing date</label>
          <input id="closing_date" name="closing_date" type="date" style={input} />
        </div>
        <div>
          <label style={label} htmlFor="closing_time">Closing time (SAST)</label>
          <input id="closing_time" name="closing_time" type="time" defaultValue="12:00" style={input} />
        </div>
      </div>
      <div>
        <label style={label} htmlFor="files">The tender&apos;s own documents *</label>
        <input
          id="files"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          style={{ ...input, padding: "8px 10px" }}
        />
        <div style={help}>
          Everything the buyer published: the tender document / RFQ, returnable forms (SBD/MBD or the buyer&apos;s own), and for SANRAL
          the Technical and Financial Submission workbooks (.xlsm) plus the C.1.1.1, C.1.2.3 and A-Forms Word files. PDF, Word, Excel or a
          .zip of them, up to 50 MB each. Scanned PDFs can&apos;t be read yet - include a text copy if you have one.
        </div>
        {files.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#4B5563" }}>
            {files.map((f) => (
              <li key={f.name + f.size}>
                {f.name} <span style={{ color: "#9A9684" }}>({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div role="alert" style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#B91C1C" }}>
          {error}
        </div>
      )}
      {progress && (
        <div aria-live="polite" style={{ background: "#FEF3C7", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#B45309" }}>
          {progress}
        </div>
      )}

      <div>
        <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1, cursor: pending ? "default" : "pointer" }}>
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
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        style={{ fontSize: 12, maxWidth: "100%" }}
      />
      <button
        type="submit"
        disabled={pending}
        style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#FFFFFF", border: "1px solid #E5E1D5", color: "#16233B", fontSize: 12, fontWeight: 600, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "Uploading…" : "Add documents and re-analyse"}
      </button>
      {progress && <span style={{ fontSize: 12, color: "#B45309" }}>{progress}</span>}
      {error && <span role="alert" style={{ fontSize: 12, color: "#B91C1C", flexBasis: "100%" }}>{error}</span>}
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
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        style={{ fontSize: 12, maxWidth: "100%" }}
      />
      <button
        type="submit"
        disabled={pending}
        style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#16233B", border: "none", color: "#FFFFFF", fontSize: 12, fontWeight: 600, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1 }}
      >
        {pending ? "Uploading…" : "Add privately and re-read"}
      </button>
      {progress && <span style={{ fontSize: 12, color: "#B45309" }}>{progress}</span>}
      {error && <span role="alert" style={{ fontSize: 12, color: "#B91C1C", flexBasis: "100%" }}>{error}</span>}
    </form>
  );
}
