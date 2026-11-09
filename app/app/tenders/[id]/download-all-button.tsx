"use client";

/**
 * "One-click Download submission pack" (prompt 10, item 3). The signed URLs
 * for a ready job's PDF + every output file already exist (submission-pack.tsx
 * computes them for the per-file links right below this button) - this just
 * fires all of them from one click instead of making someone click each link
 * in turn. No new data, no new engine output.
 *
 * Fixed (standing review, 2026-11-09): firing every `a.click()` in one
 * synchronous loop silently delivered only the LAST file for any job with
 * more than one output file (every real SANRAL pack: the main PDF plus at
 * least one .xlsm Financial workbook, `submission-pack.tsx`'s own `urls`
 * prop is never a true single-file case there) - the label still said "(N
 * files)" and the network tab shows all N requests firing, but the browser
 * treats each click as a new top-level navigation competing with the next
 * one a few microseconds later, and cancels every navigation except the
 * final one before its download can register, cross-origin (this app's own
 * origin vs. the signed Supabase Storage URL's origin) regardless of
 * whether the `download` attribute is set or the response carries a
 * `Content-Disposition`. Reproduced live with Playwright/Chromium against a
 * real two-origin HTTP server (not jsdom, which doesn't implement real
 * navigation) - 3 files, 3 real HTTP requests, but only 1 `download` event,
 * always the last URL in the array, in every variant tried (no attribute,
 * `download=""`, server-sent `Content-Disposition: attachment`, same-origin,
 * cross-origin). Spacing the clicks out on the task queue (a small
 * `setTimeout` per file, matching the well-known real-world workaround for
 * this exact browser behaviour) reproducibly fixed it in the same harness -
 * all N `download` events fire, every time. `download=""` is kept too: a
 * free, no-downside attribute that also forces a same-origin link in this
 * family to download rather than navigate, should one ever exist.
 */
export function DownloadAllButton({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        urls.forEach((url, i) => {
          // 250ms: comfortably clear of a single click-to-navigation tick
          // (confirmed empirically - see the header comment's repro), short
          // enough that N files still feel like "one click" to the person
          // waiting, not a perceptible per-file delay.
          setTimeout(() => {
            const a = document.createElement("a");
            a.href = url;
            a.download = "";
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }, i * 250);
        });
      }}
      className="min-h-8 cursor-pointer rounded-md bg-foreground px-3 text-[11px] font-bold whitespace-nowrap text-white"
    >
      Download submission pack ({urls.length} file{urls.length === 1 ? "" : "s"})
    </button>
  );
}
