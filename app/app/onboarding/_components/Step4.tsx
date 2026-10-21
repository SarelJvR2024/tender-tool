import { Upload, User } from "lucide-react";
import { WizardShell } from "./WizardShell";
import { Field, FormError } from "./fields";
import { addPersonStep, uploadPersonCvStep } from "../actions";
import { Button } from "@/components/ui/button";

const MAX_PEOPLE = 3;

type PersonRow = { id: string; name: string; role: string | null; hasCv: boolean };

export function Step4({ companyId, people, error }: { companyId: string; people: PersonRow[]; error?: string }) {
  const add = addPersonStep.bind(null, companyId);
  const upload = uploadPersonCvStep.bind(null, companyId);
  const atLimit = people.length >= MAX_PEOPLE;

  return (
    <WizardShell step={4} description="Add up to 3 key staff - their CVs can wait, or go straight in now.">
      <FormError message={error} />

      {people.length > 0 && (
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
                  <Button type="submit" size="sm" variant="outline">
                    <Upload className="size-3.5" />
                    Upload CV
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {atLimit ? (
        <p className="text-sm text-muted-foreground">You&apos;ve added {MAX_PEOPLE} people - add more any time from People &amp; CVs.</p>
      ) : (
        <form action={add} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field name="name" label="Full name" required />
            <Field name="role" label="Role" placeholder="e.g. Civil Engineer" />
          </div>
          <Button type="submit" variant="outline" className="h-11">
            Add this person
          </Button>
        </form>
      )}
    </WizardShell>
  );
}
