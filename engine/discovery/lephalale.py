"""
Discovery, direct buyer reader: Lephalale Local Municipality's own tenders
page (lephalale.gov.za/pages/tenders.php).

Flagged by this round's catalog research
(docs/specs/Government-Buyer-Catalog-Round4-Final-Sweep.md): "Zero results
for `--buyer "lephalale"` - confirmed real gap", re-confirmed independently
this same session (2026-10-21) with the exact same CLI command.

Page structure, confirmed from the real page source: a plain HTML table,
one row per PUBLISHED BATCH (not per tender) - "September Batch 2026",
"August Batch 2026", etc, each linking to a PDF. **Each batch PDF can, and
often does, bundle SEVERAL separate tenders** (confirmed: the August 2026
batch has two, T01/2026-2027 and T02/2026-2027, with two DIFFERENT closing
dates) - this is NOT the Finding 42 ("combined multi-tender bulletin, wrong
buyer attribution") problem, since every tender in a batch is genuinely
Lephalale Municipality's own, correctly read as its own separate release,
each from its own row inside the batch PDF - more like a newspaper classifieds
page than City of Tshwane's cross-department notice. The listing page's own
per-batch "closing date" column is just the LATEST closing date among that
batch's own tenders (confirmed by cross-checking it against the real PDFs) -
not used for the release data itself, only to decide which batches are worth
opening at all (see FETCH_CUTOFF_DAYS below; the archive goes back to 2023).

Each tender inside a batch PDF is its own row, "Ref no:<internal ref>"
followed by a description, a T-number (confirmed NOT always unique -
Finding-class real data-quality issue: the March 2026 batch's "8/2/821" and
"8/2/805" both carry "T46/2025-2026" for two completely different tenders,
same pattern already seen at Necsa/Limpopo Public Works/Ulundi - so the
INTERNAL REF, always unique across every batch checked, is this reader's
real identity, never the T-number), then DOC fee / evaluation-system /
enquiry-contact columns that bleed into the description text inconsistently
between batches (pdftotext's own column linearization, not a bug in this
reader), then the row's own closing date in DD/MM/YYYY - South African day-
first, NOT source_http.parse_sast's ambiguous US-style MM/DD/YYYY path, so
parsed directly here rather than risking that collision (07/09/2026 is 7
September, not July 9).

Usage:
    python3 lephalale.py [--out FILE.json] [--cutoff-days N]
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "lephalale"
BASE_URL = "https://www.lephalale.gov.za"
LIST_URL = BASE_URL + "/pages/tenders.php"
BUYER = "Lephalale Local Municipality"

# The real archive goes back to 2023 (1,095+ rows) - only batches whose OWN
# listed closing date is this recent are opened at all; the listing is
# already reverse-chronological so this is a simple walk-and-stop, not a
# full-table filter. 45 days, not just "still open": confirmed live
# (2026-10-21) that the newest batch on the page had already closed 2 days
# earlier with no newer one published yet - a cutoff tied to "still open"
# would have caught nothing that day, purely because of this buyer's own
# publishing gap, not a reader problem. is_closed (computed per-release from
# its own real date) is what actually says whether a tender is still open;
# this cutoff only bounds how far into a 3-year archive it's worth looking.
FETCH_CUTOFF_DAYS = 45

ROW_RE = re.compile(
    r"<tr><td><a href='([^']+)'[^>]*>([^<]*)</a></td><td>([\d-]+)</td><td>([\d-]+)</td></tr>")
REF_SPLIT = re.compile(r"Ref\s*no\s*:\s*")
TNUM_RE = re.compile(r"T\s*(\d{1,3})\s*/\s*(\d{4})\s*-\s*(\d{4})\s*(\(Re-?advert\))?", re.IGNORECASE)
DATE_RE = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
# Noise this reader deliberately strips from the description text - the DOC
# fee, evaluation-ratio and enquiry-phone columns, which pdftotext -layout
# interleaves into the description line inconsistently between batches (see
# module docstring) - stripped rather than guessed at, same "don't fake a
# clean field you can't actually read" rule as every other reader.
NOISE_RE = re.compile(r"R\s*\d[\d,]*\.\d{2}|\b\d{1,3}/\d{1,3}\b(?!\d)|0\d{2}\s?\d{3}\s?\d{4}|\b\d{2}/\d{2}/\d{4}\b")


def _pdf_text(path_or_bytes):
    """pdftotext -layout on a PDF's raw bytes. Returns "" (not an exception)
    on anything pdftotext itself can't open - an unreadable single batch
    (a corrupt download, an erratum that's actually a scanned notice) must
    not take down the whole run, same rule as every other multi-document
    reader in this codebase (etenders_portal, eskom_bulletin)."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(path_or_bytes)
        f.flush()
        try:
            out = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, timeout=60)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return ""
        return out.stdout if out.returncode == 0 else ""


def parse_listing(html):
    """[(url, label, uploaded_date, closing_date)] for every batch row, in
    the page's own (already reverse-chronological) order."""
    rows = []
    for url, label, uploaded, closing in ROW_RE.findall(html):
        resolved = urllib.parse.urljoin(LIST_URL, url)
        # The raw href has real, unescaped spaces/parens in the filename
        # ("September Batch 2026 - Copy.pdf") - urljoin resolves the relative
        # path but doesn't percent-encode it; only the path's own last
        # segment needs it; the scheme/host/rest of the path are already
        # clean ASCII from this site.
        split = urllib.parse.urlsplit(resolved)
        full = urllib.parse.urlunsplit(split._replace(path=urllib.parse.quote(split.path)))
        rows.append((full, sh.clean(label), uploaded, closing))
    if not rows:
        raise RuntimeError(
            "lephalale: 0 batch rows parsed from a 200 response - the listing page's own markup "
            "has likely changed. Fix the parser before trusting an empty result as 'no tenders'."
        )
    return rows


def _recent_enough(closing_date_text, cutoff_days):
    try:
        d = datetime.date.fromisoformat(closing_date_text)
    except ValueError:
        return False  # a malformed/placeholder date ("0000-00-00") - always from deep archive, skip
    return d >= (datetime.date.today() - datetime.timedelta(days=cutoff_days))


def parse_batch(text):
    """[(internal_ref, tnumber_or_None, description, closing_dt)] for every
    tender inside one batch PDF's own text. A batch with none (an erratum
    that's pure prose, a scanned notice) returns [] - not every batch bundles
    a tender, and that's legitimate, unlike the whole-listing-page case
    above where zero rows means the parser itself broke."""
    out = []
    for part in REF_SPLIT.split(text)[1:]:
        cut = part.find("•")  # the "•" bullet that starts the boilerplate conditions
        chunk = part[:cut] if cut > 0 else part
        ref_m = re.match(r"([\w/]+)", chunk)
        if not ref_m:
            continue
        internal_ref = ref_m.group(1)
        chunk = chunk[ref_m.end():]  # drop the ref itself so it never leaks into the description
        dates = DATE_RE.findall(chunk)
        if not dates:
            continue  # no closing date found in this row - can't trust it as a real tender row
        d, m, y = dates[-1]
        try:
            closing_dt = datetime.datetime(int(y), int(m), int(d), tzinfo=sh.SAST)
        except ValueError:
            continue
        tm = TNUM_RE.search(chunk)
        tnumber = f"T{tm.group(1)}/{tm.group(2)}-{tm.group(3)}" + (" (Re-advert)" if tm.group(4) else "") if tm else None
        desc = sh.clean(NOISE_RE.sub(" ", chunk))
        out.append((internal_ref, tnumber, desc, closing_dt))
    return out


def normalize(internal_ref, tnumber, desc, closing_dt, batch_url, batch_label):
    ref = f"8/2/{internal_ref}" if "/" not in internal_ref else internal_ref
    title = (f"{tnumber}: {desc}" if tnumber else desc) or batch_label
    return sh.release(
        ocid=f"lephalale:{ref}",
        contract_number=ref, title=title, description=title, buyer=BUYER,
        # Lephalale's own batch PDF gives a date only, never a time - see
        # iso_sast_closing()'s own docstring.
        closing_date=sh.iso_sast_closing(closing_dt),
        documents=[{"title": batch_label, "url": batch_url}],
        source=SOURCE, source_id=ref, source_url=LIST_URL,
        status="advertised", tender_type="Tender",
    )


def fetch_releases(cutoff_days=FETCH_CUTOFF_DAYS, log=print):
    page = sh.http_get(LIST_URL, timeout=90).decode("utf-8", errors="replace")
    rows = parse_listing(page)
    rels = []
    opened = 0
    for url, label, uploaded, closing in rows:
        if not _recent_enough(closing, cutoff_days):
            break  # reverse-chronological: everything after this is older still
        opened += 1
        try:
            data = sh.http_get(url, timeout=90)
        except Exception as e:
            log(f"  WARNING: lephalale batch {label!r} failed to download: {e}")
            continue
        text = _pdf_text(data)
        if not text:
            log(f"  WARNING: lephalale batch {label!r} - pdftotext could not read it")
            continue
        for internal_ref, tnumber, desc, closing_dt in parse_batch(text):
            rels.append(normalize(internal_ref, tnumber, desc, closing_dt, url, label))
    if opened and not rels:
        raise RuntimeError(
            f"lephalale: {opened} recent batch(es) opened, 0 tenders parsed from any of them - "
            "the batch PDFs' own table structure has likely changed. Fix the parser before "
            "trusting an empty result as 'no open tenders'."
        )
    log(f"  Lephalale Local Municipality: {len(rels)} tenders from {opened} recent batch document(s)")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    ap.add_argument("--cutoff-days", type=int, default=FETCH_CUTOFF_DAYS)
    args = ap.parse_args()
    rows = fetch_releases(cutoff_days=args.cutoff_days)
    for r in rows:
        print(f"  {r['contract_number']:<12} closes {r['closing_date']}  -  {(r['title'] or '')[:70]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
