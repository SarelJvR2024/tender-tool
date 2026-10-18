// The Tender Tool mark: a checked document, not a generic AI-startup
// gradient blob. A rounded page (contents list suggested by three short
// lines) with a bold amber checkmark breaking the page's top-right corner -
// "this page has been checked" is the entire product promise in one shape.
// Direction decided in Personas-Branding-Research-2026-10-18.md (concept #2).
// Deliberately NOT: motion lines, gradients, neural-net dots, sparkles -
// those would contradict the "complete, correct, yours - not fast, not AI"
// positioning this mark exists to carry.
export function Logo({ size = 40 }: { size?: number }) {
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
      <rect x="7" y="5" width="22" height="30" rx="4" fill="#FFFFFF" stroke="#16233B" strokeWidth="2.2" />
      <line x1="12" y1="15" x2="23" y2="15" stroke="#16233B" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="20" x2="23" y2="20" stroke="#16233B" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="25" x2="19" y2="25" stroke="#16233B" strokeWidth="1.6" strokeLinecap="round" />
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
