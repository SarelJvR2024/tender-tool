"""
Regression tests for process_pack_jobs.py's three per-poll sync_* functions
(sync_tender_requirements, sync_b7_setup, sync_position_suggestions) - no
live Supabase project and no scratch Postgres needed (bridge_selftest.py
needs both and can't run in this environment, System-Status.md Gap #8).

Standing review, 2026-10-26: System-Status.md had repeatedly flagged
sync_tender_requirements() and sync_b7_setup() as having zero dedicated
coverage (true - confirmed by grep, fixed here) and, in the same breath,
sync_position_suggestions() as having zero coverage too - which was already
wrong by the time it was written: test_pdf_merge.py's
test_sync_position_suggestions_skips_a_tender_closed_real_yesterday() covers
the naive-"today" skip path. That one test never exercises the function's
actual write path (ranking + insert/update + the "written only when the
ranking changed" no-op), which is the real remaining gap, closed below
alongside the two functions with no coverage at all.

Drives sync_tender_requirements()/sync_b7_setup() against the real
R.396-010-2025.1F sample workbook (templates/samples/) via sanral_fill.
Workbook exactly as the live bridge reads it - a local file standing in for
Storage, same idea as bridge_selftest.py's PsqlClient but with no Postgres
and no subprocess.

Run: python3 engine/pack/test_sync_functions.py
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(ENGINE, ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "pack_generator"))
sys.path.insert(0, os.path.join(ENGINE, "alerts"))
sys.path.insert(0, ENGINE)
import process_pack_jobs as ppj  # noqa: E402
import system_alerts  # noqa: E402

SAMPLE_XLSM = os.path.join(ROOT, "templates", "samples", "R.396-010-2025.1F_ran.xlsm")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """In-memory .select/.insert/.update/.download - the exact calls the
    sync_* functions make. Enough filter support to drive their real control
    flow (equality, `in` on a list, NOT_NULL), not a PostgREST clone.
    download() copies from a {(bucket, path): local_file} map instead of
    hitting Storage over HTTP."""

    def __init__(self, tables=None, files=None):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.files = dict(files or {})

    def _match(self, row, filters):
        for col, v in (filters or {}).items():
            rv = row.get(col)
            if v is ppj.NOT_NULL:
                if rv is None:
                    return False
            elif isinstance(v, (list, tuple, set)):
                if rv not in v:
                    return False
            elif rv != v:
                return False
        return True

    def select(self, table, filters=None, order=None):
        return [dict(r) for r in self.tables.get(table, []) if self._match(r, filters)]

    def insert(self, table, row):
        row = dict(row)
        self.tables.setdefault(table, []).append(row)
        return dict(row)

    def update(self, table, filters, body):
        out = []
        for r in self.tables.get(table, []):
            if self._match(r, filters):
                r.update(body)
                out.append(dict(r))
        return out

    def download(self, bucket, path, dest):
        src = self.files[(bucket, path)]
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(src, dest)
        return dest


def _workdir():
    d = tempfile.mkdtemp(prefix="sync_fn_test_")
    return d


# ============================================================================
# sync_tender_requirements - zero coverage before this pass
# ============================================================================

def test_sync_tender_requirements_writes_primary_and_alt_rows_from_setup():
    print("sync_tender_requirements(): a shared (buyer-published) workbook, never read before")
    client = FakeClient(
        tables={"tender_documents": [{"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None,
                                       "storage_path": "shared/technical.xlsm"}],
                "tender_requirements": []},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM})
    work = _workdir()
    try:
        written = ppj.sync_tender_requirements(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("the primary (non-ALT) codes returned are PL and DS1, the real SETUP sheet's own positions",
          written == {("t1", None): ["PL", "DS1"]}, written)
    rows = client.tables["tender_requirements"]
    check("every written row is stamped with the shared copy's company_id (None), not a guess",
          all(r["company_id"] is None for r in rows), rows)
    primary = [r for r in rows if not r["is_alternate"]]
    alt = [r for r in rows if r["is_alternate"]]
    check("exactly one non-ALT row per primary position (PL, DS1)",
          sorted(r["position_code"] for r in primary) == ["DS1", "PL"], primary)
    check("exactly one ALT row per position (this template's own ALT list)",
          sorted(r["position_code"] for r in alt) == ["DS1", "PL"], alt)
    check("'Non-Man' on the SETUP sheet is stored as managerial=False, not a truthy default",
          all(r["managerial"] is False for r in rows), rows)


def test_sync_tender_requirements_is_idempotent_once_positions_are_on_file():
    print("sync_tender_requirements(): the same workbook polled a second time")
    existing = [{"tender_id": "t1", "company_id": None, "position_code": c,
                 "position_description": c, "managerial": False, "is_alternate": alt}
                for c in ("PL", "DS1") for alt in (False, True)]
    client = FakeClient(
        tables={"tender_documents": [{"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None,
                                       "storage_path": "shared/technical.xlsm"}],
                "tender_requirements": existing},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM})
    work = _workdir()
    try:
        written = ppj.sync_tender_requirements(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("a tender whose positions are already on file is skipped - no re-read, no duplicate rows",
          written == {} and len(client.tables["tender_requirements"]) == 4,
          (written, len(client.tables["tender_requirements"])))


def test_sync_tender_requirements_keeps_a_companys_own_upload_separate_from_the_shared_copy():
    print("sync_tender_requirements(): a company's own upload alongside the buyer's shared copy (0045, per copy)")
    client = FakeClient(
        tables={"tender_documents": [
            {"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None, "storage_path": "shared/technical.xlsm"},
            {"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": "co1", "storage_path": "co1/technical.xlsm"},
        ], "tender_requirements": []},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM,
               ("tender-documents", "co1/technical.xlsm"): SAMPLE_XLSM})
    work = _workdir()
    try:
        written = ppj.sync_tender_requirements(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("both the shared copy and company co1's own copy get their own independent requirement rows",
          written == {("t1", None): ["PL", "DS1"], ("t1", "co1"): ["PL", "DS1"]}, written)
    by_company = {r["company_id"] for r in client.tables["tender_requirements"]}
    check("no row leaks company_id across the two copies - exactly {None, 'co1'} appear, nothing else",
          by_company == {None, "co1"}, by_company)


def test_sync_tender_requirements_skips_and_alerts_on_an_unreadable_workbook():
    print("sync_tender_requirements(): a tender_documents row whose file can't be fetched")
    alerts = []
    system_alerts.set_sink(alerts.append)
    client = FakeClient(
        tables={"tender_documents": [{"tender_id": "t_missing", "doc_type": "technical_xlsm", "company_id": None,
                                       "storage_path": "shared/gone.xlsm"}],
                "tender_requirements": []},
        files={})  # nothing registered for this path - download() fails
    work = _workdir()
    try:
        written = ppj.sync_tender_requirements(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        system_alerts.set_sink(None)
    check("an unreadable workbook writes nothing and never crashes the poll",
          written == {} and client.tables["tender_requirements"] == [], written)
    check("the failure is recorded via system_alerts, not silently dropped",
          len(alerts) == 1 and alerts[0]["p_source"] == "pack" and "t_missing" not in alerts[0]["p_message"],
          alerts)


# ============================================================================
# sync_b7_setup - zero coverage before this pass
# ============================================================================

def test_sync_b7_setup_reads_category_and_matrix_from_the_setup_sheet():
    print("sync_b7_setup(): a shared workbook, tenders.sanral_b7_setup not read yet")
    client = FakeClient(
        tables={"tender_documents": [{"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None,
                                       "storage_path": "shared/technical.xlsm", "downloaded_at": "2026-10-20"}],
                "tenders": [{"id": "t1"}]},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM})
    work = _workdir()
    try:
        written = ppj.sync_b7_setup(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("category 3, required for every size, matches the real R.396 sample's own SETUP sheet",
          written.get("t1", {}).get("category") == 3
          and written["t1"]["required_by_size"] == {"EME": True, "QSE": True, "GENERIC": True}, written)
    check("tenders.sanral_b7_setup is actually updated on the row, not just returned",
          client.tables["tenders"][0].get("sanral_b7_setup", {}).get("category") == 3,
          client.tables["tenders"][0])


def test_sync_b7_setup_is_idempotent_once_the_same_copy_has_been_read():
    print("sync_b7_setup(): the same workbook polled a second time (source_key unchanged)")
    client = FakeClient(
        tables={"tender_documents": [{"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None,
                                       "storage_path": "shared/technical.xlsm", "downloaded_at": "2026-10-20"}],
                "tenders": [{"id": "t1"}]},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM})
    work = _workdir()
    try:
        ppj.sync_b7_setup(client, work)
        written_again = ppj.sync_b7_setup(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("a workbook already read under the same storage path is not re-read on the next poll",
          written_again == {}, written_again)


def test_sync_b7_setup_prefers_the_shared_copy_over_a_companys_own_upload():
    print("sync_b7_setup(): a shared copy AND a company upload both on file for the same tender")
    client = FakeClient(
        tables={"tender_documents": [
            # The company's own copy sorts first by downloaded_at alone, but
            # points at a file that doesn't exist - if sync_b7_setup picked
            # it instead of the shared copy, this test would see written=={}.
            {"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": "co1",
             "storage_path": "co1/technical.xlsm", "downloaded_at": "2020-01-01"},
            {"tender_id": "t1", "doc_type": "technical_xlsm", "company_id": None,
             "storage_path": "shared/technical.xlsm", "downloaded_at": "2026-10-20"},
        ], "tenders": [{"id": "t1"}]},
        files={("tender-documents", "shared/technical.xlsm"): SAMPLE_XLSM})  # co1's file deliberately absent
    work = _workdir()
    try:
        written = ppj.sync_b7_setup(client, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    check("the shared (buyer-published) copy is read, not the company's own upload, regardless of upload order",
          written.get("t1", {}).get("category") == 3, written)


# ============================================================================
# sync_position_suggestions - the real write/no-op path, not yet covered
# (test_pdf_merge.py only covers the closed-tender skip path)
# ============================================================================

def _suggestions_tables():
    return {
        "tender_requirements": [{"tender_id": "t1", "company_id": None, "is_alternate": False,
                                  "position_code": "PL", "position_description": "Project Leader"},
                                 {"tender_id": "t1", "company_id": None, "is_alternate": False,
                                  "position_code": "DS1", "position_description": "Design Specialist"}],
        "tenders": [{"id": "t1", "family": "Conventional Consultant Tender", "closing_date": "2099-01-01"}],
        "tender_packs": [{"id": "pk1", "tender_id": "t1", "company_id": "co1"}],
        "people": [{"id": "p1", "company_id": "co1", "name": "Jane Doe", "created_at": "2026-01-01"}],
        "projects": [], "tender_pack_assignments": [],
    }


def test_sync_position_suggestions_writes_a_ranking_for_every_open_position():
    print("sync_position_suggestions(): an open tender with two key positions and one candidate")
    client = FakeClient(tables=_suggestions_tables())
    written = ppj.sync_position_suggestions(client, today=__import__("datetime").date(2026, 10, 26))
    check("one tender_pack_assignments row is written per position (PL, DS1)", written == 2, written)
    rows = client.tables["tender_pack_assignments"]
    check("each written row carries this pack's id and a non-empty candidate_scores list",
          len(rows) == 2 and all(r["tender_pack_id"] == "pk1" and r["candidate_scores"] for r in rows), rows)
    check("the ranked candidate is keyed by person_id, matching rank_candidates()'s own CANDIDATE_KEYS shape",
          all(r["candidate_scores"][0]["person_id"] == "p1" for r in rows), rows)


def test_sync_position_suggestions_is_a_noop_once_the_ranking_is_unchanged():
    print("sync_position_suggestions(): polled again with nothing about the candidates changed")
    tables = _suggestions_tables()
    client = FakeClient(tables=tables)
    today = __import__("datetime").date(2026, 10, 26)
    first = ppj.sync_position_suggestions(client, today=today)
    second = ppj.sync_position_suggestions(client, today=today)
    check("the first poll writes both positions' rankings", first == 2, first)
    check("an unchanged ranking on the next poll writes nothing - a quiet poll stays quiet",
          second == 0, second)


def main():
    test_sync_tender_requirements_writes_primary_and_alt_rows_from_setup()
    test_sync_tender_requirements_is_idempotent_once_positions_are_on_file()
    test_sync_tender_requirements_keeps_a_companys_own_upload_separate_from_the_shared_copy()
    test_sync_tender_requirements_skips_and_alerts_on_an_unreadable_workbook()
    test_sync_b7_setup_reads_category_and_matrix_from_the_setup_sheet()
    test_sync_b7_setup_is_idempotent_once_the_same_copy_has_been_read()
    test_sync_b7_setup_prefers_the_shared_copy_over_a_companys_own_upload()
    test_sync_position_suggestions_writes_a_ranking_for_every_open_position()
    test_sync_position_suggestions_is_a_noop_once_the_ranking_is_unchanged()
    if FAILS:
        print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
        sys.exit(1)
    print("\nALL PASSED")


if __name__ == "__main__":
    main()
