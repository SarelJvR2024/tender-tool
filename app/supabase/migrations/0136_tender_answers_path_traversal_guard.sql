-- Finding 215 (standing review, 2026-11-08): tender_answers' own storage_path
-- CHECK constraint (0018, "tender_answers_check2") is a TRUE SIBLING of the
-- "storage path must sit under the row's own company/tender folder" family
-- that Finding 35 (2026-10-20, Python) and Finding 214 (2026-11-08, its SQL
-- sweep across 9 other sites - tt_own_path/0043, tt_path_in_company/0050,
-- record_tender_document()/0045, _manual_tender_documents()/0024,
-- tender_private_documents_path/0032) both worked through - but it was never
-- named in either pass, so it still has NO traversal guard at all, not even
-- the overzealous substring one Finding 35/214 dealt with:
--
--   check (storage_path is null or storage_path like company_id::text ||
--          '/tenders/' || tender_id::text || '/%')
--
-- A plain SQL LIKE '<prefix>/%' only requires the string to START WITH the
-- prefix - it places no restriction at all on what comes after, including a
-- literal "../" or "//" segment. Every true sibling constraint in this
-- family carries at least a "not like '%..%'" guard (0032, pre-Finding-214)
-- and, after Finding 214, a path-SEGMENT regex (tt_own_path/tt_path_in_company
-- /0032/0045/0024 all now use '(^|/)\.\.(/|$)' plus 'not like ''%//%''') -
-- tender_answers alone has neither.
--
-- Reproduced directly in a disposable scratch Postgres (113 migrations, no
-- fix - engine/security/replay_schema.sh against real `main`, dropped
-- immediately after use), one company, one tender:
--   insert into tender_answers (company_id, tender_id, field_key,
--     storage_path, original_filename) values ('<company A>', '<tender>',
--     'upload:evil',
--     '<company A>/tenders/<tender>/../../<company B>/secret.pdf', 'x') -
--   SUCCEEDED (no constraint violation). The row's own storage_path string
--   literally names a path outside company A's own folder while still
--   satisfying the LIKE prefix check, because '%' matches anything,
--   traversal segments included.
--
-- Real-world reach: engine/general/process_general_jobs.py's own
-- gather_pack_inputs() reads tender_answers rows for field_key
-- 'upload:<key>' and downloads each storage_path from the (private)
-- 'company-documents' bucket WITH THE SERVICE ROLE (no Storage RLS for that
-- key - same already-documented reason tt_own_path/own_path() exist
-- everywhere else in this codebase), after its own Python-side own_path()
-- guard. That Python guard independently blocks a literal ".." substring
-- today, so this specific consumer is not currently exploitable - but the
-- DATABASE should not be the one piece of this family relying solely on a
-- downstream caller's own defense-in-depth check to catch what every true
-- sibling's own CHECK constraint already catches first, especially since
-- Supabase PostgREST lets ANY authenticated company member write
-- tender_answers.storage_path directly (0018's own "tenant isolation"
-- policy, is_company_member(company_id) - no narrower check on the column's
-- own content). Fixed the same way, not the stricter substring shape
-- Finding 35/214 just finished moving away from.
--
-- Fix: replace the bare LIKE prefix check with the same path-SEGMENT
-- traversal guard Finding 214 standardised on, plus the "//" guard every
-- true sibling except the pre-Finding-214 0032 already carried. A genuine
-- traversal segment ("co1/tenders/t1/../../co2/x.pdf", "co1/tenders/t1/..",
-- "../co1/tenders/t1/x.pdf") is still rejected; an ordinary filename that
-- merely contains ".." as a substring ("co1/tenders/t1/abc-Report..Final.pdf")
-- is not - matching app/lib/safeFileName.ts's own allowed character set,
-- which keeps '.' (so "Report..Final.pdf" is a legitimate upload name, same
-- shape Finding 214's own write-up already demonstrated for its other 9
-- sites).
alter table tender_answers drop constraint tender_answers_check2;
alter table tender_answers add constraint tender_answers_check2 check (
  storage_path is null
  or (storage_path like company_id::text || '/tenders/' || tender_id::text || '/%'
      and storage_path !~ '(^|/)\.\.(/|$)'
      and storage_path not like '%//%')
);
