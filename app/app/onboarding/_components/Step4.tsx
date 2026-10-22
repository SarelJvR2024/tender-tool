"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Upload, User, Loader2 } from "lucide-react";
import { WizardShell } from "./WizardShell";
import { Field, FormError } from "./fields";
import { addPersonStep, uploadPersonCvStep } from "../actions";
import { Button, buttonVariants } from "@/components/ui/button";

const MAX_PEOPLE = 3;

type PersonRow = { id: string; name: string; role: string | null; hasCv: boolean };

/**
 * Both of this step's Server Actions redirect back to `/onboarding?step=4&error=...`
 * on failure - one `error` string, no field key to say which of the two forms (add
 * person, upload CV) it came from. Routes on the message's own fixed wording
 * instead (every string actions.ts can send for this step is enumerated in its
 * addPersonStep/uploadPersonCvStep) so the error lands next to the form that
 * actually caused it, not a single banner at the top of the whole step.
 */
function isCvUploadError(message: string): boolean {
  return /\bcv\b|upload/i.test(message);
}

function AddPersonSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="h-11" disabled={pending}>
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {pending ? "Saving…" : "Add this person"}
    </Button>
  );
}

function UploadCvSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
      {pending ? "Saving…" : "Upload CV"}
    </Button>
  );
}

export function Step4({ companyId, people, error }: { companyId: string; people: PersonRow[]; error?: string }) {
  const add = addPersonStep.bind(null, companyId);
  const upload = uploadPersonCvStep.bind(null, companyId);
  const atLimit = people.length >= MAX_PEOPLE;

  // Split the one possible error message between the two forms it could have
  // come from, instead of one generic banner at the top of the step - see
  // isCvUploadError above.
  const cvError = error && isCvUploadError(error) ? error : undefined;
  const personError = error && !isCvUploadError(error) ? error : undefined;

  return (
    <WizardShell step={4} description="Add up to 3 key staff - their CVs can wait, or go straight in now.">
      {people.length > 0 && (
        <>
          <FormError message={cvError} />
          <ul className="mb-5 flex flex-col gap-2">
            {people.map((p) => (
              <li key={p.id} className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                  {p.role && <span className="text-xs text-muted-foreground">{p.role}</span>}
                </div>
                {p.hasCv ? (
                  <p className="mt-1.5 pl-6 text-xs text-success">CV on file</p>
                ) : (
                  <form action={upload} className="mt-2 flex items-center gap-2 pl-6">
                    <input type="hidden" name="person_id" value={p.id} />
                    <input type="file" name="file" accept=".pdf,.doc,.docx" required className="text-xs" />
                    <UploadCvSubmitButton />
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {atLimit ? (
        <p className="text-sm text-muted-foreground">You&apos;ve added {MAX_PEOPLE} people - add more any time from People &amp; CVs.</p>
      ) : (
        <form action={add} className="flex flex-col gap-4">
          <FormError message={personError} />
          <div className="grid grid-cols-2 gap-3">
            <Field name="name" label="Full name" required />
            <Field name="role" label="Role" placeholder="e.g. Civil Engineer" />
          </div>
          <AddPersonSubmitButton />
        </form>
      )}

      {people.length > 0 && (
        <Link href="/onboarding?step=5" className={buttonVariants({ className: "mt-4 h-11 w-full" })}>
          Continue
        </Link>
      )}
    </WizardShell>
  );
}
