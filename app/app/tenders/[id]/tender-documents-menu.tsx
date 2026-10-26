"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DocUrlEntry = { url: string; title: string | null };
export type PrivateDocEntry = { id: string; title: string; href: string | null };

/**
 * Tender Workspace header's own document quick-access (Sarel's "Master
 * Overhaul" brief, item 4, 2026-10-24): the buyer's own published documents
 * (tenders.document_urls) were real data this page already read but never
 * actually linked anywhere - only counted ("Reading N published documents").
 * This company's own private copies (tender_private_documents) already have
 * a real download UI (private-documents.tsx) but it's buried in the
 * Overview tab; this surfaces both from the sticky header instead. No
 * fabricated categories (RFP / BOQ / Addenda) - the real data is a flat
 * list with a title and a link, so that's what this shows.
 */
export function TenderDocumentsMenu({
  docUrls,
  privateDocs,
  uploadHref,
}: {
  docUrls: DocUrlEntry[];
  privateDocs: PrivateDocEntry[];
  uploadHref: string | null;
}) {
  const total = docUrls.length + privateDocs.length;

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="min-h-9 gap-1.5 text-xs font-semibold" />}>
        <FileText className="size-3.5" />
        Tender documents{total > 0 ? ` (${total})` : ""}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="font-display text-sm font-medium text-foreground">Tender documents</div>
          <div className="text-xs text-muted-foreground">What the buyer published, plus your own private copies</div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {total === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No documents on file for this tender yet.</div>
          ) : (
            <>
              {docUrls.map((d, i) => (
                <a
                  key={`pub-${i}`}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 border-b border-border px-4 py-3 text-inherit no-underline last:border-b-0 hover:bg-muted/50"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{d.title ?? "Published document"}</div>
                    <div className="text-xs text-muted-foreground">Published by the buyer</div>
                  </div>
                </a>
              ))}
              {privateDocs.map((d) => (
                <a
                  key={d.id}
                  href={d.href ?? "#"}
                  className="flex items-start gap-3 border-b border-border px-4 py-3 text-inherit no-underline last:border-b-0 hover:bg-muted/50"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{d.title}</div>
                    <div className="text-xs text-muted-foreground">Your private copy - only your company sees this</div>
                  </div>
                </a>
              ))}
            </>
          )}
        </div>
        {uploadHref && (
          <div className="border-t border-border px-4 py-2.5">
            <Link href={uploadHref} className="text-xs font-semibold text-accent no-underline hover:underline">
              + Add a private document →
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
