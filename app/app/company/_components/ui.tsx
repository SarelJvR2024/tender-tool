// Small shared building blocks for the Company sub-pages (0050: principals,
// registrations, properties, bank accounts). Migrated to the design
// system's tokens/Tailwind (Company vault sub-PR 2 - see app/AGENTS.md):
// these were the one place still hardcoding the stale pre-color-update
// Civic Navy/gold values (NAVY #16233B, AMBER #D97706) that the shell
// sub-PR's own token migration didn't reach, since this file lives outside
// `/company`'s own page.tsx. Component names/signatures are kept exactly as
// they were so the 4 consumer pages (bank-accounts/principals/properties/
// registrations) need no structural changes - only this file's
// implementation changed.
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/tt/page-header";
import type { StatusChip } from "@/lib/dates";
import { ChipBadge, Banner } from "./shared";
import { AppShell } from "../../_components/AppShell";
import { ConfirmSubmitButton } from "../../_components/ConfirmSubmitButton";

// Kept as exported token-based values (not literal hex) rather than deleted
// outright - every consumer page still reads these directly for one-off
// inline styles (e.g. `style={{ color: NAVY }}`) in spots that aren't one
// of this file's own components. Pointing them at the real CSS custom
// properties (app/globals.css) rather than rewriting every call site is
// the "token-based values" option named in this migration's own brief, and
// keeps the 4 consumer pages themselves out of scope for this file's edit.
// MUTED/FAINT collapse onto the one `--muted-foreground` token (the design
// system has no second, fainter muted tone elsewhere either - shared.tsx's
// own `Field` "Not on file" caption uses `text-muted-foreground/70` for
// that, an opacity modifier Tailwind classes can express but a plain CSS
// string can't, so FAINT stays the same base token as MUTED here).
export const NAVY = "var(--foreground)";
export const AMBER = "var(--accent)";
export const CREAM = "var(--card)";
export const BORDER = "var(--border)";
export const MUTED = "var(--muted-foreground)";
export const FAINT = "var(--muted-foreground)";

export function SubPage({
  title,
  intro,
  error,
  saved,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  error?: string;
  saved?: string | null;
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-5 pb-10">
        <a href="/company" className="text-[13px] font-semibold text-accent no-underline">
          ← Company profile
        </a>
        <PageHeader className="mt-2 mb-4" title={title} description={<span className="max-w-[720px]">{intro}</span>} />
        {saved && (
          <div className="mb-4">
            <Banner tone="success">{saved}</Banner>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Banner tone="destructive">Could not save: {error}</Banner>
          </div>
        )}
        {children}
      </div>
    </AppShell>
  );
}

export function Card({ title, id, children }: { title?: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-3.5 rounded-xl border border-border bg-card p-4 shadow-sm sm:px-[18px]">
      {title && (
        <h2 className="mb-3 text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">{title}</h2>
      )}
      {children}
    </div>
  );
}

/** A StatusChip (lib/dates.ts's expiryStatus - or an ad hoc {label,bg,color} of the same shape) rendered as a soft-tint token badge. */
export function Chip({ status }: { status: StatusChip }) {
  return <ChipBadge status={status} />;
}

export const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

function FieldLabel({ text, htmlFor }: { text: string; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-semibold text-foreground">
      {text}
    </Label>
  );
}

export function Text({
  name,
  label,
  defaultValue,
  required,
  type = "text",
  placeholder,
  autoComplete = "off",
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: "text" | "date" | "number";
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "decimal" | "text";
}) {
  return (
    <div>
      <FieldLabel text={label} htmlFor={name} />
      <Input
        id={name}
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="min-h-11 text-sm"
      />
    </div>
  );
}

const nativeSelectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function Select({
  name,
  label,
  defaultValue,
  options,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div>
      <FieldLabel text={label} htmlFor={name} />
      <select id={name} name={name} defaultValue={defaultValue ?? ""} required={required} className={nativeSelectClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function YesNo({ name, label, value }: { name: string; label: string; value: boolean | null | undefined }) {
  return (
    <Select
      name={name}
      label={label}
      defaultValue={value === true ? "yes" : value === false ? "no" : ""}
      options={[
        { value: "", label: "Not stated" },
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
    />
  );
}

export function Area({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string | null }) {
  return (
    <div>
      <FieldLabel text={label} htmlFor={name} />
      <Textarea id={name} name={name} defaultValue={defaultValue ?? ""} rows={2} className="min-h-11 resize-y text-sm" />
    </div>
  );
}

export function Submit({ children, secondary }: { children: React.ReactNode; secondary?: boolean }) {
  return (
    <Button type="submit" variant={secondary ? "outline" : "accent"} size="lg" className="min-h-11 px-[18px]">
      {children}
    </Button>
  );
}

export function DangerButton({ children, confirmMessage }: { children: React.ReactNode; confirmMessage: string }) {
  return (
    <ConfirmSubmitButton
      confirmMessage={confirmMessage}
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-destructive/30 bg-card px-3.5 text-[13px] font-semibold text-destructive",
        "hover:bg-destructive/10",
      )}
    >
      {children}
    </ConfirmSubmitButton>
  );
}

export function FileUpload({ label, required = true }: { label: string; required?: boolean }) {
  return (
    <input
      type="file"
      name="file"
      required={required}
      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
      aria-label={label}
      className="max-w-full text-xs text-foreground"
    />
  );
}

export function Disclosure({ summary, open, id, children }: { summary: string; open?: boolean; id?: string; children: React.ReactNode }) {
  return (
    <details id={id} open={open} className="mt-2.5">
      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-accent">{summary}</summary>
      <div className="pt-2.5">{children}</div>
    </details>
  );
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
