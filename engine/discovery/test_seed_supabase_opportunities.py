"""
Offline test for seed_supabase_opportunities.py's own isolation between
companies/releases in one seed() call.

QA pass, 2026-11-12 (Finding 453): seed()'s per-company write (the
client.upsert/insert for company_results, the client.update for
company_reassessed) ran with no try/except at all. A genuine failure on ANY
single (company, release) write - a Supabase network blip, a schema
mismatch, a bad field value PostgREST rejects on just that one row - raised
straight out of the function and aborted seed() entirely, so every OTHER
company and every OTHER release still queued after it in the same batch
never got written, even though nothing was wrong with THEIR own rows. Same
bug class already fixed in this lineage for download_discovered_documents.py
(Finding 441) and opportunity_requirements.py's classify_all() (Finding 104,
then Finding 452's own write-call gap) - this file's own per-company write
was the one remaining unattended batch job in engine/discovery/ with zero
isolation between items.

Uses a minimal in-memory fake client (duck-typed: select/upsert/insert/
update), not a real Supabase project or Postgres - seed()'s own logic is
pure Python over whatever `client` it is given, so no HTTP/DB is needed to
exercise the isolation bug.

Run: python3 engine/discovery/test_seed_supabase_opportunities.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (HERE, os.path.join(ENGINE_DIR, "alerts")):
    if p not in sys.path:
        sys.path.insert(0, p)
import system_alerts  # noqa: E402
import seed_supabase_opportunities as seeder  # noqa: E402

ALERTS = []
system_alerts.set_sink(lambda payload: ALERTS.append(payload) and "test-alert-id")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """Just enough of the RestClient surface for seed(): an in-memory table
    store, with upsert/insert/update each able to be told to raise for one
    specific row (simulating the genuine PostgREST/network failure a real
    call can hit on exactly one row, and only that one)."""

    def __init__(self):
        self.rows = {}  # table -> [row, ...]
        self.next_id = 1
        self.fail_on = set()  # set of (table, key) tuples that raise once

    def select(self, table, filters=None, order=None):
        filters = filters or {}
        return [r for r in self.rows.get(table, [])
                if all(r.get(k) == v for k, v in filters.items())]

    def _maybe_fail(self, table, key):
        if (table, key) in self.fail_on:
            self.fail_on.discard((table, key))
            raise RuntimeError(f"POST {table} failed: 500 simulated PostgREST failure for {key}")

    def upsert(self, table, rows, on_conflict):
        out = []
        for row in rows:
            key = row.get("company_id"), row.get("ocid")
            self._maybe_fail(table, key)
            existing = next((r for r in self.rows.setdefault(table, [])
                             if r.get("company_id") == row.get("company_id") and r.get("ocid") == row.get("ocid")), None)
            if existing:
                existing.update(row)
                out.append(existing)
            else:
                new = {"id": self.next_id, **row}
                self.next_id += 1
                self.rows.setdefault(table, []).append(new)
                out.append(new)
        return out

    def insert(self, table, row):
        key = row.get("company_id"), row.get("ocid")
        self._maybe_fail(table, key)
        new = {"id": self.next_id, **row}
        self.next_id += 1
        self.rows.setdefault(table, []).append(new)
        return new

    def update(self, table, filters, body):
        self._maybe_fail(table, ("update", filters.get("id")))
        out = []
        for r in self.rows.get(table, []):
            if all(r.get(k) == v for k, v in filters.items()):
                r.update(body)
                out.append(r)
        return out


def release(contract_number, ocid, companies, reassessed=None):
    return {"contract_number": contract_number, "ocid": ocid, "buyer": "Test Buyer", "title": "Test tender",
            "description": "Test tender", "closing_date": "2099-01-01T00:00:00Z", "documents": [],
            "company_results": companies, "company_reassessed": reassessed or []}


def company_result(company_id, legal_name, verdict="strong_fit"):
    return {"company_id": company_id, "legal_name": legal_name, "verdict": verdict,
            "reasons": ["(test) matched"], "score_outlook": None, "rescored": None, "previous_verdict": None}


def main():
    print("1. a release AFTER a failing one in the same batch is still seeded (RED before the fix, GREEN after)")
    c = FakeClient()
    releases = [
        release("TN-FAIL", "ocid-fail", [company_result("company-a", "Failing Co A")]),
        release("TN-OK-1", "ocid-ok-1", [company_result("company-b", "OK Co B")]),
        release("TN-OK-2", "ocid-ok-2", [company_result("company-c", "OK Co C")]),
    ]
    c.fail_on.add(("discovered_opportunities", ("company-a", "ocid-fail")))
    written = seeder.seed(c, releases, log=lambda m: print("   ", m))
    check("the failing company's own write did not raise out of seed()", True)  # reaching here at all is the fix
    check("company-a (the one that genuinely failed) has no row", "company-a" not in written, written)
    check("company-b, AFTER the failing release in the same batch, still got its row",
          written.get("company-b") == 1, written)
    check("company-c, AFTER both the failing release and company-b, still got its row",
          written.get("company-c") == 1, written)
    check("the failure was recorded as a system alert (not silently dropped)",
          any("TN-FAIL" in (a.get("p_message") or "") for a in ALERTS), ALERTS)

    print("2. the same isolation for company_reassessed (the downgrade-flag write)")
    ALERTS.clear()
    c2 = FakeClient()
    # Seed two existing rows directly so is_downgrade() has something to compare against.
    c2.rows["discovered_opportunities"] = [
        {"id": 101, "company_id": "company-d", "ocid": "ocid-re-1", "verdict": "strong_fit", "reasons": ["x"]},
        {"id": 102, "company_id": "company-e", "ocid": "ocid-re-2", "verdict": "strong_fit", "reasons": ["y"]},
    ]
    releases2 = [
        release("TN-RE-FAIL", "ocid-re-1", [], reassessed=[
            {"company_id": "company-d", "legal_name": "Downgrade Co D", "verdict": "not_a_fit",
             "reasons": ["(test) no longer matches"], "score_outlook": None, "rescored": "profile_changed",
             "previous_verdict": "strong_fit"}]),
        release("TN-RE-OK", "ocid-re-2", [], reassessed=[
            {"company_id": "company-e", "legal_name": "Downgrade Co E", "verdict": "not_a_fit",
             "reasons": ["(test) no longer matches"], "score_outlook": None, "rescored": "profile_changed",
             "previous_verdict": "strong_fit"}]),
    ]
    c2.fail_on.add(("discovered_opportunities", ("update", 101)))
    written2 = seeder.seed(c2, releases2, log=lambda m: print("   ", m))
    check("company-d's own downgrade-flag write genuinely failed and was not counted",
          written2.get("company-d") is None, written2)
    check("company-e, AFTER the failing release in the same batch, still got its downgrade flagged",
          written2.get("company-e") == 1, written2)
    row_e = next(r for r in c2.rows["discovered_opportunities"] if r["company_id"] == "company-e")
    check("company-e's row really was flagged (downgraded_from recorded)",
          row_e.get("downgraded_from") == "strong_fit", row_e)
    row_d = next(r for r in c2.rows["discovered_opportunities"] if r["company_id"] == "company-d")
    check("company-d's row was left exactly as it was (the failed write made no partial change)",
          row_d.get("verdict") == "strong_fit" and row_d.get("downgraded_from") is None, row_d)
    check("the second failure was also recorded as a system alert",
          any("TN-RE-FAIL" in (a.get("p_message") or "") for a in ALERTS), ALERTS)

    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nall checks passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
