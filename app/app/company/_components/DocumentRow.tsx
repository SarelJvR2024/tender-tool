import type { StatusChip } from "@/lib/dates";
import { filenameFromPath, type VaultDocumentKind } from "@/lib/vaultDocuments";
import { uploadVaultDocument } from "../actions";
import { ChipBadge } from "./shared";
import { Button } from "@/components/ui/button";

/** One vault document: its tracked facts, an expiry chip, a link to the uploaded copy, and an upload/replace form. */
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
  const upload = uploadVaultDocument.bind(null, companyId);
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
      <form action={upload} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          aria-label={`Upload ${title}`}
          className="max-w-full text-xs text-foreground"
        />
        <Button type="submit" variant="outline" size="sm">
          {filename ? "Replace" : "Upload"}
        </Button>
      </form>
    </div>
  );
}
