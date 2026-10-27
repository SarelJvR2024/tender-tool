import datetime
import os
import sys

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


def test_fail_stale_jobs_marks_old_generating_jobs_failed_and_leaves_fresh_ones_alone():
    now = datetime.datetime(2026, 10, 27, 12, 0, tzinfo=datetime.timezone.utc)
    old = (now - datetime.timedelta(minutes=45)).isoformat()   # past STALE_AFTER_MINUTES=30
    fresh = (now - datetime.timedelta(minutes=5)).isoformat()  # well within it
    db = FakeDB({"narrative_documents": [
        {"id": "stuck", "status": "generating", "started_at": old},
        {"id": "running", "status": "generating", "started_at": fresh},
    ]})
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
    test_fail_stale_jobs_marks_old_generating_jobs_failed_and_leaves_fresh_ones_alone()
    test_process_one_happy_path_writes_ready_with_every_generation_field()
    test_process_one_transient_error_requeues_quietly_but_setup_error_requeues_and_raises()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
