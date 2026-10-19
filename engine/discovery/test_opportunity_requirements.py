"""
Offline test for opportunity_requirements.py: in-memory fake of the Supabase
PostgREST + Storage API (same `Fake` shape as
test_download_discovered_documents.py), real committed sample documents
(templates/samples/*.xlsm, templates/forms/R.396-010-2025.1F/*.docx,
templates/general_samples/treasury_rt83/*) so classify_documents() /
check_fingerprint() run against genuine files, not synthetic bytes - no live
Supabase project exists in this environment.

Covers:
  1. a release with no discovered_opportunity_documents rows at all ->
     classify_release() returns None (the "not_downloaded" state is the
     ABSENCE of a row, never a fabricated row).
  2. a release where every document URL failed to download (status='failed'
     rows only) -> a row IS written, but route/family are null and the
     signal says plainly that nothing could be classified.
  3. a real SANRAL R.396 Technical + Financial workbook + the three A-Forms
     docx -> route='sanral', family detected, fingerprint_status populated
     (ok against the committed baseline, if one exists for this sample - the
     test accepts whatever check_fingerprint() honestly reports, it does not
     assert a specific status), missing=[] (every required doc present).
  4. the same SANRAL workbook with the A-Forms/Form-of-Offer docx removed ->
     missing lists exactly those labels.
  5. a general (non-SANRAL) release (Treasury RT83's own documents) -> route
     reported (general or sanral, whichever classify_documents() genuinely
     decides from the real file), never a fabricated general-tender
     requirement list.
  6. a PDF-only release (nothing classifiable) -> route='general', family
     None, an honest "nothing to route on yet" signal, document_count > 0.

Run: python3 engine/discovery/test_opportunity_requirements.py
"""
import json
import os
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(ENGINE, ".."))
sys.path.insert(0, HERE)
import company_profiles  # noqa: E402
import opportunity_requirements as oreq  # noqa: E402

SAMPLES = os.path.join(ROOT, "templates")
R396_TECH = os.path.join(SAMPLES, "samples", "R.396-010-2025.1F_ran.xlsm")
R396_FIN = os.path.join(SAMPLES, "samples", "financial", "R.396-010-2025.1F_Financial_Submission_ran.xlsm")
R396_FORMS = os.path.join(SAMPLES, "forms", "R.396-010-2025.1F")
RT83 = os.path.join(SAMPLES, "general_samples", "treasury_rt83")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class Fake:
    """Same shape as test_download_discovered_documents.py's Fake, with
    `in`/`eq` filter parsing and a Storage GET that serves whatever bytes
    were POSTed under that key (this test seeds storage directly via
    self.put(), never through the download path - opportunity_requirements.py
    only ever READS storage)."""

    def __init__(self):
        self.tables, self.storage, self.lock = {}, {}, threading.Lock()
        fake = self

        def parse_filters(query):
            filters = {}
            for k, vs in urllib.parse.parse_qs(query).items():
                if k in ("select", "order", "on_conflict"):
                    continue
                v = vs[0]
                if v.startswith("eq."):
                    filters[k] = ("eq", v[3:])
                elif v.startswith("in."):
                    inner = v[3:].strip("()")
                    vals = [p.strip('"') for p in inner.split(",") if p.strip('"')]
                    filters[k] = ("in", vals)
            return filters

        def row_matches(row, filters):
            for k, (op, v) in filters.items():
                if op == "eq" and str(row.get(k)) != v:
                    return False
                if op == "in" and str(row.get(k)) not in v:
                    return False
            return True

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, payload, raw=None):
                body = raw if raw is not None else json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                if u.path.startswith("/storage/v1/object/"):
                    key = urllib.parse.unquote(u.path[len("/storage/v1/object/"):])
                    data = fake.storage.get(key)
                    return self._send(200, None, data) if data is not None else self._send(404, {"message": "not found"})
                table = u.path.split("/rest/v1/", 1)[1]
                filters = parse_filters(u.query)
                with fake.lock:
                    rows = [dict(r) for r in fake.tables.get(table, []) if row_matches(r, filters)]
                self._send(200, rows)

            def do_POST(self):
                u = urllib.parse.urlparse(self.path)
                n = int(self.headers.get("Content-Length") or 0)
                data = self.rfile.read(n) if n else b""
                table = u.path.split("/rest/v1/", 1)[1].split("?")[0]
                rows = json.loads(data)
                if isinstance(rows, dict):
                    rows = [rows]
                on_conflict = urllib.parse.parse_qs(u.query).get("on_conflict", [None])[0]
                with fake.lock:
                    t = fake.tables.setdefault(table, [])
                    for row in rows:
                        if on_conflict:
                            t[:] = [r for r in t if r.get(on_conflict) != row.get(on_conflict)]
                        t.append(dict(row))
                self._send(201, rows)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def put(self, path, data):
        self.storage[f"{oreq.BUCKET}/{path}"] = data

    def seed_docs(self, release_key, docs):
        """docs: [(document_title, local_path_or_None, status)]. local_path
        is read and stored under a synthetic storage_path; status='failed'
        gets no storage_path, matching download_discovered_documents.py's
        own row shapes."""
        rows = self.tables.setdefault(oreq.DOCS_TABLE, [])
        for i, (title, local, status) in enumerate(docs):
            row = {"release_key": release_key, "document_title": title, "document_url": f"https://example/{i}",
                   "status": status, "source": "etenders_portal", "buyer": "Test Buyer"}
            if status == "downloaded":
                path = f"test/{release_key}/{i}-{title}"
                self.put(path, open(local, "rb").read())
                row["storage_path"] = path
            rows.append(row)


def req_row(fake, key):
    return next((r for r in fake.rows(oreq.REQ_TABLE) if r["release_key"] == key), None)


Fake.rows = lambda self, table: [dict(r) for r in self.tables.get(table, [])]


def main():
    fake = Fake()
    client = company_profiles.RestClient(fake.url, "test-key")

    # 1. nothing downloaded at all
    result = oreq.classify_release(client, "no-docs-release")
    check("case 1: no documents rows at all -> None (not_downloaded is absence, not a fake row)", result is None)

    # 2. every document failed to download
    fake.seed_docs("all-failed-release", [("Notice.pdf", None, "failed"), ("Book1.xlsx", None, "failed")])
    r2 = oreq.classify_release(client, "all-failed-release")
    check("case 2: a row is written even though everything failed", r2 is not None)
    check("case 2: route/family are null, not guessed", r2 and r2["route"] is None and r2["family"] is None)
    check("case 2: failed_downloads counted", r2 and r2["failed_downloads"] == 2, r2)

    # 3. real SANRAL R.396 set, everything present
    if os.path.exists(R396_TECH) and os.path.exists(R396_FIN) and os.path.isdir(R396_FORMS):
        fake.seed_docs("sanral-full-release", [
            ("Technical Submission.xlsm", R396_TECH, "downloaded"),
            ("Financial Submission.xlsm", R396_FIN, "downloaded"),
            ("C.1.1.1 Form of Offer.docx", os.path.join(R396_FORMS, "C.1.1.1_Form_of_Offer.docx"), "downloaded"),
            ("C.1.2.3 Contract Data.docx", os.path.join(R396_FORMS, "C.1.2.3_Contract_Data.docx"), "downloaded"),
            ("A-Forms.docx", os.path.join(R396_FORMS, "A_Forms.docx"), "downloaded"),
        ])
        r3 = oreq.classify_release(client, "sanral-full-release")
        check("case 3: route=sanral for a real R.396 Technical workbook", r3 and r3["route"] == "sanral", r3 and r3.get("signal"))
        check("case 3: a known family was detected", r3 and bool(r3["family"]))
        check("case 3: fingerprint_status was actually computed (not left null)", r3 and r3["fingerprint_status"] is not None)
        check("case 3: nothing required is missing - every SANRAL doc was uploaded", r3 and r3["missing"] == [], r3 and r3["missing"])
        check("case 3: document_count matches what was downloaded", r3 and r3["document_count"] == 5)

        # 4. same set, A-Forms removed
        fake.seed_docs("sanral-missing-release", [
            ("Technical Submission.xlsm", R396_TECH, "downloaded"),
            ("Financial Submission.xlsm", R396_FIN, "downloaded"),
            ("C.1.1.1 Form of Offer.docx", os.path.join(R396_FORMS, "C.1.1.1_Form_of_Offer.docx"), "downloaded"),
        ])
        r4 = oreq.classify_release(client, "sanral-missing-release")
        check("case 4: route=sanral still (workbook alone is the routing signal)", r4 and r4["route"] == "sanral")
        check("case 4: missing lists exactly the two omitted docs (C.1.2.3, A-Forms)",
              r4 and r4["missing"] == ["C.1.2.3 Contract Data (.docx)", "A-Forms / returnable schedules (.docx)"], r4 and r4["missing"])
    else:
        print("  (skipped cases 3/4: committed R.396 sample files not found)")

    # 5. a general (non-SANRAL) release - Treasury RT83's real documents, whatever they are
    if os.path.isdir(RT83):
        general_files = [f for f in os.listdir(RT83) if f.lower().endswith((".xlsx", ".xlsm", ".docx"))][:3]
        if general_files:
            fake.seed_docs("general-release", [(f, os.path.join(RT83, f), "downloaded") for f in general_files])
            r5 = oreq.classify_release(client, "general-release")
            check("case 5: a real general-tender document set classifies without raising", r5 is not None)
            check("case 5: route is one of general/sanral, never fabricated", r5 and r5["route"] in ("general", "sanral"), r5 and r5.get("route"))
        else:
            print("  (skipped case 5: no classifiable file in treasury_rt83)")
    else:
        print("  (skipped case 5: templates/general_samples/treasury_rt83 not found)")

    # 6. PDF-only release - nothing classifiable
    pdf_path = os.path.join(HERE, "__test_fixture_notice.pdf")
    open(pdf_path, "wb").write(b"%PDF-1.4 fake notice\n" * 5)
    try:
        fake.seed_docs("pdf-only-release", [("Tender Notice.pdf", pdf_path, "downloaded")])
        r6 = oreq.classify_release(client, "pdf-only-release")
        check("case 6: PDF-only -> route general, nothing classifiable, no crash", r6 and r6["route"] == "general" and r6["family"] is None, r6)
        check("case 6: document_count still reflects what was downloaded", r6 and r6["document_count"] == 1)
    finally:
        os.remove(pdf_path)

    # classify_all() writes rows via upsert and is idempotent on release_key
    summary = oreq.classify_all(client)
    check("classify_all: covers every release with downloaded documents", summary["classified"] >= 2, summary)
    rows_before = len(fake.rows(oreq.REQ_TABLE))
    oreq.classify_all(client)
    check("classify_all: re-running upserts (no duplicate rows per release_key)",
          len(fake.rows(oreq.REQ_TABLE)) == rows_before, (rows_before, len(fake.rows(oreq.REQ_TABLE))))

    fake.stop()
    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nAll checks passed.")
    if FAILS:
        sys.exit(1)


if __name__ == "__main__":
    main()
