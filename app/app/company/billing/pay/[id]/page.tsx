import { createClient } from "@/lib/supabase/server";
import { buildCheckoutForm, formatAmount, getPayfastConfig } from "@/lib/payfast";
import { baseUrl } from "../../actions";
import { AutoSubmitForm } from "../AutoSubmitForm";
import { NAVY, MUTED } from "../../../_components/ui";
import { notFound } from "next/navigation";

export const instant = false;

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
};

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: checkout } = await supabase
    .from("payfast_checkouts")
    .select("m_payment_id, company_id, plan_code, billing_cycle, expected_amount_zar, resolved_at")
    .eq("m_payment_id", id)
    .maybeSingle();
  if (!checkout) notFound();

  const config = getPayfastConfig();
  const origin = await baseUrl();
  const planName = PLAN_NAMES[checkout.plan_code] ?? checkout.plan_code;

  const { actionUrl, fields } = buildCheckoutForm(
    {
      merchant_id: config.merchantId,
      merchant_key: config.merchantKey,
      return_url: `${origin}/company/billing?success=1`,
      cancel_url: `${origin}/company/billing?cancelled=1`,
      notify_url: `${origin}/api/payfast/itn`,
      name_first: (user.user_metadata?.full_name as string | undefined) ?? undefined,
      email_address: user.email,
      m_payment_id: checkout.m_payment_id,
      amount: formatAmount(checkout.expected_amount_zar),
      item_name: `Tender Ready - ${planName} (${checkout.billing_cycle})`,
    },
    config
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: NAVY, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Taking you to PayFast…</p>
        <p style={{ color: MUTED, fontSize: 13 }}>Don&apos;t close this page.</p>
        <AutoSubmitForm actionUrl={actionUrl} fields={fields} />
      </div>
    </div>
  );
}
