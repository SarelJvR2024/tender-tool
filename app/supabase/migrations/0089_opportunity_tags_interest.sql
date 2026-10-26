-- Company-defined opportunity tags + quick interest/decline marking (Sarel's
-- own live feedback on /discovery, 2026-10-22: "allow the company to add
-- tags for how to search and prioritise opportunities. add quick tags to
-- indicate interest or declines."). Schema approved by Sarel - this is the
-- real feature, replacing the browser-only localStorage preview this PR
-- shipped earlier (lib/opportunityTagsPreview.ts / OpportunityQuickActions).

alter table discovered_opportunities
  add column if not exists company_tags text[] not null default '{}';
alter table discovered_opportunities
  add column if not exists interest_marker text check (interest_marker in ('interested', 'declined'));
alter table discovered_opportunities
  add column if not exists interest_marked_at timestamptz;
alter table discovered_opportunities
  add column if not exists interest_marked_by uuid references auth.users(id);

create index if not exists discovered_opportunities_company_tags_idx
  on discovered_opportunities using gin (company_tags);
create index if not exists discovered_opportunities_interest_marker_idx
  on discovered_opportunities (interest_marker) where interest_marker is not null;

comment on column discovered_opportunities.company_tags is
  'Free-text tags the company itself defines, for their own search/filter/prioritisation on the Opportunities page - not a shared taxonomy like tenders.industry_tags (0060), and not used by the fit-scoring engine.';
comment on column discovered_opportunities.interest_marker is
  'A company-level quick mark - interested or declined - distinct from the engine-computed verdict column. Null = not marked.';

-- Writes: discovered_opportunities has no client UPDATE policy (0004's own
-- header comment - "service-role written"; confirmed again here by reading
-- every migration that touches its RLS before writing this one) - only a
-- members-can-select SELECT policy exists. Every prior write to this table
-- from the app (0048 accept_tender_update_date, 0055
-- acknowledge_discovery_downgrade) goes through a SECURITY DEFINER function
-- that checks is_company_member() itself, never a direct
-- supabase.from(...).update(). These two follow the exact same shape - no
-- new RLS policy is added (none is needed, and a blanket company-scoped
-- UPDATE policy would be a bigger surface than these two narrow, column-
-- specific writes need).

create or replace function set_opportunity_tag(p_opportunity_id uuid, p_tag text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  opp discovered_opportunities%rowtype;
  tag text;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if p_action not in ('add', 'remove') then
    raise exception 'Invalid action - must be add or remove.';
  end if;

  -- Same normalisation the client already applies (trim, lowercase, collapse
  -- internal whitespace) - repeated here so a direct RPC call (or a future
  -- caller that forgets to normalise) can't silently create a near-duplicate
  -- tag that only differs in case/spacing.
  tag := regexp_replace(btrim(lower(p_tag)), '\s+', ' ', 'g');
  if tag = '' then
    raise exception 'Tag cannot be empty.';
  end if;

  if p_action = 'add' then
    if not (tag = any(opp.company_tags)) then
      update discovered_opportunities set company_tags = array_append(opp.company_tags, tag) where id = p_opportunity_id;
    end if;
  else
    update discovered_opportunities set company_tags = array_remove(opp.company_tags, tag) where id = p_opportunity_id;
  end if;
end;
$$;

revoke all on function set_opportunity_tag(uuid, text, text) from public, anon;
grant execute on function set_opportunity_tag(uuid, text, text) to authenticated;

create or replace function set_opportunity_interest(p_opportunity_id uuid, p_marker text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  opp discovered_opportunities%rowtype;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if p_marker is not null and p_marker not in ('interested', 'declined') then
    raise exception 'Invalid interest marker - must be interested, declined, or null.';
  end if;

  update discovered_opportunities
     set interest_marker = p_marker,
         interest_marked_at = case when p_marker is null then null else now() end,
         interest_marked_by = case when p_marker is null then null else auth.uid() end
   where id = p_opportunity_id;
end;
$$;

revoke all on function set_opportunity_interest(uuid, text) from public, anon;
grant execute on function set_opportunity_interest(uuid, text) to authenticated;
