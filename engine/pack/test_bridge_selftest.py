"""
Finding 332: bridge_selftest.py's own real-SQL PsqlClient (the stand-in for
Supabase.upsert()/SupabaseRest.upsert() this harness uses everywhere else -
System-Status.md standing item 13) never implemented upsert() at all, so
process_job()'s field_provenance upsert (Finding 190, 2026-11-07) crashed
the ENTIRE self-test with AttributeError the moment any job reached that
far - every job that would otherwise go 'ready' (bridge_selftest.py's own
[B7 b]/[B7 c] stages) failed instead, and the self-test could never again
actually exercise process_job()'s full happy path end to end.

Part 1 (no DB needed): PsqlClient.upsert() builds the right SQL shape -
checked by capturing the query text via a stubbed sql(), not by executing
it, so this part runs in any environment.

Part 2 (PACK_SELFTEST_PSQL set - a scratch Postgres with every migration
replayed, same scratch DB bridge_selftest.py itself uses): a real round
trip against the real field_provenance table - first upsert() inserts,
second upsert() on the same conflict key merges into the SAME row (not a
duplicate), matching PostgREST's own "Prefer: resolution=merge-duplicates"
semantics the real SupabaseRest.upsert() relies on.

Usage:
    python3 engine/pack/test_bridge_selftest.py
    PACK_SELFTEST_PSQL="psql -U postgres -d packtest" python3 engine/pack/test_bridge_selftest.py
"""
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bridge_selftest as bs  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def part1_sql_shape():
    print("\n[part 1] upsert() builds the right SQL shape (no DB needed)")
    client = bs.PsqlClient("psql -U postgres -d unused", "/tmp/unused-storage")
    captured = {}

    def fake_sql(q):
        captured["q"] = q
        return "[]"
    client.sql = fake_sql

    client.upsert("field_provenance", [{"tender_pack_id": "p1", "field_key": "a.b", "status": "confirmed",
                                        "value": "x", "reason": None, "source": "test"}],
                  "tender_pack_id,field_key")
    q = captured["q"]
    check("inserts into the right table", "insert into field_provenance" in q, q[:120])
    check("conflict target matches on_conflict", "on conflict (tender_pack_id, field_key)" in q, q)
    check("updates the non-conflict columns from excluded",
          all(f"{c} = excluded.{c}" in q for c in ("status", "value", "reason", "source")), q)
    check("does not try to update a conflict-key column from excluded",
          "tender_pack_id = excluded.tender_pack_id" not in q and "field_key = excluded.field_key" not in q, q)

    # The case Finding 332 itself never reached before crashing: calling it
    # at all must not raise AttributeError.
    try:
        client.upsert("tender_watch_state", [{"tender_id": "t1"}], "tender_id")
        ok = True
    except AttributeError as e:
        ok = False
        print(f"  (regressed: {e})")
    check("a single-column upsert (all columns are the conflict key) does not raise", ok)
    if ok:
        check("falls back to DO NOTHING when there is nothing left to update",
              "do nothing" in captured["q"], captured["q"])


def part2_real_db_round_trip():
    psql = os.environ.get("PACK_SELFTEST_PSQL")
    if not psql:
        print("\n[part 2 skipped - set PACK_SELFTEST_PSQL to a replayed scratch database, "
              "same one bridge_selftest.py itself uses]")
        return
    print("\n[part 2] real round trip against field_provenance on a replayed scratch Postgres")
    client = bs.PsqlClient(psql, "/tmp/unused-storage")
    pack_id = str(uuid.uuid4())
    tender_id = str(uuid.uuid4())
    company_id = str(uuid.uuid4())
    # Minimal real rows this needs to satisfy field_provenance's own FK to
    # tender_packs (0002) - reuses the real R.396 seed tender bridge_selftest.py
    # itself requires to already be loaded, so this never invents its own tenant.
    tender = client.select("tenders", {"contract_no": "R.396-010-2025/1F"})
    if not tender:
        print("  (part 2 skipped - load app/supabase/seed_tenders.sql into this scratch DB first)")
        return
    company = client.insert("companies", {"legal_name": "Finding 332 upsert test co", "status": "active"})
    client.insert("tender_packs", {"id": pack_id, "company_id": company["id"], "tender_id": tender[0]["id"],
                                   "status": "confirmed"})

    row1 = client.upsert("field_provenance", [{"tender_pack_id": pack_id, "field_key": "a.b",
                                                "status": "confirmed", "value": "first", "reason": None,
                                                "source": "test_bridge_selftest"}],
                         "tender_pack_id,field_key")
    check("first upsert() inserts exactly one row", len(row1) == 1, row1)
    check("first upsert() value is as given", row1 and row1[0]["value"] == "first", row1)

    row2 = client.upsert("field_provenance", [{"tender_pack_id": pack_id, "field_key": "a.b",
                                                "status": "missing", "value": None, "reason": "changed my mind",
                                                "source": "test_bridge_selftest"}],
                         "tender_pack_id,field_key")
    check("second upsert() on the same conflict key still returns one row (merged, not duplicated)",
          len(row2) == 1, row2)
    check("second upsert() merged the new values into the SAME row id",
          row2 and row1 and row2[0]["id"] == row1[0]["id"], (row1, row2))
    check("second upsert() actually overwrote status/value/reason",
          row2 and row2[0]["status"] == "missing" and row2[0]["value"] is None
          and row2[0]["reason"] == "changed my mind", row2)

    all_rows = client.select("field_provenance", {"tender_pack_id": pack_id})
    check("exactly one field_provenance row exists for this pack (no duplicate from the two upserts)",
          len(all_rows) == 1, all_rows)


if __name__ == "__main__":
    part1_sql_shape()
    part2_real_db_round_trip()
    if FAILS:
        print(f"\n{len(FAILS)} FAILED: {FAILS}")
        sys.exit(1)
    print("\nALL PASSED")
    sys.exit(0)
