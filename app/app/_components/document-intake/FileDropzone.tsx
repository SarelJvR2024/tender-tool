"use client";

import { useRef, useState } from "react";

// Generic drag-drop + click-to-choose file picker (spec v3 Batch 2/O12: "one
// 'Add documents' control opens file selection and starts upload after
// selection; no second 'Upload' button... Drag-and-drop is equally
// supported"). Deliberately has no opinion on what happens to the files
// once chosen - that's the caller's job (see upload-form.tsx for the
// multi-file AI-classify flow, VaultDocumentUploader.tsx for the
// single-file vault-row flow). Extracted from document-scan/upload-form.tsx,
// which now uses this instead of its own copy.

export function validateFiles(
  files: File[],
  { acceptedExtensions, maxBytes, maxFiles }: { acceptedExtensions: string[]; maxBytes: number; maxFiles?: number },
): string | null {
  if (files.length === 0) return "Choose at least one document, or drop a folder's worth at once.";
  if (maxFiles && files.length > maxFiles) {
    return maxFiles === 1 ? "Choose one file at a time here." : `Choose up to ${maxFiles} files at a time here.`;
  }
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (!acceptedExtensions.some((ext) => lower.endsWith(ext))) {
      return `${f.name}: not a type this can read yet (${acceptedExtensions.join(", ")}).`;
    }
    if (f.size > maxBytes) return `${f.name} is larger than ${(maxBytes / (1024 * 1024)).toFixed(1)} MB.`;
    if (f.size === 0) return `${f.name} is empty.`;
  }
  return null;
}

export function FileDropzone({
  title,
  hint,
  acceptedExtensions,
  multiple = true,
  disabled,
  compact,
  onFilesChosen,
}: {
  title: string;
  hint?: string;
  acceptedExtensions: string[];
  multiple?: boolean;
  disabled?: boolean;
  /** A slim inline control instead of a full dashed drop panel - for a single row inside a longer list (e.g. one vault document), not a dedicated upload page. Still accepts drag-and-drop and a click; just doesn't need a tall box to prove it. */
  compact?: boolean;
  onFilesChosen: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length > 0) onFilesChosen(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled && e.dataTransfer.files.length > 0) choose(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={compact ? title : undefined}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={
        compact
          ? `inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs font-semibold text-foreground ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${dragOver ? "border-accent bg-accent/5" : "border-border bg-muted/30"}`
          : `rounded-xl border-2 border-dashed px-4 py-7 text-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${dragOver ? "border-accent bg-accent/5" : "border-border bg-muted/30"}`
      }
    >
      {compact ? (
        title
      ) : (
        <>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={acceptedExtensions.join(",")}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) choose(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
