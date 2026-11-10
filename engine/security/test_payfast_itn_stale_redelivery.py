"""
apply_payfast_itn() stale-redelivery ledger (Finding 334, standing review,
2026-11-10 - docs/specs/QA-Edge-Case-Findings.md has the full write-up).

PR #197 (Finding 225, still unmerged) closes a real exact-redelivery gap in
apply_payfast_itn(), but only ever compares the redelivered ITN's own
pf_payment_id/token against the row's CURRENT payfast_token. A stale
redelivery of an OLDER, already-superseded real transaction (last month's
renewal ITN, resent from PayFast's own merchant dashboard, or simply
delayed past the next renewal) carries a DIFFERENT pf_payment_id from
whatever the row's current one now is, so that guard never matches it, and
it gets applied as if it were a brand-new charge - extending
current_period_end/current_period_start again for free and rolling
payfast_token BACKWARDS to the stale value (which then also breaks the
row's own redelivery protection for the real current charge).

Migration 0128 fixes this with an append-only ledger
(payfast_itn_applied_events) keyed by PayFast's own globally-unique
pf_payment_id: any pf_payment_id this function has ever actually applied
before - current or stale - becomes a no-op on a later delivery.

Run against a scratch Postgres with every migration replayed:

    sudo -u postgres pg_ctlcluster 16 main start
    sudo -u postgres bash engine/security/replay_schema.sh -U postgres -d payfasttest
    PAYFAST_PSQL="psql -U postgres -d payfasttest" python3 engine/security/test_payfast_itn_stale_redelivery.py

With no PAYFAST_PSQL set, this prints a skip notice and exits 0 (same
convention as test_tenant_isolation.py's Part 2) - this is a real-SQL-only
check, there is nothing to run without a live database.
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
        return r.returncode == 0, r.stdout.strip(), r.stderr.strip()

    def one(self, sql):
        ok, out, err = self.run(sql)
        if not ok:
            raise RuntimeError(f"{err}\nSQL: {sql}")
        return out.splitlines()[-1] if out else ""

    def row(self, sql):
        """One pipe-separated row -> list of fields."""
        return self.one(sql).split("|")


def main():
    psql = os.environ.get("PAYFAST_PSQL")
    if not psql:
        print("(skipped - set PAYFAST_PSQL to a scratch Postgres with every migration replayed)")
        return 0

    db = Db(psql)
    company = str(uuid.uuid4())
    mpid = f"mpid-{uuid.uuid4().hex[:12]}"

    db.one(f"insert into companies (id, legal_name) values ('{company}', 'Stale Redelivery Co')")
    db.one(f"update company_subscriptions set payfast_m_payment_id = '{mpid}' where company_id = '{company}'")

    def subscription_row():
        return db.row(f"select plan_tier, status, payfast_token, current_period_end "
                       f"from company_subscriptions where company_id = '{company}'")

    def apply(token, status, amount, period_days=31):
        db.one(f"select apply_payfast_itn('{mpid}', '{token}', '{status}', "
               f"now() + interval '{period_days} days', {amount})")

    # Charge 1: genuine first activation.
    apply("pf-1", "COMPLETE", 2990)
    _, status1, token1, end1 = subscription_row()
    check(status1 == "active" and token1 == "pf-1", "charge 1 activates the row with its own token")

    # Charge 2: genuine renewal under the SAME recurring m_payment_id (PayFast's
    # own design - 0078's header comment), a NEW pf_payment_id, as a real charge
    # always gets.
    apply("pf-2", "COMPLETE", 2990)
    _, status2, token2, end2 = subscription_row()
    check(status2 == "active" and token2 == "pf-2", "charge 2 (legit renewal) advances the row to its own new token")
    check(end2 > end1, "charge 2 genuinely advances current_period_end")

    # THE BUG THIS FINDING CLOSES: a stale redelivery of the OLDER charge 1
    # (pf-1) arrives after charge 2 has already landed. Must be a complete
    # no-op - row stays exactly as charge 2 left it.
    apply("pf-1", "COMPLETE", 2990)
    _, status3, token3, end3 = subscription_row()
    check(token3 == "pf-2", "stale redelivery of the OLDER charge does NOT roll payfast_token backwards")
    check(end3 == end2, "stale redelivery of the OLDER charge does NOT extend current_period_end again")
    check(status3 == "active", "stale redelivery of the OLDER charge does not change status")

    # Exact redelivery of the CURRENT charge (pf-2) must also still be a no-op
    # (the case PR #197/0125 already covers - confirms 0128 doesn't regress it).
    apply("pf-2", "COMPLETE", 2990)
    _, status4, token4, end4 = subscription_row()
    check(token4 == "pf-2" and end4 == end2, "exact redelivery of the CURRENT charge is still a no-op")

    # The ledger recorded exactly the 2 real transactions, not the redeliveries.
    count = db.one(f"select count(*) from payfast_itn_applied_events where m_payment_id = '{mpid}'")
    check(count == "2", f"ledger holds exactly 2 applied events (pf-1, pf-2), got {count}")

    # A genuinely NEW third renewal (new token) must still work normally -
    # the fix must not accidentally block real future charges.
    apply("pf-3", "COMPLETE", 2990)
    _, status5, token5, end5 = subscription_row()
    check(token5 == "pf-3" and end5 > end4, "a genuinely new renewal charge still advances the row normally")

    # A rejected (amount-mismatch) ITN must NOT be permanently burned by its
    # own ledger entry - it must remain retryable with the correct amount.
    ok, _, err = db.run(f"select apply_payfast_itn('{mpid}', 'pf-bad', 'COMPLETE', now() + interval '31 days', 1)")
    check(not ok and "amount_gross" in err, "wrong-amount ITN is rejected (raises)")
    burned = db.one(f"select count(*) from payfast_itn_applied_events where pf_payment_id = 'pf-bad'")
    check(burned == "0", "the rejected ITN's own ledger insert was rolled back with the rest of the transaction")
    apply("pf-bad", "COMPLETE", 2990)  # now with the correct amount
    _, status6, token6, _ = subscription_row()
    check(token6 == "pf-bad" and status6 == "active", "retrying the same pf_payment_id with the correct amount still succeeds")

    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nALL PASSED")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
