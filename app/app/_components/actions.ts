"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Used by AppSidebar's own account menu (moved here from the topbar in the
// Phase 2 nav restructure, 2026-10-23) - there was no way to sign out
// anywhere in the app before this (found by a live walkthrough, 2026-10-19).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
