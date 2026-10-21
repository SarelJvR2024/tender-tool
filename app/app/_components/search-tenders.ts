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
 */
export async function searchTenders(query: string): Promise<TenderSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenders")
    .select("id, contract_no, description")
    .or(`contract_no.ilike.%${q}%,description.ilike.%${q}%`)
    .order("closing_date", { ascending: true })
    .limit(8);

  if (error) {
    console.error("tenders search failed for command palette", error);
    return [];
  }
  return data ?? [];
}
