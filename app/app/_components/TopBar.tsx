"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AvatarMenu } from "./AvatarMenu";
import { NotificationsBell } from "./NotificationsBell";
import { CommandPalette } from "./CommandPalette";
import type { AppNotification } from "@/lib/notifications";

export function TopBar({
  userEmail,
  companyName,
  isPlatformAdmin,
  isEmployee,
  notifications,
  notificationsError = false,
}: {
  userEmail: string | null;
  companyName: string | null;
  isPlatformAdmin: boolean;
  isEmployee: boolean;
  notifications: AppNotification[];
  notificationsError?: boolean;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="size-11 md:size-9" />
      <Button
        variant="outline"
        size="sm"
        className="h-11 flex-1 justify-start gap-2 text-muted-foreground sm:max-w-80 md:h-9"
        onClick={() => setPaletteOpen(true)}
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Jump to a page or tender...</span>
        <span className="sm:hidden">Search</span>
        <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {companyName && <div className="hidden max-w-40 truncate text-sm font-medium text-foreground md:block">{companyName}</div>}
        <NotificationsBell notifications={notifications} hasError={notificationsError} />
        <AvatarMenu email={userEmail} isEmployee={isEmployee} />
      </div>
      <CommandPalette isPlatformAdmin={isPlatformAdmin} isEmployee={isEmployee} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
