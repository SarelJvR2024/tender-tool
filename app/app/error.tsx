"use client"; // Error boundaries must be Client Components (Next.js 16)

import { useEffect } from "react";

/**
 * Root error boundary (enterprise-readiness audit, 2026-10-20: no error.tsx/
 * not-found.tsx existed anywhere in this app before this - Next.js 16's own
 * default fallback UI is generic, not this app's own voice). Logs the real
 * error server-side (the `error` prop's own message is already sanitized by
 * Next itself for a Server Component error - see error.tsx's own docs: a
 * generic message + `error.digest` to match server logs, nothing sensitive
 * reaches here to begin with) and shows a plain, on-brand message with a
 * retry button - `retry()` (stable since Next 16.3.0) re-renders the failed
 * segment without a full page reload, the way Sarel's own error-handling
 * convention elsewhere in this app degrades gracefully rather than crashing.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("Unhandled error in a route segment", error);
  }, [error]);

  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-card p-6 font-sans">
      <div className="max-w-[420px] text-center">
        <div className="mb-2 text-[15px] font-bold text-foreground">Something went wrong</div>
        <div className="mb-5 text-[13px] leading-normal text-muted-foreground">
          This page hit an unexpected error. Try again - if it keeps happening, let us know.
          {digest && <span className="mt-2 block text-[11px] text-muted-foreground">Reference: {digest}</span>}
        </div>
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-none bg-accent px-5 text-sm font-semibold text-accent-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
