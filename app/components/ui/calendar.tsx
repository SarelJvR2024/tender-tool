"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, type DayPickerProps } from "react-day-picker"
import { enZA } from "date-fns/locale"
import { cn } from "cn"

// South African locale throughout (weekday/month names, Monday-first week) -
// matches the rest of this app's en-ZA date formatting (lib/dates.ts).
function Calendar({
  className,
  classNames,
  ...props
}: DayPickerProps) {
  return (
    <DayPicker
      locale={enZA}
      showOutsideDays
      className={cn("p-2.5", className)}
      classNames={{
        root: "w-fit",
        months: "flex flex-col gap-3",
        month: "flex flex-col gap-3",
        nav: "flex items-center justify-between absolute inset-x-0 top-0 px-1",
        button_previous: cn(
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        ),
        button_next: cn(
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        ),
        month_caption: "flex items-center justify-center pt-1 pb-2 text-sm font-semibold text-foreground",
        caption_label: "text-sm font-semibold text-foreground",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 text-center text-[11px] font-semibold text-muted-foreground",
        week: "flex w-full mt-1",
        day: "p-0 text-center",
        day_button: cn(
          "inline-flex size-8 items-center justify-center rounded-md text-sm font-normal text-foreground",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        ),
        today: "font-semibold text-accent",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90",
        outside: "text-muted-foreground/40",
        disabled: "text-muted-foreground/30 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
      }}
      {...props}
    />
  )
}

export { Calendar }
