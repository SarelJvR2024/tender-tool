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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#FFFFFF", padding: "24px" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: "#5B6472", marginBottom: 20, lineHeight: 1.5 }}>
          This page hit an unexpected error. Try again - if it keeps happening, let us know.
          {digest && <span style={{ display: "block", marginTop: 8, fontSize: 11, color: "#8A93A0" }}>Reference: {digest}</span>}
        </div>
        <button
          type="button"
          onClick={() => retry()}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, padding: "0 20px", borderRadius: 9, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", background: "#D97706", color: "#FFFFFF" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
