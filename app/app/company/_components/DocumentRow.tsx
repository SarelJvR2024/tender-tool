import type { StatusChip } from "@/lib/dates";
import { filenameFromPath, VAULT_KIND_TO_DOCUMENT_KIND, type VaultDocumentKind } from "@/lib/vaultDocuments";
import { ChipBadge } from "./shared";
import { VaultDocumentUploader } from "./VaultDocumentUploader";
import { DirectVaultDocumentUploader } from "./DirectVaultDocumentUploader";

/**
 * The upload/replace control for one vault document - whichever of the two
 * real upload paths this kind actually uses (see VAULT_KIND_TO_DOCUMENT_KIND's
 * own comment: 6 kinds go through the AI classify-and-review pipeline, 'coid'
 * through a direct upload, same one button either way per spec v3 O12).
 * Shared by DocumentRow's card body and the table view's own row, so the two
 * views can never drift onto two different upload behaviours.
 */
export function DocumentUploadAction({
  companyId,
  kind,
  title,
  hasExisting,
}: {
  companyId: string;
  kind: VaultDocumentKind;
  title: string;
  hasExisting: boolean;
}) {
  const reviewable = !!VAULT_KIND_TO_DOCUMENT_KIND[kind];
  return reviewable ? (
    <VaultDocumentUploader companyId={companyId} title={title} />
  ) : (
    <DirectVaultDocumentUploader companyId={companyId} kind={kind} title={title} hasExisting={hasExisting} />
  );
}

/** One vault document: its tracked facts, an expiry chip, a link to the uploaded copy, and an upload/replace control. */
export function DocumentRow({
  companyId,
  kind,
  title,
  lines,
  status,
  path,
  url,
}: {
  companyId: string;
  kind: VaultDocumentKind;
  title: string;
  lines: string[];
  status: StatusChip;
  path: string | null;
  url: string | undefined;
}) {
  const filename = filenameFromPath(path);
  return (
    <div className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-0.5 text-sm font-semibold text-foreground">{title}</div>
          {lines.map((l, i) => (
            <div key={i} className="mt-0.5 text-xs break-words text-muted-foreground first:mt-0">
              {l}
            </div>
          ))}
          <div className="mt-1 text-xs">
            {filename ? (
              url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-accent no-underline">
                  {filename}
                </a>
              ) : (
                <span className="text-muted-foreground">{filename}</span>
              )
            ) : (
              <span className="text-muted-foreground/70">No copy uploaded</span>
            )}
          </div>
        </div>
        <ChipBadge status={status} />
      </div>
      <DocumentUploadAction companyId={companyId} kind={kind} title={title} hasExisting={!!filename} />
    </div>
  );
}
