"""
OCR for scanned documents (pages that are pictures of paper, with no text
layer). EXPERIMENTAL - built so Sarel can test whether it is worth keeping;
the evaluation and the keep/drop recommendation are in
docs/specs/OCR-Evaluation.md.

It is an alternative path, never a replacement: the readers that use it
(engine/general/requirements.py read_document, engine/cv/extract_cv_fields.py
read_cv_text) only call it for pages that have no text layer, and when OCR is
unavailable or its output fails the quality gate below they fall back to the
same clear "can't read this" refusal as before OCR existed.

Engine: Tesseract 5 (local, free, no API cost, nothing leaves the machine),
called as a command-line program the same way pdftotext/soffice are - no
Python wrapper package. Pages are rasterised with pdftoppm (poppler-utils,
already in the worker image).

Quality gate (per page), set from the real scans in OCR-Evaluation.md: every
real scan read cleanly scored a mean word confidence of 81-96 with 83%+ of
words at confidence 60 or more; degraded copies that produced wrong text
(a 7 May 2013 read for 4 May 2015, a registration number with a digit
missing, word salad from blur) all scored under 70. A page passes when
  - Tesseract found at least MIN_WORDS words on it, and
  - their mean confidence is at least MIN_MEAN_CONF, and
  - at least MIN_GOOD_SHARE of them have confidence >= 60.
A page that fails is left out of the text (never passed on as garbage) and
reported by number with the reason.

Removing this experiment: delete engine/ocr/, the two `scan_ocr` call sites
(search for "scan_ocr"), the tesseract packages in engine/worker/Dockerfile and
the OCR notices in the two UI cards (search for "ocr" in
app/app/tenders/[id]/ and app/app/people/[id]/cv-review.tsx). No database
column depends on it.

Usage (local check):
    python3 engine/ocr/scan_ocr.py <file.pdf|image> [--pages 1,3] [--show-text]
"""
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alerts"))
import system_alerts  # noqa: E402

# Quality gate - see the module docstring and OCR-Evaluation.md.
MIN_WORDS = 5
MIN_MEAN_CONF = 75.0
MIN_GOOD_SHARE = 0.70
GOOD_WORD_CONF = 60.0

# Longest side of the rendered page in pixels. 3508 px = an A4 page at 300
# dpi, the resolution Tesseract is tuned for; larger sheets (A1 drawings) are
# scaled down to this instead of being rendered at 10k+ pixels.
RENDER_LONG_SIDE = 3508
# Pages OCR'd per document, so a 300-page scan can't hold the worker for an
# hour (about 3-4 s a page here: the 17-page Tourism NB143 scan took about a
# minute). Pages beyond it are reported as not read. Override with OCR_MAX_PAGES.
DEFAULT_MAX_PAGES = 60
LANG = "eng"
PAGE_TIMEOUT = 120

# Image uploads OCR can read directly (Pillow opens them; HEIC needs a plugin
# we don't install, so it stays refused).
IMAGE_EXTS = {"png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "webp"}

NOTICE = ("Read by OCR from a scanned image, not from a real text layer - OCR can misread characters and "
          "numbers (0/O, 1/l, 5/S), so check anything taken from it against the scan.")


def max_pages():
    try:
        return max(1, int(os.environ.get("OCR_MAX_PAGES", DEFAULT_MAX_PAGES)))
    except ValueError:
        return DEFAULT_MAX_PAGES


def available():
    """(True, version) or (False, reason). OCR is optional: without
    Tesseract every caller keeps its pre-OCR refusal."""
    if os.environ.get("OCR_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return False, "OCR is switched off on this worker (OCR_DISABLED)"
    exe = shutil.which("tesseract")
    if not exe:
        return False, "Tesseract OCR is not installed on this worker"
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=20)
        langs = subprocess.run([exe, "--list-langs"], capture_output=True, text=True, timeout=20)
    except (subprocess.TimeoutExpired, OSError) as e:
        return False, f"Tesseract OCR could not be started ({type(e).__name__})"
    if LANG not in (langs.stdout or "").split():
        return False, f"Tesseract has no '{LANG}' language data installed"
    first = ((out.stdout or out.stderr or "").splitlines() or ["tesseract"])[0].strip()
    return True, first


# ---------------------------------------------------------------------------
# One page image -> words with confidences
# ---------------------------------------------------------------------------

# Tesseract's own OpenMP threading: on this 4-core box under load one page
# took 3 min with it and 4 s with it off (one thread per page is faster).
TESS_ENV = {**os.environ, "OMP_THREAD_LIMIT": "1"}


def _tsv_words(image_path):
    """Tesseract's word table: [{'text', 'conf', 'block', 'par', 'line'}]."""
    out = subprocess.run(["tesseract", image_path, "-", "-l", LANG, "--psm", "3", "tsv"],
                         capture_output=True, text=True, timeout=PAGE_TIMEOUT, env=TESS_ENV)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or "tesseract failed").strip().splitlines()[-1][:160])
    words = []
    for r in csv.DictReader(io.StringIO(out.stdout), delimiter="\t", quoting=csv.QUOTE_NONE):
        if r.get("level") != "5":
            continue
        text = (r.get("text") or "").strip()
        try:
            conf = float(r.get("conf") or -1)
        except ValueError:
            continue
        if text and conf >= 0:
            words.append({"text": text, "conf": conf, "block": r["block_num"], "par": r["par_num"], "line": r["line_num"]})
    return words


def _words_to_text(words):
    """Rebuild reading-order text from the word table: one line per Tesseract
    line, a blank line between blocks."""
    lines, cur_key, cur, prev_block = [], None, [], None
    for w in words:
        key = (w["block"], w["par"], w["line"])
        if key != cur_key:
            if cur:
                lines.append(" ".join(cur))
            if prev_block is not None and w["block"] != prev_block:
                lines.append("")
            cur, cur_key, prev_block = [], key, w["block"]
        cur.append(w["text"])
    if cur:
        lines.append(" ".join(cur))
    return "\n".join(lines)


def _stats(words):
    if not words:
        return {"words": 0, "mean_conf": 0.0, "good_share": 0.0}
    confs = [w["conf"] for w in words]
    return {"words": len(words), "mean_conf": round(sum(confs) / len(confs), 1),
            "good_share": round(sum(c >= GOOD_WORD_CONF for c in confs) / len(confs), 2)}


def _osd_rotation(image_path):
    """Tesseract's orientation guess (0/90/180/270) or 0 when it can't tell."""
    try:
        out = subprocess.run(["tesseract", image_path, "-", "--psm", "0"], capture_output=True, text=True, timeout=60,
                             env=TESS_ENV)
    except (subprocess.TimeoutExpired, OSError):
        return 0
    m = re.search(r"Rotate:\s*(\d+)", out.stdout or "")
    c = re.search(r"Orientation confidence:\s*([\d.]+)", out.stdout or "")
    if m and c and float(c.group(1)) >= 1.5:
        return int(m.group(1)) % 360
    return 0


def ocr_image(image_path, work_dir):
    """OCR one page image. Returns {'text', 'status', 'reason', 'rotated', **stats}.
    A page scanned sideways or upside down is retried turned the way
    Tesseract's orientation check suggests, and the better-scoring read kept."""
    words = _tsv_words(image_path)
    rotated = 0
    st = _stats(words)
    if st["words"] < MIN_WORDS or st["mean_conf"] < MIN_MEAN_CONF:
        rot = _osd_rotation(image_path)
        if rot:
            from PIL import Image
            turned = os.path.join(work_dir, f"rot{rot}_" + os.path.basename(image_path))
            with Image.open(image_path) as im:
                # Tesseract's "Rotate: n" is the clockwise turn that makes it upright.
                im.rotate(-rot, expand=True, fillcolor="white").save(turned)
            w2 = _tsv_words(turned)
            s2 = _stats(w2)
            if s2["mean_conf"] > st["mean_conf"] and s2["words"] >= MIN_WORDS:
                words, st, rotated = w2, s2, rot
    if st["words"] < MIN_WORDS:
        status, reason = "no_text", "no readable text found on it (blank, a picture or signature only, handwriting, or a badly skewed scan)"
    elif st["mean_conf"] < MIN_MEAN_CONF or st["good_share"] < MIN_GOOD_SHARE:
        status, reason = "illegible", (f"too unclear for OCR to read reliably (OCR confidence {st['mean_conf']:.0f}/100; "
                                       "low resolution, blur, skew, handwriting or dotted contents-page lines do this)")
    else:
        status, reason = "ok", None
    return {"text": _words_to_text(words) if status == "ok" else "", "status": status, "reason": reason,
            "rotated": rotated, **st}


# ---------------------------------------------------------------------------
# Whole files
# ---------------------------------------------------------------------------

def _render_pdf_page(pdf_path, page_no, out_dir):
    """pdftoppm one page (1-based) to a grayscale PNG; returns its path or None."""
    prefix = os.path.join(out_dir, f"p{page_no:04d}")
    try:
        subprocess.run(["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-gray", "-png",
                        "-scale-to", str(RENDER_LONG_SIDE), "-singlefile", pdf_path, prefix],
                       capture_output=True, timeout=PAGE_TIMEOUT)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    return prefix + ".png" if os.path.exists(prefix + ".png") else None


def pages_with_images(pdf_path):
    """1-based page numbers that carry at least one raster image (pdfimages
    -list), or None if that can't be told. A page with little text and no
    image can't be a scan, so it isn't worth rendering and OCR'ing."""
    try:
        out = subprocess.run(["pdfimages", "-list", pdf_path], capture_output=True, text=True, timeout=60)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if out.returncode != 0:
        return None
    pages = set()
    for line in out.stdout.splitlines()[2:]:
        parts = line.split()
        if parts and parts[0].isdigit():
            pages.add(int(parts[0]))
    return pages


def _alert_failures(res, path):
    """System alerts for OCR that BROKE (System-Status: central alerts), as
    opposed to a page that simply failed the quality gate (a bad scan - the
    expected, user-facing refusal, never alerted). Broke = Tesseract missing
    or unstartable on a worker that is meant to have it, Tesseract erroring
    or timing out on a page, or a page that couldn't be rendered. One alert
    per document, never raises."""
    name = os.path.basename(path or "")
    if res.get("error") and "OCR_DISABLED" not in res["error"]:
        system_alerts.record("ocr", f"OCR could not run: {res['error']}", "error", context={"file": name})
        return
    broken = [f for f in res.get("failed") or []
              if (res["pages"].get(f["page"]) or {}).get("status") == "error" or "could not be rendered" in f["reason"]]
    if broken:
        system_alerts.record("ocr", f"OCR failed on {len(broken)} page(s) of a document: {broken[0]['reason']}",
                             "error", context={"file": name, "pages": [f["page"] for f in broken][:50]})


def _scratch(work_dir):
    if work_dir:
        os.makedirs(work_dir, exist_ok=True)
    return tempfile.mkdtemp(prefix="tt_ocr_", dir=work_dir)


def ocr_pdf_pages(pdf_path, pages, work_dir=None):
    """OCR the given 1-based page numbers of a PDF. Returns a result dict:
      pages        {page_no: page result (see ocr_image)} for every page tried
      read         [page numbers whose OCR text passed the gate]
      failed       [{'page', 'reason'}] pages that didn't
      skipped      [page numbers not tried (over OCR_MAX_PAGES)]
      engine       Tesseract version line
      error        set (and nothing else filled) when OCR couldn't run at all
    """
    ok, engine = available()
    res = {"pages": {}, "read": [], "failed": [], "skipped": [], "engine": engine if ok else None,
           "error": None if ok else engine}
    if not ok:
        _alert_failures(res, pdf_path)
        return res
    tmp = _scratch(work_dir)
    try:
        limit = max_pages()
        for i, n in enumerate(sorted(pages)):
            if i >= limit:
                res["skipped"].append(n)
                continue
            img = _render_pdf_page(pdf_path, n, tmp)
            if not img:
                res["failed"].append({"page": n, "reason": "the page could not be rendered to an image for OCR"})
                continue
            try:
                page = ocr_image(img, tmp)
            except (RuntimeError, subprocess.TimeoutExpired) as e:
                page = {"text": "", "status": "error", "reason": f"OCR failed on it ({str(e)[:120] or type(e).__name__})",
                        "rotated": 0, "words": 0, "mean_conf": 0.0, "good_share": 0.0}
            finally:
                os.remove(img)
            res["pages"][n] = page
            if page["status"] == "ok":
                res["read"].append(n)
            else:
                res["failed"].append({"page": n, "reason": page["reason"]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _alert_failures(res, pdf_path)
    return res


def ocr_image_file(path, work_dir=None):
    """An uploaded photo/scan image (PNG/JPEG/TIFF...). Same result shape as
    ocr_pdf_pages, with every frame of a multi-page TIFF as a page."""
    ok, engine = available()
    res = {"pages": {}, "read": [], "failed": [], "skipped": [], "engine": engine if ok else None,
           "error": None if ok else engine}
    if not ok:
        _alert_failures(res, path)
        return res
    from PIL import Image, ImageSequence
    tmp = _scratch(work_dir)
    try:
        try:
            im = Image.open(path)
            frames = [f.copy() for f in ImageSequence.Iterator(im)]
        except Exception as e:
            # QA pass, 2026-10-30: every OTHER OCR-infrastructure break here
            # (Tesseract missing, a PDF page that couldn't be rendered, a
            # page OCR errored/timed out) reaches _alert_failures() below -
            # this one returned early and never did, so a corrupted/
            # mislabeled image upload (a real shape: a renamed .txt, a
            # truncated download) was silently invisible to system_alerts,
            # unlike its exact analogue in ocr_pdf_pages() ("the page could
            # not be rendered to an image for OCR", which _alert_failures()
            # already matches on). The user-facing refusal via
            # read_cv_text()/failure_sentence() was already correct either
            # way - only the operator-visible alert was missing.
            res["error"] = f"the image could not be opened ({type(e).__name__})"
            _alert_failures(res, path)
            return res
        limit = max_pages()
        for n, frame in enumerate(frames, start=1):
            if n > limit:
                res["skipped"].append(n)
                continue
            g = frame.convert("L")
            # A phone photo at 4000 px or a 100 dpi fax: bring the long side to
            # the same ~300 dpi A4 size PDFs are rendered at.
            scale = RENDER_LONG_SIDE / max(g.size)
            if scale < 0.9 or scale > 1.6:
                g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.LANCZOS)
            p = os.path.join(tmp, f"img{n:04d}.png")
            g.save(p, dpi=(300, 300))
            try:
                page = ocr_image(p, tmp)
            except (RuntimeError, subprocess.TimeoutExpired) as e:
                page = {"text": "", "status": "error", "reason": f"OCR failed on it ({str(e)[:120] or type(e).__name__})",
                        "rotated": 0, "words": 0, "mean_conf": 0.0, "good_share": 0.0}
            res["pages"][n] = page
            if page["status"] == "ok":
                res["read"].append(n)
            else:
                res["failed"].append({"page": n, "reason": page["reason"]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _alert_failures(res, path)
    return res


def summary(res, total_pages=None):
    """The JSON-safe record stored with a document/CV so the UI can say the
    text came from OCR: engine, pages read, mean confidence, pages left out."""
    read = res.get("read") or []
    confs = [res["pages"][n]["mean_conf"] for n in read]
    return {
        "engine": res.get("engine"),
        "pages_ocr": sorted(read),
        "pages_failed": res.get("failed") or [],
        "pages_skipped": res.get("skipped") or [],
        "mean_confidence": round(sum(confs) / len(confs), 1) if confs else None,
        "total_pages": total_pages,
        "notice": NOTICE,
    }


def failure_reason(res):
    """Why OCR read nothing usable, as a phrase the caller puts after
    "OCR couldn't read it: " - e.g. "too unclear ... (confidence 49/100 ...)"."""
    if res.get("error"):
        return res["error"]
    failed = res.get("failed") or []
    if not failed:
        return "no readable text found"
    if len(failed) == 1:
        return failed[0]["reason"]
    uniq = sorted({f["reason"] for f in failed})
    if len(uniq) == 1:
        return f"all {len(failed)} pages: {uniq[0]}"
    return "; ".join(f"p.{f['page']}: {f['reason']}" for f in failed[:4]) + ("; ..." if len(failed) > 4 else "")


def failure_sentence(res):
    """A clause for a refusal message: "OCR couldn't read it clearly: ..." or,
    when OCR couldn't run at all, "it couldn't be OCR'd here: ..."."""
    if res is None:
        return "it couldn't be OCR'd: OCR can't open this file format"
    if res.get("error"):
        return f"it couldn't be OCR'd here: {res['error']}"
    return f"OCR couldn't read it clearly: {failure_reason(res)}"


def main(argv=None):
    import argparse
    import json
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--pages", help="1-based page numbers, comma separated (default: all)")
    ap.add_argument("--show-text", action="store_true")
    args = ap.parse_args(argv)
    ext = os.path.splitext(args.path)[1].lower().lstrip(".")
    if ext == "pdf":
        info = subprocess.run(["pdfinfo", args.path], capture_output=True, text=True).stdout
        n = int((re.search(r"Pages:\s*(\d+)", info) or [0, 0])[1])
        pages = [int(p) for p in args.pages.split(",")] if args.pages else list(range(1, n + 1))
        res = ocr_pdf_pages(args.path, pages)
    else:
        n = None
        res = ocr_image_file(args.path)
    for p, r in sorted(res["pages"].items()):
        print(f"page {p}: {r['status']:9} words={r['words']:4} mean_conf={r['mean_conf']:5.1f} "
              f"good_share={r['good_share']:.2f}" + (f" rotated={r['rotated']}" if r["rotated"] else "")
              + (f"  ({r['reason']})" if r["reason"] else ""))
        if args.show_text and r["text"]:
            print(r["text"])
            print("-" * 60)
    print(json.dumps(summary(res, n), indent=2))
    if not res["read"]:
        print("FAILED: OCR couldn't read it:", failure_reason(res))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
