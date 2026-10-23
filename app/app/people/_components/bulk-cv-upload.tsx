"use client";

import { useState, useTransition } from "react";
import { bulkUploadCvs } from "../actions";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { ACCEPTED_EXTENSIONS } from "@/lib/onboardingScan";
import { Button } from "@/components/ui/button";

const MAX_CV_BYTES = 4.4 * 1024 * 1024;

type Person = { id: string; name: string };
type Row = { file: File; kind: "existing" | "new"; personId: string; name: string };

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none";

/** Strip extension/separators for a rough starting guess at a name -
 * never trusted as a match, just a less annoying blank to edit. The actual
 * confirm-or-correct step (per person, after AI reads the CV) is what
 * really decides the name - see createPersonWithCv()'s own comment. */
function guessNameFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\bcv\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bestPersonMatch(filename: string, people: Person[]): Person | null {
  const normalized = filename.toLowerCase();
  for (const p of people) {
    const parts = p.name.toLowerCase().split(/\s+/).filter((s) => s.length > 2);
    if (parts.length > 0 && parts.every((part) => normalized.includes(part))) return p;
  }
  return null;
}

/**
 * Sarel's own live feedback: "allow bulk upload of all People CVs... or
 * bulk upload of people with their details." Multiple files at once, each
 * assigned to an existing person or a new one (named, since a CV can't be
 * AI-extracted before a person_id exists - see bulkUploadCvs()'s own
 * comment, app/app/people/actions.ts). Nothing is created or attached until
 * "Upload N CVs" is clicked - a filename-based guess only pre-fills the row,
 * it never auto-submits.
 */
export function BulkCvUpload({ people }: { people: Person[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"ai_extract" | "as_is">("ai_extract");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseFiles(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_CV_BYTES });
    if (bad) {
      setError(bad);
      return;
    }
    setError(null);
    const newRows: Row[] = files.map((file) => {
      const match = bestPersonMatch(file.name, people);
      return match
        ? { file, kind: "existing", personId: match.id, name: "" }
        : { file, kind: "new", personId: "", name: guessNameFromFilename(file.name) };
    });
    setRows((prev) => [...prev, ...newRows]);
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const readyCount = rows.filter((r) => (r.kind === "existing" ? r.personId : r.name.trim())).length;

  function submit() {
    const unassigned = rows.some((r) => (r.kind === "existing" ? !r.personId : !r.name.trim()));
    if (unassigned) {
      setError("Every file needs either an existing person chosen or a name for a new one - remove a row if you want to skip it.");
      return;
    }
    if (rows.length === 0) {
      setError("Choose at least one CV first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("count", String(rows.length));
      fd.append("mode", mode);
      rows.forEach((r, i) => {
        fd.append(`kind_${i}`, r.kind);
        fd.append(`file_${i}`, r.file);
        if (r.kind === "existing") fd.append(`person_id_${i}`, r.personId);
        else fd.append(`name_${i}`, r.name.trim());
      });
      await bulkUploadCvs(fd); // redirects to /people?bulk=... on completion
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <FileDropzone
        title="Drop multiple CVs here, or click to choose"
        hint="PDF, Word or an image, up to 4.4 MB each."
        acceptedExtensions={ACCEPTED_EXTENSIONS}
        multiple
        disabled={pending}
        onFilesChosen={chooseFiles}
      />

      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-4 rounded-lg border border-border bg-background px-3 py-2.5">
          <label className="flex max-w-[320px] items-start gap-1.5 text-sm text-foreground">
            <input
              type="radio"
              name="mode"
              checked={mode === "ai_extract"}
              onChange={() => setMode("ai_extract")}
              disabled={pending}
              className="mt-0.5"
            />
            <span>
              <strong>AI-extract</strong> the fields for every CV in this batch - nothing is saved until each one is confirmed.
            </span>
          </label>
          <label className="flex max-w-[320px] items-start gap-1.5 text-sm text-foreground">
            <input
              type="radio"
              name="mode"
              checked={mode === "as_is"}
              onChange={() => setMode("as_is")}
              disabled={pending}
              className="mt-0.5"
            />
            <span>
              <strong>Use as-is</strong> - attach every file exactly as uploaded, no AI involvement at all.
            </span>
          </label>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={`${r.file.name}-${i}`} className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.file.name}</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateRow(i, { kind: "existing" })}
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${r.kind === "existing" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  Existing person
                </button>
                <button
                  type="button"
                  onClick={() => updateRow(i, { kind: "new" })}
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${r.kind === "new" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  New person
                </button>
              </div>
              {r.kind === "existing" ? (
                <select className={`${fieldClass} sm:w-[220px]`} value={r.personId} onChange={(e) => updateRow(i, { personId: e.target.value })}>
                  <option value="">- choose -</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${fieldClass} sm:w-[220px]`}
                  value={r.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  placeholder="Full name"
                />
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => removeRow(i)} disabled={pending}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <Button type="button" variant="accent" size="lg" className="mt-4 min-h-11" onClick={submit} disabled={pending || readyCount === 0}>
          {pending ? "Uploading…" : `Upload ${rows.length} CV${rows.length === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}
