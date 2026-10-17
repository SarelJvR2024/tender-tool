"""
Bridge between the web app's CV request tables (app/supabase/migrations/
0008_cv_uploads.sql: generated_cvs) and the one real CV generator,
engine/cv/generate_cv.py.

Why this exists at all (the architectural problem stated in the brief): the
web app is Next.js on Vercel - it cannot run Python or LibreOffice, and
generate_cv.py depends on both (python-docx + a `soffice` subprocess for PDF
conversion), same as engine/print_reports.py and others. So "upload a CV in
the browser and get a generated .docx back synchronously" is not achievable
by calling generate_cv.py directly from a Next.js route.

The approach taken (same shape engine/write_admin_harness_results.py already
uses to bridge admin_harness.py's output into Supabase): generated_cvs is a
request/status table. A person uploading a CV with mode='ai_extract', or
someone clicking "Generate tender-specific CV" on the Tender Workspace page,
inserts a row with status='requested'. This script - run by a human (Sarel,
on a machine with Python + LibreOffice) or on a schedule, NOT inside the web
app's request path - polls for 'requested' rows, actually runs generate_cv.py
against the real person/project/company data (read from Supabase, replacing
generate_cv.py's own direct-JSON-file reading for this one caller), uploads
the result to Supabase Storage, and marks the row 'ready' (or 'failed' with
error_message). The UI only ever shows status, never waits on this script.

This was NOT built as a second, parallel CV-generation implementation in
JavaScript - it calls generate_cv.py's own functions directly (import, not a
reimplementation) for the sanral_keyperson/world_bank formats, and
generate_as_is() for the use-as-is path's provenance record. generate_cv.py
remains the one real implementation; this script is only an adapter between
Supabase's row shapes and generate_cv.py's existing profile-dict shape.

NOT LIVE-TESTED against a real Supabase project - none exists in this
environment (same limitation every session building this app has hit
today, per the task brief). The Supabase REST calls follow the exact
pattern already proven working in engine/write_admin_harness_results.py
and engine/seed_supabase_company.py. What IS verified here, for real: the
adapter that turns Supabase's flat people/projects row shapes into the
nested profile-dict shape generate_cv.py's build_sanral_keyperson/
build_world_bank expect (see adapt_person_row/adapt_project_row below, and
the self-test at the bottom of this file, runnable with --self-test using a
fixture shaped exactly like real Supabase rows, no live project required).

Usage:
    python3 process_cv_jobs.py [--once] [--out-dir <dir>]
    python3 process_cv_jobs.py --loop [--interval SECONDS] [--max-cycles N]
    python3 process_cv_jobs.py --self-test

Run modes (changed 2026-10-16, see docs/specs/Automated-Fulfillment-Deployment.md):
  - default / --once: process every 'requested' row once, then exit. This is
    what a cron entry or a person runs. (Before this change, running with NO
    flag looped forever with a hard-coded 30s sleep and no error handling,
    and only --once exited. Nothing in the repo invoked it without --once,
    confirmed by grep, and a cron entry calling it without --once would have
    stacked up a new never-ending process every time. --once still works
    exactly as before.)
  - --loop: the always-on worker mode. Polls every --interval seconds
    (default 30) via engine/worker/poll_loop.py, survives a failed poll,
    stops cleanly on SIGTERM. This is what engine/worker/run_bridges.py and
    the worker container run.

Each job is claimed with a conditional update (status requested ->
generating, only if it is still 'requested'), so two workers running at
once (say a hosted worker plus someone running --once by hand) never build
the same CV twice.
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "worker"))
from generate_cv import generate_as_is  # noqa: E402
import generate_cv  # noqa: E402
from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS, system_alerts  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT_DIR = os.path.join(HERE, "..", "..", "out", "generated_cvs")


# ============================================================================
# Supabase REST helpers (pattern copied from write_admin_harness_results.py /
# seed_supabase_company.py - same env vars, same service-role bypass of RLS)
# ============================================================================

def supabase_request(url, service_key, method, path, body=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body_text = r.read()
            return json.loads(body_text) if body_text else []
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()}")


def storage_upload(url, service_key, bucket, object_path, local_path, content_type):
    with open(local_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"{url}/storage/v1/object/{bucket}/{object_path}",
        data=data,
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"storage upload of {object_path} failed: {e.code} {e.read().decode()}")


# ============================================================================
# Adapters: Supabase row shape -> generate_cv.py's profile-dict shape
# (verified by the self-test below, no live project needed to check this part)
# ============================================================================

def adapt_project_row(row):
    """projects table columns -> the keys generate_cv.py's builders read
    (client_and_number, value_rm, position_held, start, end, contact,
    contact_phone, contact_match_confidence) - the field NAMES differ from
    config/klipcorp_profile.json's own projects shape (contact_name -> contact,
    start_date -> start, end_date -> end) because that JSON file predates the
    Supabase schema; generate_cv.py's builders were written against the JSON
    shape, so this adapter does the renaming rather than changing generate_cv.py
    (which still needs to serve the JSON-file CLI path unchanged)."""
    return {
        "client_and_number": row.get("client_and_number"),
        "value_rm": row.get("value_rm"),
        "position_held": row.get("position_held"),
        "start": row.get("start_date"),
        "end": row.get("end_date"),
        "contact": row.get("contact_name"),
        "contact_phone": row.get("contact_phone"),
        "contact_match_confidence": row.get("contact_match_confidence"),
    }


def adapt_person_row(person_row, project_rows):
    """people table row (flat qualification columns) + its projects rows ->
    generate_cv.py's nested {"qualifications": {...}, "projects": [...]} shape."""
    return {
        "name": person_row["name"],
        "id_number": person_row.get("id_number"),
        "role": person_row.get("role") or person_row.get("description"),
        "qualifications": {
            "ecsa_level": person_row.get("ecsa_level"),
            "ecsa_number": person_row.get("ecsa_number"),
            "ecsa_date": person_row.get("ecsa_date"),
            "sacpcmp_number": person_row.get("sacpcmp_number"),
            "highest_description": person_row.get("highest_description"),
            "highest_institution": person_row.get("highest_institution"),
            "highest_graduated": person_row.get("highest_graduated"),
            "initial_description": person_row.get("initial_description"),
            "initial_institution": person_row.get("initial_institution"),
            "initial_graduated": person_row.get("initial_graduated"),
        },
        "projects": [adapt_project_row(p) for p in project_rows],
    }


def adapt_company_row(company_row):
    return {"legal_name": company_row.get("legal_name", "")}


def build_tender_ctx_from_assignment(tender_row, requirement_row, assignment_row, person_id):
    """Builds the same tender_ctx shape load_tender_context() reads from a
    local pack_suggestions.json - but sourced from tender_pack_assignments,
    which already stores suggest_pack.py's own score/rationale/specialism_warning
    at the moment a human confirmed that position (0001_init_schema.sql). This
    is still "never a new matcher": the score/rationale were computed by
    suggest_pack.py when the assignment was created, just read back from
    Supabase instead of re-reading the JSON file suggest_pack.py also writes."""
    return {
        "contract_no": tender_row.get("contract_no") or tender_row.get("nra_reference"),
        "closing_date": (tender_row.get("closing_date") or "")[:10] or None,
        "position": {
            "code": assignment_row["position_code"],
            "description": (requirement_row or {}).get("position_description") or assignment_row["position_code"],
        },
        "candidate": {
            "person_id": person_id,
            "score": assignment_row.get("suggested_score"),
            "rationale": assignment_row.get("suggested_rationale"),
            "specialism_warning": bool(assignment_row.get("specialism_warning")),
        },
    }


# ============================================================================
# Job processing
# ============================================================================

def fetch_job_context(url, key, job):
    # Every read is scoped to the job's own company: this runs with the
    # service role (no RLS), and generated_cvs.person_id / tender_pack_id are
    # written by the client - without the company filter a request naming
    # another company's person built that person's CV into this company's
    # folder (POPIA-Security-Audit.md; migration 0043 refuses such a row too).
    person_rows = supabase_request(url, key, "GET",
                                   f"people?id=eq.{job['person_id']}&company_id=eq.{job['company_id']}&select=*")
    if not person_rows:
        raise RuntimeError(f"person {job['person_id']} not found in this company")
    person_row = person_rows[0]

    project_rows = supabase_request(url, key, "GET",
                                    f"projects?person_id=eq.{job['person_id']}&company_id=eq.{job['company_id']}&select=*")

    company_rows = supabase_request(url, key, "GET", f"companies?id=eq.{job['company_id']}&select=legal_name")
    company_row = company_rows[0] if company_rows else {}

    tender_ctx = None
    if job.get("tender_id"):
        tender_rows = supabase_request(url, key, "GET", f"tenders?id=eq.{job['tender_id']}&select=*")
        tender_row = tender_rows[0] if tender_rows else {}
        if tender_row.get("owner_company_id") not in (None, job["company_id"]):
            raise RuntimeError("tender not found")  # another company's private tender (0024)

        req_rows = supabase_request(
            url, key, "GET",
            f"tender_requirements?tender_id=eq.{job['tender_id']}&position_code=eq.{job['position_code']}&select=*",
        )
        requirement_row = req_rows[0] if req_rows else None

        own_pack = supabase_request(url, key, "GET", f"tender_packs?id=eq.{job['tender_pack_id']}"
                                    f"&company_id=eq.{job['company_id']}&select=id") if job.get("tender_pack_id") else []
        assignment_rows = supabase_request(
            url, key, "GET",
            f"tender_pack_assignments?tender_pack_id=eq.{job['tender_pack_id']}&position_code=eq.{job['position_code']}&select=*",
        ) if own_pack else []
        assignment_row = assignment_rows[0] if assignment_rows else {
            "position_code": job["position_code"], "suggested_score": None,
            "suggested_rationale": None, "specialism_warning": False,
        }

        tender_ctx = build_tender_ctx_from_assignment(tender_row, requirement_row, assignment_row, f"person_{job['person_id']}")

    profile = {"company": adapt_company_row(company_row), "key_people": [adapt_person_row(person_row, project_rows)]}
    return profile, tender_ctx


def claim_job(url, key, job):
    """Atomically move one row requested -> generating. PostgREST applies the
    status=eq.requested filter and the update in one statement, and returns
    the updated rows (Prefer: return=representation), so an empty result
    means another worker already took it. Sets claimed_at (migration 0019)
    so fail_stale_jobs() below can tell a stuck job from a slow one."""
    claimed = supabase_request(
        url, key, "PATCH", f"generated_cvs?id=eq.{job['id']}&status=eq.requested",
        {"status": "generating", "claimed_at": _now_iso()},
    )
    return bool(claimed)


STALE_AFTER_MINUTES = 60  # same threshold and reasoning as process_pack_jobs.py's
                          # fail_stale_jobs() - a CV is one document, not a merged
                          # pack, so this is generous, not tight


def fail_stale_jobs(url, key, now=None):
    """A worker killed mid-job (OOM, host crash) leaves its row in
    'generating' forever (System-Status Gap #11). claimed_at (migration 0019)
    makes that detectable here: after STALE_AFTER_MINUTES the row is marked
    'failed' with a plain reason, so the UI stops showing "Generating..." and
    the person can request again. Deliberately not re-queued: a job that
    crashed the worker once would crash it again in a loop - same rule
    process_pack_jobs.py's own fail_stale_jobs() already follows."""
    import datetime
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    stuck = supabase_request(url, key, "GET", "generated_cvs?status=eq.generating&select=*")
    for job in stuck:
        claimed = job.get("claimed_at")
        if not claimed:
            continue
        claimed_dt = datetime.datetime.fromisoformat(claimed.replace("Z", "+00:00"))
        if claimed_dt < cutoff:
            supabase_request(url, key, "PATCH", f"generated_cvs?id=eq.{job['id']}&status=eq.generating", {
                "status": "failed", "completed_at": _now_iso(),
                "error_message": f"The CV builder stopped mid-job (no result after {STALE_AFTER_MINUTES} "
                                 "minutes). Nothing was produced - request the CV again.",
            })
            print(f"[failed] {job['id']}: stale 'generating' since {claimed}")
            system_alerts.record("cv", f"A CV job was stuck in 'generating' for over {STALE_AFTER_MINUTES} minutes "
                                       "(the worker died mid-job) and was marked failed", "error",
                                 context={"job_id": job["id"], "company_id": job.get("company_id"),
                                          "person_id": job.get("person_id"), "claimed_at": claimed})


def process_job(url, key, job, out_dir):
    if not claim_job(url, key, job):
        print(f"[skipped] {job['id']}: already claimed by another worker")
        return False
    try:
        profile, tender_ctx = fetch_job_context(url, key, job)
        person = profile["key_people"][0]
        person_id = f"person_0"

        log = generate_cv.ProvenanceLog(source="engine/cv/process_cv_jobs.py")
        builder = {"sanral_keyperson": generate_cv.build_sanral_keyperson,
                   "world_bank": generate_cv.build_world_bank}[job["format"]]
        doc = builder(profile, person, person_id, job["detail"], tender_ctx, None, log)

        mode = "customized" if tender_ctx else "standard"
        base_name = f"{person['name'].replace(' ', '_')}_{job['format']}_{job['detail']}_{mode}_{job['id']}"
        docx_local = os.path.join(out_dir, base_name + ".docx")
        os.makedirs(out_dir, exist_ok=True)
        doc.save(docx_local)
        pdf_local = generate_cv._convert_to_pdf(docx_local, out_dir)

        storage_path_docx = f"{job['company_id']}/people/{job['person_id']}/generated/{base_name}.docx"
        storage_upload(url, key, "cv-documents", storage_path_docx, docx_local,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

        storage_path_pdf = None
        if not pdf_local:
            # The Word CV is still delivered, so the job is 'ready' - but a
            # missing PDF means LibreOffice failed on the worker, silently.
            system_alerts.record("cv", "A CV was generated but its PDF conversion failed (LibreOffice) - "
                                       "only the .docx was delivered", "warning",
                                 context={"job_id": job["id"], "company_id": job.get("company_id"),
                                          "person_id": job.get("person_id"), "format": job.get("format")})
        if pdf_local:
            storage_path_pdf = f"{job['company_id']}/people/{job['person_id']}/generated/{base_name}.pdf"
            storage_upload(url, key, "cv-documents", storage_path_pdf, pdf_local, "application/pdf")

        supabase_request(url, key, "PATCH", f"generated_cvs?id=eq.{job['id']}", {
            "status": "ready",
            "storage_path_docx": storage_path_docx,
            "storage_path_pdf": storage_path_pdf,
            "completed_at": _now_iso(),
        })
        print(f"[ready] {job['id']} ({job['format']}/{job['detail']}) -> {storage_path_docx}")
    except Exception as e:
        system_alerts.record("cv", f"CV generation job failed: {type(e).__name__}: {e}", "error", exc=e,
                             context={"job_id": job["id"], "company_id": job.get("company_id"),
                                      "person_id": job.get("person_id"), "format": job.get("format")})
        try:
            supabase_request(url, key, "PATCH", f"generated_cvs?id=eq.{job['id']}", {
                "status": "failed", "error_message": str(e),
            })
        except Exception as e2:
            system_alerts.record("cv", f"Could not mark a failed CV job as failed: {type(e2).__name__}: {e2}",
                                 "error", exc=e2, context={"job_id": job["id"]})
        print(f"[failed] {job['id']}: {e}")
    return True


def _now_iso():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def poll_once(url, key, out_dir, quiet_when_empty=False):
    """One pass over the queue. Returns how many jobs this call handled."""
    fail_stale_jobs(url, key)
    jobs = supabase_request(url, key, "GET", "generated_cvs?status=eq.requested&select=*&order=requested_at.asc")
    if not jobs and not quiet_when_empty:
        print("No pending generated_cvs jobs.")
    handled = 0
    for job in jobs:
        if process_job(url, key, job, out_dir):
            handled += 1
    return handled


def run(out_dir, loop=False, interval=DEFAULT_INTERVAL_SECONDS, max_cycles=None):
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    if not loop:
        poll_once(url, key, out_dir)
        return

    # In loop mode an empty queue is the normal state; printing "No pending
    # jobs" every 30s would bury the lines that matter in the host's logs.
    poll_forever(lambda: poll_once(url, key, out_dir, quiet_when_empty=True),
                 interval=interval, max_cycles=max_cycles, name="process_cv_jobs", alert_source="cv")


# ============================================================================
# Self-test: proves the row-shape adapters against a fixture shaped exactly
# like real Supabase rows, and that the result feeds generate_cv.py's own
# builders correctly - no live Supabase project required. This is the part of
# this script that IS actually run and checked in this pass.
# ============================================================================

def self_test(out_dir):
    person_row = {
        "name": "Test Person", "id_number": "8601205135087", "role": "Contracts Engineer",
        "description": "Contracts Engineer", "ecsa_level": "Professional Engineer",
        "ecsa_number": "20150155", "ecsa_date": "2015-05-04", "sacpcmp_number": None,
        "highest_description": "MEng (Civil Engineering)", "highest_institution": "University of Stellenbosch",
        "highest_graduated": "2015-03-05", "initial_description": "BEng (Civil Engineering)",
        "initial_institution": "University of Pretoria", "initial_graduated": "2010-04-23",
    }
    project_rows = [{
        "client_and_number": "ACSA (OR Tambo Airport)\nORT5737/2018/RFP", "value_rm": 150,
        "position_held": "Contract Engineer", "contact_name": "Kamogelo Molawa",
        "contact_phone": "061 077 1225", "start_date": "2018-01-01", "end_date": "2020-01-01",
        "contact_match_confidence": "confirmed",
    }]
    company_row = {"legal_name": "Klipcorp (Pty) Ltd"}

    profile = {"company": adapt_company_row(company_row), "key_people": [adapt_person_row(person_row, project_rows)]}
    person = profile["key_people"][0]
    assert person["qualifications"]["ecsa_number"] == "20150155"
    assert person["projects"][0]["contact"] == "Kamogelo Molawa"
    assert person["projects"][0]["start"] == "2018-01-01"

    log = generate_cv.ProvenanceLog(source="self-test")
    doc = generate_cv.build_sanral_keyperson(profile, person, "person_0", "summary", None, None, log)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "self_test_sanral_keyperson.docx")
    doc.save(out_path)
    assert os.path.exists(out_path)

    tender_row = {"contract_no": "R.334-030-2025/1F", "closing_date": "2026-11-01T00:00:00+00:00"}
    requirement_row = {"position_description": "Contracts Engineer"}
    assignment_row = {"position_code": "CE", "suggested_score": 7, "suggested_rationale": "test rationale", "specialism_warning": False}
    ctx = build_tender_ctx_from_assignment(tender_row, requirement_row, assignment_row, "person_0")
    assert ctx["position"]["code"] == "CE"
    assert ctx["closing_date"] == "2026-11-01"

    doc2 = generate_cv.build_world_bank(profile, person, "person_0", "detailed", ctx, None, log)
    out_path2 = os.path.join(out_dir, "self_test_world_bank_tender.docx")
    doc2.save(out_path2)
    assert os.path.exists(out_path2)

    print(f"Self-test OK - wrote {out_path} and {out_path2}")
    print(f"Provenance summary: {log.summary()}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true",
                      help="process pending jobs once and exit (the default; kept as an explicit flag)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true",
                      help="keep polling for requested jobs until stopped (always-on worker mode)")
    ap.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS,
                    help=f"seconds between polls in --loop mode (default {DEFAULT_INTERVAL_SECONDS})")
    ap.add_argument("--max-cycles", type=int, default=None,
                    help="--loop mode only: stop after this many polls (for tests)")
    ap.add_argument("--self-test", action="store_true", help="verify the row-shape adapters with no live Supabase project")
    args = ap.parse_args()

    if args.self_test:
        self_test(args.out_dir)
        return
    if args.interval <= 0:
        ap.error("--interval must be a positive number of seconds")

    run(args.out_dir, loop=args.loop, interval=args.interval, max_cycles=args.max_cycles)


if __name__ == "__main__":
    main()
