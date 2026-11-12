import contextlib
import datetime
import io
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import process_narrative_jobs as pnj  # noqa: E402
import system_alerts  # noqa: E402  (on the path via poll_loop, same as watch_deadlines's own tests)

FAILS = []
ALERTS = []
system_alerts.set_sink(lambda payload: ALERTS.append(payload) or "test-alert")


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class StubSupabase:
    """Stands in for pnj.supabase_request - returns canned rows keyed by the
    path's resource name (the bit before '?'), so each adapter function can
    be tested without a real Supabase connection."""
    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    def __call__(self, url, key, method, path, body=None):
        self.calls.append((method, path, body))
        resource = path.split("?", 1)[0]
        return self.tables.get(resource, [])


def _patch(monkeypatch_tables):
    stub = StubSupabase(monkeypatch_tables)
    original = pnj.supabase_request
    pnj.supabase_request = stub
    return stub, original


# ---------------------------------------------------------------------------
# claim_job() / fail_stale_jobs() / process_one()'s own PATCH filters were
# never exercised anywhere in this repo - StubSupabase above ignores the
# querystring entirely (any GET/PATCH on a resource returns/mutates every
# row), so it can't tell an atomic "status=eq.requested" claim from a
# no-op one. FakeDB actually applies eq./neq. filters to GETs and PATCHes
# real rows in place (mimicking PostgREST's own filtered-PATCH-with-
# Prefer:-return=representation contract), so these tests exercise the
# real claim/fulfil mechanism this whole bridge exists for, not just the
# adapter functions around it. QA pass, 2026-10-27.
# ---------------------------------------------------------------------------

def _parse_filters(qs):
    import urllib.parse
    filters = []
    for key, vals in urllib.parse.parse_qs(qs).items():
        if key in ("select", "order", "limit"):
            continue
        val = vals[0]
        if val.startswith("eq."):
            filters.append((key, "eq", val[3:]))
        elif val.startswith("neq."):
            filters.append((key, "neq", val[4:]))
        elif val.startswith("in."):
            filters.append((key, "in", val[3:].strip("()").split(",")))
    return filters


def _row_matches(row, filters):
    for col, op, val in filters:
        rv = row.get(col)
        if op == "eq" and str(rv) != val:
            return False
        if op == "neq" and str(rv) == val:
            return False
        if op == "in" and str(rv) not in val:
            return False
    return True


class FakeDB:
    """A minimal, real in-memory PostgREST stand-in: GET returns rows
    matching the querystring's own eq./neq./in. filters; PATCH updates only
    the rows that match (never every row of the resource) and returns
    them, same as Prefer: return=representation - so an empty return really
    does mean 'the filter matched nothing', exactly what claim_job()'s own
    atomicity depends on."""
    def __init__(self, tables):
        self.tables = {k: list(v) for k, v in tables.items()}
        self.calls = []

    def __call__(self, url, key, method, path, body=None):
        self.calls.append((method, path, body))
        resource, _, qs = path.partition("?")
        rows = self.tables.setdefault(resource, [])
        matched = [r for r in rows if _row_matches(r, _parse_filters(qs))]
        if method == "GET":
            return matched
        if method == "PATCH":
            for r in matched:
                r.update(body)
            return matched
        raise ValueError(f"FakeDB does not support {method}")


class FakeDBWithGeneratingUniqueIndex(FakeDB):
    """Same as FakeDB, but also enforces migration 0130's own real
    constraint: at most one row of narrative_documents may hold
    status='generating' for a given (tender_id, kind) at a time. A PATCH
    that would create a second one raises RuntimeError the same shape
    supabase_request() itself raises on an HTTPError (claim_job() greps the
    message for '23505' and the index name - this mirrors that exact
    string), so claim_job()'s own except branch is exercised for real
    rather than assumed. Only narrative_documents is guarded; every other
    resource behaves exactly like plain FakeDB."""

    def __call__(self, url, key, method, path, body=None):
        resource = path.split("?", 1)[0]
        if resource == "narrative_documents" and method == "PATCH" and (body or {}).get("status") == "generating":
            to_patch = [r for r in self.tables.get(resource, [])
                        if _row_matches(r, _parse_filters(path.partition("?")[2]))]
            for row in to_patch:
                clash = any(
                    other is not row and other.get("status") == "generating"
                    and other.get("tender_id") == row.get("tender_id") and other.get("kind") == row.get("kind")
                    for other in self.tables.get(resource, [])
                )
                if clash:
                    raise RuntimeError(
                        "PATCH narrative_documents failed: 409 "
                        '{"code":"23505","message":"duplicate key value violates unique constraint '
                        '\\"narrative_documents_one_generating_per_tender_kind\\""}')
        return super().__call__(url, key, method, path, body)


def test_claim_job_is_atomic_a_second_claim_on_the_same_row_fails():
    db = FakeDB({"narrative_documents": [{"id": "job-1", "status": "requested"}]})
    original = pnj.supabase_request
    pnj.supabase_request = db
    try:
        first = pnj.claim_job("url", "key", {"id": "job-1"})
        second = pnj.claim_job("url", "key", {"id": "job-1"})
    finally:
        pnj.supabase_request = original
    check("the first claim on a 'requested' row succeeds", first is True)
    check("a second claim on the SAME row (now 'generating') fails, not re-claimed",
          second is False)
    check("the row really did move to 'generating', not left untouched",
          db.tables["narrative_documents"][0]["status"] == "generating")
    check("started_at was stamped by the successful claim",
          db.tables["narrative_documents"][0].get("started_at") is not None)


def test_claim_job_defers_not_fails_when_a_different_company_already_holds_the_same_tender_kind_slot():
    """Standing review, 2026-11-10 (migration 0130): the anti-collusion
    uniqueness check (uniqueness.py) only ever compares a new draft against
    OTHER companies' already-'ready' documents for the same (tender_id,
    kind) - a job still 'generating' is invisible to it. Once narrative was
    wired into run_bridges.py (2026-10-25) and this repo's own documented
    deployment model allows a hosted worker and a hand-run --once to
    overlap, two companies' jobs for the SAME tender+kind could both reach
    'generating' at once (reproduced live against a real replayed Postgres
    schema - see 0130's own migration header) and neither would ever see
    the other's in-flight draft. The fix is a partial unique index; this
    test exercises claim_job()'s own handling of the 23505 it now produces:
    a second company's claim for a DIFFERENT row sharing the same
    (tender_id, kind) as one already 'generating' must be deferred - treated
    exactly like 'already claimed by another worker' - never recorded as a
    job failure (the job is fine, it just has to wait its turn)."""
    db = FakeDBWithGeneratingUniqueIndex({"narrative_documents": [
        {"id": "alpha-job", "company_id": "alpha", "tender_id": "tender-1", "kind": "cover_letter",
         "status": "generating"},  # another company's job already won this tender+kind's slot
        {"id": "beta-job", "company_id": "beta", "tender_id": "tender-1", "kind": "cover_letter",
         "status": "requested"},
        {"id": "unrelated-job", "company_id": "gamma", "tender_id": "tender-2", "kind": "cover_letter",
         "status": "requested"},  # different tender_id - must be unaffected
    ]})
    original = pnj.supabase_request
    pnj.supabase_request = db
    try:
        beta_claimed = pnj.claim_job("url", "key", {"id": "beta-job"})
        unrelated_claimed = pnj.claim_job("url", "key", {"id": "unrelated-job"})
    finally:
        pnj.supabase_request = original
    check("beta's claim is deferred (False), not raised as an exception", beta_claimed is False)
    check("beta's row is left exactly as 'requested' - not corrupted, not marked failed",
          db.tables["narrative_documents"][1]["status"] == "requested")
    check("a DIFFERENT tender_id's claim is unaffected by the index and still succeeds",
          unrelated_claimed is True)
    check("the unrelated row really did move to 'generating'",
          db.tables["narrative_documents"][2]["status"] == "generating")


def test_fail_stale_jobs_marks_old_generating_jobs_failed_and_leaves_fresh_ones_alone():
    now = datetime.datetime(2026, 10, 27, 12, 0, tzinfo=datetime.timezone.utc)
    old = (now - datetime.timedelta(minutes=45)).isoformat()   # past STALE_AFTER_MINUTES=30
    fresh = (now - datetime.timedelta(minutes=5)).isoformat()  # well within it
    db = FakeDB({"narrative_documents": [
        {"id": "stuck", "company_id": "c-stuck", "status": "generating", "started_at": old},
        {"id": "running", "company_id": "c-running", "status": "generating", "started_at": fresh},
        # QA Finding, 2026-10-29: a malformed started_at used to raise
        # straight out of this function's own for loop, with no per-row
        # guard - one bad value aborted the stale-reclaim sweep for every
        # OTHER genuinely stuck job too (same bug class as watch_deadlines.
        # days_until()'s own malformed-date guard).
        {"id": "corrupt", "company_id": "c-corrupt", "status": "generating", "started_at": "not-a-real-timestamp"},
    ]})
    ALERTS.clear()
    original = pnj.supabase_request
    pnj.supabase_request = db
    try:
        pnj.fail_stale_jobs("url", "key", now=now)
    finally:
        pnj.supabase_request = original
    rows = {r["id"]: r for r in db.tables["narrative_documents"]}
    check("a job stuck 'generating' for longer than STALE_AFTER_MINUTES is marked failed",
          rows["stuck"]["status"] == "failed", rows["stuck"])
    check("...with a customer-facing reason, not left blank",
          bool(rows["stuck"].get("error_message")))
    check("a job that only just started is left alone, not prematurely failed",
          rows["running"]["status"] == "generating", rows["running"])
    check("a malformed started_at does not crash the sweep and is left generating, not guessed at",
          rows["corrupt"]["status"] == "generating", rows["corrupt"])
    # Finding 188 (2026-11-07): this bridge used to be the ONE process_*_jobs.py
    # sibling whose fail_stale_jobs() never alerted on the real reclaim at all -
    # pack/general's own siblings both raise an "error"-severity alert the
    # moment a row is actually marked failed for staleness. Fixed to match:
    # the genuinely stuck job now gets its own "error" alert too, alongside
    # the pre-existing "warning" for the malformed-timestamp row.
    check("exactly two alerts were recorded: the genuinely stale job (error) and the "
          "malformed-timestamp row (warning) - the malformed row did not silently cost "
          "the stuck job its own alert",
          [(a["p_source"], a["p_severity"]) for a in ALERTS] ==
          [("narrative", "error"), ("narrative", "warning")], ALERTS)
    check("the stale-reclaim alert carries the job's own company_id",
          ALERTS[0]["p_context"].get("company_id") == "c-stuck", ALERTS)
    check("the malformed-timestamp alert carries the job's own company_id too",
          ALERTS[1]["p_context"].get("company_id") == "c-corrupt", ALERTS)


class RaisingOnFirstStaleWrite(FakeDB):
    """The identical shape as process_pack_jobs.py's own RaisingOnFirstUpdate
    (Finding 454): the FIRST mark-failed PATCH (for the first stale job the
    sweep reaches) itself raises; every later PATCH succeeds normally.
    Models a transient Supabase failure (a network blip, a 500) hitting one
    stale row's own write, not a malformed value on the row itself - the
    write-side gap this function's own fail_stale_jobs() never got, only its
    read-side started_at parse was guarded (2026-10-29)."""
    def __init__(self, tables):
        super().__init__(tables)
        self._raised = False

    def __call__(self, url, key, method, path, body=None):
        resource = path.split("?", 1)[0]
        if (not self._raised and resource == "narrative_documents" and method == "PATCH"
                and (body or {}).get("status") == "failed"):
            self._raised = True
            raise RuntimeError("simulated transient Supabase failure marking a stale job failed")
        return super().__call__(url, key, method, path, body)


def test_fail_stale_jobs_survives_a_write_failure_marking_one_stale_job_failed():
    print("fail_stale_jobs(): a write failure (transient Supabase error) marking ONE stale narrative "
          "job failed must not abort the sweep for every OTHER genuinely stale job - the write-side "
          "half of the 2026-10-29 QA pass's own bug class, never applied to this function's own "
          "mark-failed PATCH call")
    now = datetime.datetime(2026, 11, 12, 12, 0, tzinfo=datetime.timezone.utc)
    stale = (now - datetime.timedelta(minutes=45)).isoformat()  # past STALE_AFTER_MINUTES=30
    db = RaisingOnFirstStaleWrite({"narrative_documents": [
        {"id": "job-first", "company_id": "co-a", "status": "generating", "started_at": stale},
        {"id": "job-second", "company_id": "co-b", "status": "generating", "started_at": stale},
    ]})
    ALERTS.clear()
    original = pnj.supabase_request
    pnj.supabase_request = db
    try:
        pnj.fail_stale_jobs("url", "key", now=now)
    finally:
        pnj.supabase_request = original
    rows = {r["id"]: r for r in db.tables["narrative_documents"]}
    check("the job whose own mark-failed write failed is reported, not silently stuck forever",
          any("Could not mark" in a["p_message"] for a in ALERTS), ALERTS)
    check("that job is left 'generating' (untouched), not left in some half-updated state",
          rows["job-first"]["status"] == "generating", rows["job-first"])
    check("the OTHER stale job, queued after the one whose write failed, is still reached and "
          "marked failed - the sweep does not abort on the first row's own write failure",
          rows["job-second"]["status"] == "failed", rows["job-second"])
    check("error_message is set on the job that was actually marked failed",
          bool(rows["job-second"].get("error_message")))


def test_process_one_happy_path_writes_ready_with_every_generation_field():
    db = FakeDB({
        "narrative_documents": [{"id": "job-1", "status": "requested"}],
        "companies": [{"id": "c1", "legal_name": "Mahlangu Civils"}],
        "tenders": [{"id": "t1", "contract_no": "N.004-010-2026/1F", "title": "N4 Rehab", "buyer": "SANRAL"}],
        "people": [], "experience_items": [],
    })
    original_db, original_build_docx, original_storage_upload, original_generate = (
        pnj.supabase_request, pnj.build_docx, pnj.storage_upload, pnj.generate_with_uniqueness_check)
    pnj.supabase_request = db
    pnj.build_docx = lambda *a, **k: None
    pnj.storage_upload = lambda *a, **k: None
    pnj.generate_with_uniqueness_check = lambda context, other_texts: {
        "sections": [], "plain_text": "Dear Sir/Madam...", "similarity_score": 0.12,
        "similarity_flagged": False, "regenerated_for_distinctness": False,
        "quality_review_passes": 2, "quality_flagged": False,
    }
    try:
        pnj.process_one("url", "key", {"id": "job-1", "company_id": "c1", "tender_id": "t1",
                                        "kind": "cover_letter", "style_length": "standard",
                                        "style_detail": "detailed", "style_visual": "structured",
                                        "style_color": "navy"}, "/tmp")
    finally:
        (pnj.supabase_request, pnj.build_docx, pnj.storage_upload,
         pnj.generate_with_uniqueness_check) = (original_db, original_build_docx,
                                                 original_storage_upload, original_generate)
    row = db.tables["narrative_documents"][0]
    check("status moved all the way to ready", row["status"] == "ready", row)
    check("generated_text was recorded", row.get("generated_text") == "Dear Sir/Madam...")
    check("similarity_score was recorded, not dropped", row.get("similarity_score") == 0.12)
    check("quality_review_passes was recorded", row.get("quality_review_passes") == 2)
    check("generated_storage_path points under this tender/job", "t1" in row.get("generated_storage_path", ""))


def test_process_one_transient_error_requeues_quietly_but_setup_error_requeues_and_raises():
    """The two 'not this job's fault' exceptions are handled on purpose
    differently: TransientError is swallowed so the loop carries on to the
    next job this same poll; SetupError re-raises (same reasoning as
    extract_cv_fields.py's own SetupError handling) so a worker that's
    missing its API key stops hammering every other queued job with the
    same doomed call instead of burning through the whole batch first.
    Both must still revert the row to 'requested' either way - never leave
    it stuck 'generating'."""
    def _run(exc_cls):
        db = FakeDB({"narrative_documents": [{"id": "job-1", "status": "requested"}]})
        original_db, original_build_context = pnj.supabase_request, pnj.build_context
        pnj.supabase_request = db
        pnj.build_context = lambda *a, **k: (_ for _ in ()).throw(exc_cls("boom"))
        try:
            raised = False
            try:
                pnj.process_one("url", "key", {"id": "job-1", "company_id": "c1", "tender_id": "t1",
                                                "kind": "methodology", "style_length": "standard",
                                                "style_detail": "detailed", "style_visual": "structured"}, "/tmp")
            except exc_cls:
                raised = True
        finally:
            pnj.supabase_request, pnj.build_context = original_db, original_build_context
        return db.tables["narrative_documents"][0]["status"], raised

    status, raised = _run(pnj.TransientError)
    check("TransientError leaves the row back at 'requested'", status == "requested", status)
    check("...and does not raise out of process_one (the loop must carry on this cycle)",
          raised is False)

    status, raised = _run(pnj.SetupError)
    check("SetupError also leaves the row back at 'requested'", status == "requested", status)
    check("...but DOES raise out of process_one (aborts the rest of this poll's batch on purpose)",
          raised is True)


def test_load_key_people_computes_years_experience_from_graduation_date():
    today = datetime.date.today()
    graduated = today.replace(year=today.year - 10)
    stub, original = _patch({
        "people": [{"name": "Thabo Mahlangu", "role": "Site Agent", "ecsa_level": "Pr Eng",
                    "highest_description": "BEng Civil", "highest_graduated": graduated.isoformat()}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("one person returned", len(people) == 1)
    check("years_experience computed from the graduation date", people[0]["years_experience"] == 10,
          people[0]["years_experience"])
    check("name/role passed through", people[0]["name"] == "Thabo Mahlangu" and people[0]["role"] == "Site Agent")


def test_load_key_people_handles_missing_graduation_date():
    stub, original = _patch({
        "people": [{"name": "Jane Doe", "role": "QA Manager", "ecsa_level": None,
                    "highest_description": None, "highest_graduated": None}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("years_experience is None rather than raising when no graduation date is on file",
          people[0]["years_experience"] is None)


def test_load_key_people_handles_unparseable_graduation_date():
    stub, original = _patch({
        "people": [{"name": "Jane Doe", "role": "QA Manager", "ecsa_level": None,
                    "highest_description": None, "highest_graduated": "not-a-date"}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("an unparseable graduation date does not raise - years_experience stays None",
          people[0]["years_experience"] is None)


def test_load_experience_maps_columns_through():
    stub, original = _patch({
        "experience_items": [{"project_name": "N4 Upgrade", "client_name": "SANRAL",
                              "scope_summary": "Road rehabilitation", "value_rm": 45.2,
                              "completion_date": "2024-03-01", "performance_rating": "Excellent"}],
    })
    try:
        experience = pnj.load_experience("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("one experience item returned", len(experience) == 1)
    check("project_name passed through", experience[0]["project_name"] == "N4 Upgrade")
    check("value_rm passed through", experience[0]["value_rm"] == 45.2)


def test_load_other_companies_text_excludes_empty_generated_text():
    stub, original = _patch({
        "narrative_documents": [{"generated_text": "Some text"}, {"generated_text": None}, {"generated_text": ""}],
    })
    try:
        texts = pnj.load_other_companies_text("url", "key", "tender-1", "methodology", "company-1")
    finally:
        pnj.supabase_request = original
    check("only the non-empty generated_text is returned", texts == ["Some text"], texts)


def test_build_context_raises_generation_failed_when_company_row_is_missing():
    stub, original = _patch({"companies": [], "tenders": [{"contract_no": "X"}]})
    try:
        pnj.build_context("url", "key", {"company_id": "missing", "tender_id": "t1", "kind": "methodology",
                                          "user_guidance": "", "style_length": "standard",
                                          "style_detail": "detailed", "style_visual": "structured"})
        check("a missing company row should have raised GenerationFailed", False)
    except pnj.GenerationFailed:
        check("a missing company row raises GenerationFailed", True)
    finally:
        pnj.supabase_request = original


def test_build_context_assembles_the_shape_generate_narrative_expects():
    stub, original = _patch({
        "companies": [{"legal_name": "Mahlangu Civils", "how_we_work": "We run a single accountable site agent."}],
        "tenders": [{"contract_no": "N.004-010-2026/1F", "title": "N4 Rehabilitation", "buyer": "SANRAL",
                     "closing_date": "2026-11-15", "description": "Rehabilitate 40km of the N4."}],
        "people": [],
        "experience_items": [],
    })
    job = {"company_id": "c1", "tender_id": "t1", "kind": "methodology", "user_guidance": "Keep it concise.",
           "style_length": "concise", "style_detail": "high_level", "style_visual": "plain"}
    try:
        context = pnj.build_context("url", "key", job)
    finally:
        pnj.supabase_request = original
    check("kind passed through", context["kind"] == "methodology")
    check("tender context assembled", context["tender"]["buyer"] == "SANRAL")
    check("company context assembled", context["company"]["legal_name"] == "Mahlangu Civils")
    check("style assembled from the job's own style_* columns",
          context["style"] == {"length": "concise", "detail": "high_level", "visual": "plain"})
    check("user_guidance passed through", context["user_guidance"] == "Keep it concise.")


def test_process_one_never_leaks_a_raw_exception_to_the_customer():
    """QA pass, 2026-10-25: process_one()'s own except clause used to write
    str(e) straight into error_message for ANY unexpected exception (a
    python-docx internal error, a KeyError, ...) - narrative-documents.tsx
    shows this to the customer verbatim, no sanitisation on that side. Same
    'never a raw Python/library exception' discipline process_cv_jobs.py's
    own process_job() already follows. Also: this was the only
    process_*_jobs.py bridge in the repo with no system_alerts call at all
    on a genuine crash."""
    stub, original = _patch({
        "narrative_documents": [{"id": "job-1"}],  # non-empty -> claim_job() succeeds
    })
    real_build_context = pnj.build_context

    def boom(*a, **k):
        raise ValueError("Some raw internal detail that must never reach a customer")

    pnj.build_context = boom
    ALERTS.clear()
    try:
        pnj.process_one("url", "key", {"id": "job-1", "company_id": "c1", "tender_id": "t1", "kind": "methodology",
                                       "style_length": "standard", "style_detail": "detailed",
                                       "style_visual": "structured"}, "/tmp")
    finally:
        pnj.build_context = real_build_context
        pnj.supabase_request = original

    patches = [c for c in stub.calls if c[0] == "PATCH" and "status" in (c[2] or {})
               and c[2]["status"] == "failed"]
    check("a 'failed' PATCH was sent", len(patches) == 1, stub.calls)
    if patches:
        msg = patches[0][2]["error_message"]
        check("the customer-facing error_message is the generic message, not the raw exception",
              "raw internal detail" not in msg and msg == "Could not generate this document - try again. "
              "If it keeps happening, let us know.", msg)
    check("a system_alerts record was made for this genuine crash (previously none ever were)",
          len(ALERTS) == 1 and "Some raw internal detail" in ALERTS[0]["p_message"], ALERTS)


def test_main_once_with_nothing_queued_prints_a_quiet_prefixed_line():
    """run_bridges.py suppresses an idle pass only when its only output
    starts with QUIET_PREFIXES ("No pending"). This bridge used to print
    "Processed 0 job(s)." on an empty queue - a line QUIET_PREFIXES never
    matched - so a real --loop worker (30s default interval) logged
    "narrative: Processed 0 job(s)." every single cycle forever. Standing
    review pass, 2026-11-02."""
    stub, original = _patch({"narrative_documents": []})
    old_environ = dict(os.environ)
    old_argv = sys.argv
    os.environ["NEXT_PUBLIC_SUPABASE_URL"] = "https://example.supabase.co"
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-key"
    sys.argv = ["process_narrative_jobs.py", "--once"]
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            pnj.main()
    finally:
        pnj.supabase_request = original
        os.environ.clear()
        os.environ.update(old_environ)
        sys.argv = old_argv
    printed = out.getvalue().strip()
    check("prints a line run_bridges.py's QUIET_PREFIXES recognises as quiet",
          printed.startswith("No pending"), printed)


def test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails():
    print("poll_once(): a crash on one job's own claim does not skip every OTHER pending job")
    # Finding (2026-11-04): process_one()'s own claim_job() sits BEFORE its
    # try block - so the only way a job could still raise here (other than
    # a deliberate SetupError, covered separately below) is that claim call
    # itself (a network blip, a 500). Before this fix, that propagated
    # straight out of poll_once()'s own for loop, aborting the whole pass:
    # every OTHER pending narrative job was skipped that cycle too, not
    # just the one whose claim failed - same bug class as Finding 123
    # (run_bridges.py) and Finding 126 (extract_cv_fields.py).
    db = FakeDB({"narrative_documents": [
        {"id": "job-flaky", "status": "requested"},
        {"id": "job-ok", "status": "requested"},
    ]})
    original_db, original_process_one = pnj.supabase_request, pnj.process_one
    pnj.supabase_request = db
    attempted = []

    def flaky_process_one(url, key, job, out_dir):
        attempted.append(job["id"])
        if job["id"] == "job-flaky":
            raise RuntimeError("simulated transient Supabase failure while claiming job-flaky")
    pnj.process_one = flaky_process_one
    alerts = []
    real_record = pnj.system_alerts.record
    pnj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        n = pnj.poll_once("url", "key", "/tmp")
    finally:
        pnj.supabase_request, pnj.process_one = original_db, original_process_one
        pnj.system_alerts.record = real_record
    check("poll_once() returns the total job count, no crash", n == 2, n)
    check("BOTH jobs were attempted - job-ok was not skipped because job-flaky's claim failed",
          sorted(attempted) == ["job-flaky", "job-ok"], attempted)
    check("the failing job's own claim failure is reported as its own alert, not silently lost",
          any(a[0][0] == "narrative" and a[0][2] == "error" and "job-flaky" in a[0][1] for a in alerts), alerts)


def test_poll_once_still_propagates_setup_error():
    print("poll_once(): a genuine SetupError from process_one() still aborts the whole pass on purpose")
    # The new per-item isolation above must not swallow SetupError - that
    # means the whole bridge is broken (bad key, missing package), not one
    # bad job, same reasoning process_one() itself already uses.
    db = FakeDB({"narrative_documents": [{"id": "job-1", "status": "requested"}]})
    original_db, original_process_one = pnj.supabase_request, pnj.process_one
    pnj.supabase_request = db
    pnj.process_one = lambda url, key, job, out_dir: (_ for _ in ()).throw(pnj.SetupError("no API key"))
    try:
        raised = False
        try:
            pnj.poll_once("url", "key", "/tmp")
        except pnj.SetupError:
            raised = True
    finally:
        pnj.supabase_request, pnj.process_one = original_db, original_process_one
    check("SetupError still propagates out of poll_once(), not swallowed", raised is True)


def test_supabase_request_all_paginates_past_postgrests_own_db_max_rows_cap():
    print("supabase_request_all(): a table with more matching rows than PostgREST's own "
          "db-max-rows cap (same bug class as Finding 252 - process_general_jobs.py's "
          "Supabase.select()/process_pack_jobs.py's SupabaseRest.select() - never checked "
          "before for THIS file's own separate supabase_request() helper, which fail_stale_jobs() "
          "and poll_once()'s own job-queue read both call with no limit/offset at all).")
    all_rows = [{"id": i} for i in range(2500)]

    def fake_req(url, key, method, path, body=None):
        check_method = method == "GET"
        qs = urllib.parse.parse_qs(path.split("?", 1)[1] if "?" in path else "")
        requested_limit = int(qs["limit"][0]) if "limit" in qs else 10**9
        offset = int(qs["offset"][0]) if "offset" in qs else 0
        # Faithful PostgREST stand-in: caps at its own db-max-rows (1000)
        # regardless of what (or whether) a limit was asked for - exactly
        # what let the pre-fix, no-limit-at-all call silently truncate.
        return all_rows[offset: offset + min(requested_limit, 1000)] if check_method else []

    original = pnj.supabase_request
    pnj.supabase_request = fake_req
    try:
        got = pnj.supabase_request_all("https://example.test", "k", "narrative_documents?status=eq.requested&select=*")
    finally:
        pnj.supabase_request = original
    check("supabase_request_all() returns EVERY matching row, not just PostgREST's own first 1000-row page",
          len(got) == len(all_rows), f"got {len(got)} of {len(all_rows)}")
    check("rows come back in order, nothing dropped or duplicated across pages",
          [r["id"] for r in got] == list(range(2500)), [r["id"] for r in got[:3]] + ["..."])


def main():
    test_load_key_people_computes_years_experience_from_graduation_date()
    test_load_key_people_handles_missing_graduation_date()
    test_load_key_people_handles_unparseable_graduation_date()
    test_load_experience_maps_columns_through()
    test_load_other_companies_text_excludes_empty_generated_text()
    test_build_context_raises_generation_failed_when_company_row_is_missing()
    test_build_context_assembles_the_shape_generate_narrative_expects()
    test_process_one_never_leaks_a_raw_exception_to_the_customer()
    test_claim_job_is_atomic_a_second_claim_on_the_same_row_fails()
    test_claim_job_defers_not_fails_when_a_different_company_already_holds_the_same_tender_kind_slot()
    test_fail_stale_jobs_marks_old_generating_jobs_failed_and_leaves_fresh_ones_alone()
    test_fail_stale_jobs_survives_a_write_failure_marking_one_stale_job_failed()
    test_process_one_happy_path_writes_ready_with_every_generation_field()
    test_process_one_transient_error_requeues_quietly_but_setup_error_requeues_and_raises()
    test_main_once_with_nothing_queued_prints_a_quiet_prefixed_line()
    test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails()
    test_poll_once_still_propagates_setup_error()
    test_supabase_request_all_paginates_past_postgrests_own_db_max_rows_cap()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
