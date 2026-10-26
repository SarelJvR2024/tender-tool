"""
Tests for tender_enrichment.py's own CLI wiring (step 3/5 of this task): the
document-fetch helpers, the BOQ-candidate-document picker, and counts().
Kept SEPARATE from test_tender_enrichment.py (which is deliberately
"no network, no database - pure functions only", see its own docstring) -
this file is the one that exercises I/O, all of it mocked/stubbed, same
style as test_company_profiles.py and test_boq_extraction.py.

Usage: python3 engine/discovery/test_tender_enrichment_cli.py
"""
import io
import os
import sys
import types
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["TT_TAXONOMY_SOURCE"] = "seed"
import tender_enrichment as te  # noqa: E402
from test_boq_extraction import make_workbook_bytes  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def test_ext_of():
    check(te._ext_of("https://example.test/docs/Bill_of_Quantities.XLSX?x=1") == "xlsx", "extension lowercased, query string stripped")
    check(te._ext_of("https://example.test/no-extension") == "", "no extension -> empty string, not a guess")
    check(te._ext_of(None) == "", "a missing url/name never raises")


def test_boq_candidate_document_never_guesses():
    docs = [
        {"title": "Specification.pdf", "url": "https://example.test/spec.pdf"},
        {"title": "Bill of Quantities.xlsx", "url": "https://example.test/boq.xlsx"},
        {"title": "Addendum 1.pdf", "url": "https://example.test/add1.pdf"},
    ]
    picked = te._boq_candidate_document(docs)
    check(picked is not None and picked["url"].endswith("boq.xlsx"), f"should pick the BOQ-titled spreadsheet, got {picked}")
    check(te._boq_candidate_document([{"title": "Bill of Quantities.pdf", "url": "https://example.test/boq.pdf"}]) is None,
          "a BOQ-titled document that ISN'T a spreadsheet format must not be picked (nothing to parse as one)")
    check(te._boq_candidate_document([]) is None, "no documents -> no candidate, never fabricated")
    check(te._boq_candidate_document(None) is None, "None documents list never raises")


def test_download_bytes_handles_errors_without_raising():
    import urllib.request

    def boom(*a, **kw):
        raise urllib.error.URLError("name resolution failed")

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = boom
    try:
        data, err = te._download_bytes("https://dead.example.test/doc.pdf")
        check(data is None and "could not download" in err, f"a dead host should degrade honestly, got {(data, err)}")
    finally:
        urllib.request.urlopen = real_urlopen


def test_fetch_boq_items_end_to_end_with_mocked_download():
    """The real boq_extraction parser, fed bytes from a MOCKED download (no
    real network) - proves the CLI's own glue (candidate picking -> download
    -> parse -> items) works, not just each piece in isolation."""
    xlsx_bytes = make_workbook_bytes({"BOQ": [
        ["Description", "Unit", "Qty", "Rate", "Amount"],
        ["Supply and install streetlight poles", "no", 24, 8500, 204000],
    ]})
    docs = [{"title": "Bill of Quantities.xlsx", "url": "https://example.test/boq.xlsx"}]
    logged = []
    orig_download = te._download_bytes
    te._download_bytes = lambda url, timeout=30: (xlsx_bytes, None)
    try:
        items = te._fetch_boq_items(docs, log=logged.append)
    finally:
        te._download_bytes = orig_download
    check(items is not None and len(items) == 1, f"should return the real parsed item, got {items}")
    check(items[0]["quantity"] == 24, f"quantity should be the real parsed number, got {items}")
    check(any("Parsed 1 line item" in m for m in logged), "the parse result should be logged")


def test_fetch_boq_items_download_failure_degrades_honestly():
    docs = [{"title": "Bill of Quantities.xlsx", "url": "https://example.test/boq.xlsx"}]
    logged = []
    orig_download = te._download_bytes
    te._download_bytes = lambda url, timeout=30: (None, "could not download document: 404")
    try:
        items = te._fetch_boq_items(docs, log=logged.append)
    finally:
        te._download_bytes = orig_download
    check(items is None, "a failed download must degrade to None, never a fabricated item list")
    check(any("could not be downloaded" in m for m in logged), "the failure should be logged, not silent")


class FakeOppsClient:
    """Stands in for company_profiles.RestClient: only .select() as
    _tender_context() uses it."""
    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table

    def select(self, table, filters=None, order=None):
        return self.rows_by_table.get(table, [])


def test_tender_context_dedupes_documents_and_reads_the_buyer():
    tender = {"id": "t1"}
    client = FakeOppsClient({"discovered_opportunities": [
        {"company_id": "c1", "tender_id": "t1", "buyer": "City of Tshwane",
         "document_urls": [{"title": "Spec.pdf", "url": "https://example.test/spec.pdf"}]},
        {"company_id": "c2", "tender_id": "t1", "buyer": "City of Tshwane",
         "document_urls": [{"title": "Spec.pdf", "url": "https://example.test/spec.pdf"},
                           {"title": "BOQ.xlsx", "url": "https://example.test/boq.xlsx"}]},
    ]})
    ctx = te._tender_context(client, tender)
    check(len(ctx["documents"]) == 2, f"should de-duplicate the same URL seen from two companies, got {ctx['documents']}")
    check(ctx["buyer"] == "City of Tshwane",
          "buyer must come from discovered_opportunities - tenders itself has no buyer column")


def test_tender_context_never_raises_when_table_read_fails():
    class BrokenClient:
        def select(self, table, filters=None, order=None):
            raise RuntimeError("network down")
    ctx = te._tender_context(BrokenClient(), {"id": "t1"})
    check(ctx == {"documents": [], "buyer": None}, "a broken read should degrade to an empty context, not raise")


class FakeCountsClient:
    def __init__(self, tenders, scope_rows):
        self._tenders, self._scope_rows = tenders, scope_rows

    def select(self, table, filters=None, order=None):
        if table == "tenders":
            return self._tenders
        if table == "tender_scope_records":
            return self._scope_rows
        return []


def test_counts_reports_real_numbers_not_a_sample():
    tenders = [{"id": str(i)} for i in range(5)]
    scope_rows = [
        {"tender_id": "0", "confidence": "heuristic"},
        {"tender_id": "1", "confidence": "heuristic"},
        {"tender_id": "2", "confidence": "document_confirmed"},
        # tenders "3" and "4" have no tender_scope_records row at all
    ]
    orig_client = te._client
    te._client = lambda: FakeCountsClient(tenders, scope_rows)
    try:
        report = te.counts(log=lambda m: None)
    finally:
        te._client = orig_client
    check(report["total_tenders"] == 5, f"total should be the real count, got {report}")
    check(report["tender_scope_records_heuristic"] == 2, f"heuristic count wrong: {report}")
    check(report["tender_scope_records_document_confirmed"] == 1, f"document_confirmed count wrong: {report}")
    check(report["no_tender_scope_record_yet"] == 2, f"'none yet' count wrong: {report}")


def main():
    test_ext_of()
    test_boq_candidate_document_never_guesses()
    test_download_bytes_handles_errors_without_raising()
    test_fetch_boq_items_end_to_end_with_mocked_download()
    test_fetch_boq_items_download_failure_degrades_honestly()
    test_tender_context_dedupes_documents_and_reads_the_buyer()
    test_tender_context_never_raises_when_table_read_fails()
    test_counts_reports_real_numbers_not_a_sample()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
