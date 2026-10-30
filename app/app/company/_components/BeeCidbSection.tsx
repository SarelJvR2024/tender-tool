import { Pencil } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

const EDIT_HREF = "/company?edit=1#bee-cidb";

export function BeeCidbSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection
      id="bee-cidb"
      title="B-BBEE & CIDB"
      actions={
        <a href={EDIT_HREF} className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1 text-xs text-muted-foreground" })}>
          <Pencil className="size-3.5" /> Edit
        </a>
      }
    >
      <div className={fieldGridClass}>
        <Field label="B-BBEE level" value={company.bee_level} editHref={EDIT_HREF} />
        <Field label="Black ownership %" value={company.black_ownership_pct} editHref={EDIT_HREF} />
        <Field label="B-BBEE procurement recognition %" value={company.bee_procurement_recognition_pct} editHref={EDIT_HREF} />
        <Field label="Status" value={company.status} editHref={EDIT_HREF} />
      </div>
    </VaultSection>
  );
}
