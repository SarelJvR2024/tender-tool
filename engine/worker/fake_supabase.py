"""
A small in-memory stand-in for the slice of Supabase's REST + Storage API that
engine/cv/process_cv_jobs.py talks to. Test-only: used by
engine/worker/test_poll_loop.py to prove the --loop mode really loops (picks up
a job, sleeps, picks up a second job that only appeared after the sleep)
without a live Supabase project - none exists in this environment.

It understands only the exact URL shapes process_cv_jobs.py sends
(`table?col=eq.value&col2=eq.value&select=...` for GET/PATCH, and
`/storage/v1/object/<bucket>/<path>` for uploads). It is not a general
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
    return filters


def _match(row, filters):
    return all(str(row.get(k)) == v for k, v in filters.items())


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
                else:
                    self._send(404, {"message": "not handled by FakeSupabase"})

        return Handler
