"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

/**
 * A plain <button type="submit"> that shows a real pending state while its
 * enclosing <form action={serverAction}> is in flight - the "instant loading
 * state" Sarel's own brief (2026-10-31) asked for on the inline signatory-
 * capacity fix. useFormStatus only works inside a form, so this has to be
 * its own client component (a Server Component page can't call a hook) -
 * the surrounding form/inputs stay exactly as plain server-rendered JSX.
 */
export function SubmitButton({ children, pendingLabel, style, className }: { children: ReactNode; pendingLabel: string; style?: CSSProperties; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={{ ...style, ...(pending ? { opacity: 0.7, cursor: "default" } : {}) }} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
