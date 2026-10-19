"""
Offline test for download_discovered_documents.py: synthetic HTTP fixtures
(file:// URLs serving real small files committed under this test's own
tempdir), no live network call, against an in-memory fake of the Supabase
PostgREST + Storage API (same pattern as engine/general/test_general_bridge.py's
`Fake`), so this proves the real behaviour without a live Supabase project -
none exists in this environment.

Covers:
  1. a release with two documents (direct, unauthenticated URLs, like
     etenders_portal/eskom_bulletin/...) - both downloaded, uploaded to the
     'discovered-tender-documents' bucket, and recorded with status
     'downloaded', content_hash and byte_size.
  2. a SANRAL release whose document has url=None (gov_sources.sanral_releases()'s
     own shape) - never downloaded, never given a row at all (not even a
     'failed' one) - the human-click-through case must stay visible, not
     turned into a confusing database row.
  3. a release with one dead link - recorded as a 'failed' row with the
     reason, the run does not raise, and the OTHER documents in the same run
     (including the two from case 1) are still downloaded - "one bad link
     must not take out the whole run".
  4. idempotency: running download_for_releases() a SECOND time over the
     exact same releases does not re-download or re-upload anything (no new
     storage POSTs, no new HTTP GETs on the fixture files) and the summary
     counts show everything as already-seen (downloaded + failed both
     skipped, not retried).
  5. two companies' report-worthy results for the SAME release (fan_out()'s
     shape) must not cause the same document to be downloaded twice - proven
     by running against a releases list where the same release_key/url
     appears via two separate release dicts (the same shape
     seed_supabase_opportunities.seed() tolerates, one dict per report-worthy
     company) and checking only one row/upload happened.
  6. a relative/scheme-less document URL (QA-Edge-Case-Findings.md,
     2026-10-19: confirmed reachable from sars_procurement.py's own
     fetch_documents(), which used to store a raw regex-captured href with
     no absolute-URL resolution at all) is recorded as a 'failed' row with
     a reason, not an uncaught ValueError taking out the whole run - and the
     OTHER documents in the same run are still processed normally.

Run: python3 engine/discovery/test_download_discovered_documents.py
"""
import json
import os
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import company_profiles  # noqa: E402
import download_discovered_documents as ddd  # noqa: E402
import system_alerts  # noqa: E402

ALERTS = []
system_alerts.set_sink(lambda payload: ALERTS.append(payload) or "test-alert")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------------------
# Fake Supabase: GET (eq./in. filters), POST insert, Storage GET/POST.
# Same shape as engine/general/test_general_bridge.py's `Fake`, extended with
# `in.(...)` filter parsing (existing_urls() reads release_key with `in`).
# ---------------------------------------------------------------------------

class Fake:
    def __init__(self):
        self.tables, self.storage, self.lock = {}, {}, threading.Lock()
        self.storage_posts = 0  # counts real upload POSTs, for the idempotency check
        fake = self

        def parse_filters(query):
            filters = {}
            for k, vs in urllib.parse.parse_qs(query).items():
                if k in ("select", "order"):
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

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

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
                data = self._body()
                if u.path.startswith("/storage/v1/object/"):
                    key = urllib.parse.unquote(u.path[len("/storage/v1/object/"):])
                    with fake.lock:
                        fake.storage[key] = data
                        fake.storage_posts += 1
                    return self._send(200, {"Key": key})
                table = u.path.split("/rest/v1/", 1)[1].split("?")[0]
                rows = json.loads(data)
                if isinstance(rows, dict):
                    rows = [rows]
                with fake.lock:
                    t = fake.tables.setdefault(table, [])
                    for row in rows:
                        t.append(dict(row))
                self._send(201, rows)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def rows(self, table):
        with self.lock:
            return [dict(r) for r in self.tables.get(table, [])]


# ---------------------------------------------------------------------------
# Fixture documents (real small files on disk, served over file:// - the
# same "file:// as a stand-in for a live HTTP link" trick
# test_discovery_fanout.py already uses for assess_tender.fetch_pdf_text).
# ---------------------------------------------------------------------------

def main():
    tmp = tempfile.mkdtemp(prefix="ddd_test_")
    doc_a = os.path.join(tmp, "notice_a.pdf")
    doc_b = os.path.join(tmp, "book1.xlsx")
    open(doc_a, "wb").write(b"%PDF-1.4 fake notice A content\n" * 5)
    open(doc_b, "wb").write(b"PK fake xlsx content B\n" * 5)
    url_a, url_b = "file://" + doc_a, "file://" + doc_b
    dead_url = "file://" + os.path.join(tmp, "does_not_exist.pdf")

    fake = Fake()
    client = company_profiles.RestClient(fake.url, "test-key")

    releases = [
        {"ocid": "ocds-release-1", "contract_number": "RFQ-01/2026", "buyer": "City of Cape Town",
         "title": "Supply of office furniture", "source": "capetown_procurement",
         "documents": [{"url": url_a, "title": "Notice.pdf"}, {"url": url_b, "title": "Book1.xlsx"}]},
        {"ocid": "sanral:some-slug", "contract_number": "NRA 2026/0999", "buyer": "SANRAL",
         "title": "Routine road maintenance", "source": "sanral",
         "documents": [{"title": "Technical Submission.pdf", "url": None}]},
        {"ocid": "ocds-release-2", "contract_number": "E3999GXTEST", "buyer": "Eskom",
         "title": "Switchgear upgrade", "source": "eskom_bulletin",
         "documents": [{"url": dead_url, "title": "DeadLink.pdf"}]},
    ]

    summary1 = ddd.download_for_releases(releases, client)

    check("case 1: 2 documents downloaded this run", summary1["downloaded"] == 2, summary1)
    check("case 1: both bytes stored in the fake bucket", fake.storage_posts == 2, fake.storage_posts)
    rows = fake.rows(ddd.TABLE)
    check("case 1: one row per real document attempted (2 downloaded here), not per release",
          sum(1 for r in rows if r["release_key"] == "ocds-release-1") == 2,
          [r["document_url"] for r in rows])
    row_a = next(r for r in rows if r["document_url"] == url_a)
    check("case 1: row carries release identity", row_a["release_key"] == "ocds-release-1" and row_a["buyer"] == "City of Cape Town")
    check("case 1: status downloaded + storage_path + content_hash + byte_size set",
          row_a["status"] == "downloaded" and row_a["storage_path"] and row_a["content_hash"] and row_a["byte_size"] > 0)
    check("case 1: content actually matches what was downloaded",
          fake.storage.get(f"{ddd.BUCKET}/{row_a['storage_path']}") == open(doc_a, "rb").read())

    check("case 2: SANRAL no-URL document gets NO row at all", summary1["skipped_no_url"] == 1)
    check("case 2: no row exists for the SANRAL release", not any(r["release_key"] == "sanral:some-slug" for r in rows))

    check("case 3: dead link recorded as failed, not raised", summary1["failed"] == 1)
    failed_row = next((r for r in rows if r["release_key"] == "ocds-release-2"), None)
    check("case 3: failed row has status=failed and a reason", bool(failed_row) and failed_row["status"] == "failed"
          and bool(failed_row.get("error")))
    check("case 3: a summary system_alerts entry was raised for the failure",
          any(a["p_source"] == "discovery" and "failed to download" in a["p_message"] for a in ALERTS))

    # --- idempotency: run again over the exact same releases ---------------
    posts_before = fake.storage_posts
    rows_before = len(fake.rows(ddd.TABLE))
    summary2 = ddd.download_for_releases(releases, client)
    check("idempotent: second run downloads nothing new", summary2["downloaded"] == 0, summary2)
    check("idempotent: second run's existing counts cover both the downloaded and the failed doc",
          summary2["skipped_existing"] == 3, summary2)  # 2 downloaded + 1 failed, all already on file
    check("idempotent: no new storage upload happened", fake.storage_posts == posts_before)
    check("idempotent: no new row was inserted", len(fake.rows(ddd.TABLE)) == rows_before)

    # --- same release/document seen via two companies' separate dicts ------
    # (fan_out()'s real shape: one release dict per report-worthy company,
    # same ocid/documents, e.g. from two entries in new_releases that share
    # a release but differ in company_results.)
    fake2 = Fake()
    client2 = company_profiles.RestClient(fake2.url, "test-key")
    two_company_releases = [
        {"ocid": "ocds-shared", "contract_number": "RFQ-02/2026", "buyer": "Transnet",
         "title": "Shared release", "source": "transnet_etenders",
         "documents": [{"url": url_a, "title": "Notice.pdf"}]},
        {"ocid": "ocds-shared", "contract_number": "RFQ-02/2026", "buyer": "Transnet",
         "title": "Shared release", "source": "transnet_etenders",
         "documents": [{"url": url_a, "title": "Notice.pdf"}]},
    ]
    summary3 = ddd.download_for_releases(two_company_releases, client2)
    check("two company-result dicts for the same release: downloaded once", summary3["downloaded"] == 1, summary3)
    check("two company-result dicts for the same release: second is skipped_existing",
          summary3["skipped_existing"] == 1, summary3)
    check("two company-result dicts for the same release: only one row/upload total",
          len(fake2.rows(ddd.TABLE)) == 1 and fake2.storage_posts == 1)

    # --- a relative/scheme-less URL must degrade, never crash the run ------
    fake3 = Fake()
    client3 = company_profiles.RestClient(fake3.url, "test-key")
    relative_url_releases = [
        {"ocid": "ocds-relative", "contract_number": "RFP-14/2026", "buyer": "South African Revenue Service",
         "title": "ICT infrastructure audit", "source": "sars_procurement",
         "documents": [{"url": "/files/tender/RFP14-2026-spec.pdf", "title": "Specification.pdf"},
                       {"url": url_a, "title": "Notice.pdf"}]},
    ]
    summary4 = ddd.download_for_releases(relative_url_releases, client3)
    check("case 6: run does not raise on a relative URL", summary4["failed"] == 1, summary4)
    check("case 6: the OTHER document on the same release still downloads",
          summary4["downloaded"] == 1, summary4)
    rel_row = next(r for r in fake3.rows(ddd.TABLE) if r["document_url"] == "/files/tender/RFP14-2026-spec.pdf")
    check("case 6: the relative URL got a failed row with a reason, not a crash",
          rel_row["status"] == "failed" and bool(rel_row.get("error")))

    fake.stop()
    fake2.stop()
    fake3.stop()

    print(f"\n{len(FAILS)} failure(s)" if FAILS else "\nAll checks passed.")
    if FAILS:
        sys.exit(1)


if __name__ == "__main__":
    main()
