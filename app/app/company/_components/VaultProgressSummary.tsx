import Link from "next/link";
import { FileCheck, Users } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Sarel's own live feedback (this page, tonight): "see progress, number of
 * docs uploaded and missing, people uploaded and missing docs per person" -
 * always visible, not buried in a section you have to open. Two numbers,
 * reusing data this page already computes elsewhere (VAULT_DOCUMENTS'
 * column-presence count in page.tsx, cv_uploads already queried for the
 * bid-readiness score) rather than inventing a second counting rule that
 * could quietly disagree with BidReadinessCard above it.
 *
 * Deliberately NOT a progress bar or percentage here - BidReadinessCard
 * already owns "the one score" for this company (its own file's comment:
 * "these surfaces can't quietly disagree"). This is the concrete, countable
 * version of the same underlying facts: which documents, which people.
 */
export function VaultProgressSummary({
  documentsOnFile,
  documentsTotal,
  peopleTotal,
  peopleWithCv,
  peopleMissingCv,
}: {
  documentsOnFile: number;
  documentsTotal: number;
  peopleTotal: number;
  peopleWithCv: number;
  /** Up to a handful of names missing a CV, for a direct link each - not every missing person if there are many, see the component body for the cutoff. */
  peopleMissingCv: { id: string; name: string }[];
}) {
  const SHOWN = 4;
  const shown = peopleMissingCv.slice(0, SHOWN);
  const more = peopleMissingCv.length - shown.length;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Card className="gap-1.5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileCheck className="size-4 text-muted-foreground" aria-hidden />
          Compliance documents
        </div>
        <div className="text-2xl font-bold text-foreground">
          {documentsOnFile} <span className="text-sm font-normal text-muted-foreground">of {documentsTotal} on file</span>
        </div>
        {documentsOnFile < documentsTotal ? (
          <Link href="#compliance-documents" className="text-xs font-medium text-accent hover:underline">
            {documentsTotal - documentsOnFile} still missing - add them →
          </Link>
        ) : (
          <div className="text-xs text-success">All on file</div>
        )}
      </Card>

      <Card className="gap-1.5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          People / CVs
        </div>
        {peopleTotal === 0 ? (
          <>
            <div className="text-2xl font-bold text-foreground">No one on file yet</div>
            <Link href="/people/new" className="text-xs font-medium text-accent hover:underline">
              Add your first person →
            </Link>
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-foreground">
              {peopleWithCv} <span className="text-sm font-normal text-muted-foreground">of {peopleTotal} have a CV</span>
            </div>
            {peopleMissingCv.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                Missing:{" "}
                {shown.map((p, i) => (
                  <span key={p.id}>
                    <Link href={`/people/${p.id}`} className="font-medium text-accent hover:underline">
                      {p.name}
                    </Link>
                    {i < shown.length - 1 ? ", " : ""}
                  </span>
                ))}
                {more > 0 && <> and {more} more</>}
                {" - "}
                <Link href="/people" className="font-medium text-accent hover:underline">
                  see all
                </Link>
              </div>
            ) : (
              <div className="text-xs text-success">Everyone has a CV on file</div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
