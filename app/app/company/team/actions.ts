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
  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id, role, user_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");
  if (membership.role !== "owner" && membership.role !== "admin") fail("Only an owner or admin of the company can manage the team.");
  return { companyId: membership.company_id as string, userId: user.id };
}

export async function createInvite(formData: FormData) {
  const { companyId } = await requireCompanyAdmin();
  const supabase = await createClient();

  const role = str(formData, "role");
  if (!role || !ROLES.includes(role)) fail("Choose a role for this invite.");
  const linkedPersonId = str(formData, "linked_person_id");

  // Billing (0083): a plan's "N people" is a seat cap - checked and
  // inserted in one locked SQL transaction (create_company_invite_checked,
  // 0113), not as separate select-count-then-insert client queries, so two
  // concurrent invites for this company can't both slip past the cap.
  const { error } = await supabase.rpc("create_company_invite_checked", {
    p_company_id: companyId,
    p_email: str(formData, "email"),
    p_role: role,
    p_linked_person_id: linkedPersonId,
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

  // .select("id").maybeSingle() matters here exactly as it does on every
  // sibling plain delete already fixed in this bug class (officeActions.ts's
  // deleteCompanyOffice(), comment-actions.ts's deleteTenderComment(), etc.):
  // "company_invites: admins manage their company's invites" (0077) is
  // `using (tt_is_company_admin(company_id))` - USING-only, re-evaluated
  // against the row at delete time. If this caller's own admin/owner role is
  // revoked (another admin's concurrent removeMember()/setMemberRole() call)
  // between requireCompanyAdmin()'s read above and this delete,
  // tt_is_company_admin() re-evaluates false and the delete matches zero
  // rows - a 2xx with error: null, indistinguishable from a real revoke by
  // `error` alone. The same silent no-op is also reachable without any race
  // on the admin's OWN role: the `.is("accepted_at", null)` guard means a
  // concurrently-accepted invite (acceptInvite(), app/invite/actions.ts)
  // also matches zero rows here. Either way, pre-fix this still redirected
  // `saved=revoked`, telling the admin the invite was gone when it was not -
  // it would silently reappear in the pending-invites list on refresh.
  const { data: deleted, error } = await supabase
    .from("company_invites")
    .delete()
    .eq("id", inviteId)
    .eq("company_id", companyId)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();
  if (error) fail(error.message);
  if (!deleted) fail("That invite is no longer pending - it may have already been accepted or revoked. Refresh and try again.");

  revalidatePath(BACK);
  redirect(`${BACK}?saved=revoked`);
}

/**
 * Change an existing member's role. Two self-lockout guards - a user can't
 * change their OWN role, and the company must keep at least one 'owner' at
 * all times - plus the seat-cap-style TOCTOU race those checks had (found
 * 2026-11-04: two concurrent demotions of two different owners could both
 * pass the "count > 1" check before either committed, leaving zero owners)
 * are all enforced in one locked SQL transaction now
 * (set_member_role_checked, 0114), not as separate select-check-then-update
 * client queries - same fix shape as createInvite()'s own seat-cap race
 * (0113).
 */
export async function setMemberRole(formData: FormData) {
  await requireCompanyAdmin();
  const supabase = await createClient();

  const memberId = str(formData, "member_id"); // company_members.id
  const targetUserId = str(formData, "user_id");
  const newRole = str(formData, "role");
  if (!memberId || !targetUserId || !newRole || !ROLES.includes(newRole)) fail("Choose a valid role.");

  const { error } = await supabase.rpc("set_member_role_checked", {
    p_member_id: memberId,
    p_target_user_id: targetUserId,
    p_new_role: newRole,
  });
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=role`);
}

/**
 * Remove a member from the company. Same last-owner protection and race
 * fix as setMemberRole() above (remove_member_checked, 0114).
 */
export async function removeMember(formData: FormData) {
  await requireCompanyAdmin();
  const supabase = await createClient();

  const memberId = str(formData, "member_id");
  const targetUserId = str(formData, "user_id");
  if (!memberId || !targetUserId) redirect(BACK);

  const { error } = await supabase.rpc("remove_member_checked", {
    p_member_id: memberId,
    p_target_user_id: targetUserId,
  });
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?saved=removed`);
}
