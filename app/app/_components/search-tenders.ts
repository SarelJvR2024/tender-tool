"use server";

import { createClient } from "@/lib/supabase/server";

export type TenderSearchResult = {
  id: string;
  contract_no: string | null;
  description: string | null;
};

/**
 * Backs the command palette's tender search - contract numbers aren't
 * sequential or memorable, so "type part of it, jump straight there" only
 * works with a real query, not a client-side filter over a list that might
 * not even be loaded on the current page.
 *
 * Standing solution-architect review, 2026-11-06 (from-scratch read, not a
 * grep hit): used to return a bare `[]` on a failed read, identical to the
 * genuine "no tender matches this query" case - CommandPalette.tsx showed
 * "Nothing found." either way. Low severity (a search convenience, not a
 * compliance gate), but the same false-all-clear shape this sweep looks
 * for, so the caller now gets `error` to show a distinct message on a real
 * read failure instead of implying the tender doesn't exist.
 */
export async function searchTenders(query: string): Promise<{ results: TenderSearchResult[]; error: boolean }> {
  const q = query.trim();
  if (q.length < 2) return { results: [], error: false };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenders")
    .select("id, contract_no, description")
    .or(`contract_no.ilike.%${q}%,description.ilike.%${q}%`)
    .order("closing_date", { ascending: true })
    .limit(8);

  if (error) {
    console.error("tenders search failed for command palette", error);
    return { results: [], error: true };
  }
  return { results: data ?? [], error: false };
}
