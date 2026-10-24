import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * One-click Tier 0 (onboarding/lifecycle) unsubscribe - RFC 8058. No
 * Supabase session exists here by design (a mail client POSTs this
 * automatically, with zero user interaction, when it supports
 * List-Unsubscribe-Post - exactly the same "no session, possession of an
 * unguessable bearer token is the authorization" shape as
 * app/api/billing/payfast/itn's own route). The real work goes through
 * unsubscribe_lifecycle_email(), a narrow SECURITY DEFINER function
 * (migration 0093), never a direct table write.
 *
 * Both verbs do the same thing:
 *   - POST: the RFC 8058 one-click path. Mail clients (Gmail, Apple Mail,
 *     Outlook) call this automatically from the List-Unsubscribe-Post
 *     header - must respond fast, with no redirect and no page, and must
 *     NOT require the body `List-Unsubscribe=One-Click` to be re-validated
 *     beyond what the mail client already sent (RFC 8058 section 3.1).
 *   - GET: a human clicking the visible "Unsubscribe" link in the email
 *     body in a browser - same effect, but returns a small confirmation
 *     page since a person, not a mail client, is looking at it.
 *
 * Always responds 200 for a well-formed request, token valid or not - an
 * invalid/expired token is a dead link, not an error a sender or a mail
 * client should ever see surfaced as a failure.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Missing token", { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("unsubscribe_lifecycle_email", { p_token: token });
  if (error) {
    console.error("unsubscribe_lifecycle_email rpc failed", error);
    return new NextResponse("Could not process - try again shortly.", { status: 500 });
  }
  return new NextResponse("OK", { status: 200 });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Missing token", { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("unsubscribe_lifecycle_email", { p_token: token });
  if (error) console.error("unsubscribe_lifecycle_email rpc failed", error);

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Unsubscribed - Tender Ready</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#F4F5F7;margin:0;padding:48px 16px;">
    <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border:1px solid #DDE0E3;border-radius:12px;padding:32px;text-align:center;">
      <p style="font-size:16px;font-weight:700;color:#0B1F3A;margin:0 0 8px;">You're unsubscribed</p>
      <p style="font-size:13px;color:#5C6374;margin:0;">You won't receive onboarding or lifecycle emails from Tender Ready any more. Operational tender alerts and compliance notices for your company are unaffected.</p>
    </div>
  </body>
</html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
