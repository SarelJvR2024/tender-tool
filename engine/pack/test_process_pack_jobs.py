"""
process_pack_jobs.py had no test file at all before this pass touching its
job-queue logic - confirmed by a repo-wide search before writing this (its
siblings cv/general/narrative/onboarding each have their own). Deliberately
narrow, same scope as engine/general/test_process_general_jobs.py's own
fail_stale_jobs() test: just fail_stale_jobs(), in isolation, against a
minimal in-memory fake client matching the real Supabase class's
select()/update() shape, not a full pipeline test.

QA Finding, 2026-10-29: fail_stale_jobs() parsed every stuck row's own
started_at with a bare datetime.fromisoformat() call, no try/except - one
malformed value on ANY one stuck 'generating' row raised straight out of
this function, which is process_pending()'s own FIRST call: every OTHER
genuinely stale SANRAL pack job stayed stuck forever, and (since the
exception aborts process_pending() entirely) no new pending pack request
got processed that cycle either, repeatedly, until a human fixed the one
bad row by hand. The identical unguarded pattern was found and fixed the
same pass in process_general_jobs.py, process_narrative_jobs.py,
process_cv_jobs.py, extract_cv_fields.py and process_onboarding_jobs.py -
same bug class as watch_deadlines.days_until()'s own malformed-date guard
(engine/compliance/test_watch_deadlines_urgency.py, 2026-10-23).

Run: python3 engine/pack/test_process_pack_jobs.py
"""
import datetime
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_pack_jobs as ppj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """Matches the real Supabase.select()/update() call shape exactly - no
    network, no urllib. Rows live in self.rows; update() mutates in place
    and returns the matched rows (mirrors PostgREST's own return=representation
    behaviour that the real code relies on). Same pattern as
    engine/general/test_process_general_jobs.py's own FakeClient."""

    def __init__(self, rows):
        self.rows = rows
        self.upserted = []  # (table, rows, on_conflict) - recorded, not applied to self.rows

    def select(self, table, filters=None, order=None):
        def match(r, k, v):
            return r.get(k) in v if isinstance(v, (list, tuple)) else r.get(k) == v
        return [r for r in self.rows if all(match(r, k, v) for k, v in (filters or {}).items())]

    def upsert(self, table, rows, on_conflict):
        self.upserted.append((table, rows, on_conflict))
        return rows

    def update(self, table, filters, body):
        matched = [r for r in self.rows if all(r.get(k) == v for k, v in (filters or {}).items())]
        for r in matched:
            r.update(body)
        return matched

    def upload(self, bucket, path, local, content_type):
        # Not exercised for its own sake by any test here - just needs to
        # accept the call without touching the network, same reason this
        # fake has no real select()/update() network either.
        pass


def iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def test_fail_stale_jobs_recovers_a_stuck_sanral_job_and_survives_a_malformed_one():
    print("fail_stale_jobs(): a stuck SANRAL pack job is recovered; a malformed started_at "
          "elsewhere does not abort the sweep")
    now = datetime.datetime(2026, 10, 29, 12, 0, 0, tzinfo=datetime.timezone.utc)
    stale_started = now - datetime.timedelta(minutes=90)  # past STALE_AFTER_MINUTES=60
    fresh_started = now - datetime.timedelta(minutes=5)   # still well within the window

    rows = [
        {"id": "job-stale", "status": "generating", "engine": "sanral",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-fresh", "status": "generating", "engine": "sanral",
         "started_at": iso(fresh_started), "company_id": "co-a", "tender_id": "t-b"},
        {"id": "job-general", "status": "generating", "engine": "general",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-c"},
        {"id": "job-ready", "status": "ready", "engine": "sanral",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-d"},
        # The finding: a corrupted/hand-edited started_at on this row alone
        # used to crash the whole sweep, including job-stale above.
        {"id": "job-corrupt", "status": "generating", "engine": "sanral",
         "started_at": "not-a-real-timestamp", "company_id": "co-a", "tender_id": "t-e"},
    ]
    client = FakeClient(rows)

    alerts = []
    real_record = ppj.system_alerts.record
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        ppj.fail_stale_jobs(client, now=now)
    finally:
        ppj.system_alerts.record = real_record

    by_id = {r["id"]: r for r in rows}
    check("a job stuck in 'generating' past the threshold is marked failed",
          by_id["job-stale"]["status"] == "failed", by_id["job-stale"])
    check("its error_message is a plain, actionable sentence (no raw internals)",
          "stopped mid-job" in by_id["job-stale"].get("error_message", ""))
    check("completed_at is set on the now-failed job", bool(by_id["job-stale"].get("completed_at")))
    check("a job still well within the stale window is left untouched",
          by_id["job-fresh"]["status"] == "generating", by_id["job-fresh"])
    check("a 'general'-engine row (same shared table) is NOT touched by the 'sanral' queue's own sweep - "
          "that's process_general_jobs.py's own job",
          by_id["job-general"]["status"] == "generating", by_id["job-general"])
    check("an already-'ready' job is left untouched regardless of its started_at age",
          by_id["job-ready"]["status"] == "ready", by_id["job-ready"])
    check("a malformed started_at does not crash the sweep and is left generating, not guessed at",
          by_id["job-corrupt"]["status"] == "generating", by_id["job-corrupt"])
    check("both the real stale job and the malformed row got their own alert, each correctly severed",
          sorted((a[0][0], a[0][2]) for a in alerts) == [("pack", "error"), ("pack", "warning")], alerts)
    # Standing review, 2026-11-07 (re-verification of Finding 192's own "all
    # 6 bridges swept" claim): Finding 192 added company_id to this file's
    # OTHER system_alerts.record() call sites, but this exact one - the
    # malformed-started_at "warning" alert right here, in this same
    # fail_stale_jobs() function - was missed, even though job.get(
    # "company_id") was already in scope two lines below it (the "stuck in
    # 'generating'" error alert right after it). Its true siblings,
    # process_cv_jobs.py/process_narrative_jobs.py's own identically-shaped
    # malformed-timestamp alerts, both already carried company_id - this was
    # the one file where the twin alert in the SAME function diverged.
    malformed_alert = next(kw for (a, kw) in alerts if a[2] == "warning")
    check("the malformed-started_at alert now carries company_id too, not just the stuck-job alert",
          malformed_alert.get("context", {}).get("company_id") == "co-a", malformed_alert)


def test_adapt_person_carries_sacnasp_and_sagc_through():
    print("adapt_person(): a person's own SACNASP/SAGC registration (0040) must reach the "
          "SANRAL pack's qualifications dict, same as ECSA/SACPCMP already do")
    # Finding (2026-11-03): process_cv_jobs.py's own adapt_person_row() (the standalone-CV path)
    # already read sacnasp_category/number/expiry and sagc_category/number/expiry - this
    # SANRAL-pack adapter never did, so a geologist's/surveyor's real registration (exactly what
    # SANRAL C3.1.11 asks for, per 0050's own held_registrations comment) never reached a
    # generated SANRAL pack's Form B2.1 at all, even though generate_cv.py's own
    # build_sanral_keyperson() has always had display code ready for it.
    row = {"name": "Jane Doe", "id_number": "123", "sacnasp_category": "Pr.Sci.Nat",
           "sacnasp_number": "SACNASP999", "sacnasp_expiry": "2027-06-30",
           "sagc_category": None, "sagc_number": None, "sagc_expiry": None}
    person = ppj.adapt_person(row, [])
    q = person["qualifications"]
    check("sacnasp_category reaches the qualifications dict", q.get("sacnasp_category") == "Pr.Sci.Nat", q)
    check("sacnasp_number reaches the qualifications dict", q.get("sacnasp_number") == "SACNASP999", q)
    check("sacnasp_expiry reaches the qualifications dict", q.get("sacnasp_expiry") == "2027-06-30", q)
    check("sagc_* keys are present (as None) rather than absent", "sagc_number" in q, q)


def test_process_pending_does_not_abort_the_whole_pass_when_one_jobs_claim_fails():
    print("process_pending(): a crash on one job's own claim does not skip every OTHER pending job")
    # Finding (2026-11-04): process_job()'s own claim (client.update(...))
    # sits BEFORE its try block, and process_job() itself never re-raises
    # (its own blanket except Exception always marks the job failed and
    # returns) - so the only way a job could still raise here is that claim
    # call itself (a network blip, a 500). Before this fix, that propagated
    # straight out of process_pending()'s own for loop, aborting the whole
    # pass: every OTHER pending pack job was skipped that cycle too, not
    # just the one whose claim failed - same bug class as Finding 123
    # (run_bridges.py) and Finding 126 (extract_cv_fields.py).
    rows = [
        {"id": "job-flaky", "status": "requested", "engine": "sanral", "requested_at": "1",
         "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-ok", "status": "requested", "engine": "sanral", "requested_at": "2",
         "company_id": "co-a", "tender_id": "t-b"},
    ]
    client = FakeClient(rows)
    attempted = []
    real_process_job = ppj.process_job

    def flaky_process_job(client, job, work_root, keep=False):
        attempted.append(job["id"])
        if job["id"] == "job-flaky":
            raise RuntimeError("simulated transient Supabase failure while claiming job-flaky")
        return None
    ppj.process_job = flaky_process_job
    alerts = []
    real_record = ppj.system_alerts.record
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        n = ppj.process_pending(client, "/tmp/test_process_pending_work_root")
    finally:
        ppj.process_job = real_process_job
        ppj.system_alerts.record = real_record
    check("process_pending() returns the total job count, no crash", n == 2, n)
    check("BOTH jobs were attempted - job-ok was not skipped because job-flaky's claim failed",
          attempted == ["job-flaky", "job-ok"], attempted)
    check("the failing job's own claim failure is reported as its own alert, not silently lost",
          any(a[0][0] == "pack" and a[0][2] == "error" and "job-flaky" in a[0][1] for a in alerts), alerts)


def test_supabase_rest_rpc_posts_to_rpc_endpoint_and_parses_the_response():
    print("SupabaseRest.rpc(): posts to /rest/v1/rpc/<fn> with the args as the body and parses "
          "the JSON response - send_pack_ready_email() calls company_notification_recipients/"
          "claim_notification/record_notification_sent through exactly this, and this class had "
          "no rpc() at all before this pass (confirmed: it's the one method process_cv_jobs.py's "
          "own send_pack_ready_email() caller needs that process_general_jobs.py's Supabase class "
          "already had and this one, its SANRAL sibling, never did).")
    client = ppj.SupabaseRest("https://example.test", "k")
    calls = []

    def fake_req(method, path, body=None, headers=None, raw=None):
        calls.append((method, path, body, headers))
        return b'[{"ok": true}]'
    client._req = fake_req
    result = client.rpc("some_function", {"p_a": 1})
    check("exactly one request was made", len(calls) == 1, calls)
    method, path, body, _headers = calls[0]
    check("POSTs", method == "POST", method)
    check("to the right rpc path", path == "/rest/v1/rpc/some_function", path)
    check("the args dict is sent as the body, unmodified", body == {"p_a": 1}, body)
    check("the JSON response is parsed back into Python", result == [{"ok": True}], result)

    calls.clear()
    client.rpc("no_args_function")
    check("args=None sends an empty dict, not null/omitted", calls[0][2] == {}, calls[0])


def test_process_job_sends_the_pack_ready_email_on_success():
    print("process_job(): on a successful SANRAL pack build, send_pack_ready_email() is now "
          "called with (client, job, page_count, APP_URL) - the Finding this pass fixed: this "
          "bridge shares pack_generation_jobs with process_general_jobs.py (engine='sanral' vs "
          "'general'), and the 'general' side has fired this exact email on every ready pack "
          "since 2026-10-27 (notification-engine item B12) while this, its sibling, never did.")
    work_root = tempfile.mkdtemp(prefix="test_pack_ready_email_work_root_")
    job = {"id": "job-1", "status": "requested", "engine": "sanral",
           "company_id": "co-a", "tender_id": "t-a"}
    client = FakeClient([dict(job)])

    def fake_gather(client, job, work):
        return {}

    def fake_build_submission_pack(work_dir, **kwargs):
        os.makedirs(work_dir, exist_ok=True)
        pdf_path = os.path.join(work_dir, "submission_pack.pdf")
        fin_path = os.path.join(work_dir, "financial.pdf")
        open(pdf_path, "wb").close()
        open(fin_path, "wb").close()
        return pdf_path, {
            "page_count": 42, "sections": ["s1"], "omitted": [],
            "financial": {"page_count": 5},
            "outputs": {"pdf": pdf_path, "financial_pdf": fin_path},
        }

    sent = []
    real_gather, real_build, real_verify, real_send = (
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email)
    ppj.gather = fake_gather
    ppj.build_submission_pack = fake_build_submission_pack
    ppj.verify_pack = lambda pdf, manifest: []
    ppj.send_pack_ready_email = lambda client, job, page_count, app_url: sent.append(
        (job, page_count, app_url))
    try:
        manifest = ppj.process_job(client, job, work_root, keep=True)
    finally:
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email = (
            real_gather, real_build, real_verify, real_send)
        shutil.rmtree(work_root, ignore_errors=True)

    check("process_job() returns the real manifest on success", manifest is not None, manifest)
    check("the job row was marked ready", client.rows[0]["status"] == "ready", client.rows[0])
    check("send_pack_ready_email() was called exactly once", len(sent) == 1, sent)
    if sent:
        sent_job, sent_page_count, sent_app_url = sent[0]
        check("...with the real job dict (same id)", sent_job["id"] == "job-1", sent_job)
        check("...with the real page_count from the manifest", sent_page_count == 42, sent_page_count)
        check("...with APP_URL", sent_app_url == ppj.APP_URL, sent_app_url)


def test_process_job_writes_field_provenance_to_the_db_on_success():
    print("process_job(): on a successful SANRAL pack build, the merged field_provenance.json "
          "is now upserted into the field_provenance table (tender_pack_id, last write wins on a "
          "repeated field_key) - the Finding this pass fixed: this bridge only ever wrote a "
          "field_provenance.json FILE, never a DB row, while its general-family sibling "
          "(process_general_jobs.py's run_pack()) has upserted it since that engine's own first "
          "commit. The Tender Workspace readiness report / Pack Review 'Form answers' / "
          "compliance report all read this table by tender_pack_id and showed nothing for any "
          "real SANRAL pack as a result.")
    work_root = tempfile.mkdtemp(prefix="test_pack_field_provenance_work_root_")
    job = {"id": "job-1", "status": "requested", "engine": "sanral",
           "company_id": "co-a", "tender_id": "t-a", "tender_pack_id": "pack-xyz"}
    client = FakeClient([dict(job)])

    def fake_gather(client, job, work):
        return {}

    def fake_build_submission_pack(work_dir, **kwargs):
        os.makedirs(work_dir, exist_ok=True)
        pdf_path = os.path.join(work_dir, "submission_pack.pdf")
        fin_path = os.path.join(work_dir, "financial.pdf")
        prov_path = os.path.join(work_dir, "field_provenance.json")
        open(pdf_path, "wb").close()
        open(fin_path, "wb").close()
        import json as _json
        _json.dump([
            {"field_key": "a_forms.A8.litigation", "status": "confirmed", "value": "No", "reason": None,
             "source": "fill_a_forms.py"},
            # Same field_key written twice (e.g. by two merged fillers) - last write wins,
            # same rule process_general_jobs.py's own write already applies.
            {"field_key": "contract_data.henning_email", "status": "missing", "value": None,
             "reason": "stale draft", "source": "fill_docx_forms.py"},
            {"field_key": "contract_data.henning_email", "status": "confirmed", "value": "henning@klipcorp.co.za",
             "reason": None, "source": "fill_docx_forms.py"},
        ], open(prov_path, "w"))
        return pdf_path, {
            "page_count": 42, "sections": ["s1"], "omitted": [],
            "financial": {"page_count": 5},
            "outputs": {"pdf": pdf_path, "financial_pdf": fin_path, "field_provenance": prov_path},
        }

    real_gather, real_build, real_verify, real_send = (
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email)
    ppj.gather = fake_gather
    ppj.build_submission_pack = fake_build_submission_pack
    ppj.verify_pack = lambda pdf, manifest: []
    ppj.send_pack_ready_email = lambda client, job, page_count, app_url: None
    try:
        manifest = ppj.process_job(client, job, work_root, keep=True)
    finally:
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email = (
            real_gather, real_build, real_verify, real_send)
        shutil.rmtree(work_root, ignore_errors=True)

    check("process_job() returns the real manifest on success", manifest is not None, manifest)
    check("exactly one field_provenance upsert was made", len(client.upserted) == 1, client.upserted)
    if client.upserted:
        table, rows, on_conflict = client.upserted[0]
        check("...into the field_provenance table", table == "field_provenance", table)
        check("...on_conflict is tender_pack_id,field_key (matches the unique constraint)",
              on_conflict == "tender_pack_id,field_key", on_conflict)
        by_key = {r["field_key"]: r for r in rows}
        check("exactly 2 distinct field_key rows (the duplicate key collapsed to one)",
              len(rows) == 2, rows)
        check("every row carries THIS job's own tender_pack_id",
              all(r["tender_pack_id"] == "pack-xyz" for r in rows), rows)
        check("the non-duplicated field carries its own confirmed value",
              by_key.get("a_forms.A8.litigation", {}).get("value") == "No", by_key)
        check("the duplicated field_key kept the LAST entry (confirmed), not the first (missing)",
              by_key.get("contract_data.henning_email", {}).get("status") == "confirmed", by_key)
        check("...with the last entry's own value",
              by_key.get("contract_data.henning_email", {}).get("value") == "henning@klipcorp.co.za", by_key)


def test_process_job_skips_the_field_provenance_upsert_when_the_file_is_absent():
    print("process_job(): no field_provenance.json in outputs (or an empty one) must not crash "
          "or upsert an empty batch - same defensive shape as process_general_jobs.py's own "
          "`if prov_pack and res[\"provenance\"]:` guard")
    work_root = tempfile.mkdtemp(prefix="test_pack_field_provenance_absent_work_root_")
    job = {"id": "job-1", "status": "requested", "engine": "sanral",
           "company_id": "co-a", "tender_id": "t-a", "tender_pack_id": "pack-xyz"}
    client = FakeClient([dict(job)])

    def fake_gather(client, job, work):
        return {}

    def fake_build_submission_pack(work_dir, **kwargs):
        os.makedirs(work_dir, exist_ok=True)
        pdf_path = os.path.join(work_dir, "submission_pack.pdf")
        fin_path = os.path.join(work_dir, "financial.pdf")
        open(pdf_path, "wb").close()
        open(fin_path, "wb").close()
        return pdf_path, {
            "page_count": 42, "sections": ["s1"], "omitted": [],
            "financial": {"page_count": 5},
            "outputs": {"pdf": pdf_path, "financial_pdf": fin_path},  # no "field_provenance" key at all
        }

    real_gather, real_build, real_verify, real_send = (
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email)
    ppj.gather = fake_gather
    ppj.build_submission_pack = fake_build_submission_pack
    ppj.verify_pack = lambda pdf, manifest: []
    ppj.send_pack_ready_email = lambda client, job, page_count, app_url: None
    try:
        manifest = ppj.process_job(client, job, work_root, keep=True)
    finally:
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email = (
            real_gather, real_build, real_verify, real_send)
        shutil.rmtree(work_root, ignore_errors=True)

    check("process_job() still returns the real manifest, no crash", manifest is not None, manifest)
    check("no field_provenance upsert was attempted", client.upserted == [], client.upserted)


def test_suggested_person_label_flags_a_real_override_even_when_unresolved():
    print("Finding 167: _suggested_person_label() must still flag a real AI-suggestion "
          "override even when the suggested person's own row was never fetched into this "
          "job's reduced index_of (the live-pipeline shape: index_of only ever holds the "
          "signatory and each position's CONFIRMED person) - the previous `sid in index_of "
          "else None` silently could not, since a real override is exactly the case where "
          "the suggested id is NOT in index_of.")
    index_of = {"confirmed-person-uuid": 0, "signatory-uuid": 1}  # never holds the override

    # No override: suggested == confirmed, so it IS in index_of (confirmed fetched it there).
    same = ppj._suggested_person_label({"suggested_person_id": "confirmed-person-uuid"}, index_of)
    check("no override: resolves to the same person_N label as confirmed_person",
          same == "person_0", same)

    # A real override: suggested != confirmed, so the suggested id was never fetched.
    overridden = ppj._suggested_person_label({"suggested_person_id": "overridden-ai-suggestion-uuid"}, index_of)
    check("real override: still returns a label (not None) so confirm_pack.py's own "
          "`person_id != sel['suggested_person']` check actually fires",
          overridden == "overridden-ai-suggestion-uuid", overridden)
    check("...and that label differs from confirmed_person's own 'person_0' label",
          overridden != "person_0", overridden)

    # No suggestion recorded at all (never scored, or sync_position_suggestions hasn't run yet).
    none_case = ppj._suggested_person_label({"suggested_person_id": None}, index_of)
    check("no suggestion on file at all: stays None", none_case is None, none_case)


class RaisingOnSecondUpdate(FakeClient):
    """Claim succeeds (the first update()); marking the job 'failed' after a
    crash (the second update()) itself raises - the one path that reaches
    the nested except Exception as e2 block ("Could not mark a failed pack
    job as failed")."""
    def __init__(self, rows):
        super().__init__(rows)
        self.updates = 0

    def update(self, table, filters, body):
        self.updates += 1
        if self.updates == 1:
            return super().update(table, filters, body)
        raise RuntimeError("simulated transient Supabase failure marking the job failed")


def test_could_not_mark_a_failed_pack_job_as_failed_alert_carries_company_id():
    print("Finding 188: the nested 'could not mark a failed pack job as failed' alert "
          "carries company_id too, same as the outer crash alert right above it")
    rows = [{"id": "job-1", "status": "requested", "company_id": "c-nested", "tender_id": "t-1"}]
    client = RaisingOnSecondUpdate(rows)
    alerts = []
    real_gather, real_record = ppj.gather, ppj.system_alerts.record
    ppj.gather = lambda client, job, work: (_ for _ in ()).throw(RuntimeError("synthetic crash"))
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        ppj.process_job(client, rows[0], tempfile.mkdtemp())
    finally:
        ppj.gather = real_gather
        ppj.system_alerts.record = real_record
    check("both alerts fired (the crash itself, then failing to even mark it failed)", len(alerts) == 2, alerts)
    nested = next((kw for a, kw in alerts if "Could not mark" in a[1]), None)
    check("the nested alert carries the job's own company_id",
          nested is not None and nested["context"].get("company_id") == "c-nested", alerts)


def test_sync_tender_requirements_and_b7_setup_alerts_carry_company_id():
    print("Finding 188: sync_tender_requirements()/sync_b7_setup()'s own 'could not read "
          "SETUP sheet' alerts carry company_id, read straight off the same row they already use")

    class RaisingDownloadClient(FakeClient):
        def download(self, bucket, path, local):
            raise RuntimeError("simulated storage download failure")

        def select(self, table, filters=None, order=None):
            # FakeClient's own select() matches purely by field shape, not by
            # table name - this fake's single tender_documents row would
            # otherwise spuriously satisfy sync_tender_requirements()'s own
            # "already written?" lookup too (both share a "tender_id" field).
            # Real table separation: tender_requirements starts empty.
            if table == "tender_requirements":
                return []
            return super().select(table, filters, order)

    # sync_tender_requirements(): tender_documents rows feed `d`, which already
    # carries company_id (used two lines above the real call site for the
    # [requirements] log line) - just never passed into the alert's context.
    docs = [{"id": "doc-1", "tender_id": "t-1", "company_id": "c-req", "storage_path": "x/y.xlsm",
            "doc_type": "technical_xlsm", "downloaded_at": "2026-11-01T00:00:00Z"}]
    client = RaisingDownloadClient(docs + [{"id": "t-1"}])
    alerts = []
    real_record = ppj.system_alerts.record
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        ppj.sync_tender_requirements(client, tempfile.mkdtemp())
    finally:
        ppj.system_alerts.record = real_record
    check("sync_tender_requirements() raised its own alert on the download failure", len(alerts) == 1, alerts)
    if alerts:
        check("...and it carries the tender_document row's own company_id",
              alerts[0][1]["context"].get("company_id") == "c-req", alerts[0])

    # sync_b7_setup(): same shape, the `d` (chosen tender_documents row) carries
    # company_id too - confirmed by the function's own sort key using it already.
    alerts.clear()
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        ppj.sync_b7_setup(client, tempfile.mkdtemp())
    finally:
        ppj.system_alerts.record = real_record
    check("sync_b7_setup() raised its own alert on the download failure", len(alerts) == 1, alerts)
    if alerts:
        check("...and it carries the chosen tender_document row's own company_id",
              alerts[0][1]["context"].get("company_id") == "c-req", alerts[0])


class TableAwareFakeClient:
    """A per-table in-memory store - unlike FakeClient above, which matches
    rows against filters regardless of table (fine for its own tests, which
    are careful never to let two tables' rows collide on a shared field
    name). This test needs tender_documents and tender_requirements rows
    that legitimately share tender_id/company_id, so each table gets its own
    list. insert() accepts either one row (the pre-fix per-position call
    shape) or a list of rows (the fix's own single bulk call) and can be
    told to fail whenever a row with a given position_code is present in
    the call - modelling one bad/duplicate SETUP-sheet position (a real
    thing an edited workbook can produce) or an equally real one-request-out-
    of-several transient network blip, without caring which."""

    def __init__(self):
        self.tables = {}
        self.fail_on_code = None
        self.download_calls = 0

    def _rows(self, table):
        return self.tables.setdefault(table, [])

    def select(self, table, filters=None, order=None):
        def match(r, k, v):
            return r.get(k) in v if isinstance(v, (list, tuple)) else r.get(k) == v
        return [dict(r) for r in self._rows(table) if all(match(r, k, v) for k, v in (filters or {}).items())]

    def insert(self, table, row):
        batch = row if isinstance(row, list) else [row]
        if self.fail_on_code and any(r.get("position_code") == self.fail_on_code for r in batch):
            raise RuntimeError(f"simulated failure inserting position {self.fail_on_code}")
        self._rows(table).extend(dict(r) for r in batch)
        return batch

    def download(self, bucket, path, local):
        self.download_calls += 1  # proves cycle 2 actually re-read the workbook, not silently skipped it


def test_sync_tender_requirements_mid_batch_insert_failure_does_not_strand_a_tender_on_a_partial_position_list():
    print("Finding 230: sync_tender_requirements() used to call client.insert() once PER position in "
          "a plain for-loop, no shared transaction - a failure partway through one workbook's own "
          "positions (a bad/duplicate SETUP-sheet value, or a transient network blip on any one of "
          "several requests) left the EARLIER positions already committed. The next poll cycle's own "
          "'already have positions for this tender?' check is existence-based, not completeness-"
          "based, so it then skipped this workbook SILENTLY, forever - no further alert, no retry, "
          "permanently stuck on a partial list. Confirmed live against the real schema's own unique "
          "constraint (tender_requirements_tender_position_company_key) in a scratch Postgres: 3 "
          "separate per-row INSERTs with a bad 2nd row left 1 row committed; the same 3 rows sent as "
          "ONE bulk INSERT left 0 rows committed - Postgres makes one statement atomic.")

    docs = [{"id": "doc-230", "tender_id": "t-230", "company_id": "c-230", "storage_path": "x/technical.xlsm",
             "doc_type": "technical_xlsm", "downloaded_at": "2026-11-01T00:00:00Z"}]
    primary = [{"code": "PL", "description": "Project Leader", "managerial": "Y"},
               {"code": "DS1", "description": "Design Specialist 1", "managerial": "N"},
               {"code": "DS2", "description": "Design Specialist 2", "managerial": "N"}]

    client = TableAwareFakeClient()
    for d in docs:
        client.insert("tender_documents", d)

    real_workbook, real_reader, real_record = ppj.Workbook, ppj.read_required_positions, ppj.system_alerts.record
    alerts = []
    ppj.Workbook = lambda path: "fake-workbook"
    ppj.read_required_positions = lambda wb: (primary, {})
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        # Cycle 1: DS1's own insert fails this one time (the transient blip).
        client.fail_on_code = "DS1"
        ppj.sync_tender_requirements(client, tempfile.mkdtemp())
        check("cycle 1 recorded its own alert for the failed workbook", len(alerts) == 1, alerts)
        after_cycle_1 = sorted(r["position_code"] for r in client.select("tender_requirements", {"tender_id": "t-230"}))
        print(f"  (after cycle 1, with the fix: {after_cycle_1 or 'nothing'} committed - "
              f"pre-fix this would show ['PL'], the partial per-row result)")

        # Cycle 2: the next poll, well after the blip has cleared.
        client.fail_on_code = None
        downloads_before_cycle_2 = client.download_calls
        ppj.sync_tender_requirements(client, tempfile.mkdtemp())
        after_cycle_2 = sorted(r["position_code"] for r in client.select("tender_requirements", {"tender_id": "t-230"}))
        check("cycle 2 actually retried the workbook, rather than the 'have' check silently "
              "treating cycle 1's partial result as already-done forever",
              client.download_calls > downloads_before_cycle_2, client.download_calls)
        check("cycle 2 completes the FULL position list once the transient failure has cleared, "
              "not permanently stuck on whatever partial subset cycle 1 managed to commit",
              after_cycle_2 == ["DS1", "DS2", "PL"], after_cycle_2)
    finally:
        ppj.Workbook, ppj.read_required_positions, ppj.system_alerts.record = real_workbook, real_reader, real_record


def main():
    test_fail_stale_jobs_recovers_a_stuck_sanral_job_and_survives_a_malformed_one()
    test_adapt_person_carries_sacnasp_and_sagc_through()
    test_process_pending_does_not_abort_the_whole_pass_when_one_jobs_claim_fails()
    test_supabase_rest_rpc_posts_to_rpc_endpoint_and_parses_the_response()
    test_process_job_sends_the_pack_ready_email_on_success()
    test_process_job_writes_field_provenance_to_the_db_on_success()
    test_process_job_skips_the_field_provenance_upsert_when_the_file_is_absent()
    test_suggested_person_label_flags_a_real_override_even_when_unresolved()
    test_could_not_mark_a_failed_pack_job_as_failed_alert_carries_company_id()
    test_sync_tender_requirements_and_b7_setup_alerts_carry_company_id()
    test_sync_tender_requirements_mid_batch_insert_failure_does_not_strand_a_tender_on_a_partial_position_list()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
