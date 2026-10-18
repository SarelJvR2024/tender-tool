-- Sarel's answers to the open questions of the audit Q3/Q5 pass
-- (Discipline-Taxonomy-Findings.md §7 O1, O2, O4; Hardcoded-Assumptions-Audit.md
-- §10), 2026-10-17. Evidence: Discipline-Taxonomy-Findings.md §8.
-- (Numbered 0054: 0044-0053 are taken or claimed by other passes.)
--
-- 1. Who may edit the shared list: a platform admin (0043 platform_admins /
--    is_platform_admin() - Tender Tool's own staff, not any company owner).
--    The owner of any customer company must not be able to rename or retire
--    categories under every other company.
--
-- 2. discipline_categories (0040) becomes writable by a platform admin from
--    the app (/admin/taxonomy), not only by the service role / CLI
--    (engine/discovery/taxonomy.py add). Insert and update only - a category
--    is retired with active = false, never deleted, so stored tags keep their
--    label. The two-level trigger from 0040 still applies to every writer.
--
-- 3. discipline_category_suggestions - a company's own custom experience tag
--    (0036: any lower-case slug) offered for the SHARED list. Sarel: "don't
--    auto-promote, Sarel reviews first." A company member files a pending
--    suggestion for their own company; only a platform admin approves or
--    rejects it. Approving (approve_discipline_suggestion) creates the
--    category with the SAME slug, so the company's existing tags become a
--    listed category with no change to their data - the same "adding the
--    slug later makes it listed" rule 0040 documents.
--
-- 4. (Not here: SACAP / SACPLAN / SACQSP / SACPVP / PSIRA, audit O4. They
--    are held through the shared registrations catalog of 0050
--    (registration_types + held_registrations, one home per fact); the
--    app shows them on the People page only when a tender asks for that
--    body - app/lib/personCredentials.ts. No people columns are added.)
--
-- 5. discovered_opportunities: the buyer's own eTenders category (audit O1).
--    Discovery reads the OCDS feed, which has only goods/services/works. The
--    eTenders site's own "Category" (the 91-entry dropdown the buyer picks
--    from) is now read alongside and stored as a CROSS-CHECK on Tender
--    Tool's own categories - never instead of them (same spirit as CIDB
--    classes being a cross-reference, not the list).

-- 2 ---------------------------------------------------------------------------
create policy "discipline_categories: platform admins insert" on discipline_categories
  for insert to authenticated with check (is_platform_admin());
create policy "discipline_categories: platform admins update" on discipline_categories
  for update to authenticated using (is_platform_admin()) with check (is_platform_admin());
-- No delete policy for anyone but the service role: retire with active = false.

-- 0040's trigger stops a row's PARENT being a child; now that the list is
-- edited from a screen, also stop a group that has disciplines being moved
-- under another group (its disciplines would become a third level).
create or replace function discipline_categories_no_third_level()
returns trigger
language plpgsql
as $$
begin
  if new.parent_slug is not null and exists (
    select 1 from discipline_categories c where c.parent_slug = new.slug
  ) then
    raise exception 'discipline_categories: % has disciplines of its own - it must stay a group (two levels only)', new.slug;
  end if;
  return new;
end;
$$;
create trigger discipline_categories_no_third_level
  before insert or update on discipline_categories
  for each row execute function discipline_categories_no_third_level();

-- 3 ---------------------------------------------------------------------------
create table discipline_category_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null check (length(trim(label)) > 0),
  suggested_parent_slug text references discipline_categories(slug) on update cascade on delete set null,
  note text,
  -- the Experience Library item the tag was suggested from (0012), so Sarel
  -- can see what the company used it for
  example_item_id uuid references experience_items(id) on delete set null,
  -- Snapshots for the reviewer, filled by the trigger (never by the
  -- client): a platform admin can't read another company's companies /
  -- experience_items rows under RLS, and shouldn't need to. The suggesting
  -- page says these two are shared with the reviewer.
  company_name text,
  example_project_name text,
  suggested_by uuid default auth.uid(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_category_slug text references discipline_categories(slug) on update cascade on delete set null,
  created_at timestamptz not null default now()
);
comment on table discipline_category_suggestions is
  'A company''s own experience tag (0036) suggested for the shared discipline_categories list (audit O2). Pending until a platform admin approves (creates the category, same slug) or rejects it. Never auto-promoted.';
create unique index discipline_category_suggestions_one_pending
  on discipline_category_suggestions (company_id, slug) where status = 'pending';
create index discipline_category_suggestions_status on discipline_category_suggestions (status, created_at);

-- The example item must be the suggesting company's own (a member of A can't
-- point a suggestion at B's experience item - same rule as 0043's
-- cross-company references), and a suggestion for a slug already on the list
-- is refused (nothing to promote).
create or replace function discipline_category_suggestions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.example_item_id is not null and not exists (
    select 1 from experience_items e where e.id = new.example_item_id and e.company_id = new.company_id
  ) then
    raise exception 'discipline_category_suggestions: example item is not this company''s';
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from discipline_categories c where c.slug = new.slug) then
      raise exception 'discipline_category_suggestions: % is already on the shared list', new.slug;
    end if;
    new.company_name := (select legal_name from companies where id = new.company_id);
    new.example_project_name := (select project_name from experience_items where id = new.example_item_id);
  else
    -- review never rewrites what was suggested, or by whom
    new.company_id := old.company_id;
    new.slug := old.slug;
    new.company_name := old.company_name;
    -- (example_item_id may only go to null: the item's own deletion, "on
    -- delete set null")
    if new.example_item_id is not null then
      new.example_item_id := old.example_item_id;
    end if;
    new.example_project_name := old.example_project_name;
    new.suggested_by := old.suggested_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger discipline_category_suggestions_guard
  before insert or update on discipline_category_suggestions
  for each row execute function discipline_category_suggestions_guard();

alter table discipline_category_suggestions enable row level security;
create policy "suggestions: members and platform admins read" on discipline_category_suggestions
  for select to authenticated using (is_company_member(company_id) or is_platform_admin());
create policy "suggestions: members suggest for their company" on discipline_category_suggestions
  for insert to authenticated with check (
    is_company_member(company_id)
    and status = 'pending'
    and suggested_by = auth.uid()
    and reviewed_by is null and reviewed_at is null and review_note is null and created_category_slug is null
  );
create policy "suggestions: members withdraw a pending one" on discipline_category_suggestions
  for delete to authenticated using (is_company_member(company_id) and status = 'pending');
create policy "suggestions: platform admins review" on discipline_category_suggestions
  for update to authenticated using (is_platform_admin()) with check (is_platform_admin());

-- Approve in one transaction: create the category (same slug as the tag, so
-- the company's tagged items need no change), mark the suggestion approved.
-- Security invoker: the caller's own RLS applies to both writes, so only a
-- platform admin can do it (checked first for a clear message).
create or replace function approve_discipline_suggestion(
  p_suggestion_id uuid,
  p_label text,
  p_parent_slug text,
  p_keywords text[] default '{}',
  p_exclude_keywords text[] default '{}',
  p_review_note text default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  s discipline_category_suggestions;
  next_order integer;
begin
  if not is_platform_admin() then
    raise exception 'Only a platform admin can approve a suggested category.';
  end if;
  select * into s from discipline_category_suggestions where id = p_suggestion_id for update;
  if s.id is null then
    raise exception 'Suggestion not found.';
  end if;
  if s.status <> 'pending' then
    raise exception 'This suggestion was already %.', s.status;
  end if;
  select coalesce(max(sort_order), 0) + 10 into next_order from discipline_categories;
  insert into discipline_categories (slug, label, parent_slug, sort_order, keywords, exclude_keywords, added_from)
  values (s.slug, coalesce(nullif(trim(p_label), ''), s.label), nullif(p_parent_slug, ''), next_order,
          coalesce(p_keywords, '{}'), coalesce(p_exclude_keywords, '{}'),
          'company suggestion ' || s.id::text || ', approved in /admin/taxonomy');
  update discipline_category_suggestions
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_review_note, '')), ''), created_category_slug = s.slug
   where id = s.id;
  return s.slug;
end;
$$;

-- 5 ---------------------------------------------------------------------------
alter table discovered_opportunities
  add column etenders_category text,
  add column etenders_category_check jsonb;
comment on column discovered_opportunities.etenders_category is
  'The buyer''s own category on the eTenders site (Home/PaginatedTenderOpportunities "category", the 91-entry dropdown), joined on the OCDS ocid''s site id. A cross-reference only - categories (Tender Tool''s own taxonomy) is what fit scoring uses. Null = not read (site unreachable, or a release not on the site''s advertised list).';
comment on column discovered_opportunities.etenders_category_check is
  'How the buyer''s eTenders category compares with Tender Tool''s categories (engine/discovery/taxonomy.py etenders_crosscheck): {status: agrees|differs|unmapped|generic, site_category, matching_categories[], note}.';
