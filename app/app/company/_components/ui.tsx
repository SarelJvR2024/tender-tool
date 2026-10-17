// Small shared building blocks for the Company sub-pages (0050: principals,
// registrations, properties, bank accounts). Civic Navy, inline styles only -
// the same values app/app/company/page.tsx uses.
import type { StatusChip } from "@/lib/dates";
import { SiteNav } from "../../_components/SiteNav";

export const NAVY = "#16233B";
export const AMBER = "#D97706";
export const CREAM = "#F6F5F1";
export const BORDER = "#E5E1D5";
export const MUTED = "#6B6758";
export const FAINT = "#9A9684";

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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: CREAM }}>
      <SiteNav active="company" />
      <div style={{ flex: 1, padding: "20px 16px 40px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <a href="/company" style={{ fontSize: 13, color: AMBER, fontWeight: 600, textDecoration: "none" }}>
          ← Company profile
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: "8px 0 6px" }}>{title}</h1>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, marginBottom: 16, maxWidth: 720 }}>{intro}</div>
        {saved && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            {saved}
          </div>
        )}
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            Could not save: {error}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Card({ title, id, children }: { title?: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 11, padding: "16px 18px", marginBottom: 14 }}>
      {title && (
        <h2 style={{ fontSize: 13, fontWeight: 600, color: FAINT, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 12px" }}>{title}</h2>
      )}
      {children}
    </div>
  );
}

export function Chip({ status }: { status: StatusChip }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color, whiteSpace: "nowrap" }}>
      {status.label}
    </span>
  );
}

export const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${BORDER}`,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#FFFFFF",
};

function Label({ text, htmlFor }: { text: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: NAVY, marginBottom: 5 }}>
      {text}
    </label>
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
      <Label text={label} />
      <input
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        style={inputStyle}
      />
    </div>
  );
}

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
      <Label text={label} />
      <select name={name} defaultValue={defaultValue ?? ""} required={required} style={inputStyle}>
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
      <Label text={label} />
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
    </div>
  );
}

export function Submit({ children, secondary }: { children: React.ReactNode; secondary?: boolean }) {
  return (
    <button
      type="submit"
      style={{
        minHeight: 44,
        padding: "0 18px",
        borderRadius: 9,
        background: secondary ? "#FFFFFF" : AMBER,
        border: secondary ? `1px solid ${BORDER}` : "none",
        color: secondary ? NAVY : "#FFFFFF",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function DangerButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      style={{ minHeight: 40, padding: "0 14px", borderRadius: 9, background: "#FFFFFF", border: "1px solid #FCA5A5", color: "#B91C1C", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
    >
      {children}
    </button>
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
      style={{ fontSize: 12, color: NAVY, maxWidth: "100%" }}
    />
  );
}

export function Disclosure({ summary, open, id, children }: { summary: string; open?: boolean; id?: string; children: React.ReactNode }) {
  return (
    <details id={id} open={open} style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: AMBER, minHeight: 32, display: "flex", alignItems: "center" }}>{summary}</summary>
      <div style={{ paddingTop: 10 }}>{children}</div>
    </details>
  );
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
