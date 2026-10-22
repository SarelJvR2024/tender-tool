import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createInvite, revokeInvite, setMemberRole, removeMember } from "./actions";
import { Card, DangerButton, Select, SubPage, Submit, Text, fmtDate } from "../_components/ui";

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
          <div className="text-[13px] text-muted-foreground">No members yet.</div>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2.5 border-b border-border py-2.5">
              <div className="text-[13px] text-foreground">
                {labelByUser.get(m.user_id) ?? "A team member"}
                {m.user_id === user?.id && <span className="text-muted-foreground"> (you)</span>}
              </div>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <form action={setMemberRole} className="flex items-center gap-1.5">
                    <input type="hidden" name="member_id" value={m.id} />
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select name="role" defaultValue={m.role} disabled={m.user_id === user?.id} className="min-h-9 rounded-md border border-border px-1.5 text-[12.5px]">
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
                <span className="text-xs text-muted-foreground">{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</span>
              )}
            </div>
          ))
        )}
        {ownerCount <= 1 && <div className="mt-2.5 text-[11.5px] text-muted-foreground">The company always keeps at least one owner.</div>}
      </Card>

      {isAdmin && (
        <>
          <Card title="Pending invites">
            {invites.length === 0 ? (
              <div className="text-[13px] text-muted-foreground">No pending invites.</div>
            ) : (
              invites.map((inv) => {
                const link = `${origin}/invite/${inv.token}`;
                return (
                  <div key={inv.id} className="border-b border-border py-2.5">
                    <div className="text-[13px] font-semibold text-foreground">
                      {ROLES.find((r) => r.value === inv.role)?.label ?? inv.role}
                      {inv.email ? ` - ${inv.email}` : ""}
                      {personName(inv.linked_person_id) ? ` - for ${personName(inv.linked_person_id)}` : ""}
                    </div>
                    <div className="my-0.5 text-[11.5px] text-muted-foreground">
                      Created {fmtDate(inv.created_at)} - expires {fmtDate(inv.expires_at)}
                    </div>
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full rounded-md border border-border bg-muted px-2.5 py-[7px] font-mono text-[12.5px] text-foreground"
                    />
                    <div className="mt-2">
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
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <Text name="email" label="Email (your own reference - not sent anywhere)" type="text" />
                <Select name="role" label="Role" defaultValue="member" options={ROLES} required />
                <Select
                  name="linked_person_id"
                  label="Link to an existing person (optional)"
                  defaultValue=""
                  options={[{ value: "", label: "No - a new team member" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                />
              </div>
              <div className="mt-3">
                <Submit>Create invite link</Submit>
              </div>
            </form>
          </Card>
        </>
      )}
    </SubPage>
  );
}
