"use client";

import { useState, useTransition } from "react";
import { createPersonWithCv } from "../actions";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { ACCEPTED_EXTENSIONS } from "@/lib/onboardingScan";
import { Button } from "@/components/ui/button";

// Vercel's Server Action request-body cap, same constant VaultDocumentUploader
// and uploadCv's own storage path convention assume elsewhere in this app.
const MAX_CV_BYTES = 4.4 * 1024 * 1024;

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none";
const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";

/**
 * Sarel's own live feedback: "on the add person, allow option to add a CV
 * and have AI read and capture all the information instead of the user
 * capturing it." Leads with name + CV upload - see createPersonWithCv()'s
 * own comment (app/app/people/actions.ts) for exactly what this can and
 * can't do without a schema/engine change, and why the name is still typed.
 */
export function CvLedAddPerson() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"ai_extract" | "as_is">("ai_extract");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function chooseFile(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_CV_BYTES, maxFiles: 1 });
    if (bad) {
      setError(bad);
      return;
    }
    setError(null);
    setFile(files[0]);
  }

  function submit() {
    if (!name.trim()) {
      setError("Enter a name - you can correct it once AI reads the CV.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", name.trim());
      if (file) {
        fd.append("file", file);
        fd.append("mode", mode);
      }
      await createPersonWithCv(fd); // redirects to the new person's page on success
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-border bg-card p-4">
      <div className="mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">Add from a CV</div>
      <div className="mb-3 text-xs text-muted-foreground">
        AI reads the CV and proposes qualifications, registrations and project history - you review and confirm
        before anything is saved, same as replacing a CV on an existing person.
      </div>

      <div className="mb-3">
        <label className={labelClass}>Full name *</label>
        <input
          className={fieldClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="As it appears on their CV - correct it after AI reads the CV if needed"
          disabled={pending}
        />
      </div>

      <div className="mb-3">
        <label className={labelClass}>CV (optional, but recommended)</label>
        <FileDropzone
          title={pending ? "Adding…" : file ? `Selected: ${file.name}` : "Upload CV - PDF, Word or an image"}
          hint="Up to 4.4 MB. Drop a file or click to choose."
          acceptedExtensions={ACCEPTED_EXTENSIONS}
          multiple={false}
          disabled={pending}
          onFilesChosen={chooseFile}
        />
      </div>

      {file && (
        <div className="mb-3 flex flex-wrap gap-4">
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
              <strong>AI-extract</strong> the fields for you to check - nothing is saved until you confirm it.
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
              <strong>Use as-is</strong> - attach this exact file to submissions, no AI involvement at all.
            </span>
          </label>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="button" variant="accent" size="lg" className="min-h-11" onClick={submit} disabled={pending || !name.trim()}>
        {pending ? "Adding…" : "Add person"}
      </Button>
    </div>
  );
}
