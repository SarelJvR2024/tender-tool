// A single shared filename sanitizer for every upload path in this app.
// Previously duplicated byte-for-byte in app/lib/onboardingScan.ts and
// app/lib/manualTender.ts (both re-export this for their own existing
// importers, unchanged). A standing-review sweep (2026-11-03) grepped every
// upload action file left in the app and found exactly one straggler still
// hand-rolling its own narrower inline version (app/app/my-cv/actions.ts:
// `replace(/[^a-zA-Z0-9._-]/g, "_")`, no length cap, no space/parenthesis
// allowance) instead of importing this - confirmed not exploitable even
// there (both forms already strip "/"), now switched over to this shared
// function so there is exactly one place left to fix if that ever changes.
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ ()-]/g, "_").slice(0, 120) || "document";
}
