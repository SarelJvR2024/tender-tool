"""
Stream 4 (discovery), part 3: actually fetch the document pack for a tender.

How the site really works (mapped 2026-10-15 by loading the real page in a
browser and reading its own JS, not guessed):

  1. Clicking ".btn-download" on /open-tenders/<slug> opens a dialog with a
     form (class "sanral-tender-download") asking for fullname, company_name,
     phone, email, and an accept_policy checkbox.
  2. Clicking ".btn-download-email" calls `grecaptcha.execute(SITEKEY,
     {action:'homepage'})`. This is reCAPTCHA **v3** - invisible, score-based,
     no puzzle to solve. A real browser that loads the page and clicks the
     real button the way a human would gets a legitimate token the same way
     any visitor's browser does; nothing is being defeated or bypassed.
  3. The page POSTs the form as multipart FormData to
     /sanral-tenders/download/<slug>, expects back JSON, and on
     {"success": true, "link": "..."} navigates to that link to get the file.

Compliance check done 2026-10-15: robots.txt allows all paths for all
agents; the published Terms & Conditions only cover copyright, disclaimer
and linking policy - nothing about automated access, bots or scraping.
Nothing found prohibiting this.

What this script does NOT do: run unattended with fabricated identity data.
fullname and company_name are REQUIRED arguments with no default - this
script will refuse to run without them rather than guess at who "you" are
on a form submitted to a real government procurement body, repeatedly, on
a schedule. Confirm them once; the daily runner (run_discovery.py) then
reuses the same confirmed values every day.

Usage:
    python3 download_documents.py <slug> [<slug> ...] \
        --fullname "Sarel ..." --company "..." --phone "082-786-9775" \
        --email "sarel@..." --out-dir ../templates/incoming
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

# No hardcoded browser path here on purpose: this runs `playwright install
# chromium` wherever it's deployed and lets Playwright find its own managed
# browser normally. A hardcoded path only makes sense pinned to one specific
# machine's layout, which breaks the moment this moves to a different host.
BASE = "https://www.nra.co.za/open-tenders/"


def download_one(page, slug, fullname, company, phone, email, out_dir, accept_policy=True):
    page.goto(BASE + slug, wait_until="networkidle", timeout=30000)
    page.click(".btn-download")
    page.wait_for_selector("form.sanral-tender-download", state="visible", timeout=10000)

    page.fill('form.sanral-tender-download input[name="fullname"]', fullname)
    page.fill('form.sanral-tender-download input[name="company_name"]', company)
    page.fill('form.sanral-tender-download input[name="phone"]', phone)
    page.fill('form.sanral-tender-download input[name="email"]', email)
    if accept_policy:
        checkbox = page.locator('form.sanral-tender-download input[name="accept_policy"]')
        if checkbox.count() and not checkbox.is_checked():
            checkbox.check()

    with page.expect_response(
        lambda r: f"/sanral-tenders/download/{slug}" in r.url, timeout=20000
    ) as resp_info:
        page.click(".btn-download-email")
    resp = resp_info.value
    result = resp.json()

    if not result.get("success"):
        return {"slug": slug, "success": False, "error": result.get("html", "no link returned")}

    link = result["link"]
    os.makedirs(out_dir, exist_ok=True)
    with page.expect_download(timeout=30000) as dl_info:
        page.evaluate("(url) => { window.location.href = url; }", link)
    download = dl_info.value
    saved_path = os.path.join(out_dir, download.suggested_filename)
    download.save_as(saved_path)

    return {"slug": slug, "success": True, "link": link, "saved_path": saved_path}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slugs", nargs="+")
    ap.add_argument("--fullname", required=True)
    ap.add_argument("--company", required=True)
    ap.add_argument("--phone", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--out-dir", default="../templates/incoming")
    ap.add_argument("--out", help="write a JSON results summary here")
    ap.add_argument("--headed", action="store_true", help="show the browser (debugging)")
    args = ap.parse_args()

    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        try:
            page = browser.new_page(accept_downloads=True)
            for slug in args.slugs:
                try:
                    r = download_one(page, slug, args.fullname, args.company,
                                      args.phone, args.email, args.out_dir)
                except Exception as e:
                    r = {"slug": slug, "success": False, "error": str(e)}
                results.append(r)
                status = "OK -> " + r.get("saved_path", "") if r["success"] else "FAILED: " + r.get("error", "")[:200]
                print(f"{slug}: {status}", file=sys.stderr)
                time.sleep(2)  # don't hammer the site between tenders
        finally:
            browser.close()

    out = json.dumps(results, indent=2)
    if args.out:
        open(args.out, "w").write(out)
    else:
        print(out)

    if any(not r["success"] for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
