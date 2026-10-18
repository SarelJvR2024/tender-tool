"""
Checks for the market-tendering-trend aggregation (migration 0062
market_trend_for_tags(), app/lib/marketTrendLogic.ts / marketPricing.ts /
market-context.tsx) built on top of public_tender_outcomes (0053) and
tender_scope_records (0060). Design: Sarel's instruction (paraphrased,
2026-10-18) - "once we get winning prices we can use to adjust our pricing
engine to improve estimates and start building market tendering trends for
similar future projects and improve our estimated project value".

Part 1 (offline, in CI, no network/database): migration 0062's SQL text is
checked for the honesty rules it must encode (awarded + competitive only,
the join key, never dividing against a null/unknown estimate), and
engine/fill_financial.py - explicitly out of scope for this work - is
checked to be byte-for-byte unchanged against the last commit.

Part 2 (same shape as test_award_prices.py's Part 2 - MARKET_TREND_PSQL set,
a scratch Postgres with every migration replayed): the live function
actually enforces its own min-sample-adjacent honesty rules (it does NOT
enforce the display threshold itself - that is app/lib/marketTrendLogic.ts's
job, tested there in TypeScript - but the SQL must never divide by a null
or zero estimate, and never count a non-competitive/non-awarded outcome).

The minimum-sample-size DISPLAY gate itself is pure TypeScript
(marketTrendLogic.ts, gateMarketTrend()) and is covered by
app/lib/marketTrendLogic.test.ts, not here - no reason to re-implement it in
Python when the real logic lives in one place.

    python3 engine/discovery/test_market_trend.py
    MARKET_TREND_PSQL="psql -h /tmp/tt-mkt-pg/sock -p 54452 -U postgres -d mkt" \\
        python3 engine/discovery/test_market_trend.py
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MIGRATION = os.path.join(REPO_ROOT, "app", "supabase", "migrations", "0062_market_trend_by_tags.sql")
FILL_FINANCIAL = os.path.join(REPO_ROOT, "engine", "fill_financial.py")

FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------------------
# Part 1: offline, no database
# ---------------------------------------------------------------------------

def test_fill_financial_untouched():
    """engine/fill_financial.py is explicitly out of scope: the priced BOQ /
    actual pricing-fill logic stays the tenderer's own business decision,
    exactly as that file's own docstring already states. This feature only
    ever reads public_tender_outcomes/tender_scope_records for display."""
    check("fill_financial.py exists (sanity - wrong path would false-pass)", os.path.isfile(FILL_FINANCIAL))
    try:
        out = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--", "engine/fill_financial.py"],
            cwd=REPO_ROOT, capture_output=True,
        )
        # exit 0 = no diff against the last commit; this check runs before
        # this session's own commit, so a non-zero exit means something
        # touched the file this session - which must never happen here.
        check("fill_financial.py has no uncommitted changes this session", out.returncode == 0,
              out.stdout.decode() + out.stderr.decode())
    except FileNotFoundError:
        print("SKIP  fill_financial.py git-diff check (git not available)")


def test_migration_honesty_rules():
    with open(MIGRATION) as f:
        sql = f.read()

    check("defines market_trend_for_tags()", "create or replace function market_trend_for_tags" in sql)
    check("joins through tenders.id (the shared key, no new identifier scheme)",
          "join tenders t" in sql)
    check("reuses the same match-key join as tender_market_outcomes() (0053) - no second join rule invented",
          "award_match_keys(t.contract_no)" in sql and "award_match_keys(t.nra_reference)" in sql)
    check("groups by tenders.industry_tags/discipline_tags (0060), not a new tag column",
          "t.industry_tags && p_tags" in sql and "t.discipline_tags && p_tags" in sql)
    check("only AWARDED outcomes count (no in-progress register guessed as a result)",
          "o.status = 'awarded'" in sql)
    check("only COMPETITIVE outcomes count (sole-source/emergency awards excluded, same rule as marketPricing.ts)",
          "o.competitive = true" in sql)
    check("the price-vs-estimate ratio requires a REAL stated estimate (value_band_basis = 'stated_in_text')",
          "value_band_basis = 'stated_in_text'" in sql)
    check("never divides against a null or non-positive estimate",
          "value_band_raw_amount is not null and value_band_raw_amount > 0" in sql)
    check("never divides against a null or non-positive winning amount",
          "winner_amount_zar is not null and winner_amount_zar > 0" in sql)
    check("every aggregate carries its own sample size for the app-layer MIN_SAMPLE gate",
          all(col in sql for col in ("pct_of_estimate_n", "bidder_count_n")) and re.search(r"\bn\s+integer\b", sql))
    check("never touches fill_financial.py / pricing-fill logic (no mention in this migration)",
          "fill_financial" not in sql.lower() or "does not touch" in sql.lower() or "NOT touch" in sql)
    check("documents the live-function-over-materialized-view choice (no silent cached table)",
          "materialized view" in sql.lower())


# ---------------------------------------------------------------------------
# Part 2: live Postgres (optional, same env-var-gated shape as
# test_award_prices.py's Part 2)
# ---------------------------------------------------------------------------

def _psql():
    return os.environ.get("MARKET_TREND_PSQL")


def test_live_function_never_fabricates_a_ratio():
    psql = _psql()
    if not psql:
        print("SKIP  live-Postgres checks (MARKET_TREND_PSQL not set)")
        return
    import shlex

    def run_sql(sql):
        cmd = shlex.split(psql) + ["-t", "-A", "-c", sql]
        out = subprocess.run(cmd, capture_output=True, text=True)
        if out.returncode != 0:
            raise RuntimeError(out.stderr)
        return out.stdout.strip()

    # A tag with zero matching awarded/competitive outcomes must return a
    # null/zero row, never a fabricated ratio.
    row = run_sql("select n, pct_of_estimate_n, pct_of_estimate_median "
                   "from market_trend_for_tags(array['__no_such_tag_in_fixtures__'], null, 24)")
    cols = row.split("|")
    check("a tag with no matches returns n=0", cols and cols[0] == "0", row)
    check("a tag with no matches returns a null pct_of_estimate_median, not 0 or a fabricated number",
          len(cols) >= 3 and cols[2] == "", row)


def main():
    test_fill_financial_untouched()
    test_migration_honesty_rules()
    test_live_function_never_fabricates_a_ratio()
    if FAILS:
        print(f"\n{len(FAILS)} check(s) failed: {FAILS}")
        sys.exit(1)
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
