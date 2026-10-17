"""
A small in-memory stand-in for the slice of Supabase's REST + Storage API that
engine/cv/process_cv_jobs.py talks to. Test-only: used by
engine/worker/test_poll_loop.py to prove the --loop mode really loops (picks up
a job, sleeps, picks up a second job that only appeared after the sleep)
without a live Supabase project - none exists in this environment.

It understands only the exact URL shapes process_cv_jobs.py sends
(`table?col=eq.value&col2=eq.value&select=...` for GET/PATCH, and
`/storage/v1/object/<bucket>/<path>` for uploads), plus the
`rpc/record_system_alert` call every bridge makes on a failure (0042), kept
in `tables["system_alerts"]`. It is not a general
PostgREST emulator and is never used outside tests.

Every request is recorded in `server.request_log` as (method, path) so a test
can compare one run's request sequence against another's.
"""
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _parse_filters(query):
    filters = {}
    for k, vs in urllib.parse.parse_qs(query).items():
        if k == "select":
            continue
        v = vs[0]
        if v.startswith("eq."):
            filters[k] = v[3:]
        elif v == "is.null":
            filters[k] = IS_NULL
    return filters


IS_NULL = object()


def _match(row, filters):
    return all(row.get(k) is None if v is IS_NULL else str(row.get(k)) == v for k, v in filters.items())


class FakeSupabase:
    def __init__(self):
        self.tables = {}          # table name -> list of row dicts
        self.storage = {}         # "bucket/path" -> bytes
        self.request_log = []
        self.lock = threading.Lock()
        handler = self._make_handler()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def insert(self, table, row):
        with self.lock:
            self.tables.setdefault(table, []).append(dict(row))

    def rows(self, table):
        with self.lock:
            return [dict(r) for r in self.tables.get(table, [])]

    def _make_handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, payload):
                body = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def do_GET(self):
                fake.request_log.append(("GET", self.path))
                parsed = urllib.parse.urlparse(self.path)
                table = parsed.path.split("/rest/v1/", 1)[-1]
                filters = _parse_filters(parsed.query)
                with fake.lock:
                    rows = [dict(r) for r in fake.tables.get(table, []) if _match(r, filters)]
                self._send(200, rows)

            def do_PATCH(self):
                fake.request_log.append(("PATCH", self.path))
                parsed = urllib.parse.urlparse(self.path)
                table = parsed.path.split("/rest/v1/", 1)[-1]
                filters = _parse_filters(parsed.query)
                patch = json.loads(self._body() or b"{}")
                updated = []
                with fake.lock:
                    for r in fake.tables.get(table, []):
                        if _match(r, filters):
                            r.update(patch)
                            updated.append(dict(r))
                self._send(200, updated)

            def do_POST(self):
                fake.request_log.append(("POST", self.path))
                data = self._body()
                if self.path.startswith("/storage/v1/object/"):
                    key = self.path[len("/storage/v1/object/"):]
                    with fake.lock:
                        fake.storage[key] = data
                    self._send(200, {"Key": key})
                elif self.path.startswith("/rest/v1/rpc/record_system_alert"):
                    # engine/alerts/system_alerts.py's write (0042): one row per
                    # open fingerprint, repeats counted - the SQL function's rule.
                    p = json.loads(data or b"{}")
                    with fake.lock:
                        rows = fake.tables.setdefault("system_alerts", [])
                        hit = next((r for r in rows if r["fingerprint"] == p["p_fingerprint"]
                                    and not r.get("resolved_at")), None)
                        if hit:
                            hit["occurrences"] += 1
                            hit["detail"] = p.get("p_detail") or hit.get("detail")
                            hit["context"] = p.get("p_context") or {}
                        else:
                            hit = {"id": f"alert-{len(rows) + 1}", "source": p["p_source"], "severity": p["p_severity"],
                                   "message": p["p_message"], "detail": p.get("p_detail"),
                                   "context": p.get("p_context") or {}, "fingerprint": p["p_fingerprint"],
                                   "occurrences": 1, "reported_at": None, "reported_occurrences": 0,
                                   "resolved_at": None}
                            rows.append(hit)
                    self._send(200, hit["id"])
                else:
                    self._send(404, {"message": "not handled by FakeSupabase"})

        return Handler
