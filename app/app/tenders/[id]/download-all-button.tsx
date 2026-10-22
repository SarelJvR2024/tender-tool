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
      className="min-h-8 cursor-pointer rounded-md bg-foreground px-3 text-[11px] font-bold whitespace-nowrap text-white"
    >
      Download submission pack ({urls.length} file{urls.length === 1 ? "" : "s"})
    </button>
  );
}
