-- Finding 280: tender_folder_readable()/tt_template_object_readable() -
-- the 'tender-documents' bucket's one remaining non-manual/non-private read
-- branch - both fail OPEN for the real-world object shape this bucket
-- actually holds, not just a hypothetical/legacy edge case (Sarel,
-- 2026-11-09).
--
-- The prior standing note on this function ("default-allow-on-no-match
-- shape", 2026-11-09z) concluded it was safe today because (a) it's only
-- reachable via a deleted `tenders` row, which no production code path ever
-- does, and (b) even then a second, independent gate
-- (tt_template_object_readable(), relying on tender_documents' FK cascade)
-- would still deny. Both of those are true for the SCENARIO that pass
-- considered - but neither function was checked against the actual folder
-- name shape engine/general/process_general_jobs.py's own
-- _template_storage_path() produces for every real SANRAL-registered shared
-- tender in production TODAY, which this migration does, live, against a
-- scratch Postgres with every migration replayed:
--
--   _template_storage_path(): for any tender that isn't a manually-loaded
--   private one, the blank-template object is stored at
--     f"{tender.get('slug') or tender['id']}/{doc_type}{ext}"
--   i.e. keyed by the tender's own SLUG (a human-readable SANRAL reference,
--   e.g. "sanral-r396-010-2025-1f" - `slug` is a real, always-truthy string
--   for every SANRAL-sourced release, engine/discovery/gov_sources.py), not
--   its uuid `id`. This is the NORMAL, every-time path for every shared
--   tender's buyer-published templates, not an edge case.
--
--   Two bugs, independently, make BOTH of the real policy's gates vacuous
--   for this exact (real, current) object shape:
--
--   1. tender_folder_readable(p_folder) does
--      `select not exists (select 1 from tenders t where t.id::text = p_folder
--       and t.owner_company_id is not null and not is_company_member(...))`.
--      A slug never equals the tender's own id as text, so the `exists`
--      clause can never match for one of these objects - the function
--      returns true (allow) unconditionally, REGARDLESS of whether the
--      tender is shared or private. Confirmed live: calling it directly with
--      a real slug returns `t` with no auth context at all.
--
--   2. tt_template_object_readable(p_name) does
--      `select coalesce((storage.foldername(p_name))[2], '') not in (five
--       doc types) or exists (select 1 from tender_documents ...)` - written
--      assuming the pre-0045 THREE-level shape `<tender_id>/<doc_type>/
--      <file>` (0025's own documented scheme), where index [2] is the doc
--      type. But the real path above is only TWO levels
--      (`<slug-or-id>/<doc_type><ext>` - the doc type is baked into the
--      FILENAME, there is no separate doc-type folder), so
--      `storage.foldername()` returns a ONE-element array and index [2] is
--      always null. `coalesce(null, '') not in (...)` is always true, so the
--      "is this a recognized template path" escape fires on EVERY such
--      object and the per-company `exists (...)` check - the one actually
--      meant to gate it - never runs at all. Confirmed live:
--      tt_template_object_readable() on a real such path returns `t`
--      unconditionally too.
--
-- Live-demonstrated end to end (not reasoned from source alone), against
-- engine/security/replay_schema.sh's own scratch schema: seeded a real
-- shared tender with a real slug and its service-role-registered blank
-- template (company_id null, exactly as register_sanral_tender() writes
-- it), confirmed a total-stranger company reads it through the REAL storage
-- policy (correct - it's a shared tender, meant to be open) - then flipped
-- `owner_company_id` on the SAME tender/object to simulate it being a
-- private one (today, no production code path can reach this combination,
-- because owner_company_id is only ever set by load_manual_tender(), which
-- always sets source='manual' in the same insert, and
-- _template_storage_path()'s `if tender.get("source") == "manual" and
-- tender.get("owner_company_id")` branch always routes a manual tender's
-- own templates through the DIFFERENT, correctly-gated 'manual/<company>/
-- <tender>/intake/' three-level path instead - so this exact combination
-- genuinely cannot occur today) - and the SAME stranger company could STILL
-- read the object, unchanged, after the flip. So today's real-world safety
-- for this object family rests entirely on one Python-level invariant in
-- _template_storage_path()/load_manual_tender() holding - not on either of
-- the two SQL-level gates the real storage policy actually ANDs together,
-- both of which turn out to be structurally vacuous for the one shape that
-- matters. One future change to that single `if` (or a new code path that
-- sets owner_company_id some other way) would silently leak a private
-- tender's confidential intake template to every authenticated user, with no
-- test failure and no RLS policy actually in the way.
--
-- Fix, both gates tightened to fail CLOSED and to match the real shape:
--
--   tender_folder_readable(): requires a MATCHING tenders row (by id OR
--   slug - real folder names are one or the other) that is either shared or
--   one the caller is a member of. No match at all -> deny, not allow.
--
--   tt_template_object_readable(): drops the doc-type-folder-depth sniff
--   entirely (it was always wrong for the real 2-level shape, and even where
--   it happened to be right it was only ever an unnecessary escape hatch -
--   every legitimate writer into this bucket namespace
--   (register_tender_document() / register_sanral_tender(), confirmed by
--   grepping every write into this bucket outside manual/private) always
--   pairs the storage object with a tender_documents row at the identical
--   storage_path, so requiring that row to exist and be visible is a strict
--   tightening with no regression on any real current path.
--
-- Reproduced before and shown closed after by
-- engine/security/test_tenant_isolation.py's own [17] shared-templates case,
-- widened by this same change to cover the real slug-keyed folder name on a
-- PRIVATE tender (the shape the prior write-up's own probe, using the
-- tender's raw id instead of its real slug, happened to miss).

create or replace function tender_folder_readable(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from tenders t
    where (t.id::text = p_folder or t.slug = p_folder)
      and (t.owner_company_id is null or is_company_member(t.owner_company_id))
  );
$$;

comment on function tender_folder_readable(text) is
  'True only when p_folder names a real tenders row (by id OR slug - real
   Storage folder names for this bucket''s one non-manual/non-private branch
   are keyed by whichever _template_storage_path() used, usually the slug,
   never both) that is shared or one the caller is a member of. Fails
   CLOSED (0140): a folder that matches no tenders row at all is denied, not
   allowed - the prior fails-OPEN shape (0032) was unexploited only because
   every private tender''s own templates take a different, correctly-gated
   storage path (see this migration''s own header); this closes the gap
   structurally rather than relying on that one Python-level invariant
   alone.';

create or replace function tt_template_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from tender_documents d
                 where d.storage_path = p_name
                   and (d.company_id is null or is_company_member(d.company_id)));
$$;

comment on function tt_template_object_readable(text) is
  'True only when a tender_documents row exists at this exact storage_path
   and is visible to the caller (the shared buyer-published copy, or the
   caller''s own company''s copy). 0140: dropped the prior "skip the check
   when this does not look like a <tender_id>/<doc_type>/<file> path"
   escape - it assumed a three-level folder shape that
   _template_storage_path() (engine/general/process_general_jobs.py) does
   not actually use (the real shape is two-level,
   <slug-or-id>/<doc_type><ext>, so the escape''s own folder-depth check was
   always vacuously true for every real object here, skipping the per-company
   check entirely). Every legitimate writer into this bucket outside
   manual/private always pairs the object with a matching tender_documents
   row at the identical path, so requiring one unconditionally is a strict
   tightening, not a behavior change for any real path.';
