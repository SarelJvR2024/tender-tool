"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AppNotification } from "@/lib/notifications";

export function NotificationsBell({
  notifications,
  hasError = false,
}: {
  notifications: AppNotification[];
  hasError?: boolean;
}) {
  const urgentCount = notifications.filter((n) => n.severity === "destructive").length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-11 md:size-9"
            aria-label={`Notifications${notifications.length ? ` (${notifications.length})` : ""}`}
          />
        }
      >
        <Bell />
        {notifications.length > 0 && (
          <span
            className={cn(
              "absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white",
              urgentCount > 0 ? "bg-destructive" : "bg-warning"
            )}
          >
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="font-display text-sm font-medium text-foreground">Notifications</div>
          <div className="text-xs text-muted-foreground">Expiring documents and tenders closing soon</div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {hasError ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load notifications right now. Try reloading the page.</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing needs your attention right now.</div>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                className="flex items-start gap-3 border-b border-border px-4 py-3 text-inherit no-underline last:border-b-0 hover:bg-muted/50"
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.severity === "destructive" ? "bg-destructive" : "bg-warning")} />
                <div className="min-w-0 flex-1">
                  <div title={n.title} className="line-clamp-2 text-sm font-medium break-words text-foreground">{n.title}</div>
                  <div className="text-xs text-muted-foreground">{n.detail}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
