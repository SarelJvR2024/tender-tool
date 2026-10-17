# Always-on worker that fulfils the web app's queued document requests
# (generated_cvs today, pack_generation_jobs once engine/pack/process_pack_jobs.py
# lands). The web app on Vercel cannot run Python or LibreOffice; this container
# can. See docs/specs/Automated-Fulfillment-Deployment.md.
#
# Build context is the REPO ROOT (the worker needs engine/; the pack bridge's
# engine/pack/ code reads templates/samples/ and templates/forms/):
#   docker build -f engine/worker/Dockerfile -t tender-worker .
#   docker run --rm -e NEXT_PUBLIC_SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... tender-worker
#
# On Railway: set the service variable RAILWAY_DOCKERFILE_PATH=engine/worker/Dockerfile,
# plus NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. No port, no domain:
# this is a background worker, it only makes outbound calls to Supabase.
FROM python:3.13-slim

# LibreOffice Writer (headless, no GUI) for generate_cv.py's .docx -> .pdf step,
# plus metric-compatible fonts so Word layouts (Arial/Times/Calibri) don't reflow.
# The pack bridge (engine/pack/process_pack_jobs.py) also needs Calc and the
# Python-UNO bridge: print_reports.py drives LibreOffice through `import uno`
# to recalculate the filled SANRAL workbook and print the Form B reports.
# The general bridge (engine/general/process_general_jobs.py) reads tender PDFs
# with pdftotext (poppler-utils), same as engine/discovery/assess_tender.py.
# EXPERIMENTAL: Tesseract OCR (+ English and orientation data) reads scanned
# pages with no text layer - engine/ocr/scan_ocr.py, called by the general
# bridge and the CV-extraction bridge. Local and free (no API, nothing leaves
# the container). Evaluation and keep/drop recommendation:
# docs/specs/OCR-Evaluation.md. To drop it, delete these three packages; the
# bridges then refuse scans exactly as before (scan_ocr.available() is False).
# OCR_DISABLED=1 switches it off without a rebuild.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui python3-uno poppler-utils \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd \
      fonts-liberation fonts-crosextra-carlito fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# python3-uno installs for Debian's own python3; expose it to this image's
# python3 too. A .pth line is appended to sys.path, so pip's packages still win.
RUN echo /usr/lib/python3/dist-packages > "$(python3 -c 'import site; print(site.getsitepackages()[0])')/debian-uno.pth"

WORKDIR /srv/tender-tool
COPY engine/worker/requirements.txt engine/worker/requirements.txt
RUN pip install --no-cache-dir -r engine/worker/requirements.txt

COPY engine engine
# The stored SANRAL template baselines. Without them every pack run in this
# image skipped the template-changed check with only a warning
# (assemble_pack.check_template_fingerprint: "No stored fingerprint baseline")
# and the intake reported "no baseline" - Sarel's "always check the template
# first" rule silently off in production. Found by the 2026-10-17 scenario pass.
COPY fingerprints fingerprints
COPY templates templates
COPY config/test_companies config/test_companies
# Discipline taxonomy seed (0040): the offline fallback when the
# discipline_categories table can't be read (engine/discovery/taxonomy.py).
COPY config/discipline_taxonomy.json config/discipline_taxonomy.json

# Unbuffered so log lines reach the host's log viewer immediately; a non-root
# user with a writable HOME, because LibreOffice writes a profile there.
ENV PYTHONUNBUFFERED=1 HOME=/tmp
RUN useradd --system --no-create-home worker && mkdir -p out && chown worker out
USER worker

# Poll every 30s (override with BRIDGE_POLL_INTERVAL). SIGTERM on redeploy
# finishes the current job, then exits.
CMD ["python3", "engine/worker/run_bridges.py", "--loop"]
