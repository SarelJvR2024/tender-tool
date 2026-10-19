import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../../_components/AuthShell";
import { acceptInvite } from "../actions";

export const instant = false;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  employee: "Employee (restricted - your own CV and documents only)",
};

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 380, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", fontFamily: "system-ui, sans-serif" };
const PRIMARY_BUTTON: React.CSSProperties = { width: "100%", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "none", background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer", boxSizing: "border-box" };
const OAUTH_BUTTON: React.CSSProperties = { display: "block", width: "100%", minHeight: 44, padding: "0 16px", marginBottom: 10, borderRadius: 8, border: "1px solid #E5E1D5", background: "#FFFFFF", fontSize: 14, fontWeight: 600, color: "#16233B", textDecoration: "none", boxSizing: "border-box", lineHeight: "44px" };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: previewRows } = await supabase.rpc("invite_preview", { p_token: token });
  const preview = (previewRows ?? [])[0] as
    | { company_name: string; role: string; is_expired: boolean; is_accepted: boolean }
    | undefined;

  const next = `/invite/${token}`;

  if (!preview) {
    return (
      <AuthShell>
        <div style={CARD}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px" }}>Invite not found</h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: 0, lineHeight: 1.6 }}>
            This invite link isn&apos;t valid. Ask whoever sent it to send a new one.
          </p>
          <Link href="/login" style={{ display: "inline-block", marginTop: 24, fontSize: 13, color: "#16233B", fontWeight: 600, textDecoration: "none" }}>
            &larr; Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (preview.is_accepted || preview.is_expired) {
    return (
      <AuthShell>
        <div style={CARD}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px" }}>
            {preview.is_accepted ? "Invite already used" : "Invite expired"}
          </h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: 0, lineHeight: 1.6 }}>
            {preview.is_accepted
              ? "This invite has already been accepted. If that wasn't you, ask the company for a new one."
              : "This invite link has expired. Ask whoever sent it for a new one."}
          </p>
          <Link href="/login" style={{ display: "inline-block", marginTop: 24, fontSize: 13, color: "#16233B", fontWeight: 600, textDecoration: "none" }}>
            &larr; Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <div style={CARD}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Join {preview.company_name}</h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>
            You&apos;ve been invited as <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>. Sign in or create an account to
            continue - you&apos;ll come straight back here to finish joining.
          </p>
          <Link href={`/login?next=${encodeURIComponent(next)}`} style={OAUTH_BUTTON}>
            Sign in
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`} style={{ ...OAUTH_BUTTON, marginBottom: 0 }}>
            Create an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={CARD}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Join {preview.company_name}</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 20px" }}>
          You&apos;ll join as <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>, signed in as {user.email}.
        </p>
        {error && <p style={{ color: "#B91C1C", fontSize: 12, textAlign: "left", margin: "0 0 14px" }}>{error}</p>}
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" style={PRIMARY_BUTTON}>
            Accept and join
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
