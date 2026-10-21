"use client";

/**
 * "One-click Download submission pack" (prompt 10, item 3). The signed URLs
 * for a ready job's PDF + every output file already exist (submission-pack.tsx
 * computes them for the per-file links right below this button) - this just
 * fires all of them from one click instead of making someone click each link
 * in turn. No new data, no new engine output.
 */
export function DownloadAllButton({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        for (const url of urls) {
          const a = document.createElement("a");
          a.href = url;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      }}
      style={{ minHeight: 32, padding: "0 12px", borderRadius: 7, background: "#16233B", color: "#FFFFFF", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
    >
      Download submission pack ({urls.length} file{urls.length === 1 ? "" : "s"})
    </button>
  );
}
