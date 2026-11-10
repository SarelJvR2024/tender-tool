"""
apply_payfast_itn()'s rescue-branch recency guard (Finding 339, standing
review, 2026-11-10 - docs/specs/QA-Edge-Case-Findings.md has the full
write-up).

The rescue branch (0081/0082/0083) exists for ONE shape: a LATER checkout
attempt was started but never paid, and the EARLIER attempt's own payment
then arrives late - rescuing it is correct, nothing newer was ever really
activated. It never checked the OTHER shape the exact same branch also
reaches: the LATER attempt was itself already paid and IS the company's
real, currently-active subscription, and the charge now arriving is a
genuine but STALE renewal of an OLDER attempt the company has since moved
on from (this app has no PayFast subscription-cancel flow at all - every
switched-away-from plan keeps auto-renewing on its own schedule forever
unless cancelled by hand on PayFast's own side, so this is the routine
outcome of any ordinary plan switch, not a contrived edge case). Before
migration 0131, that stale-but-real charge silently reverted the company's
current, correct, more-recent subscription back to the old plan/limits and
reclaimed payfast_m_payment_id for the old attempt - orphaning the newer
subscription's own m_payment_id too.

0131 adds a guard: before the rescue branch applies anything, if the
company's CURRENT row is already 'active' under a DIFFERENT attempt created
strictly AFTER the one this ITN is trying to rescue, return as a no-op
(the real charge stays on record in payfast_payment_attempts; nothing is
silently lost, just not blindly applied over a newer active plan). The
original rescue case - the current row is NOT already 'active' under a
newer attempt - is deliberately left completely unchanged.

Run against a scratch Postgres with every migration replayed:

    sudo -u postgres pg_ctlcluster 16 main start
    sudo -u postgres bash engine/security/replay_schema.sh -U postgres -d payfasttest2
    PAYFAST_PSQL="psql -U postgres -d payfasttest2" python3 engine/security/test_payfast_itn_rescue_recency.py

With no PAYFAST_PSQL set, this prints a skip notice and exits 0 (same
convention as test_tenant_isolation.py's Part 2 and
test_payfast_itn_stale_redelivery.py) - this is a real-SQL-only check,
there is nothing to run without a live database.
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
                            capture_output=True, text=True, check=False)
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

    def subscription_row(company):
        return db.row(
            f"select plan_tier, billing_interval, status, payfast_m_payment_id, "
            f"max_users, max_packs_per_month from company_subscriptions where company_id = '{company}'"
        )

    def seed_company(label):
        company = str(uuid.uuid4())
        db.one(f"insert into companies (id, legal_name) values ('{company}', 'Rescue Recency {label}')")
        return company

    def attempt(company, mpid, plan, interval):
        db.one(
            f"insert into payfast_payment_attempts (company_id, m_payment_id, plan_tier, billing_interval) "
            f"values ('{company}', '{mpid}', '{plan}', '{interval}')"
        )
        limits = {"starter": (2, 5), "professional": (5, 15), "business": (10, 30)}[plan]
        db.one(
            f"update company_subscriptions set payfast_m_payment_id = '{mpid}', plan_tier = '{plan}', "
            f"billing_interval = '{interval}', max_users = {limits[0]}, max_packs_per_month = {limits[1]} "
            f"where company_id = '{company}'"
        )

    def apply(mpid, token, status, amount, period_days=31):
        db.one(
            f"select apply_payfast_itn('{mpid}', '{token}', '{status}', "
            f"now() + interval '{period_days} days', {amount})"
        )

    price = {
        ("starter", "monthly"): 1490,
        ("business", "yearly"): 49900,
        ("professional", "monthly"): 2990,
    }

    # --- THE LIVE BUG THIS FINDING CLOSES -----------------------------------
    company1 = seed_company("A")
    x1, x2 = f"x1-{uuid.uuid4().hex[:10]}", f"x2-{uuid.uuid4().hex[:10]}"

    attempt(company1, x1, "business", "yearly")
    apply(x1, "pf-x1-initial", "COMPLETE", price[("business", "yearly")], period_days=366)
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company1)
    check(plan == "business" and status == "active" and mpid == x1,
          "attempt 1 (business/yearly) activates normally")

    # Company genuinely switches plans - a second, later, genuinely paid attempt.
    attempt(company1, x2, "starter", "monthly")
    apply(x2, "pf-x2-initial", "COMPLETE", price[("starter", "monthly")])
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company1)
    check(plan == "starter" and status == "active" and mpid == x2,
          "attempt 2 (starter/monthly) activates and becomes the real current plan")

    # The never-cancelled attempt-1 PayFast subscription auto-renews for real,
    # much later, under a brand-new pf_payment_id (not a redelivery of pf-x1-initial).
    apply(x1, "pf-x1-stale-renewal", "COMPLETE", price[("business", "yearly")], period_days=366)
    plan2, interval2, status2, mpid2, max_u2, max_p2 = subscription_row(company1)
    check(plan2 == "starter" and interval2 == "monthly", "stale renewal of the OLD attempt does NOT revert plan_tier/billing_interval")
    check(mpid2 == x2, "stale renewal of the OLD attempt does NOT reclaim payfast_m_payment_id")
    check(status2 == "active", "the company's real, current subscription stays active, untouched")
    check(int(max_u2) == 2 and int(max_p2) == 5, "the newer plan's own limits (starter: 2/5) are preserved, not reverted to business's 10/30")

    # --- NON-REGRESSION: the ORIGINAL rescue case must still work -----------
    company2 = seed_company("B")
    a1, a2 = f"a1-{uuid.uuid4().hex[:10]}", f"a2-{uuid.uuid4().hex[:10]}"

    attempt(company2, a1, "professional", "monthly")  # started, about to be abandoned
    attempt(company2, a2, "starter", "monthly")        # a later attempt also started, also abandoned
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company2)
    check(status == "trialing" and mpid == a2, "neither attempt has been paid yet - row still reflects attempt 2, still trialing")

    # a1's payment (the EARLIER, abandoned-looking attempt) now genuinely lands.
    apply(a1, "pf-a1", "COMPLETE", price[("professional", "monthly")])
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company2)
    check(plan == "professional" and status == "active" and mpid == a1,
          "original rescue case UNCHANGED: a genuinely-abandoned later attempt lets an earlier real payment rescue normally")
    check(int(max_u) == 5 and int(max_p) == 15, "rescued attempt's own limits (professional: 5/15) are applied, as before")

    # --- Guard only fires when the CURRENT row is already 'active' ----------
    company3 = seed_company("C")
    b1, b2 = f"b1-{uuid.uuid4().hex[:10]}", f"b2-{uuid.uuid4().hex[:10]}"
    attempt(company3, b1, "business", "yearly")
    apply(b1, "pf-b1", "COMPLETE", price[("business", "yearly")], period_days=366)
    attempt(company3, b2, "starter", "monthly")
    apply(b2, "pf-b2-failed", "FAILED", 0)  # attempt 2's own payment FAILED - current status is past_due, not active
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company3)
    check(status == "past_due" and mpid == b2, "attempt 2's failed payment leaves the row past_due under attempt 2's own id")

    apply(b1, "pf-b1-stale-renewal-2", "COMPLETE", price[("business", "yearly")], period_days=366)
    plan, _interval, status, mpid, max_u, max_p = subscription_row(company3)
    check(plan == "business" and status == "active" and mpid == b1,
          "guard does NOT block a stale charge when the current row is past_due (not active) - rescue still applies as before")

    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nALL PASSED")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
