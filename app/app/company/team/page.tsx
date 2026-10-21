import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createInvite, revokeInvite, setMemberRole, removeMember } from "./actions";
import { Card, DangerButton, MUTED, NAVY, Select, SubPage, Submit, Text, fmtDate } from "../_components/ui";

export const instant = false;

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "employee", label: "Employee (restricted - own CV only)" },
];

const SAVED: Record<string, string> = {
  invited: "Invite created - copy its link below and send it to them.",
  revoked: "Invite revoked.",
  role: "Role updated.",
  removed: "Removed from the team.",
};

type Member = { id: string; user_id: string; role: string };
type Invite = { id: string; email: string | null; role: string; token: string; created_at: string; expires_at: string; linked_person_id: string | null };
type Person = { id: string; name: string };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: membership } = await supabase.from("company_members").select("company_id, role").eq("user_id", user?.id ?? "").maybeSingle();
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  const companyId = membership?.company_id as string | undefined;

  const [{ data: memberRows }, { data: inviteRows }, { data: personRows }, { data: labels }] = await Promise.all([
    companyId ? supabase.from("company_members").select("id, user_id, role").eq("company_id", companyId).order("created_at") : Promise.resolve({ data: [] }),
    isAdmin && companyId
      ? supabase.from("company_invites").select("id, email, role, token, created_at, expires_at, linked_person_id").eq("company_id", companyId).is("accepted_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    isAdmin && companyId ? supabase.from("people").select("id, name").eq("company_id", companyId).order("name") : Promise.resolve({ data: [] }),
    isAdmin ? supabase.rpc("company_member_labels") : Promise.resolve({ data: [] }),
  ]);

  const members = (memberRows ?? []) as Member[];
  const invites = (inviteRows ?? []) as Invite[];
  const people = (personRows ?? []) as Person[];
  const labelByUser = new Map(((labels ?? []) as { user_id: string; label: string }[]).map((l) => [l.user_id, l.label]));
  const personName = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "that person" : null);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";

  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <SubPage
      title="Team"
      intro={
        <>
          Add teammates and set what they can see. Owners and admins run the company&apos;s tenders and people records. Members do the
          day-to-day work. <strong>Employee</strong> is restricted - that person can only view and update their own CV, qualifications
          and documents; they can&apos;t see other people&apos;s records, tenders, pricing or bank details.
        </>
      }
      error={error}
      saved={saved ? SAVED[saved] ?? null : null}
    >
      <Card title="Current team">
        {members.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>No members yet.</div>
        ) : (
          members.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid #F0EEE6" }}>
              <div style={{ fontSize: 13, color: NAVY }}>
                {labelByUser.get(m.user_id) ?? "A team member"}
                {m.user_id === user?.id && <span style={{ color: MUTED }}> (you)</span>}
              </div>
              {isAdmin ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <form action={setMemberRole} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select name="role" defaultValue={m.role} disabled={m.user_id === user?.id} style={{ minHeight: 36, borderRadius: 7, border: "1px solid #E5E1D5", fontSize: 12.5, padding: "0 6px" }}>
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    {m.user_id !== user?.id && <Submit secondary>Save</Submit>}
                  </form>
                  {m.user_id !== user?.id && (
                    <form action={removeMember}>
                      <input type="hidden" name="member_id" value={m.id} />
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <DangerButton confirmMessage="Remove this person from the company?">Remove</DangerButton>
                    </form>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: MUTED }}>{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</span>
              )}
            </div>
          ))
        )}
        {ownerCount <= 1 && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10 }}>The company always keeps at least one owner.</div>}
      </Card>

      {isAdmin && (
        <>
          <Card title="Pending invites">
            {invites.length === 0 ? (
              <div style={{ fontSize: 13, color: MUTED }}>No pending invites.</div>
            ) : (
              invites.map((inv) => {
                const link = `${origin}/invite/${inv.token}`;
                return (
                  <div key={inv.id} style={{ padding: "10px 0", borderBottom: "1px solid #F0EEE6" }}>
                    <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>
                      {ROLES.find((r) => r.value === inv.role)?.label ?? inv.role}
                      {inv.email ? ` - ${inv.email}` : ""}
                      {personName(inv.linked_person_id) ? ` - for ${personName(inv.linked_person_id)}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: MUTED, margin: "2px 0 6px" }}>
                      Created {fmtDate(inv.created_at)} - expires {fmtDate(inv.expires_at)}
                    </div>
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                      style={{ width: "100%", boxSizing: "border-box", minHeight: 38, padding: "7px 10px", borderRadius: 7, border: "1px solid #E5E1D5", fontSize: 12.5, fontFamily: "monospace", background: "#F6F5F1", color: NAVY }}
                    />
                    <div style={{ marginTop: 8 }}>
                      <form action={revokeInvite}>
                        <input type="hidden" name="invite_id" value={inv.id} />
                        <DangerButton confirmMessage="Revoke this invite? The link will stop working.">Revoke</DangerButton>
                      </form>
                    </div>
                  </div>
                );
              })
            )}
          </Card>

          <Card title="Invite someone">
            <form action={createInvite} autoComplete="off">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <Text name="email" label="Email (your own reference - not sent anywhere)" type="text" />
                <Select name="role" label="Role" defaultValue="member" options={ROLES} required />
                <Select
                  name="linked_person_id"
                  label="Link to an existing person (optional)"
                  defaultValue=""
                  options={[{ value: "", label: "No - a new team member" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
              <div style={{ marginTop: 12 }}>
                <Submit>Create invite link</Submit>
              </div>
            </form>
          </Card>
        </>
      )}
    </SubPage>
  );
}
