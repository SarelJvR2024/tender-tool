"""
Stream 5 (discovery), permanent document store: downloads and stores EVERY
document for EVERY discovered tender - automatically, at discovery time,
with no human needing to "pursue" the tender first (Sarel, 2026-10-19: "We
need to have a full repository of all tenders on the internet available to
us, and all documents already downloaded... It shouldn't be manually
prompted by a user. We need it up front so we can build engines to analyze
if there's anything we haven't catered for.").

Before this, every government source's documents were fetched only
TRANSIENTLY: assess_tender.fetch_pdf_text downloads to a temp file purely to
extract text for scoring, then discards it. This script is the missing
permanent step, writing to discovered_opportunity_documents (migration 0071)
and the 'discovered-tender-documents' Storage bucket - see that migration's
header comment for why this is a new table rather than a reuse of
tender_documents (shape and scoping-key mismatch: tender_documents needs a
real tenders row, which most discovered releases never get, and is one row
per (tender, doc TYPE) where this is one row per (release, document URL)).

SANRAL is deliberately excluded. Its own document-download form is gated
behind reCAPTCHA v3 - CONFIRMED live, on real infrastructure
(engine/discovery/download_documents.py's own docstring) - a hard, already-
confirmed technical wall this script does not attempt to bypass.
gov_sources.sanral_releases() already records SANRAL's attached file TITLES
with url=None; a document with no URL is skipped here and logged as needing
a human click-through, never silently dropped. Every other source
(etenders_portal, etenders_ocds/national, eskom_bulletin,
transnet_etenders, capetown_procurement, cidb_tenders, dbsa_procurement,
sars_procurement) gives a direct, unauthenticated link - confirmed in each
source's own module docstring.

Idempotent by design: before downloading anything, each document is checked
against discovered_opportunity_documents by (release_key, document_url) -
a URL already on file (success OR a previously-recorded failure) is skipped
without touching the network again. These feeds are read daily/repeatedly
by watch_new_tenders.py, so re-downloading an unchanged document on every
run would be both slow and pointless.

One bad or dead link must not take out the whole run (same philosophy as
assess_tender.fetch_pdf_text's own error handling): a download or upload
failure is recorded as a 'failed' row with the reason and the run continues.
Failures are logged clearly; if any occurred this run, ONE summary
system_alerts entry is raised (not one per document, which would flood
Sarel on a feed with a handful of dead links).

Wired into engine/discovery/watch_new_tenders.py: every scheduled watch run
downloads documents for the report-worthy releases it just scored (the same
releases that become discovered_opportunities rows), right after
seed_supabase_opportunities.seed(). Opt out with --no-download-documents
(mirrors --no-seed). Can also be run by hand against a watch's --out file.

Usage:
    python3 download_discovered_documents.py <releases.json>
    (releases.json: the list watch_new_tenders.py's --out writes, or any
    list of release dicts shaped like its `documents` entries -
    {"url": ..., "title": ...} - under a "documents" key, plus "ocid"/
    "contract_number"/"buyer"/"title"/"source")
"""
import hashlib
import os
import re
import sys
import json
import argparse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import company_profiles  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "alerts"))
import system_alerts  # noqa: E402

TABLE = "discovered_opportunity_documents"
BUCKET = "discovered-tender-documents"
DOWNLOAD_TIMEOUT = 30  # seconds per document - same ballpark as assess_tender.fetch_pdf_text

_SLUG_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def _slug(s, default="unknown"):
    s = _SLUG_RE.sub("_", str(s or "")).strip("_")
    return s or default


def release_key(r):
    """Same identity as watch_new_tenders.release_key(): ocid, falling back
    to contract_number for the rare release with no ocid. Kept as a
    standalone copy (not an import) so this script has no hard dependency on
    watch_new_tenders.py and can be run/tested on its own."""
    return r.get("ocid") or r.get("contract_number")


def fetch_document(url, timeout=DOWNLOAD_TIMEOUT):
    """Returns (data, content_type, error). A failed download degrades to
    (None, None, <reason>) rather than raising - one bad document link on a
    public buyer's own site must not take out the whole run, same rule as
    assess_tender.fetch_pdf_text.

    A relative or scheme-less URL (confirmed reachable: sars_procurement.py's
    own fetch_documents() used to store a raw regex-captured href with no
    absolute-URL resolution at all, unlike dbsa_procurement.py's equivalent -
    fixed separately) makes urllib.request.Request() itself raise ValueError
    the moment it's constructed - a plain construction failure, not one of
    urlopen's own network-error types, so it used to be uncaught here and
    crashed the ENTIRE download_for_releases() run on the very first bad
    link it hit, exactly the "one bad link taking out the whole run" failure
    this function's own docstring says it prevents (QA-Edge-Case-Findings.md,
    2026-10-19). Deliberately not also restricting the scheme itself to
    http(s): file:// is this codebase's own established convention for
    offline test fixtures standing in for a live link (test_discovery_fanout.py,
    test_discovery_downgrades.py, test_taxonomy.py, and this module's own
    test), feeding this exact production code path - narrowing it here would
    just break that convention without closing a real, demonstrated gap."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
            content_type = r.headers.get_content_type() or "application/octet-stream"
            return data, content_type, None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError) as e:
        return None, None, f"could not download document: {e}"


def storage_path(release_key_, source, document_title, url, digest):
    name = _slug(document_title or os.path.basename(url.split("?")[0]) or "document", "document")
    # No file extension assumed - kept exactly as the source names it (some
    # buyers link a .pdf, some an .docx/.xlsx Book 1). digest prefix keeps two
    # differently-named documents at the same release from colliding and makes
    # the stored filename traceable back to content_hash at a glance.
    return f"{_slug(source, 'unknown')}/{_slug(release_key_)}/{digest[:16]}-{name}"


def existing_urls(client, release_keys):
    """{(release_key, document_url)} already recorded - downloaded or
    previously failed - across every given release, read in one query per
    chunk of keys (RestClient.select already pages/batches for a long 'in'
    list the same way watch_new_tenders.py's seen-store read does)."""
    out = set()
    keys = sorted({k for k in release_keys if k})
    if not keys:
        return out
    for row in client.select(TABLE, {"release_key": keys}):
        out.add((row["release_key"], row["document_url"]))
    return out


def download_for_releases(releases, client, timeout=DOWNLOAD_TIMEOUT, log=print):
    """Downloads and permanently stores every not-yet-seen document on each
    release (skipping SANRAL/no-URL documents and anything already on file -
    see this module's docstring). Returns a summary dict: {downloaded,
    skipped_existing, skipped_no_url, failed} counts, plus `failures` (a list
    of {release_key, buyer, document_url, error} for the run's own logging/
    alerting - never raised)."""
    summary = {"downloaded": 0, "skipped_existing": 0, "skipped_no_url": 0, "failed": 0, "failures": []}
    seen = existing_urls(client, (release_key(r) for r in releases))
    for r in releases:
        key = release_key(r)
        docs = r.get("documents") or []
        if not docs:
            continue
        if not key:
            log(f"  SKIPPED {len(docs)} document(s) for '{r.get('title') or r.get('buyer')}': "
                "no ocid/contract_number to key a row on.")
            continue
        source = r.get("source")
        for d in docs:
            url = (d or {}).get("url")
            title = (d or {}).get("title")
            if not url:
                summary["skipped_no_url"] += 1
                log(f"  SKIPPED (needs human click-through, no direct URL): {key} - "
                    f"{title or '(untitled)'}" + ("  [SANRAL]" if source == "sanral" else ""))
                continue
            if (key, url) in seen:
                summary["skipped_existing"] += 1
                continue
            data, content_type, error = fetch_document(url, timeout)
            row = {
                "release_key": key, "ocid": r.get("ocid"), "contract_number": r.get("contract_number"),
                "source": source, "buyer": r.get("buyer"), "release_title": r.get("title"),
                "document_title": title, "document_url": url,
            }
            if error:
                row.update({"status": "failed", "error": error})
                summary["failed"] += 1
                summary["failures"].append({"release_key": key, "buyer": r.get("buyer"),
                                            "document_url": url, "error": error})
                log(f"  FAILED  {key} - {title or url}: {error}")
            else:
                digest = hashlib.sha256(data).hexdigest()
                path = storage_path(key, source, title, url, digest)
                try:
                    client.upload(BUCKET, path, data, content_type)
                except RuntimeError as e:
                    row.update({"status": "failed", "error": f"upload failed: {e}"})
                    summary["failed"] += 1
                    summary["failures"].append({"release_key": key, "buyer": r.get("buyer"),
                                                "document_url": url, "error": str(e)})
                    log(f"  FAILED  {key} - {title or url}: upload failed: {e}")
                else:
                    row.update({"status": "downloaded", "storage_path": path, "content_hash": digest,
                               "content_type": content_type, "byte_size": len(data)})
                    summary["downloaded"] += 1
                    log(f"  stored  {key} - {title or url}  ({len(data):,} bytes -> {BUCKET}/{path})")
            try:
                client.insert(TABLE, row)
            except RuntimeError as e:
                # A duplicate from a concurrent run losing the unique-constraint
                # race is not a reason to fail this run - the other run's row
                # already records this document.
                log(f"  NOTE: could not record a row for {key} - {title or url}: {e}")
            seen.add((key, url))
    if summary["failures"]:
        system_alerts.record(
            "discovery",
            f"{summary['failed']} discovered-tender document(s) failed to download this run",
            "warning",
            detail="\n".join(f"{f['release_key']} ({f['buyer']}): {f['document_url']} - {f['error']}"
                             for f in summary["failures"][:25]),
            context={"failed_count": summary["failed"]},
        )
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("releases_path", help="JSON file written by watch_new_tenders.py's --out "
                    "(or any list of release dicts shaped the same way)")
    args = ap.parse_args()

    client = company_profiles.RestClient.from_env()
    if client is None:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    releases = json.load(open(args.releases_path))
    if not releases:
        print("No releases in this file - nothing to download.")
        return

    summary = download_for_releases(releases, client)
    print(f"\nDone - {summary['downloaded']} document(s) downloaded and stored, "
          f"{summary['skipped_existing']} already on file, "
          f"{summary['skipped_no_url']} need a human click-through (no direct URL), "
          f"{summary['failed']} failed.")


if __name__ == "__main__":
    main()
