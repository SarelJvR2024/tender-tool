"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Shared by AvatarMenu (the app shell's topbar account menu) - there was no
// way to sign out anywhere in the app before this (found by a live
// walkthrough, 2026-10-19).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
