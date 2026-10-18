# POPIA / cross-tenant security audit

**Date:** 2026-10-17, with a follow-up on 2026-10-18.
**Asked by:** Sarel. He wants no customer's data visible to another customer, and the Protection of Personal Information Act (POPIA, Act 4 of 2013) handled properly.
**Code:** commit `5523221` (first pass: migrations `0043`, `0044`, bridge fixes), then the shared-template fix (migration `0045`, this document).
**Test:** `engine/security/test_tenant_isolation.py`. Part 1 runs in CI with no database. Part 2 runs when `TENANT_PSQL` points at a scratch Postgres with every migration replayed (see "How to re-run" at the end).

> **About the sources.** This file was meant to be written in the first pass, but that pass was cut short and the draft was lost. The first pass's own report was not available when this was written. Sections 1 to 4 are therefore rebuilt from what that pass committed: the commit message of `5523221`, the comments in `0043` and `0044`, the cases in the test file, and the bridge code it changed. Everything stated there can be checked in those files. Section 5 (the shared-template fix) was done and verified in this pass. Section 6 (the POPIA assessment) is this pass's own reading of the code against the Act. Where a point needs a fact the code can't show (hosting region, contracts), it is marked **to confirm**.

---

## 1. Summary

| | Before | After |
|---|---|---|
| Isolation test, first pass (`5523221`) | 133 pass / 53 fail | 187 pass / 0 fail |
| Isolation test incl. shared-template cases 16-17, on a replay that stops before `0045` and on the old bridge code | 194 pass / 18 fail | 215 pass / 0 fail (replay `0001`→`0045`) |

**What was already right.** RLS (row-level security) was correct table by table. Every table has RLS enabled. Every tenant table is scoped with `is_company_member()`. A signed-in member of company A could not read, change, delete or insert company B's rows in any tenant table (case 8: 21 tables x 4 checks; case 9: 15 insert probes). That held before and after.

**Where the holes were.** They were one level down from RLS:

1. **What a row may point at.** RLS checks the row's own `company_id`. It never checks the company of a person, pack or file that the row references.
2. **What the service-role bridges then read.** The Python bridges (pack, CV, CV extraction, general pack) use the service-role key. That key bypasses RLS by design, so a row A could legally write, pointing at B's person or B's file, made the bridge copy B's data into A's output.

Together those two gave the 7 exfiltration paths in section 2. Section 3 covers the other database fixes, section 4 the data-protection (deletion and minimisation) fixes, and section 5 the shared-template hole that the first pass left open.

---

## 2. The 7 cross-tenant leaks (first pass, `5523221`)

Each case builds two companies in an in-memory store. A is the tenant whose job runs (the attacker), B is the victim. The case then drives the bridge's **real** code. B's people have a synthetic ID number (`8001015009087`), a phone number, projects, an uploaded CV and a vault document. Each B person's id is a `people.id`. That id is not a secret: a former employee of B, a URL in a screenshot or an e-mail is enough to have it.

| # | Path | Before | After (fix) |
|---|---|---|---|
| 1 | **SANRAL pack: B's person confirmed on A's pack.** A client can write any `people.id` into `tender_pack_assignments.confirmed_person_id`, and RLS only checks the pack. | B's person (ID number, phone, projects, as-is CV file) went into A's submission pack. | The bridge reads people / projects / CVs only with `company_id = job company` and refuses the job, naming the position. Trigger `tt_same_company` (0043) refuses the reference at write time. |
| 2 | **SANRAL pack: A's vault column points at B's storage.** `companies.sars_tcs_pin_document_path = '<B>/vault/...'` | The bridge downloaded B's tax-clearance PDF into A's pack. | `own_path()` in the bridge refuses any path outside `<job company>/`. CHECK `companies_paths_own_folder` (0043). |
| 3 | **SANRAL pack: an as-is CV A injected for B's person.** A inserts a `cv_uploads` row (company A) for B's person. | **B's own pack** bound A's file in as that person's CV (the other direction). | CV uploads are read with `company_id` = job company. Trigger refuses `person_id` from another company. |
| 4 | **CV bridge: A requests a CV for B's person** (`generated_cvs.person_id = B's person`). | The CV bridge built B's person's CV into A's folder. | `process_cv_jobs.fetch_job_context` refuses. Trigger on `generated_cvs`. |
| 5 | **CV extraction: A's `ai_extract` upload points at B's CV file.** | The bridge downloaded B's CV, and would have sent it to the AI and shown the result to A. | Refused before any download (`extract_cv_fields`). CHECK `cv_uploads_path_own_folder`. |
| 6 | **General (non-SANRAL) pack: injected as-is CV, plus a vault path into B's folder.** | Same as 3 and 2, in `process_general_jobs`. | Same scoping and path checks in `gather_pack_inputs`. |
| 7 | **General pack: field provenance.** A's job names B's `tender_pack_id`. | Provenance rows were written onto B's pack. | `provenance_pack_id()`: always the job company's own pack for that tender. |

These leaks were not logged anywhere, so there is no way to tell from the data whether any of them was used. There were no live customers at the time (System-Status Gap #9: never run against a live Supabase).

---

## 3. Database-layer fixes (0043)

- **Cross-company references.** `tt_check_same_company()` is a SECURITY DEFINER trigger. It runs for every writer, including the service role. It refuses a person, pack or upload outside the row's company on:
  - `tender_pack_assignments` (suggested and confirmed person)
  - `projects`, `cv_uploads`, `generated_cvs`, `cv_extraction_results`, `person_role_eligibility`
  - `tender_tasks.assigned_to`
  - `pack_generation_jobs` and `generated_cvs.tender_pack_id`

  It also refuses per-company rows (packs, tasks, answers, captures, documents, CVs, jobs, comments, private documents) on another company's **private** tender. Case 12 has 17 probes refused and 6 same-company writes still allowed.
- **Storage paths in the row's own company folder.** CHECK constraints apply on the `companies` vault columns and logo, `cv_uploads`, `generated_cvs`, `experience_items`, `company_document_templates`, `generated_documents` and `pack_generation_jobs`. `..` and `//` are refused (path traversal: case 12, `A/../B`). The constraints are added NOT VALID so a stray legacy row can't block the deploy, then validated straight away. If a row blocks validation, a warning names the constraint. **Action for Sarel, see section 7.**
- **Shared SANRAL templates: replacement.** Any company could replace a template another company had uploaded. Replacing the Technical workbook deleted the tender's positions for every company. 0043 limited replacement to the uploader. 0045 (section 5) replaces this rule with per-company copies.
- **Uploader identity on shared templates.** The `uploaded_by_company`, `uploaded_by` and `original_filename` columns were readable by every company on the tender. A filename like "Acme_R396_Technical.xlsm" told competitors who else was bidding. Those columns are now readable only through `tender_document_uploads()`. Storage object names no longer carry the uploader's file name.
- **Admin console.** Before, the admin proxy was "owner of any company". Every customer who onboards owns their own company, so every customer could read Tender Tool's internal harness results and mark runs reviewed. There is now a `platform_admins` table, managed by the service role only, with no client policy. Case 14 checks it.
- **Hardening.** Every SECURITY DEFINER function pins `search_path = public, pg_temp`. `is_company_member()` had none.

---

## 4. Data-protection fixes (0044, `deletePerson`, CV extraction)

These cover POPIA s 14 (retention), s 24 (correction and deletion on request) and s 10 (minimality).

- **A person could not be deleted** once they had ever been suggested or confirmed for a key position. Both `tender_pack_assignments` foreign keys were NO ACTION. Every bridge poll writes suggestions, so in practice "nobody on a SANRAL tender can be deleted", and the People page failed silently. Both keys are now ON DELETE SET NULL.
- **A user account could not be deleted** once it had done anything: 15 "who did this" foreign keys to `auth.users` were NO ACTION. They are now SET NULL, and the activity log shows "a former member".
- **Leftovers no foreign key reaches.** A deleted person's name, years, ECSA level and rationale stayed inside `tender_pack_assignments.candidate_scores` (jsonb), and their id stayed in a `tender_answers` signatory answer. Trigger `tt_forget_person` now removes both. Case 15 checks this, and checks that a colleague's ranking is kept.
- **Files.** `deletePerson` (`app/app/people/actions.ts`) now removes the person's uploaded and generated CV files from Storage before the row goes. The database can't delete Storage objects itself.
- **Minimisation.** A CV extraction proposal kept the SA ID number it found. After review (saved or discarded), `tt_drop_reviewed_id_number` drops that copy. Once saved, the number lives on `people.id_number`, the one controlled place. Existing reviewed rows were cleaned by the migration. The ID number is still matched and removed **locally** before any CV text goes to the AI (`extract_cv_fields`, unchanged).
- Earlier the same day, the daily digest was fixed to be built per company (commit `f85d889`). That leak is why this test covers the service-role layer at all.

---

## 5. Shared blank templates (follow-up, 0045): **fixed**

### 5.1 The hole

`tender_documents` (0001) holds **one** row per (tender, template type): the Technical and Financial workbooks, the A-Forms, C.1.1.1 and C.1.2.3. It was intended as "uploaded once per tender, not once per company". Since 0025, any company with a pack on the tender could supply that row from the "Blank tender templates" card. From then on, every other company pursuing the tender:

- (a) could **download the file directly**: the `<tender_id>/<type>/` Storage folder is readable by every company that can see the tender;
- (b) had **its own submission pack built from it**: `process_pack_jobs.gather()` read `tender_documents` by tender only.

Nothing checks that the file really is blank. So if A uploads its own filled-in workbook, other companies can read A's data out of it. A might do this by mistake, or because it was the copy A had already started typing into. There were three more problems:

- Since 0043, nobody but A could replace that file, so B was stuck with it.
- A could equally plant an *altered* blank: different positions, edited form wording. Every other bidder's pack would then be built on it.
- The Financial workbook holds rates.

The old code also mixed copies the other way. With both companies' rows present, A's own pack picked up B's upload (case 16b, before).

### 5.2 Evidence (before the fix)

**Bridge, case 16 (Part 1, real filler).**

1. `fill_conventional.py` fills R.396-010-2025/1F as company A: person "ALICE ACO", ID 8501015800088, 3 projects with referees and phone numbers, SACPCMP number `ACO-SACPCMP-77`.
2. That filled workbook is registered as A's upload.
3. B's pack job runs `gather()`.

On the old code:

```
FAIL B's pack job downloaded none of A's uploaded files (4 downloaded)
FAIL B's job asks B to upload its own templates (built from A files)
FAIL none of A's data in B's filled Technical workbook (left over from A:
     ['ACO CLIENT PROJECT 2', 'ACO CLIENT PROJECT 3', 'ACO Referee 3', 'ACO-082-555-0003', 'ACO-SACPCMP-77'])
FAIL A's own pack still uses A's own upload (['b_upload.xlsm', ...])        <- the reverse mix-up
FAIL one position set per company, none shared ({None: ['DS1', 'PL']})
```

So B's real fill (1 project, no SACPCMP) **overwrote A's name and ID number but kept everything of A's that B had no value for**:
- A's 2nd and 3rd projects
- A's referee and phone number
- A's SACPCMP registration number

All of it would have gone into B's submitted pack. The same fill on a genuinely blank template contains none of it.

**Database and Storage, case 17 (Part 2).** On a replay that stops at `0044`, A uploads exactly as the app did then:

```
FAIL A's upload no longer lands in the folder every company on the tender can read
FAIL B can't download A's uploaded workbook from Storage (B sees 1)
FAIL B's view of the tender's templates doesn't include A's file (B sees 1 row(s) naming it)
FAIL the templates card shows B no Technical workbook on file - B uploads its own (1)
FAIL B can't read a pre-0045 / replaced upload of A's left in the tender folder (1)
```

### 5.3 Options considered, and the choice

**Option 1: a "is this really blank" check.** Inspect the upload's data-entry cells, using what the fillers know (the `TEND 1X` key-person blocks, the Form B3/B7 cells), and refuse a filled file. Rejected as the fix, for five reasons:

- It can only look at the cells the fillers write. It misses narrative text, other sheets, the three `.docx` forms, and the Financial workbook's rates.
- It is evadable: clear the name cell and the rest passes.
- It says nothing about a file that is blank but **altered**. That is an integrity attack on a competitor's bid, which this channel also allows.
- It would have to run in the upload path. The web app is Next.js on Vercel and can't run the Python fillers. A TypeScript copy of the cell map would drift from the fillers.
- Even when it works, it only stops one way of misusing the channel. The channel itself stays.

**Option 2: per-company copies. Chosen.** Each company's upload is its own copy, used by and visible to that company only. The convenience given up is "whoever uploads first saves everyone else one upload". That convenience **is** the channel: it is the one place where one tenant's file flows into another tenant's output. And its value is small. Every bidder has to download the tender documents from SANRAL anyway, to read them, and to be on SANRAL's list of downloaders who receive addenda and clarifications. Uploading those same files once more takes seconds. A pack built from a competitor's copy could also be missing an addendum the bidder itself received.

**What stays shared.** A copy registered by the **service role from the buyer's own published documents**: the intake (`process_general_jobs.register_sanral_tender`) downloads these from the buyer's links. No tenant ever supplies that file, so it is the trusted source.

A blank check would add nothing for security once tenant files are never shared. A company's own filled file only ever reaches its own pack. It could still be a quality guard ("this looks like a workbook you already filled"), but that is not built. It is listed under section 7 as optional.

### 5.4 What changed

**Migration `0045_company_template_copies.sql`:**
- `tender_documents.company_id`: null means the shared buyer copy; set means that company's own copy. The unique key is now `(tender_id, doc_type, company_id)` with NULLS NOT DISTINCT. Select RLS: shared rows, or rows of your own company, on a tender you can see.
- `tender_requirements.company_id`: same idea. Positions read from a company's own Technical workbook belong to that company. A company that has its own rows for a tender no longer sees the shared ones. This is done in RLS through `tt_has_own_requirements()`, so the app's readers (compliance report, key positions, credentials, past-submission reuse) did not have to change.
- `record_tender_document()`:
  - The file must be under `private/<company>/<tender>/templates/<type>/`. That is 0032's private scheme, readable only by that company. The company is the one named in the path, and the caller must be a member of it and have a pack on the tender.
  - It upserts **only that company's** copy.
  - Replacing the Technical workbook clears **only that company's** positions.
  - The shared row can't be written by a client at all.
- The 0025 storage insert policy for `<tender_id>/...` is dropped. Clients no longer write into the shared tender folder.
- **Legacy files.** A migration doesn't move Storage objects. Files companies uploaded before 0045, and every version they replaced, are still in `<tender_id>/<type>/`. The bucket's select policy now shows such an object only if it is a shared row's file or the caller's own company's (`tt_template_object_readable()`).
- `tender_document_uploads()`: returns one row per type, either `own` or `buyer`. It no longer reports "uploaded by another company", which also removes the "a competitor is on this tender" signal 0043 had to keep.
- **Existing data.** A company-uploaded row becomes that company's copy, and the positions read from it become that company's. Verified on a seeded `0044` database before applying 0045:

```
before 0045, B sees:   docs  <t>/technical_xlsm/a1.xlsm (A's), leg-2/technical_xlsm.xlsm (buyer's)
                       objects  ...a0_replaced.xlsm, ...a1.xlsm, leg-2/technical_xlsm.xlsm
after 0045:            leg-1 technical_xlsm -> Legacy A;  leg-2 -> (shared);  leg-1 PL -> Legacy A;  leg-2 PL -> (shared)
  A sees               docs  its own a1.xlsm + buyer's;  positions leg-1:PL, leg-2:PL;  objects a1.xlsm + buyer's
  B sees               docs  buyer's only;  positions leg-2:PL only;  objects buyer's only
```

  A's replaced old version (`a0_replaced.xlsm`) is now hidden from A too. A doesn't need it: A's current copy is still readable.

**Bridges:**
- `process_pack_jobs.template_paths()`: per type, the company's own copy, else the shared one, never another company's. The service role sees every row, so this is where the rule is enforced in the engine.
- `sync_tender_requirements()` reads positions per copy and tags them with `company_id`.
- `sync_position_suggestions()` ranks each pack against its company's own positions, else the shared ones.
- `process_cv_jobs` uses the company's own requirement row, else the shared one.
- `process_general_jobs.register_sanral_tender` writes the shared rows explicitly (`company_id` null, upsert on the new key) and clears only shared positions.

**App:**
- The upload action stores the file under the company's private folder.
- The templates card says "Only your company sees and uses what you upload here". It shows a buyer copy as "from the buyer's published tender documents", with an "Upload your own" button.
- The activity log reads the new shape. The "another company" actor is gone.

### 5.5 Evidence (after the fix)

- **Case 16 (bridge):** B's job downloads none of A's files and is told to upload its own templates. None of A's data is in B's filled workbook. The legitimate cases also pass:
  - B builds from the buyer's shared copy (16b).
  - B uses exactly its own upload when it has one.
  - A's pack uses A's own upload, not B's.
  - Positions are one set per company (16c).
- **Case 17 (DB and Storage, replay `0001`→`0045`):**
  - A's upload lands in A's private folder.
  - B sees 0 of A's objects and 0 rows naming A's file.
  - B's templates card shows no Technical workbook.
  - B can't register A's file as its own.
  - A legacy or replaced upload is hidden from B.
  - The buyer's A-Forms stay readable by both companies and show as `a_forms:buyer`.
  - Positions: B sees the shared set (PL), A only its own (DS1, PL).
  - B's own upload doesn't touch A's copy or A's positions.
- **Cases 13/13b, updated for the new rules:**
  - A can't register a file in the shared tender folder.
  - A registering its own copy leaves B's template and positions untouched.
  - B's replacement clears only B's positions.
  - A never gets B's file name or row.
  - A can't touch B's private tender.
- **Whole suite:** 215 pass / 0 fail. No regressions in cases 1-15.
- **Legitimate shared path, end to end:**
  - `engine/pack/bridge_selftest.py` on a `0045` replay: a full pack is built and comes back clean from read-back from shared (`company_id` null) templates, with positions DS1/PL plus ALT.
  - `engine/intake/test_manual_intake.py`: 44 pass. The intake registers all 5 templates and the SETUP positions through the new upsert key.
- **Every other CI Python test:** passes (14 commands from `.github/workflows`). `tsc` and `eslint` are clean on the changed app files. The UI was not rendered against a live project (Gap #9).

**Behaviour change to note for users.** On a tender where another company uploaded the templates before 0045, a company that had relied on that upload now sees the templates as **Needed** and must upload its own copy. That is intended.

---

## 6. POPIA assessment

Tender Tool's customers are **responsible parties** for their own staff's personal information: key people's ID numbers, qualifications, project histories, phone numbers and CVs, plus directors' details. Tender Tool processes that information on their behalf, which makes it an **operator** (s 1, s 20-21) for that data. Tender Tool is the responsible party for its own users' account data (login e-mails). Company (juristic-person) information is also "personal information" under POPIA.

| Condition / section | Assessment |
|---|---|
| **Accountability (s 8)** | Tender Tool needs an Information Officer registered with the Information Regulator, and a PAIA/POPIA manual. **To do (Sarel).** |
| **Processing limitation (s 9-12): lawful basis, minimality, collection from the data subject** | The basis is the customer's contract with its own staff and its legitimate tender work (s 11(1)(b)/(f)). The customer, as responsible party, must tell its people (s 18). Minimality: ID-number copies are now dropped after review (section 4). The ID number is still on `people.id_number` because SANRAL Form B1 asks for it. |
| **Purpose specification and retention (s 13-14)** | Deletion of people and users now works (section 4). There is **no** automatic retention period: data stays until deleted. Decide one, e.g. how long after a tender closes generated packs and CVs are kept. **Open.** |
| **Further processing (s 15)** | Data is used only to fill that customer's own tenders. After this audit nothing crosses tenants, including templates (section 5). Discovery scoring is per company. |
| **Information quality (s 16)** | People and projects are edited by the customer. CV extraction is review-then-confirm, with each field ticked (CV-Extraction-Findings.md). |
| **Openness (s 17-18)** | Tender Tool needs a privacy notice for its users, and customers need the wording to inform their own staff. **To do (Sarel).** |
| **Security safeguards (s 19)** | This audit is the main evidence: tenant isolation tested at both layers (RLS and service-role bridges), storage paths confined, admin console limited to platform admins, `search_path` pinned. The service-role key stays on the bridge worker and must never reach the browser (it doesn't: the app uses the anon key and RLS). **Remaining:** no audit log of who downloaded which file; no at-rest encryption beyond Supabase's defaults (**to confirm** in the project settings); key rotation procedure not written. |
| **Operator duties (s 20-21)** | Tender Tool needs a written operator agreement in its customer terms. Tender Tool's own operators also need agreements: Supabase (database and storage hosting), Vercel (app hosting), Anthropic (CV extraction), the bridge-worker host. **To confirm** that their data-processing terms are signed. |
| **Breach notification (s 22)** | No incident procedure exists yet. The leaks in sections 2 and 5 were closed before there were live customers (Gap #9). Once live, a compromise must be reported to the Regulator and the affected parties as soon as reasonably possible. Write a short runbook. **To do.** |
| **Data-subject rights (s 23-25)** | Access and correction: through the customer, who sees and edits everything on the People page. Deletion: works now (section 4). |
| **Special personal information (s 26-33)** | Not deliberately collected. Race/B-BBEE figures are company-level ownership percentages, not per-person. A CV can contain anything, so the review step is where to drop what isn't needed. |
| **Direct marketing (s 69)** | Not applicable. The digest only goes to the customer's own members. |
| **Cross-border transfer (s 72)** | CV text goes to Anthropic's API, outside South Africa, with ID numbers removed locally first. Supabase and Vercel regions: **to confirm**. If they are outside South Africa, s 72(1) needs adequate protection (binding terms) or the data subject's consent. Customer terms should say so. |

---

## 7. Open items and Sarel's action list

**Sarel's actions (only he can do these):**

1. **Add yourself as platform admin**, once, in the Supabase SQL editor: `insert into platform_admins (user_id, note) values ('<your auth user id>', 'Sarel');` Until then `/admin` shows nothing to anyone, which is by design (0043).
2. **After deploying 0043:** check the migration output for a `0043: ... stays NOT VALID` warning. If there is one, review the rows it names (a stored path outside its own company folder), fix them, and run `alter table <t> validate constraint <name>`. New writes are checked either way.
3. **After deploying 0045:** tell any company that was using another company's uploaded templates that it needs to upload its own copy (the card shows them as Needed).
4. **POPIA paperwork:**
   - register an Information Officer;
   - PAIA/POPIA manual and privacy notice;
   - operator clause in the customer terms;
   - confirm data-processing agreements and hosting regions for Supabase, Vercel and Anthropic (s 72);
   - a one-page breach runbook (s 22).
5. **Decide retention periods** (s 14), for generated packs and CVs and for the data of a company that leaves.

**Still open (engineering):**

- **Download audit trail.** Nothing records who downloaded which file. Supabase Storage logs might cover this; **to confirm.**
- **Users in more than one company.** A user who is a member of two companies sees both companies' own template copies and positions for a shared tender. That is correct for each company, but the app picks "the" company with `maybeSingle()`. This is not a cross-tenant leak (the user is in both), but it is untested UI.
- **Optional quality guard.** Warn when an uploaded Technical workbook already has key-person cells filled. This is a convenience for the company's own pack only, not a security control (section 5.3).
- **Orphaned template files.** Objects a company uploaded before 0045, and replaced versions, are hidden but not deleted. A Storage clean-up job would remove them.
- **Live verification.** Everything here is verified on replayed migrations with a local stand-in for auth and storage, never on a live Supabase project (Gap #9).

---

## How to re-run

```bash
# Part 1 only (in CI):
python3 engine/security/test_tenant_isolation.py

# Part 2: scratch Postgres 16 + a minimal Supabase stand-in (auth.users, auth.uid() from test.uid,
# roles anon/authenticated/service_role, storage.buckets/objects/foldername, Supabase default
# privileges), then every migration in order, on a FRESH database each run (the seed is not idempotent):
TENANT_PSQL="psql -h <sock> -p <port> -U postgres -d <db>" python3 engine/security/test_tenant_isolation.py

# The "before" evidence for cases 16-17: replay only up to 0044 and run the same test with the
# pre-0045 bridge code (git stash the engine/pack, engine/general, engine/cv changes).
```
