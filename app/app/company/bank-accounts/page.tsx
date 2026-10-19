import { createClient } from "@/lib/supabase/server";
import { deleteBankAccount, saveBankAccount } from "./actions";
import { Card, DangerButton, Disclosure, MUTED, NAVY, Select, SubPage, Submit, Text, fmtDate, grid } from "../_components/ui";

export const instant = false;

type Account = {
  id: string;
  principal_id: string | null;
  bank_name: string;
  branch_name: string | null;
  branch_code: string | null;
  account_holder: string;
  account_type: string | null;
  account_number: string;
  opened_on: string | null;
};

const TYPES = [
  { value: "", label: "Not recorded" },
  { value: "cheque", label: "Cheque" },
  { value: "current", label: "Current / business" },
  { value: "savings", label: "Savings" },
  { value: "transmission", label: "Transmission" },
  { value: "other", label: "Other" },
];

const SAVED: Record<string, string> = { "1": "Bank account saved.", removed: "Bank account removed." };

export default async function BankAccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase.from("company_members").select("company_id, role").eq("user_id", user?.id ?? "").maybeSingle();
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";

  // RLS returns rows only to owners/admins; members get the masked summary.
  const [{ data: accountRows }, { data: summaries }, { data: principals }] = await Promise.all([
    supabase.from("bank_accounts").select("id, principal_id, bank_name, branch_name, branch_code, account_holder, account_type, account_number, opened_on"),
    membership ? supabase.rpc("bank_account_summaries", { p_company: membership.company_id }) : Promise.resolve({ data: [] }),
    supabase.from("company_principals").select("id, full_name, holder_type").eq("holder_type", "natural_person").order("full_name"),
  ]);
  const accounts = (accountRows ?? []) as Account[];
  const people = (principals ?? []) as { id: string; full_name: string }[];
  const nameOf = (pid: string | null) => (pid ? people.find((p) => p.id === pid)?.full_name ?? "Director" : "The company");

  return (
    <SubPage
      title="Bank accounts"
      intro={
        <>
          The company&apos;s own account and, where a tender asks, a director&apos;s. Account numbers are the most fraud-sensitive
          detail Tender Tool holds: only owners and admins of your company can see or change them, other members see the last four
          digits, and generated documents still print &quot;WITHHELD&quot; - the number is copied onto a buyer&apos;s form by hand.
        </>
      }
      error={error}
      saved={saved ? SAVED[saved] ?? null : null}
    >
      {!isAdmin ? (
        <Card title="On file">
          {((summaries ?? []) as { id: string; principal_id: string | null; bank_name: string; account_holder: string; last4: string }[]).length === 0 ? (
            <div style={{ fontSize: 13, color: MUTED }}>No bank accounts on file.</div>
          ) : (
            ((summaries ?? []) as { id: string; principal_id: string | null; bank_name: string; account_holder: string; last4: string }[]).map((s) => (
              <div key={s.id} style={{ fontSize: 13, color: NAVY, padding: "6px 0" }}>
                {nameOf(s.principal_id)}: {s.bank_name}, {s.account_holder} ••••{s.last4}
              </div>
            ))
          )}
          <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>Ask an owner or admin of your company to add or change an account.</div>
        </Card>
      ) : (
        <>
          {accounts.map((a) => (
            <Card key={a.id}>
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{nameOf(a.principal_id)}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                {a.bank_name}
                {a.branch_name ? `, ${a.branch_name}` : ""}
                {a.branch_code ? ` (${a.branch_code})` : ""} · {a.account_holder} · ••••{a.account_number.slice(-4)}
                {a.account_type ? ` · ${a.account_type}` : ""}
                {a.opened_on ? ` · opened ${fmtDate(a.opened_on)}` : ""}
              </div>
              <Disclosure summary="Show full account number">
                <div style={{ fontSize: 14, color: NAVY, fontWeight: 600, letterSpacing: "0.05em" }}>{a.account_number}</div>
              </Disclosure>
              <Disclosure summary="Edit">
                <AccountForm a={a} principals={people} />
                <form action={deleteBankAccount} style={{ marginTop: 10 }}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <DangerButton confirmMessage="Remove this bank account? This can't be undone.">Remove this account</DangerButton>
                </form>
              </Disclosure>
            </Card>
          ))}
          <Card title="Add a bank account">
            <AccountForm principals={people} />
          </Card>
        </>
      )}
    </SubPage>
  );
}

function AccountForm({ a, principals }: { a?: Account; principals: { id: string; full_name: string }[] }) {
  return (
    <form action={saveBankAccount} autoComplete="off">
      {a && <input type="hidden" name="account_id" value={a.id} />}
      <div style={grid}>
        <Select
          name="principal_id"
          label="Whose account"
          defaultValue={a?.principal_id ?? ""}
          options={[{ value: "", label: "The company" }, ...principals.map((p) => ({ value: p.id, label: p.full_name }))]}
        />
        <Text name="bank_name" label="Bank" defaultValue={a?.bank_name} required />
        <Text name="branch_name" label="Branch name" defaultValue={a?.branch_name} />
        <Text name="branch_code" label="Branch code" defaultValue={a?.branch_code} inputMode="numeric" />
        <Text name="account_holder" label="Account holder (as the bank has it)" defaultValue={a?.account_holder} required />
        <Select name="account_type" label="Account type" defaultValue={a?.account_type} options={TYPES} />
        <Text
          name="account_number"
          label={a ? `Account number (on file ••••${a.account_number.slice(-4)} - leave empty to keep)` : "Account number"}
          defaultValue={null}
          inputMode="numeric"
          required={!a}
        />
        <Text name="opened_on" label="Account opened on" type="date" defaultValue={a?.opened_on} />
      </div>
      <div style={{ marginTop: 12 }}>
        <Submit>{a ? "Save changes" : "Add account"}</Submit>
      </div>
    </form>
  );
}
