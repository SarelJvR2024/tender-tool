"use client";

/**
 * Tender Workspace overhaul (2026-10-25), CoverPagePreview's own print/
 * export button. Opens a new window with the SAME text CoverPagePreview
 * already rendered (passed in as plain strings, not re-derived here) and
 * calls window.print() on it - this is a print of the preview, not a
 * second, independent render of the real generated cover
 * (engine/make_envelope_covers.py), which this component has no access to
 * and must not pretend to reproduce pixel-for-pixel. Labelled "Print
 * preview" rather than "Print official envelope label" for that reason -
 * same honesty rule this file's own CoverPagePreview header comment already
 * follows for its two read-only fields.
 */
export function PrintPreviewButton({ lines }: { lines: string[] }) {
  const handlePrint = () => {
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    const body = lines.map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("\n");
    w.document.write(`<!doctype html>
<html>
<head>
<title>Envelope cover preview</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; text-align: center; padding: 48px 24px; color: #111; }
  div { margin: 6px 0; font-size: 13px; }
  div:nth-child(2) { font-size: 15px; font-weight: 700; margin-top: 18px; }
</style>
</head>
<body>${body}</body>
</html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="min-h-9 cursor-pointer rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground"
    >
      Print preview
    </button>
  );
}
