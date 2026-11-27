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
        if k in ("select", "order"):
            continue
        v = vs[0]
        if v.startswith("eq."):
            filters[k] = v[3:]
        elif v == "is.null":
            filters[k] = IS_NULL
    return filters


IS_NULL = object()


def _parse_order(query):
    """("col.asc"/"col.desc"/bare "col", comma-separated for multiple keys) ->
    [(column, reverse), ...] or None - PostgREST's own `order=` syntax. Found
    2026-11-09 (worker/job-queue rotation): this fake server used to silently
    drop `order` entirely (treated the same as any other unrecognised filter
    value, never sorting) and always returned rows in INSERTION order instead
    - harmless for every existing test (each only ever queues one 'requested'
    row at a time), but a real, demonstrable divergence from Supabase's own
    behaviour that would have let the real worker's FIFO ordering silently
    regress with no test able to catch it.

    Finding 517 (worker/job-queue rotation, 13th lap): this only ever parsed
    the FIRST "." in the order value, so a compound order like
    "requested_at.asc,id.asc" - exactly what process_cv_jobs.supabase_
    request_all()'s real caller now always sends, since Finding 516 added an
    unconditional id.asc tie-breaker to it this same window - had its whole
    ",id.asc" tail swallowed into the "direction" string, which can never
    equal "desc", so the secondary tie-breaker column was silently dropped
    rather than applied. Reproduced directly: two rows sharing one
    requested_at, inserted id "z" then id "a", queried with
    "order=requested_at.asc,id.asc" came back ['z', 'a'] (pure insertion
    order) instead of the real, guaranteed ['a', 'z']."""
    vs = urllib.parse.parse_qs(query).get("order")
    if not vs:
        return None
    parts = []
    for part in vs[0].split(","):
        col, _, direction = part.partition(".")
        parts.append((col, direction == "desc"))
    return parts


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
                order = _parse_order(parsed.query)
                if order:
                    # Stable sort applied last-key-first: each later pass's
                    # own stability preserves the prior (lower-priority)
                    # pass's own tie order among rows it left equal - the
                    # standard trick for a multi-key sort with a per-key
                    # direction (Finding 517).
                    for col, reverse in reversed(order):
                        rows.sort(key=lambda r, col=col: (r.get(col) is None, r.get(col)), reverse=reverse)
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
