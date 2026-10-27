#!/usr/bin/env node
// Tier 1 - New Discovered Tenders Digest (notification engine migration
// brief, 2026-10-27). Wires discoveredTendersDigestEmail() against what
// .github/workflows/daily-discovery.yml's own Python step
// (engine/discovery/watch_new_tenders.py) already seeds into
// discovered_opportunities every day - that script WRITES but has never
// emailed anyone (confirmed by reading its own module docstring). This is
// the render-and-send half, run as a later step in the SAME workflow, after
// the Python seeding step.
//
// Claim-many -> send-once-per-company -> log-many, same shape
// scripts/send-scout-alerts.ts already established for its own batched
// email, just grouped by company instead of a single admin recipient: each
// opportunity row is claimed individually first (so a specific tender is
// only ever included in one digest, ever, regardless of whether that
// company's send succeeds), then every company with 1+ newly-claimed rows
// gets ONE digest email covering all of them, and one notification_logs row
// is written per (company, tender, recipient) sharing that send's own
// resend_id/status.
//
// Run: node --experimental-strip-types scripts/send-discovered-tenders.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { createClient } from "@supabase/supabase-js";
import { discoveredTendersDigestEmail } from "../lib/emailTemplatesTier1.ts";
import { resendApiKeyConfigured, sendTransactionalEmail } from "../lib/resendEmail.ts";
import { operationalRecipients } from "../lib/notificationRecipients.ts";
import { discoveredTenderIdempotencyKey, toDiscoveredTenderCard, type DiscoveredOpportunityRow } from "../lib/discoveredTendersDigest.ts";
import { fetchAllRows } from "../lib/supabasePaging.ts";
import { parseSenderCliArgs, printDryRunTable, testIdempotencyKey, type DryRunRow } from "../lib/senderCliArgs.ts";

// A busy day's seeding can be large (confirmed live: a single --include-needs-review
// run has produced 6,000+ company x opportunity rows) - PostgREST's own
// hard response cap on this project is 1,000 rows per request regardless of
// .limit() (lib/supabasePaging.ts's own header), so an unpaginated query
// here would silently drop everything past the first 1,000 candidates,
// not error. 20,000 is a generous ceiling, not a measured one - well above
// any observed single-day batch so far.
const MAX_CANDIDATE_ROWS = 20_000;

async function main() {
  const { dryRun, companyId: scopeCompanyId, testRecipient } = parseSenderCliArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  // Bounded to the last 2 days, not the whole table: this script runs daily
  // right after the seeding step, so anything older has already been
  // through every prior run's claim attempt - same reasoning
  // send-corrigendum-alerts.ts's own 14-day window gives for its table.
  const sinceIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient(url, serviceKey);
  const { rows, error } = await fetchAllRows<DiscoveredOpportunityRow>(
    (from, to) => {
      let q = supabase
        .from("discovered_opportunities")
        .select("id, company_id, contract_number, buyer, title, description, etenders_category, categories, closing_date, verdict, created_at")
        .gte("created_at", sinceIso)
        .in("verdict", ["strong_fit", "possible", "needs_review"]);
      // --company-id scopes the query itself, as early as possible - another
      // tenant's data is never even read, let alone claimed or sent to.
      if (scopeCompanyId) q = q.eq("company_id", scopeCompanyId);
      return q.order("id").range(from, to);
    },
    MAX_CANDIDATE_ROWS,
  );
  if (error) {
    console.error("Could not read discovered_opportunities", error);
    process.exit(1);
  }
  const allRows = rows;
  if (allRows.length === 0) {
    console.log("No newly discovered tenders in the last 2 days.");
    return;
  }

  if (!dryRun && !resendApiKeyConfigured()) {
    console.log(`RESEND_API_KEY not set - not sending or claiming any of the ${allRows.length} candidate(s) this run (will retry once a key is added).`);
    return;
  }

  // --dry-run never claims - claiming is a one-time-only token
  // (notification_claims' own unique constraint), and this run must leave
  // every real future send untouched. Every candidate is shown, as if all
  // of them were new.
  let claimed: DiscoveredOpportunityRow[];
  if (dryRun) {
    claimed = allRows;
  } else {
    claimed = [];
    for (const row of allRows) {
      const { data: ok, error: claimError } = await supabase.rpc("claim_notification", {
        p_idempotency_key: discoveredTenderIdempotencyKey(row.id),
        p_notification_type: "discovered_tenders_digest",
      });
      if (claimError) {
        console.error(`claim_notification failed for ${discoveredTenderIdempotencyKey(row.id)}`, claimError);
        continue;
      }
      if (ok) claimed.push(row);
    }
    if (claimed.length === 0) {
      console.log(`Discovered-tenders digest: all ${allRows.length} candidate(s) already claimed by an earlier run, nothing new to send.`);
      return;
    }
  }

  const byCompany = new Map<string, DiscoveredOpportunityRow[]>();
  for (const row of claimed) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push(row);
    byCompany.set(row.company_id, list);
  }

  const dryRunRows: DryRunRow[] = [];
  let companiesSent = 0;
  let skippedNoRecipients = 0;

  for (const [companyId, companyRows] of byCompany) {
    const recipients = await operationalRecipients(supabase, companyId);
    const { data: company } = await supabase.from("companies").select("legal_name").eq("id", companyId).maybeSingle();
    const companyName = company?.legal_name || "your company";

    const { subject, html, text } = discoveredTendersDigestEmail({
      companyName,
      tenders: companyRows.map(toDiscoveredTenderCard),
      appUrl,
    });

    if (dryRun) {
      const shown = companyRows.slice(0, 5).map((r) => r.contract_number || r.id);
      const more = companyRows.length - shown.length;
      dryRunRows.push({
        companyName,
        companyId,
        recipients,
        targetItems: `${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`,
        subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      });
      continue;
    }

    if (recipients.length === 0) {
      skippedNoRecipients++;
      continue;
    }

    // --test-recipient redirects the real "to" address but keeps every
    // other real fact (company, items, subject) - sent to exactly this one
    // override address, never the real resolved recipients, regardless of
    // how many real recipients there are.
    const sendTo = testRecipient ? [testRecipient] : recipients;
    for (const email of sendTo) {
      const result = await sendTransactionalEmail({ to: email, subject, html, text, from: "ops" });
      if (result.status === "sent") companiesSent++;
      else console.log(`  ${result.status} -> ${email} (company ${companyId})`);

      for (const row of companyRows) {
        const realKey = discoveredTenderIdempotencyKey(row.id);
        const { error: logError } = await supabase.rpc("record_notification_sent", {
          // A test-recipient send uses a DIFFERENT key so it never burns
          // the real one-time claim the real recipient still needs later.
          p_idempotency_key: testRecipient ? testIdempotencyKey(realKey) : realKey,
          p_notification_type: "discovered_tenders_digest",
          p_recipient_email: email,
          p_company_id: companyId,
          p_tender_id: null, // discovered_opportunities.id is not a tenders.id - no FK target to log against
          p_subject: subject,
          p_status: result.status,
          p_resend_id: result.status === "sent" ? result.resendId : null,
          p_error: result.status === "failed" ? result.error : null,
        });
        if (logError) console.error(`record_notification_sent failed for discovered_tenders_digest (opportunity ${row.id})`, logError);
      }
    }
  }

  if (dryRun) {
    printDryRunTable("New Discovered Tenders Digest", dryRunRows);
    return;
  }

  console.log(`Discovered-tenders digest: ${claimed.length} tender(s) claimed across ${byCompany.size} company(ies), ${companiesSent} email send attempt(s), ${skippedNoRecipients} company(ies) skipped (no opted-in recipients).`);
}

main();
