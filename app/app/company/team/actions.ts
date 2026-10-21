"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Team management (0065: company_invites + the employee role). Owner/admin
// only, enforced both here (so a member/employee gets a clear redirect
// instead of a bare RLS error) and by RLS itself (company_invites: admins
// manage their company's invites / tt_is_company_admin on company_members
// writes below) - same belt-and-suspenders pattern as
// app/app/company/bank-accounts/actions.ts.

const BACK = "/company/team";
const ROLES = ["owner", "admin", "member", "employee"];

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

async function requireCompanyAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id, role, user_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  if (membership.role !== "owner" && membership.role !== "admin") fail("Only an owner or admin of the company can manage the team.");
  return { companyId: membership.company_id as string, userId: user.id };
}

export async function createInvite(formData: FormData) {
  const { companyId, userId } = await requireCompanyAdmin();
  const supabase = await createClient();

  const role = str(formData, "role");
  if (!role || !ROLES.includes(role)) fail("Choose a role for this invite.");
  const linkedPersonId = str(formData, "linked_person_id");

  // Billing (0078): a plan's "N people" is a seat cap - count existing
  // members plus already-pending invites (not yet redeemed) against it,
  // same seat-counting logic whatever role is being added.
  const { data: sub } = await supabase.from("company_subscriptions").select("plan_code").eq("company_id", companyId).maybeSingle();
  if (sub?.plan_code) {
    const { data: plan } = await supabase.from("subscription_plans").select("max_users").eq("code", sub.plan_code).maybeSingle();
    if (plan?.max_users !== null && plan?.max_users !== undefined) {
      const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
        supabase.from("company_members").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        supabase.from("company_invites").select("id", { count: "exact", head: true }).eq("company_id", companyId).is("accepted_at", null),
      ]);
      if ((memberCount ?? 0) + (pendingCount ?? 0) >= plan.max_users) {
        fail(`Your plan allows ${plan.max_users} people - upgrade on the Billing page to add more.`);
      }
    }
  }

  const { error } = await supabase.from("company_invites").insert({
    company_id: companyId,
    email: str(formData, "email"),
    role,
    linked_person_id: linkedPersonId,
    invited_by: userId,
  });
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=invited`);
}

export async function revokeInvite(formData: FormData) {
  const { companyId } = await requireCompanyAdmin();
  const supabase = await createClient();
  const inviteId = str(formData, "invite_id");
  if (!inviteId) redirect(BACK);

  const { error } = await supabase
    .from("company_invites")
    .delete()
    .eq("id", inviteId)
    .eq("company_id", companyId)
    .is("accepted_at", null);
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=revoked`);
}

/**
 * Change an existing member's role. Two self-lockout guards, deliberately
 * simple: a user can't change their OWN role (so nobody accidentally
 * demotes themselves out of being able to fix it), and the company must
 * keep at least one 'owner' at all times (checked by counting owners
 * before allowing a change AWAY from 'owner' on the only one).
 */
export async function setMemberRole(formData: FormData) {
  const { companyId, userId } = await requireCompanyAdmin();
  const supabase = await createClient();

  const memberId = str(formData, "member_id"); // company_members.id
  const targetUserId = str(formData, "user_id");
  const newRole = str(formData, "role");
  if (!memberId || !targetUserId || !newRole || !ROLES.includes(newRole)) fail("Choose a valid role.");

  if (targetUserId === userId) fail("You can't change your own role - ask another owner or admin.");

  const { data: current } = await supabase.from("company_members").select("role").eq("id", memberId).eq("company_id", companyId).maybeSingle();
  if (!current) fail("That team member wasn't found.");

  if (current.role === "owner" && newRole !== "owner") {
    const { count } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) fail("The company must always have at least one owner - promote someone else to owner first.");
  }

  const { error } = await supabase.from("company_members").update({ role: newRole }).eq("id", memberId).eq("company_id", companyId);
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=role`);
}

/** Remove a member from the company. Same last-owner protection as above. */
export async function removeMember(formData: FormData) {
  const { companyId, userId } = await requireCompanyAdmin();
  const supabase = await createClient();

  const memberId = str(formData, "member_id");
  const targetUserId = str(formData, "user_id");
  if (!memberId) redirect(BACK);
  if (targetUserId === userId) fail("You can't remove yourself - ask another owner or admin.");

  const { data: current } = await supabase.from("company_members").select("role").eq("id", memberId).eq("company_id", companyId).maybeSingle();
  if (!current) redirect(BACK);

  if (current.role === "owner") {
    const { count } = await supabase
      .from("company_members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) fail("The company must always have at least one owner - promote someone else to owner before removing this one.");
  }

  const { error } = await supabase.from("company_members").delete().eq("id", memberId).eq("company_id", companyId);
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}
