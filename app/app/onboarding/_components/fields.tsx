import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Shared field wrapper - label + input + optional helper text, used across every wizard step. */
export function Field({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  type = "text",
  step,
  helper,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  type?: string;
  step?: string;
  helper?: string;
}) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1.5">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="h-11"
      />
      {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

const selectClassName =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Native <select>, styled to match Input - this design system has no shadcn Select yet (the rest of the app uses plain <select> too, e.g. OfficeFields). */
export function SelectField({
  name,
  label,
  defaultValue,
  required,
  options,
  placeholder = "Choose...",
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  required?: boolean;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name} className="mb-1.5">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      <select id={name} name={name} required={required} defaultValue={defaultValue ?? ""} className={cn(selectClassName)}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A field that exists in the schema but has no manual-edit action yet, or whose data isn't tracked at all - shown, never hidden, so the step's shape stays honest about what's coming. */
export function ComingSoonField({ label, note }: { label: string; note: string }) {
  return (
    <div>
      <Label className="mb-1.5 text-muted-foreground">{label}</Label>
      <Input disabled placeholder="Coming soon" className="h-11" />
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</p>;
}
