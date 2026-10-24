"use client"

import { useId, useState } from "react"
import { CalendarIcon } from "lucide-react"
import { format, isValid, parse } from "date-fns"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Button } from "./button"
import { cn } from "cn"

// South African date input (Batch 2B follow-up): a native <input type="date">
// always submits ISO yyyy-mm-dd, but its DISPLAYED order follows the
// visitor's own browser locale, not anything this app's code controls
// (confirmed empirically in PR #141 - <html lang="en-ZA"> does not change it).
// This replaces the native control with a plain text field (typed input and
// calendar clicks both forced through the same dd/MM/yyyy parsing/formatting,
// so neither path can disagree) plus a Popover + Calendar for picking a date
// visually. The real value handed to the rest of the app - the form field
// `name` for a plain <form action={serverAction}> (uncontrolled), or
// `onChange` for a React-controlled field (e.g. the Quick Blocker drawer) -
// is always ISO yyyy-mm-dd, same as the native input it replaces.
const DISPLAY_FORMAT = "dd/MM/yyyy"
const ISO_FORMAT = "yyyy-MM-dd"

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined
  const d = parse(iso, ISO_FORMAT, new Date())
  return isValid(d) ? d : undefined
}

function dateToIso(d: Date): string {
  return format(d, ISO_FORMAT)
}

function dateToDisplay(d: Date): string {
  return format(d, DISPLAY_FORMAT)
}

/** A real, complete dd/MM/yyyy date - not just "parseable" (date-fns rolls an
 * out-of-range day/month over into the next month rather than rejecting it,
 * e.g. "31/02/2026" silently becomes 3 March), so the formatted round trip
 * must match the typed text exactly. */
function parseStrict(text: string): Date | null {
  if (text.length !== DISPLAY_FORMAT.length) return null
  const parsed = parse(text, DISPLAY_FORMAT, new Date())
  return isValid(parsed) && dateToDisplay(parsed) === text ? parsed : null
}

export function DateField({
  id,
  name,
  defaultValue,
  value,
  onChange,
  required,
  disabled,
  className,
}: {
  id?: string
  /** Set for a plain <form action={serverAction}> submission (uncontrolled) - renders a matching hidden input. */
  name?: string
  /** ISO yyyy-mm-dd initial value, uncontrolled mode. */
  defaultValue?: string
  /** ISO yyyy-mm-dd, controlled mode (with `onChange`) - e.g. the Quick Blocker drawer's own field state. */
  value?: string
  onChange?: (isoValue: string) => void
  required?: boolean
  disabled?: boolean
  className?: string
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  const isControlled = value !== undefined
  const [isoUncontrolled, setIsoUncontrolled] = useState(defaultValue ?? "")
  const iso = isControlled ? value : isoUncontrolled
  const [text, setText] = useState(() => {
    const d = isoToDate(iso ?? "")
    return d ? dateToDisplay(d) : ""
  })
  const [open, setOpen] = useState(false)

  function commitIso(nextIso: string) {
    // Uncontrolled (no `value` prop) keeps its own display state, same as a
    // native <input defaultValue>; `onChange` still fires either way, so a
    // parent that only wants a side-channel copy (e.g. the Quick Blocker
    // drawer's own `values` state, submitted later on "Save") gets it
    // without having to also drive this field's displayed value.
    if (!isControlled) setIsoUncontrolled(nextIso)
    onChange?.(nextIso)
  }

  function handleTextChange(raw: string) {
    setText(raw)
    if (raw === "") {
      commitIso("")
      return
    }
    const parsed = parseStrict(raw)
    if (parsed) commitIso(dateToIso(parsed))
    // Otherwise: still mid-typing (or invalid) - leave the committed value
    // alone until blur resolves it, rather than committing a bad date.
  }

  function handleBlur() {
    if (text === "") return // a cleared field is a valid, already-committed state
    if (!parseStrict(text)) {
      // Incomplete/invalid on blur - revert the TEXT to match the last real
      // committed value instead of leaving unparseable text on screen.
      const d = isoToDate(iso ?? "")
      setText(d ? dateToDisplay(d) : "")
    }
  }

  function handleCalendarSelect(date: Date | undefined) {
    if (!date) return
    setText(dateToDisplay(date))
    commitIso(dateToIso(date))
    setOpen(false)
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {name && <input type="hidden" name={name} value={iso ?? ""} />}
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        value={text}
        required={required}
        disabled={disabled}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleBlur}
        className="min-h-9 w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button type="button" variant="outline" size="icon" disabled={disabled} aria-label="Open calendar" />}
        >
          <CalendarIcon className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          {/* Keyed on `open` (found live, PR #144): react-day-picker only
              reads `defaultMonth` on its own first mount, so without
              remounting on every open, the calendar kept showing whatever
              month it happened to open to the very first time rather than
              navigating to the currently selected date. */}
          <Calendar key={open ? iso : "closed"} mode="single" selected={isoToDate(iso ?? "")} defaultMonth={isoToDate(iso ?? "") ?? new Date()} onSelect={handleCalendarSelect} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
