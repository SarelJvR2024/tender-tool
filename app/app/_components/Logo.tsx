// The Tender Tool mark: a checked document, not a generic AI-startup
// gradient blob. A rounded page (contents list suggested by three short
// lines) with a bold amber checkmark breaking the page's top-right corner -
// "this page has been checked" is the entire product promise in one shape.
// Direction decided in Personas-Branding-Research-2026-10-18.md (concept #2).
// Deliberately NOT: motion lines, gradients, neural-net dots, sparkles -
// those would contradict the "complete, correct, yours - not fast, not AI"
// positioning this mark exists to carry.
// "light" is the same mark, redrawn for a dark (navy) background: a
// translucent page with cream strokes instead of navy-on-white. Needed
// anywhere the mark sits on a navy panel (the /tools header bar, the new
// auth-page hero panel) - flagged as a gap when the default mark first
// shipped (PR #6) and filled in now that there's a second real use for it.
export function Logo({ size = 40, variant = "default" }: { size?: number; variant?: "default" | "light" }) {
  const light = variant === "light";
  const stroke = light ? "#FFFFFF" : "#16233B";
  const fill = light ? "rgba(246, 245, 241, 0.08)" : "#FFFFFF";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Tender Tool"
    >
      <rect x="7" y="5" width="22" height="30" rx="4" fill={fill} stroke={stroke} strokeWidth="2.2" />
      <line x1="12" y1="15" x2="23" y2="15" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="20" x2="23" y2="20" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="25" x2="19" y2="25" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M20 11 L25.5 16.5 L35.5 4.5"
        stroke="#D97706"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
