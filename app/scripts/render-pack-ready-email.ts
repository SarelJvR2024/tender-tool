#!/usr/bin/env node
// Render-only bridge for packReadyEmail() (lib/emailTemplatesTier1.ts) -
// invoked by engine/notify/send_pack_ready_email.py over a subprocess,
// since the pack-compilation job that triggers this email runs in Python
// (engine/general/process_general_jobs.py), not this Next.js app. Python
// owns sending (Resend's HTTP API directly, per Sarel's own 2026-10-27
// decision - instant delivery, no extra hop through a scheduled script) and
// the notification_claims/notification_logs dedup+audit write; this script
// ONLY renders, so the one canonical branded template stays in TypeScript
// and is never duplicated as a second, driftable HTML string in Python.
//
// Contract: one JSON object as argv[2], the exact shape of packReadyEmail's
// own opts (see that function's signature) - printed back as
// {"subject", "html", "text"} JSON on stdout. Any error (bad JSON, missing
// field) exits 1 with a message on stderr and nothing on stdout, so the
// Python caller can tell a real render failure apart from a malformed
// response.
//
// Run: node --experimental-strip-types scripts/render-pack-ready-email.ts '<json>'
import { packReadyEmail } from "../lib/emailTemplatesTier1.ts";

function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: render-pack-ready-email.ts '<json opts>'");
    process.exit(1);
  }
  let opts: Parameters<typeof packReadyEmail>[0];
  try {
    opts = JSON.parse(raw);
  } catch (e) {
    console.error(`Could not parse argv[2] as JSON: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  try {
    const email = packReadyEmail(opts);
    process.stdout.write(JSON.stringify(email));
  } catch (e) {
    console.error(`packReadyEmail() threw: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

main();
