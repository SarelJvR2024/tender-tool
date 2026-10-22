import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Shared field wrapper - label + input + optional helper text, used by Screen 1. */
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

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</p>;
}
