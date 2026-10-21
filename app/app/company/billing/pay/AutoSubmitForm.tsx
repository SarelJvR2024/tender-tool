"use client";

import { useEffect, useRef } from "react";

/**
 * Renders PayFast's signed checkout fields as a plain hidden form and
 * submits it automatically on mount - PayFast's own process endpoint only
 * accepts a real POST of these exact fields, there's no GET/redirect form
 * of this request.
 */
export function AutoSubmitForm({ actionUrl, fields }: { actionUrl: string; fields: Array<[string, string]> }) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.submit();
  }, []);

  return (
    <form ref={formRef} method="POST" action={actionUrl}>
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </form>
  );
}
