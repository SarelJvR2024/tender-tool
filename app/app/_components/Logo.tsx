/**
 * Tender Ready brand assets (2026-10-22 refresh, Sarel's own asset pack:
 * Tender-Ready-Brand-Guide.pdf + Tender-Ready-Brand-Assets.zip) - a blue
 * rounded-square "TR" monogram plus an outlined wordmark, approved
 * production artwork. These render the real vector files from the pack
 * (public/brand/*.svg), not a redrawn approximation, replacing the earlier
 * checked-document concept (Personas-Branding-Research-2026-10-18.md
 * concept #2). See app/AGENTS.md for the change record.
 *
 * The brand guide: "the square stays blue" - the mark itself never changes
 * by surface, only the wordmark's ink does, and the asset pack names its
 * two full-lockup files after the SURFACE they sit on (not the ink colour):
 * logo-light.svg is for a light surface (navy wordmark), logo-dark.svg is
 * for a dark surface (white wordmark) - `surface` below matches that
 * naming directly to avoid inverting it by accident.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/brand/mark.svg" alt="Tender Ready" width={size} height={size} />;
}

// Full lockup's native file is 643x128 (mark + wordmark) - height-driven so
// callers get a correctly proportioned width instead of a stretched image.
const LOCKUP_RATIO = 643 / 128;

export function LogoLockup({ height = 32, surface = "dark" }: { height?: number; surface?: "light" | "dark" }) {
  return (
    <img
      src={surface === "dark" ? "/brand/logo-dark.svg" : "/brand/logo-light.svg"}
      alt="Tender Ready"
      width={Math.round(height * LOCKUP_RATIO)}
      height={height}
    />
  );
}
