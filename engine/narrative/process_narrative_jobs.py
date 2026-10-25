"""
Cover letter / methodology statement bridge: claims 'requested' rows in
narrative_documents (migration 0084), assembles each company's real
context (profile, key people, past experience, the tender's own facts),
runs the real generator (generate_narrative.py) - including the mechanical
anti-collusion uniqueness check against every OTHER company's ready
document for the SAME tender - and uploads the result.

Same async request/fulfil shape as every other engine/*/process_*_jobs.py
bridge (the web app on Vercel cannot run Python): the Tender Workspace only
inserts a row with status='requested'; this script, run by a human, cron or
a scheduler, does the real work.

Usage:
    python3 process_narrative_jobs.py [--once]
    python3 process_narrative_jobs.py --loop [--interval 30]

Environment:
    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
    ANTHROPIC_API_KEY                                     needed to generate
    NARRATIVE_MODEL                                       optional, default claude-opus-5-5

The service role is required (not the anon key): the uniqueness check reads
OTHER companies' generated_text for the same tender_id, which RLS never
grants to any client role - only this backend worker, same elevated access
every other engine/*/process_*_jobs.py bridge already has.
"""
import argparse
import datetime
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "worker"))

from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS, system_alerts  # noqa: E402
from build_docx import build_docx  # noqa: E402
from generate_narrative import SetupError, TransientError, GenerationFailed, generate_with_uniqueness_check  # noqa: E402

STALE_AFTER_MINUTES = 30  # one LLM call (plus, rarely, one retry) + a docx build and upload


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def supabase_request(url, service_key, method, path, body=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=(__import__("json").dumps(body)).encode() if body is not None else None,
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
            import json
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


def claim_job(url, key, job):
    """Atomically requested -> generating, same shape as process_cv_jobs.py's
    claim_job() - an empty result means another worker already took it."""
    claimed = supabase_request(
        url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}&status=eq.requested",
        {"status": "generating", "started_at": _now_iso()},
    )
    return bool(claimed)


def fail_stale_jobs(url, key, now=None):
    """Same reasoning as every other bridge's own fail_stale_jobs(): a
    worker killed mid-job leaves its row stuck in 'generating' forever
    without this. Not re-queued - a job that crashed the worker once would
    crash it again."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    stuck = supabase_request(url, key, "GET", "narrative_documents?status=eq.generating&select=*")
    for job in stuck:
        started = job.get("started_at")
        if not started:
            continue
        started_dt = datetime.datetime.fromisoformat(started.replace("Z", "+00:00"))
        if started_dt < cutoff:
            supabase_request(
                url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}&status=eq.generating",
                {"status": "failed", "error_message": "Worker stopped responding partway through generation - request again.",
                 "completed_at": _now_iso()},
            )


# ============================================================================
# Context assembly: Supabase rows -> build_prompt.py's context-dict shape.
# Kept as small, individually obvious adapter functions (same discipline as
# process_cv_jobs.py's adapt_*_row functions) so each is easy to check
# against the real column names rather than guessed.
# ============================================================================

def load_company_context(url, key, company_id):
    rows = supabase_request(
        url, key, "GET",
        f"companies?id=eq.{company_id}&select=legal_name,csd_trading_name,cidb_grading,bee_level,"
        f"total_employees,ecsa_registered_staff_count,how_we_work",
    )
    if not rows:
        raise GenerationFailed(f"No company row found for company_id={company_id}")
    return rows[0]


def load_tender_context(url, key, tender_id):
    rows = supabase_request(
        url, key, "GET",
        f"tenders?id=eq.{tender_id}&select=contract_no,title,buyer,closing_date,description",
    )
    if not rows:
        raise GenerationFailed(f"No tender row found for tender_id={tender_id}")
    row = rows[0]
    return {
        "contract_no": row.get("contract_no"), "title": row.get("title"), "buyer": row.get("buyer"),
        "closing_date": row.get("closing_date"),
        "scope_summary": (row.get("description") or "")[:500] or None,
    }


def load_key_people(url, key, company_id, limit=5):
    """The company's own named people with a role on file - a reasonable
    default "who's on this submission" list. Does NOT specifically pick the
    key people CONFIRMED for this one tender (tender_pack_assignments is
    SANRAL-specific and general-family tenders have no equivalent) - a
    deliberate, flagged simplification for this first pass. See this
    module's own README for the follow-up."""
    rows = supabase_request(
        url, key, "GET",
        f"people?company_id=eq.{company_id}&role=not.is.null&select=name,role,ecsa_level,"
        f"highest_description,highest_graduated&order=name.asc&limit={limit}",
    )
    people = []
    for row in rows:
        years_experience = None
        if row.get("highest_graduated"):
            try:
                graduated = datetime.date.fromisoformat(row["highest_graduated"])
                years_experience = max(0, (datetime.date.today() - graduated).days // 365)
            except ValueError:
                pass
        people.append({
            "name": row.get("name"), "role": row.get("role"), "ecsa_level": row.get("ecsa_level"),
            "highest_description": row.get("highest_description"), "years_experience": years_experience,
        })
    return people


def load_experience(url, key, company_id, limit=5):
    rows = supabase_request(
        url, key, "GET",
        f"experience_items?company_id=eq.{company_id}&select=project_name,client_name,scope_summary,"
        f"value_rm,completion_date,performance_rating&order=completion_date.desc.nullslast&limit={limit}",
    )
    return [{
        "project_name": r.get("project_name"), "client_name": r.get("client_name"),
        "scope_summary": r.get("scope_summary"), "value_rm": r.get("value_rm"),
        "completion_date": r.get("completion_date"), "performance_rating": r.get("performance_rating"),
    } for r in rows]


def load_other_companies_text(url, key, tender_id, kind, exclude_company_id):
    """Every OTHER company's ready document of the same kind for the SAME
    tender - the exact cross-tenant read the uniqueness check needs and the
    one thing RLS never grants to any client; safe here because this
    worker uses the service role, and because only a similarity SCORE
    (never this text) is ever returned to any company. See migration
    0084's own header comment."""
    rows = supabase_request(
        url, key, "GET",
        f"narrative_documents?tender_id=eq.{tender_id}&kind=eq.{kind}&status=eq.ready"
        f"&company_id=neq.{exclude_company_id}&select=generated_text",
    )
    return [r["generated_text"] for r in rows if r.get("generated_text")]


def build_context(url, key, job):
    company = load_company_context(url, key, job["company_id"])
    tender = load_tender_context(url, key, job["tender_id"])
    return {
        "kind": job["kind"],
        "tender": tender,
        "company": company,
        "key_people": load_key_people(url, key, job["company_id"]),
        "experience": load_experience(url, key, job["company_id"]),
        "user_guidance": job.get("user_guidance") or "",
        "style": {
            "length": job["style_length"], "detail": job["style_detail"],
            "visual": job["style_visual"],
        },
    }


def process_one(url, key, job, out_dir):
    if not claim_job(url, key, job):
        return  # another worker already took it

    try:
        context = build_context(url, key, job)
        other_texts = load_other_companies_text(url, key, job["tender_id"], job["kind"], job["company_id"])
        result = generate_with_uniqueness_check(context, other_texts)

        title = "Cover Letter" if job["kind"] == "cover_letter" else "Methodology Statement"
        local_path = os.path.join(out_dir, f"{job['id']}.docx")
        build_docx(
            result["sections"], local_path, title=title,
            subtitle=context["tender"].get("contract_no"),
            color_theme=job["style_color"], visual_style=job["style_visual"],
        )
        object_path = f"{job['company_id']}/tenders/{job['tender_id']}/{job['id']}/{job['kind']}.docx"
        storage_upload(url, key, "narrative-documents", object_path,
                       local_path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

        supabase_request(
            url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}",
            {
                "status": "ready",
                "generated_storage_path": object_path,
                "generated_text": result["plain_text"],
                "generated_at": _now_iso(),
                "similarity_score": result["similarity_score"],
                "similarity_flagged": result["similarity_flagged"],
                "regenerated_for_distinctness": result["regenerated_for_distinctness"],
                "quality_review_passes": result["quality_review_passes"],
                "quality_flagged": result["quality_flagged"],
                "completed_at": _now_iso(),
            },
        )
    except SetupError as e:
        # Not this job's fault - revert to 'requested' so it's picked up
        # again once the worker is actually configured, same reasoning as
        # extract_cv_fields.py's own SetupError handling.
        supabase_request(url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}",
                         {"status": "requested"})
        raise
    except TransientError as e:
        supabase_request(url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}",
                         {"status": "requested"})
        print(f"Transient error on job {job['id']}, requeued: {e}", file=sys.stderr)
    except GenerationFailed as e:
        # generate_narrative.py's own messages are already written to be
        # customer-safe, plain sentences ("The AI service rejected this
        # request: ...") - safe to show verbatim, unlike the generic
        # Exception branch below.
        supabase_request(
            url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}",
            {"status": "failed", "error_message": str(e), "completed_at": _now_iso()},
        )
    except Exception as e:  # noqa: BLE001 - a bug, not a user problem
        # narrative-documents.tsx shows error_message to the customer
        # verbatim (no sanitisation on that side) - this used to write the
        # raw str(e) straight through for ANY unexpected exception here
        # (a python-docx internal error, a KeyError, ...), the exact "never
        # a raw Python/library exception" problem process_cv_jobs.py's own
        # process_job() was already written to avoid. This was also the
        # only process_*_jobs.py bridge in the repo with no system_alerts
        # call at all on a genuine crash - silent from Sarel's own ops
        # visibility too. QA pass, 2026-10-25.
        system_alerts.record("narrative", f"Narrative generation crashed: {type(e).__name__}: {e}", "error", exc=e,
                             context={"job_id": job["id"], "company_id": job.get("company_id"), "kind": job.get("kind")})
        supabase_request(
            url, key, "PATCH", f"narrative_documents?id=eq.{job['id']}",
            {"status": "failed",
             "error_message": "Could not generate this document - try again. If it keeps happening, let us know.",
             "completed_at": _now_iso()},
        )


def poll_once(url, key, out_dir):
    fail_stale_jobs(url, key)
    jobs = supabase_request(url, key, "GET", "narrative_documents?status=eq.requested&select=*&order=requested_at.asc")
    for job in jobs:
        process_one(url, key, job, out_dir)
    return len(jobs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", default=True)
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS)
    args = parser.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as out_dir:
        if args.loop:
            poll_forever(lambda: poll_once(url, key, out_dir), interval=args.interval)
        else:
            handled = poll_once(url, key, out_dir)
            print(f"Processed {handled} job(s).")


if __name__ == "__main__":
    main()
