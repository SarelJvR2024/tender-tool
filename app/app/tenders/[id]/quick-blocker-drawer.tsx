"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ACCEPTED_EXTENSIONS, MAX_ONBOARDING_FILE_BYTES, ONBOARDING_BUCKET, uploadPrefix } from "@/lib/onboardingScan";
import { registerOnboardingBatch } from "../../company/document-scan/actions";
import { FileDropzone, validateFiles } from "../../_components/document-intake/FileDropzone";
import { uploadBatch, partitionBatch } from "../../_components/document-intake/uploadBatch";
import { saveVaultQuickFields, uploadCoidQuickFix } from "./vault-quick-fix-actions";
import type { QuickFixFieldSpec, QuickFixConfig } from "./quick-fix-config";

function FieldInput({ field, defaultValue, onChange }: { field: QuickFixFieldSpec; defaultValue: string; onChange: (name: string, value: string) => void }) {
  const common = "w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground";
  if (field.kind === "number") {
    return (
      <input type="number" min={field.min} step={field.step ?? 1} defaultValue={defaultValue} className={common} onChange={(e) => onChange(field.name, e.target.value)} />
    );
  }
  if (field.kind === "date") {
    return <input type="date" defaultValue={defaultValue} className={common} onChange={(e) => onChange(field.name, e.target.value)} />;
  }
  return (
    <input type="text" defaultValue={defaultValue} placeholder={field.placeholder} className={common} onChange={(e) => onChange(field.name, e.target.value)} />
  );
}

export function QuickBlockerDrawer({
  tenderId,
  companyId,
  config,
  currentValues,
  triggerElement,
  triggerLabel,
}: {
  tenderId: string;
  companyId: string;
  config: QuickFixConfig;
  /** Current value per field name, pre-filled - "" when not on file. */
  currentValues: Record<string, string>;
  /** A bare, props-only element (e.g. `<Button variant="outline" size="sm" />`) - its own children are ignored; `triggerLabel` is what actually renders, same composition SheetTrigger/PopoverTrigger use everywhere else in this app. */
  triggerElement: React.ReactElement;
  triggerLabel: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(currentValues);
  const [fieldsSaved, setFieldsSaved] = useState(false);
  const [docUploaded, setDocUploaded] = useState(false);
  const [docResolved, setDocResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function saveFields() {
    setError(null);
    startTransition(async () => {
      const res = await saveVaultQuickFields(tenderId, companyId, values);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFieldsSaved(true);
      router.refresh();
    });
  }

  function uploadDocument(files: File[]) {
    const bad = validateFiles(files, { acceptedExtensions: ACCEPTED_EXTENSIONS, maxBytes: MAX_ONBOARDING_FILE_BYTES, maxFiles: 1 });
    if (bad) return setError(bad);
    setError(null);
    startTransition(async () => {
      if (!config.aiClassified) {
        // COID only - no AI classifier entry exists for it, so there is no
        // review step to send it through; this is a real, direct write.
        const res = await uploadCoidQuickFix(tenderId, companyId, files[0]);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDocResolved(true);
        router.refresh();
        return;
      }
      const settled = await uploadBatch(files, ONBOARDING_BUCKET, uploadPrefix(companyId), () => {});
      const { succeeded, failed } = partitionBatch(settled);
      if (failed.length > 0) {
        setError(failed[0].error);
        return;
      }
      const res = await registerOnboardingBatch({
        batchId: crypto.randomUUID(),
        files: succeeded.map((s) => ({ storagePath: s.storagePath, originalFilename: s.file.name })),
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      // Honest, not instant: AI classification + a human confirming it on
      // the review screen is what actually resolves this, same as /company
      // today - never claim "resolved" before that's actually happened.
      setDocUploaded(true);
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={triggerElement}>{triggerLabel}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{config.title}</SheetTitle>
          <SheetDescription>Fix this from here - no need to leave the tender workspace.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          {config.fields.length > 0 && (
            <div className="flex flex-col gap-3">
              {config.fields.map((field) => (
                <label key={field.name} className="flex flex-col gap-1 text-xs font-semibold text-foreground">
                  {field.label}
                  <FieldInput field={field} defaultValue={currentValues[field.name] ?? ""} onChange={(name, v) => setValues((prev) => ({ ...prev, [name]: v }))} />
                </label>
              ))}
              {fieldsSaved ? (
                <div className="rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">Saved - compliance status refreshed.</div>
              ) : (
                <Button type="button" size="sm" disabled={isPending} onClick={saveFields}>
                  {isPending ? "Saving…" : "Save & Recalculate Score"}
                </Button>
              )}
            </div>
          )}

          {config.documentKind && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="text-xs font-semibold text-foreground">{config.documentLabel}</div>
              {docResolved ? (
                <div className="rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">Uploaded - compliance status refreshed.</div>
              ) : docUploaded ? (
                <div className="rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                  Uploaded - confirm the details on the review screen to mark this resolved.{" "}
                  <Link href="/company/document-scan" className="font-semibold underline">
                    Review now →
                  </Link>
                </div>
              ) : (
                <FileDropzone
                  title={isPending ? "Uploading…" : `Upload ${config.documentLabel?.toLowerCase()}`}
                  acceptedExtensions={ACCEPTED_EXTENSIONS}
                  multiple={false}
                  compact
                  disabled={isPending}
                  onFilesChosen={uploadDocument}
                />
              )}
            </div>
          )}

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <SheetFooter>
          <Link href="/company#compliance-documents" className="text-xs font-semibold text-accent no-underline hover:underline">
            Open in Company Vault →
          </Link>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

