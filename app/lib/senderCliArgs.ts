// Shared CLI flags for every standalone notification sender script
// (scripts/send-*.ts), added 2026-10-27 at Sarel's own explicit requirement:
// "under no circumstances do we send unverified test runs to real
// companies." Three flags, used together or alone:
//
//   --dry-run              Run every real query and recipient resolution,
//                          render the real template, but make NO Supabase
//                          write (no claim_notification, no
//                          record_notification_sent) and NO Resend call.
//                          Always wins over --test-recipient if both are
//                          somehow passed - a dry run never sends, full stop.
//   --company-id <id>      Scope the ENTIRE run to one company - applied as
//                          early as possible (the first query), so another
//                          tenant's data is never even read, let alone
//                          claimed or sent to.
//   --test-recipient <email>
//                          Redirect the actual "to" address to this one
//                          email instead of each company's real resolved
//                          recipients - for a safe live send of real data
//                          to a known test inbox. Doing this safely still
//                          needs a DIFFERENT idempotency key than the real
//                          send would use (see testIdempotencyKey() below) -
//                          using the real key here would permanently burn
//                          that one-time claim, and the real recipient
//                          would never get the real notification later.
export type SenderCliArgs = {
  dryRun: boolean;
  companyId: string | null;
  testRecipient: string | null;
};

/** --test-recipient without --company-id would redirect the SEND address but still touch every real company with a real candidate right now - not the one-company-only test Sarel asked for. Exits the process rather than returning a half-safe config. */
export function parseSenderCliArgs(argv: string[]): SenderCliArgs {
  const flagValue = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const args = {
    dryRun: argv.includes("--dry-run"),
    companyId: flagValue("--company-id"),
    testRecipient: flagValue("--test-recipient"),
  };
  if (args.testRecipient && !args.companyId && !args.dryRun) {
    console.error("--test-recipient requires --company-id too (scope the real send to one company only) - refusing to run against every company's real data.");
    process.exit(1);
  }
  return args;
}

/** A test-recipient send uses a DIFFERENT idempotency key than the real one, so it never consumes the one-time claim a real future send to the real recipient still needs. */
export function testIdempotencyKey(realKey: string): string {
  return `test-${realKey}`;
}

export type DryRunRow = {
  companyName: string;
  companyId: string;
  recipients: string[];
  targetItems: string;
  subject: string;
  // "Skipped (no opted-in recipients)" is specific to the opt-in-gated
  // senders (discovered-tenders digest); "Skipped (no recipients)" is the
  // critical-alert senders (corrigenda/returnables/deadline reminders,
  // 2026-10-30) which bypass that flag entirely - no company_members row at
  // all is the only way they skip.
  status: "Simulated OK" | "No candidates" | "Skipped (no opted-in recipients)" | "Skipped (no recipients)";
};

/** One consistent table format across all 4 sender scripts, per Sarel's own requested columns. */
export function printDryRunTable(scriptLabel: string, rows: DryRunRow[]): void {
  console.log(`\n=== DRY RUN: ${scriptLabel} ===`);
  if (rows.length === 0) {
    console.log("No candidates found - nothing would be sent.");
    return;
  }
  for (const row of rows) {
    console.log(`\nCompany: ${row.companyName} (${row.companyId})`);
    console.log(`  Recipients: ${row.recipients.length > 0 ? row.recipients.join(", ") : "(none - would be skipped)"}`);
    console.log(`  Target items: ${row.targetItems}`);
    console.log(`  Subject: ${row.subject}`);
    console.log(`  Status: ${row.status}`);
  }
  console.log(`\n${rows.length} candidate compan${rows.length === 1 ? "y" : "ies"} - nothing was sent, nothing was claimed. Re-runnable.`);
}
