"""
Stream 4 (discovery), part 2: read a tender's detail page WITHOUT touching
the "Download Documents" form.

The detail page at /open-tenders/<slug> publicly shows pack metadata (file
size, file count, create/last-updated dates, the SCM reference number)
before any form is submitted. This is useful on its own: "Last Updated"
changing on a tender you've already fingerprinted is exactly the kind of
signal Stream 1 (fingerprint.py) exists to catch, and it costs nothing to
check.

It deliberately stops there. The actual documents sit behind a form
(class="sanral-tender-download") that:
  - requires full name, company name, phone and email (personal data), and
  - carries a g-recaptcha-response hidden field, i.e. it is reCAPTCHA
    protected, plus a session-bound CSRF token.
Automating past the reCAPTCHA is not something this script attempts - that
would mean automating around an anti-bot control, not just scraping public
data. Getting the actual zip needs a human in the loop (a real browser
session) until/unless Sarel confirms SANRAL's terms permit automated
collection and supplies the missing phone number (see the handover brief,
section 11, item 1 and 5).

Usage:
    python3 detail.py <slug> [<slug> ...] [--out FILE.json]
"""
import argparse
import html
import json
import re
import sys
import urllib.request

BASE = "https://www.nra.co.za/open-tenders/"
USER_AGENT = "Mozilla/5.0 (tender-tool discovery; contact: Sarel)"

STAT_ROW_RE = re.compile(
    r'<th[^>]*>([^<]+)</th>\s*<td[^>]*>\s*([^<]*?)\s*</td>', re.S
)
# The tender title/closing-date/SCM-reference always appear together in this
# exact sequence right before the download button; matching them as one block
# avoids accidentally matching an unrelated earlier <h2> elsewhere on the page
# (observed: a nav "Quick Links" heading appears before this one).
TENDER_BLOCK_RE = re.compile(
    r"<h2>([^<]+)</h2>\s*<p>([^<]+)</p>\s*<p><strong>SCM Reference Number:</strong>\s*([^<]*?)\s*</p>",
    re.S,
)
DOWNLOAD_FORM_RE = re.compile(r'class="sanral-tender-download"')
RECAPTCHA_RE = re.compile(r"g-recaptcha-response")


def fetch_detail(slug):
    url = BASE + slug
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")

    stats = {html.unescape(k).strip(): html.unescape(v).strip()
             for k, v in STAT_ROW_RE.findall(body)}
    block_m = TENDER_BLOCK_RE.search(body)

    return {
        "slug": slug,
        "url": url,
        "title": html.unescape(block_m.group(1)).strip() if block_m else None,
        "closing_date": html.unescape(block_m.group(2)).strip() if block_m else None,
        "scm_reference": html.unescape(block_m.group(3)).strip() if block_m else None,
        "download_count": stats.get("Download"),
        "file_size": stats.get("File Size"),
        "file_count": stats.get("File Count"),
        "create_date": stats.get("Create Date"),
        "last_updated": stats.get("Last Updated"),
        "download_form_present": bool(DOWNLOAD_FORM_RE.search(body)),
        "download_form_gated_by_recaptcha": bool(RECAPTCHA_RE.search(body)),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="+", help="tender slug(s), e.g. r-343-020-2025-1f")
    ap.add_argument("--out", help="write JSON list to this file instead of stdout")
    args = ap.parse_args()

    results = []
    for slug in args.slugs:
        try:
            d = fetch_detail(slug)
            results.append(d)
            print(f"{slug}: {d['file_size']}, {d['file_count']} file(s), "
                  f"last updated {d['last_updated']}", file=sys.stderr)
        except Exception as e:
            print(f"{slug}: FAILED - {e}", file=sys.stderr)
            results.append({"slug": slug, "error": str(e)})

    out = json.dumps(results, indent=2)
    if args.out:
        open(args.out, "w").write(out)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
