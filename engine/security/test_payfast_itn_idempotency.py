"""
Migration 0125: apply_payfast_itn()'s own exact-redelivery idempotency gap
(standing solution-architect review, 2026-11-09, fresh angle (c) from that
pass's own task brief - webhook/callback idempotency under a genuine
redelivery, not a race).

The app's own checkout (app/app/api/billing/checkout/route.ts) sets
subscription_type: "1" - a real PayFast recurring subscription - so
m_payment_id is set ONCE at initial checkout and reused for every future
renewal charge under that subscription's lifetime BY DESIGN. That is exactly
why a naive "have we seen this m_payment_id as active already?" idempotency
check would be wrong - it would also block legitimate monthly/yearly
renewals. The field that is genuinely unique per real transaction is
PayFast's own pf_payment_id (the route's p_payfast_token) - a brand-new
charge always gets a new one; an exact redelivery of a PAST charge's ITN
carries the SAME one again.

This test builds a scratch Postgres with every migration replayed (0001 ->
latest, via replay_schema.sh) and, calling apply_payfast_itn() directly
(it is SECURITY DEFINER - no RLS session needed to call it, same as the real
route handler's own supabase.rpc() call with no signed-in user):

  1. A first COMPLETE ITN activates a trialing subscription at the correct
     plan price - current_period_end advances by one real billing period.
  2. An EXACT redelivery of that SAME ITN (identical m_payment_id AND
     pf_payment_id/token, same amount, "arriving" 10 days later - the
     p_period_end argument is recomputed as nextPeriodEnd() at CALL time by
     the real route handler, exactly like lib/payfast.ts's own
     addMonths(now(), ...), never carried over from the original delivery)
     must be a true no-op: current_period_end and current_period_start must
     be byte-for-byte unchanged from step 1.
  3. A genuinely NEW renewal charge for the SAME subscription (same
     m_payment_id, a DIFFERENT pf_payment_id, as PayFast always issues per
     real charge) must still correctly extend current_period_end - the fix
     must not accidentally freeze a real recurring subscription.
  4. An exact redelivery of THAT second charge must also be a no-op.

Usage:
    PAYFAST_ITN_PSQL="psql -h /tmp/pfpg/sock -p 5432 -U postgres -d pftest" \\
        python3 engine/security/test_payfast_itn_idempotency.py
"""
import os
import shlex
import subprocess
import sys
import uuid

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class Db:
    def __init__(self, cmd):
        self.cmd = shlex.split(cmd)

    def run(self, sql):
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", sql],
                            capture_output=True, text=True)
        out = "\n".join(l for l in r.stdout.splitlines() if l.strip())
        return r.returncode == 0, out, r.stderr.strip()

    def one(self, sql):
        ok, out, err = self.run(sql)
        if not ok:
            raise RuntimeError(err)
        return out.splitlines()[-1] if out else ""


def part2(psql):
    print("Part 2 - real Postgres, apply_payfast_itn() called directly")
    db = Db(psql)
    company = str(uuid.uuid4())
    m_payment_id = f"mpid-{company[:8]}"

    db.one(f"insert into companies (id, legal_name) values ('{company}', 'ITN idem test co')")
    # start_company_trial() (companies_start_trial trigger) already inserted
    # a trialing company_subscriptions row - simulate what
    # start_payfast_checkout() does to it for a starter/monthly checkout.
    db.one(f"""update company_subscriptions set plan_tier='starter', billing_interval='monthly',
            payfast_m_payment_id='{m_payment_id}' where company_id = '{company}'""")

    print("\n[1] First COMPLETE ITN activates the subscription at the correct price")
    db.one(f"select apply_payfast_itn('{m_payment_id}', 'pf-token-1', 'COMPLETE', "
           f"(now() + interval '31 days')::timestamptz, 1490)")
    status1 = db.one(f"select status from company_subscriptions where company_id = '{company}'")
    end1 = db.one(f"select current_period_end from company_subscriptions where company_id = '{company}'")
    start1 = db.one(f"select current_period_start from company_subscriptions where company_id = '{company}'")
    token1 = db.one(f"select payfast_token from company_subscriptions where company_id = '{company}'")
    check(status1 == "active", f"status is active after the first ITN (got {status1!r})")
    check(token1 == "pf-token-1", f"payfast_token stored (got {token1!r})")

    print("\n[2] Exact redelivery of the SAME ITN (same pf_payment_id), 10 days later, is a no-op")
    db.one(f"select apply_payfast_itn('{m_payment_id}', 'pf-token-1', 'COMPLETE', "
           f"(now() + interval '10 days' + interval '31 days')::timestamptz, 1490)")
    end2 = db.one(f"select current_period_end from company_subscriptions where company_id = '{company}'")
    start2 = db.one(f"select current_period_start from company_subscriptions where company_id = '{company}'")
    check(end2 == end1, f"current_period_end unchanged by the exact redelivery ({end1!r} -> {end2!r})")
    check(start2 == start1, f"current_period_start unchanged by the exact redelivery ({start1!r} -> {start2!r})")

    print("\n[3] A genuinely NEW renewal charge (different pf_payment_id) still extends the period")
    db.one(f"select apply_payfast_itn('{m_payment_id}', 'pf-token-2', 'COMPLETE', "
           f"(now() + interval '30 days' + interval '31 days')::timestamptz, 1490)")
    end3 = db.one(f"select current_period_end from company_subscriptions where company_id = '{company}'")
    start3 = db.one(f"select current_period_start from company_subscriptions where company_id = '{company}'")
    token3 = db.one(f"select payfast_token from company_subscriptions where company_id = '{company}'")
    check(end3 != end1, f"a real new renewal charge DOES extend current_period_end ({end1!r} -> {end3!r})")
    check(start3 != start1, f"a real new renewal charge DOES advance current_period_start ({start1!r} -> {start3!r})")
    check(token3 == "pf-token-2", f"payfast_token updated to the new charge's own token (got {token3!r})")

    print("\n[4] Exact redelivery of THAT second charge is also a no-op")
    db.one(f"select apply_payfast_itn('{m_payment_id}', 'pf-token-2', 'COMPLETE', "
           f"(now() + interval '45 days' + interval '31 days')::timestamptz, 1490)")
    end4 = db.one(f"select current_period_end from company_subscriptions where company_id = '{company}'")
    start4 = db.one(f"select current_period_start from company_subscriptions where company_id = '{company}'")
    check(end4 == end3, f"current_period_end unchanged by the second charge's exact redelivery ({end3!r} -> {end4!r})")
    check(start4 == start3, f"current_period_start unchanged by the second charge's exact redelivery ({start3!r} -> {start4!r})")


def main():
    psql = os.environ.get("PAYFAST_ITN_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set PAYFAST_ITN_PSQL to a replayed scratch database)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
