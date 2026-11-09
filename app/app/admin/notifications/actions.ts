"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EMAIL_TEMPLATE_SAMPLES, TIER_TO_SENDER_PROFILE } from "@/lib/emailTemplateSamples";
import { sendTransactionalEmail } from "@/lib/resendEmail";

/**
 * Template Gallery's "Send Test to Me" button. Renders the given
 * template's own realistic sample data (never real company/tender rows -
 * this never queries anything beyond the signed-in admin's own email) and
 * sends it to the current platform admin's own inbox, logged through the
 * same claim_notification/record_notification_sent RPCs every real sender
 * uses (migration 0093, already granted to `authenticated`) so it shows up
 * in the dispatch log below for inspection - under a `test-sample-`
 * idempotency key that can never collide with a real send's own key.
 *
 * Platform-admin check added here (standing review, 2026-11-09, Finding
 * 274): unlike every other /admin/ Server Action (admin/actions.ts's RLS-
 * enforced-update-then-zero-row-check, the SECURITY DEFINER RPCs every
 * other admin action here calls, or admin/taxonomy/actions.ts's own
 * explicit requireAdmin()), this action had NO is_platform_admin() check
 * anywhere in its call chain - claim_notification()/record_notification_sent()
 * (migration 0093) are deliberately granted to any authenticated (even anon)
 * caller for real notification flows like the welcome email, so they are not
 * a backstop here. /admin/layout.tsx's own is_platform_admin() gate only
 * covers page renders, not a Server Action reached by direct POST (the exact
 * reasoning that comment, and every sibling action file, already states) -
 * so any signed-in, non-admin company user could reach this action directly
 * and make the app send a real outbound email via Resend. Confirmed live in
 * actions.spec.ts: pre-fix, a mocked non-admin session reached `sent=...`
 * and the Resend mock was actually called; checked here now, same as every
 * sibling action.
 */
export async function sendTestNotificationEmail(formData: FormData) {
  const templateKey = String(formData.get("template_key") ?? "");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_platform_admin");
  if (adminCheckError) console.error("is_platform_admin rpc failed", adminCheckError);
  if (!isAdmin) {
    redirect(`/admin/notifications?error=${encodeURIComponent("Only a Tender Ready platform admin can send test notification emails.")}&tab=gallery`);
  }

  const sample = EMAIL_TEMPLATE_SAMPLES.find((s) => s.key === templateKey);
  if (!sample) {
    redirect(`/admin/notifications?error=${encodeURIComponent("Unknown template.")}&tab=gallery`);
  }

  const email = sample.render();
  const profile = TIER_TO_SENDER_PROFILE[sample.tier] ?? "system";
  const result = await sendTransactionalEmail({ to: user.email, subject: `[TEST] ${email.subject}`, html: email.html, text: email.text, from: profile });

  const idempotencyKey = `test-sample-${sample.key}-${Date.now()}`;
  const { data: claimed } = await supabase.rpc("claim_notification", { p_idempotency_key: idempotencyKey, p_notification_type: sample.key });
  if (claimed) {
    await supabase.rpc("record_notification_sent", {
      p_idempotency_key: idempotencyKey,
      p_notification_type: sample.key,
      p_recipient_email: user.email,
      p_company_id: null,
      p_tender_id: null,
      p_subject: `[TEST] ${email.subject}`,
      p_status: result.status,
      p_resend_id: result.status === "sent" ? result.resendId : null,
      p_error: result.status === "failed" ? result.error : null,
    });
  }

  if (result.status === "failed") {
    redirect(`/admin/notifications?error=${encodeURIComponent(`Resend rejected the test send: ${result.error}`)}&tab=gallery`);
  }
  if (result.status === "skipped_no_api_key") {
    redirect(`/admin/notifications?error=${encodeURIComponent("RESEND_API_KEY isn't set in this environment - nothing was sent.")}&tab=gallery`);
  }
  redirect(`/admin/notifications?sent=${encodeURIComponent(sample.label)}&tab=gallery`);
}
