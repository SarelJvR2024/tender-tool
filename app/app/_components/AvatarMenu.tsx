"use client";

import Link from "next/link";
import { LogOut, Lock, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "./actions";

function initialsOf(email: string | null): string {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

export function AvatarMenu({ email }: { email: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring md:size-9"
        aria-label="Account menu"
      >
        {initialsOf(email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {email && <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{email}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/company" />}>
          <User />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/privacy" />}>
          <Lock />
          Privacy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem render={<button type="submit" className="w-full" />} variant="destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
