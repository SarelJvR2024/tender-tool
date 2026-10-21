import { NotebookPen } from "lucide-react";
import { EmptyState } from "@/components/tt/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function HowWeWorkSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection
      id="how-we-work"
      title="How we work"
      description="Kept for any part of a tender that needs your own description - used word-for-word, never rewritten by AI."
    >
      {company.how_we_work ? (
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">{company.how_we_work}</div>
      ) : (
        <EmptyState
          icon={NotebookPen}
          title="Not written yet"
          description="Describe who you are and how you actually approach a tender or project, in your own words - your real methodology, not a template."
          action={
            <a href="/company?edit=1" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-10" })}>
              Add it
            </a>
          }
          className="py-6"
        />
      )}
    </VaultSection>
  );
}
