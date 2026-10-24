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

export type QuickFixFieldSpec =
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "date"; name: string; label: string }
  | { kind: "number"; name: string; label: string; min?: number; step?: number };

/**
 * One compliance blocker's own quick-fix shape - "Quick Blocker Resolver"
 * (Sarel's own Batch 3 brief, 2026-10-24). Deliberately narrow: plain-text/
 * number/date company fields get an instant single-field form; a backing
 * document, when the item has one, gets ONE dropzone for that one expected
 * kind - never the full multi-file bulk-extraction/OCR review UI (that
 * stays a deliberate, separate "Open in Company Vault" link). For the 6
 * vault kinds the AI document-scan pipeline classifies (every kind except
 * COID), upload here still goes through that same real classification step
 * before anything is marked resolved - spec v3 §4/§17's own anti-overwrite
 * rule ("a new document must NOT silently overwrite verified company or
 * person information") applies here exactly as it does on /company; this
 * drawer does not get a shortcut around it.
 */
export type QuickFixConfig = {
  key: string;
  title: string;
  fields: QuickFixFieldSpec[];
  documentKind: "coid" | "cidb" | "sars_tcs_pin" | "pi_insurance" | "iso_9001" | "bank_letter" | "bee_proof" | null;
  documentLabel: string | null;
  /** true = goes through AI classify + the /company/document-scan review step before it's really resolved. false (COID only) = direct write, instantly resolved. */
  aiClassified: boolean;
};

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

// Per-compliance-key drawer shape, built from each field's own real column
// on `companies` (lib/tenderCompliance.ts's CompanyVault / COMPANY_VAULT_COLUMNS)
// - verified directly against lib/companyProfileUpdate.ts's own field
// whitelist and lib/vaultDocuments.ts's own VAULT_DOCUMENTS/
// VAULT_KIND_TO_DOCUMENT_KIND, not assumed. Keyed by bid-task-status.ts's
// own ComplianceItem.key - only the keys that actually resolve to a real
// company vault shape get an entry; every other key (authority, past
// performance, briefing, hours, form_of_offer, declarations, ...) keeps its
// existing plain Link to /company, unchanged - CIDB (a document-only vault
// kind with no matching FIX_HREF_FOR_KEY entry at all) is left out for the
// same reason: there is nothing real yet to route it to from here.
export const VAULT_DRAWER_CONFIG: Record<string, QuickFixConfig> = {
  csd: {
    key: "csd",
    title: "CSD supplier number",
    fields: [{ kind: "text", name: "csd_supplier_number", label: "CSD supplier number" }],
    documentKind: null,
    documentLabel: null,
    aiClassified: false,
  },
  tax: {
    key: "tax",
    title: "SARS Tax Compliance Status",
    fields: [
      { kind: "text", name: "sars_tcs_pin", label: "SARS Tax Compliance PIN" },
      { kind: "date", name: "sars_tcs_pin_expiry", label: "Expiry date" },
    ],
    documentKind: "sars_tcs_pin",
    documentLabel: "SARS Tax Compliance Status PIN letter",
    aiClassified: true,
  },
  insurance: {
    key: "insurance",
    title: "Professional indemnity insurance",
    fields: [
      { kind: "text", name: "pi_insurance_insurer", label: "Insurer" },
      { kind: "text", name: "pi_insurance_policy_number", label: "Policy number" },
      { kind: "number", name: "pi_insurance_cover_zar", label: "Cover amount (R)", min: 0 },
      { kind: "date", name: "pi_insurance_expiry", label: "Expiry date" },
    ],
    documentKind: "pi_insurance",
    documentLabel: "Professional indemnity insurance schedule",
    aiClassified: true,
  },
  quality_system: {
    key: "quality_system",
    title: "ISO 9001 certification",
    fields: [
      { kind: "text", name: "iso_9001_certificate_number", label: "Certificate number" },
      { kind: "date", name: "iso_9001_expiry", label: "Expiry date" },
    ],
    documentKind: "iso_9001",
    documentLabel: "ISO 9001 certificate",
    aiClassified: true,
  },
  coid: {
    key: "coid",
    title: "COID Letter of Good Standing",
    fields: [
      { kind: "text", name: "coid_registration_number", label: "COID registration number" },
      { kind: "text", name: "coid_letter_of_good_standing_number", label: "Letter of Good Standing number" },
      { kind: "date", name: "coid_letter_of_good_standing_expiry", label: "Letter expiry date" },
    ],
    documentKind: "coid",
    documentLabel: "COID Letter of Good Standing",
    aiClassified: false,
  },
  bbbee: {
    key: "bbbee",
    title: "B-BBEE status",
    fields: [
      { kind: "number", name: "bee_level", label: "B-BBEE level", min: 1, step: 1 },
      { kind: "number", name: "black_ownership_pct", label: "Black ownership %", min: 0 },
      { kind: "number", name: "bee_procurement_recognition_pct", label: "Procurement recognition %", min: 0 },
      { kind: "date", name: "bee_proof_expiry", label: "Proof expiry date" },
    ],
    documentKind: "bee_proof",
    documentLabel: "B-BBEE certificate or sworn affidavit",
    aiClassified: true,
  },
  bank: {
    key: "bank",
    title: "Bank details",
    // Deliberately no account number field - lib/companyProfileUpdate.ts's
    // own header comment is explicit: account numbers live only in the
    // restricted bank_accounts table, never on companies. This drawer
    // writes through the same whitelist and must not add one either.
    fields: [
      { kind: "text", name: "bank_name", label: "Bank name" },
      { kind: "text", name: "bank_branch_code", label: "Branch code" },
      { kind: "date", name: "bank_confirmation_letter_date", label: "Confirmation letter date" },
    ],
    documentKind: "bank_letter",
    documentLabel: "Bank confirmation letter",
    aiClassified: true,
  },
};
