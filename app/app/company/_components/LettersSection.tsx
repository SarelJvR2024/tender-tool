import { saveDocumentTemplate } from "../actions";
import {
  COMPANY_DOCUMENT_TYPES,
  unknownGuidelineFields,
  GUIDELINE_MAX_CHARS,
  type CompanyDocumentTemplateRow,
  type CompanyDocumentType,
} from "@/lib/companyDocuments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { VaultSection } from "./shared";

// The company's own letters/documents (0037). One card per document type:
// its state, and the same two-way choice the CV upload offers (people/[id]
// page: "AI-extract" / "Use as-is") - here "Upload your own" (used as-is) or
// "Generate from your guideline" (your own wording, {{fields}} filled in, no
// other wording added). Nothing set up = "Not set up": the pack leaves the
// document out and says so - it never uses another company's wording.
export function LettersSection({
  companyId,
  templates,
  urls,
}: {
  companyId: string;
  templates: Record<string, CompanyDocumentTemplateRow>;
  urls: Record<string, string>;
}) {
  return (
    <VaultSection
      id="letters"
      title="Letters & documents"
      description={
        <>
          Letters a tender needs from your company. For each one, upload your own (it is used exactly as uploaded,
          every time) or write the guideline it should be generated from - your own wording, with{" "}
          <code className="text-xs">{"{{fields}}"}</code> where the tender&apos;s details go. Tender Ready fills
          only those fields; it never adds or rewrites wording. Until you choose, the letter is left out of your
          packs and marked &quot;not set up&quot;.
        </>
      }
    >
      {COMPANY_DOCUMENT_TYPES.map((t) => (
        <LetterCard key={t.key} companyId={companyId} type={t} row={templates[t.key] ?? null} url={urls[t.key]} />
      ))}
    </VaultSection>
  );
}

const STATUS_TONE_CLASS = {
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

function LetterCard({
  companyId,
  type,
  row,
  url,
}: {
  companyId: string;
  type: CompanyDocumentType;
  row: CompanyDocumentTemplateRow | null;
  url: string | undefined;
}) {
  const save = saveDocumentTemplate.bind(null, companyId);
  const status = !row
    ? { label: "Not set up", tone: "warning" as const }
    : row.mode === "uploaded"
      ? { label: "Your own upload - used as-is", tone: "success" as const }
      : { label: "Generated from your guideline", tone: "success" as const };
  const unknown = row?.guideline ? unknownGuidelineFields(type, row.guideline) : [];

  return (
    <div className="mt-2.5 border-t border-border pt-3.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-[600px]">
          <div className="mb-0.5 text-sm font-semibold text-foreground">{type.label}</div>
          <div className="text-xs text-muted-foreground">{type.usedFor}</div>
          {row?.mode === "uploaded" && row.original_filename && (
            <div className="mt-1 text-xs">
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-accent no-underline">
                  {row.original_filename}
                </a>
              ) : (
                <span className="text-muted-foreground">{row.original_filename}</span>
              )}
            </div>
          )}
          {!row && (
            <div className="mt-1 text-xs text-warning">
              Left out of your packs until you upload your own or write a guideline below.
            </div>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
            STATUS_TONE_CLASS[status.tone],
          )}
        >
          {status.label}
        </span>
      </div>

      {unknown.length > 0 && (
        <div className="mt-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Your guideline uses {unknown.map((u) => `{{${u}}}`).join(", ")}, which {unknown.length === 1 ? "isn't a field" : "aren't fields"} Tender
          Tool knows - {unknown.length === 1 ? "it prints" : "they print"} as [UNKNOWN FIELD] until corrected.
        </div>
      )}

      <form action={save} className="mt-3">
        <input type="hidden" name="document_type" value={type.key} />
        <div className="mb-2.5 flex flex-wrap gap-4">
          <label className="flex max-w-80 items-start gap-1.5 text-sm text-foreground">
            <input type="radio" name="mode" value="uploaded" defaultChecked={row?.mode === "uploaded"} required className="mt-1" />
            <span>
              <strong>Upload your own</strong> - your real letter, used exactly as uploaded every time, no AI
              involvement at all.
            </span>
          </label>
          <label className="flex max-w-80 items-start gap-1.5 text-sm text-foreground">
            <input type="radio" name="mode" value="ai_guideline" defaultChecked={row?.mode === "ai_guideline"} className="mt-1" />
            <span>
              <strong>Generate from your guideline</strong> - your own wording below, with this tender&apos;s details
              filled into the fields you mark.
            </span>
          </label>
        </div>

        <label className="mb-1 block text-xs font-semibold text-foreground">
          Your file (for &quot;Upload your own&quot;){row?.storage_path ? " - leave empty to keep the one on file" : ""}
        </label>
        <input
          type="file"
          name="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          aria-label={`Upload your own ${type.label.toLowerCase()}`}
          className="mb-3 max-w-full text-xs text-foreground"
        />

        <label htmlFor={`guideline_${type.key}`} className="mb-1 block text-xs font-semibold text-foreground">
          Your guideline (for &quot;Generate from your guideline&quot;)
        </label>
        <Textarea
          id={`guideline_${type.key}`}
          name="guideline"
          rows={7}
          maxLength={GUIDELINE_MAX_CHARS}
          defaultValue={row?.guideline ?? ""}
          placeholder={`Your own wording, e.g. ${type.example}`}
          className="text-sm leading-relaxed"
        />
        <div className="my-1.5 text-xs leading-relaxed text-muted-foreground">
          Fields you can mark:{" "}
          {type.fields.map((f, i) => (
            <span key={f.key}>
              <code className="text-xs text-foreground">{`{{${f.key}}}`}</code> {f.label}
              {i < type.fields.length - 1 ? " · " : ""}
            </span>
          ))}
          . A blank line starts a new paragraph; a line starting &quot;# &quot; is a heading. A field with nothing
          on file prints as [NOT ON FILE] and is added to the sign-off checklist.
        </div>
        <Button type="submit" variant="accent" size="lg" className="min-h-10">
          Save
        </Button>
      </form>
    </div>
  );
}
