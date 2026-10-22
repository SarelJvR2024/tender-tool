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

const cardClass = "box-border w-[380px] max-w-full rounded-xl border border-border bg-card px-9 py-10 text-center font-sans";
const primaryButtonClass = "box-border min-h-11 w-full cursor-pointer rounded-lg border-none bg-foreground px-4 text-sm font-semibold text-white";
const oauthButtonClass = "box-border mb-2.5 block min-h-11 w-full rounded-lg border border-border bg-card px-4 text-sm leading-11 font-semibold text-foreground no-underline";

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
        <div className={cardClass}>
          <h1 className="mb-2.5 text-lg font-bold text-foreground">Invite not found</h1>
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            This invite link isn&apos;t valid. Ask whoever sent it to send a new one.
          </p>
          <Link href="/login" className="mt-6 inline-block text-[13px] font-semibold text-foreground no-underline">
            &larr; Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (preview.is_accepted || preview.is_expired) {
    return (
      <AuthShell>
        <div className={cardClass}>
          <h1 className="mb-2.5 text-lg font-bold text-foreground">
            {preview.is_accepted ? "Invite already used" : "Invite expired"}
          </h1>
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            {preview.is_accepted
              ? "This invite has already been accepted. If that wasn't you, ask the company for a new one."
              : "This invite link has expired. Ask whoever sent it for a new one."}
          </p>
          <Link href="/login" className="mt-6 inline-block text-[13px] font-semibold text-foreground no-underline">
            &larr; Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <div className={cardClass}>
          <h1 className="mb-1 text-xl font-bold text-foreground">Join {preview.company_name}</h1>
          <p className="mb-7 text-[13px] text-muted-foreground">
            You&apos;ve been invited as <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>. Sign in or create an account to
            continue - you&apos;ll come straight back here to finish joining.
          </p>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className={oauthButtonClass}>
            Sign in
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className={`${oauthButtonClass} mb-0`}>
            Create an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className={cardClass}>
        <h1 className="mb-1 text-xl font-bold text-foreground">Join {preview.company_name}</h1>
        <p className="mb-5 text-[13px] text-muted-foreground">
          You&apos;ll join as <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>, signed in as {user.email}.
        </p>
        {error && <p className="mb-3.5 text-left text-xs text-destructive">{error}</p>}
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className={primaryButtonClass}>
            Accept and join
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
