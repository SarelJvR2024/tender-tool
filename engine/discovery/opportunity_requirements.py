"""
Real document-understanding for a discovered-but-not-yet-pursued opportunity
(Sarel, 2026-10-19: "run our engines to unpack the specs and requirements and
make the list of everything that is needed and make sure we have an engine
that perfectly understands how to complete, build and compile each one" -
scope addition on top of the /admin/discovered-opportunities review panel).

This does NOT invent a new document-understanding method. It is wiring: take
the documents engine/discovery/download_discovered_documents.py already
downloaded and stored permanently (discovered_opportunity_documents, migration
0070), and run them through the SAME classifier a real tender intake uses
(engine/intake/classify_tender.py's classify_documents() - workbook family
fingerprint matching via engine/fingerprint.py detect_family(), the SANRAL
docx/required-document detection, and check_fingerprint() against the stored
baseline). Nothing here is scored differently from a real "Prepare this
tender" intake run - it is the same function, run earlier, on the same kind
of files.

Why this can only ever run for non-SANRAL sources: SANRAL's own document form
is behind a confirmed reCAPTCHA v3 wall (see download_discovered_documents.py's
header) - nothing is ever downloaded for it automatically, so there is nothing
here to classify. A SANRAL release's requirements stay "not_downloaded"
forever under this script; a human still has to fetch its documents and go
through the real "Prepare this tender" intake.

Why general (non-SANRAL) tenders get a SHALLOW result, not a full requirement
list: classify_documents() can tell you whether a SANRAL workbook is present
(it isn't, for a general tender, by definition) and which known SANRAL-shaped
docx forms are among the uploads - but the actual general-tender required-
document list (tenders.document_requirements) is produced by
engine/general/requirements.py's LLM-backed extract_requirements() pass,
which is deliberately NOT invoked automatically here for every discovered
release (cost, and it is designed to run once per PURSUED tender, not
speculatively for every one of hundreds of daily discoveries). A general
route is reported honestly as "general (non-SANRAL) - no SANRAL workbook
found; the itemised requirement list needs the full intake pass, run once
this tender is pursued", never a fabricated list.

One row per RELEASE (release_key, same identity as discovered_opportunity_
documents and watch_new_tenders.release_key()) - not per company, same
reasoning as the documents table itself (migration 0070's header): the
documents belong to the release, not to any one company's verdict on it.

Usage:
    python3 opportunity_requirements.py                 # every release with
                                                          # downloaded documents
    python3 opportunity_requirements.py --release-key <k>  # just one, for testing
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (HERE, ENGINE_DIR, os.path.join(ENGINE_DIR, "intake"), os.path.join(ENGINE_DIR, "pack_generator"),
         os.path.join(ENGINE_DIR, "alerts")):
    if p not in sys.path:
        sys.path.insert(0, p)

import company_profiles  # noqa: E402
import system_alerts  # noqa: E402
from classify_tender import classify_documents, check_fingerprint  # noqa: E402

DOCS_TABLE = "discovered_opportunity_documents"
REQ_TABLE = "discovered_opportunity_requirements"
BUCKET = "discovered-tender-documents"
DOWNLOAD_TIMEOUT = 60

# Which extensions classify_documents() can actually look inside (same set
# classify_tender.classify_documents() branches on: xlsm/xlsx workbooks,
# docx forms). A PDF (most Book 1 / tender notices) is listed but never
# classified here - same honest limitation classify_tender.py itself has.
CLASSIFIABLE_EXT = ("xlsm", "xlsx", "docx")


def _ext(title, url):
    name = (title or "").strip() or os.path.basename((url or "").split("?")[0])
    ext = os.path.splitext(name)[1].lstrip(".").lower()
    return ext or None


def _storage_download(client, path, timeout=DOWNLOAD_TIMEOUT):
    """GET raw bytes back from Supabase Storage (service role) - the read
    side of company_profiles.RestClient.upload(), kept here rather than
    added to that shared class so this script has no edit footprint on a
    file download_discovered_documents.py (a different background task) is
    also actively changing."""
    h = {"apikey": client.key, "Authorization": f"Bearer {client.key}"}
    url = client.url + "/storage/v1/object/" + BUCKET + "/" + urllib.parse.quote(path)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        raise RuntimeError(f"could not fetch {BUCKET}/{path}: {e}")


def classify_release(client, release_key, log=print):
    """Returns the row to upsert into discovered_opportunity_requirements,
    or None when there is nothing downloaded yet for this release (the
    caller should not write a row at all - absence of a row IS the
    "not_downloaded" state, read back by the app as such)."""
    rows = client.select(DOCS_TABLE, {"release_key": release_key})
    if not rows:
        return None

    downloaded = [r for r in rows if r.get("status") == "downloaded" and r.get("storage_path")]
    failed_count = sum(1 for r in rows if r.get("status") == "failed")
    buyer = next((r.get("buyer") for r in rows if r.get("buyer")), None)
    source = next((r.get("source") for r in rows if r.get("source")), None)

    if not downloaded:
        # Every URL on file for this release failed to download - nothing to
        # classify, but distinct from "not_downloaded" (a download WAS tried).
        return {
            "release_key": release_key, "source": source, "buyer": buyer,
            "route": None, "family": None, "signal": f"All {failed_count} document download(s) for this release failed - nothing to classify.",
            "required_documents": [], "missing": [], "fingerprint_status": None,
            "unreadable_documents": [], "failed_downloads": failed_count,
            "document_count": 0,
        }

    with tempfile.TemporaryDirectory(prefix="opp_req_") as tmp:
        doc_entries = []
        fetch_errors = []
        for r in downloaded:
            ext = _ext(r.get("document_title"), r.get("document_url"))
            if ext not in CLASSIFIABLE_EXT:
                continue  # a PDF, or something with no recognisable extension - not classifiable, not an error
            try:
                data = _storage_download(client, r["storage_path"])
            except RuntimeError as e:
                fetch_errors.append(str(e))
                log(f"  WARNING: {e}")
                continue
            local = os.path.join(tmp, hashlib.sha1(r["storage_path"].encode()).hexdigest() + "." + ext)
            with open(local, "wb") as f:
                f.write(data)
            doc_entries.append({"name": r.get("document_title") or r.get("document_url"), "format": ext, "_local": local})

        if not doc_entries:
            if fetch_errors:
                # At least one of these WAS a workbook/.docx classify_documents()
                # could look inside - it just couldn't be re-fetched from
                # Storage this run (object moved/deleted since download, or a
                # transient error). Distinct from "every downloaded file is a
                # PDF" below: say so honestly, and keep the real error instead
                # of letting it vanish past this early return.
                signal = (f"{len(fetch_errors)} of {len(downloaded)} downloaded document(s) looked like a "
                          "workbook or .docx form, but couldn't be re-fetched from storage just now - see "
                          "unreadable_documents.")
            else:
                signal = (f"{len(downloaded)} document(s) downloaded, none of them a workbook or .docx form "
                          "classify_documents() can look inside (PDFs, mostly) - nothing to route on yet.")
            return {
                "release_key": release_key, "source": source, "buyer": buyer,
                "route": "general", "family": None,
                "signal": signal,
                "required_documents": [], "missing": [], "fingerprint_status": None,
                "unreadable_documents": [f"(storage fetch failed) {e}" for e in fetch_errors],
                "failed_downloads": failed_count,
                "document_count": len(downloaded),
            }

        decision = classify_documents(doc_entries, buyer=buyer)
        unreadable = [w["document"] for w in decision["workbooks"] if w["kind"] == "unreadable"]

        fingerprint_status, missing = None, []
        if decision["route"] == "sanral":
            tech = decision["sanral_files"].get("technical_xlsm")
            if tech:
                fp = check_fingerprint(tech, decision["family"])
                fingerprint_status = fp["status"]
            present = {d["doc_type"] for d in decision["sanral_documents"]}
            missing = [lbl for dt, lbl in (("c111_form_of_offer", "C.1.1.1 Form of Offer (.docx)"),
                                           ("c123_contract_data", "C.1.2.3 Contract Data (.docx)"),
                                           ("a_forms", "A-Forms / returnable schedules (.docx)"),
                                           ("financial_xlsm", "Financial Submission workbook (.xlsm)"))
                       if dt not in present]

        return {
            "release_key": release_key, "source": source, "buyer": buyer,
            "route": decision["route"], "family": decision["family"], "signal": decision["signal"],
            "required_documents": decision["sanral_documents"],
            "missing": missing,
            "fingerprint_status": fingerprint_status,
            "unreadable_documents": unreadable + [f"(storage fetch failed) {e}" for e in fetch_errors],
            "failed_downloads": failed_count,
            "document_count": len(downloaded),
        }


def classify_all(client, release_key=None, log=print):
    """Every release_key with at least one downloaded document (or just the
    one given), classified and upserted into discovered_opportunity_requirements.
    Returns {classified, skipped_nothing_downloaded, errors}.

    QA pass, 2026-10-30: classify_release() used to be called with no
    try/except at all in this loop - a transient failure on any ONE release
    (a Supabase network blip during its own select()/upsert(), or anything
    else classify_release() didn't already catch) raised straight out of
    this function, aborting classification for every OTHER, perfectly fine
    release still queued after it in the same run - confirmed directly: a
    simulated failure on the middle release of three left the third one
    never even attempted. Same bug class this codebase has fixed
    independently several times (watch_deadlines.days_until(), every
    fail_stale_jobs()). This file also had no system_alerts integration at
    all before this fix, unlike every other engine/ script - a repeated
    failure here would have had no trace beyond this call's own stdout."""
    if release_key:
        keys = [release_key]
    else:
        rows = client.select(DOCS_TABLE, {"status": "downloaded"})
        keys = sorted({r["release_key"] for r in rows if r.get("release_key")})

    summary = {"classified": 0, "skipped_nothing_downloaded": 0, "errors": 0}
    for key in keys:
        try:
            result = classify_release(client, key, log=log)
        except Exception as e:
            summary["errors"] += 1
            system_alerts.record("discovery", f"Could not classify requirements for release {key}: "
                                 f"{type(e).__name__}: {e}", "error", exc=e, context={"release_key": key})
            log(f"  ERROR classifying {key}: {type(e).__name__}: {e} - skipped, other releases still run")
            continue
        if result is None:
            summary["skipped_nothing_downloaded"] += 1
            continue
        client.upsert(REQ_TABLE, [result], on_conflict="release_key")
        summary["classified"] += 1
        log(f"  classified {key}: route={result['route']} family={result['family']} "
            f"fingerprint={result['fingerprint_status']} missing={len(result['missing'])}")
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release-key", help="classify just this one release (default: every release with downloaded documents)")
    args = ap.parse_args()

    client = company_profiles.RestClient.from_env()
    if client is None:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see app/.env.local.example) before running this.")
        sys.exit(1)

    summary = classify_all(client, args.release_key)
    print(f"\nDone - {summary['classified']} release(s) classified, "
          f"{summary['skipped_nothing_downloaded']} had no downloaded documents to classify, "
          f"{summary['errors']} failed and were skipped (see system_alerts).")


if __name__ == "__main__":
    main()
