import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const STEP_TITLES = ["Company basics", "Compliance", "Where you work", "Your people", "What to bid on"];
export const TOTAL_STEPS = STEP_TITLES.length;

/**
 * Chrome shared by every wizard step: the progress bar, "Step N of 5", the
 * step's own title/description, a Back link (not shown on step 1 - nothing
 * to go back to), and a "Skip for now" link (not shown on step 1 either -
 * the prompt's own rule, since step 1 is what creates the company every
 * later step depends on). Each step supplies its own form and Continue
 * button as `children` - Continue's behavior (what it saves, where it goes)
 * differs enough per step that one shared button here would need as many
 * special cases as the steps themselves.
 */
export function WizardShell({
  step,
  description,
  children,
}: {
  step: number;
  description?: string;
  children: React.ReactNode;
}) {
  const title = STEP_TITLES[step - 1];
  return (
    <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 shadow-sm md:p-10">
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            Step {step} of {TOTAL_STEPS}
          </span>
          {step > 1 && (
            <Link href={`/onboarding?step=${step - 1}`} className="flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="size-3.5" />
              Back
            </Link>
          )}
        </div>
        <Progress value={(step / TOTAL_STEPS) * 100} />
      </div>

      <h1 className="mb-1 font-display text-xl font-medium text-foreground">{title}</h1>
      {description && <p className="mb-6 text-sm text-muted-foreground">{description}</p>}
      {!description && <div className="mb-6" />}

      {children}

      {step > 1 && (
        <Link
          href={step === TOTAL_STEPS ? "/onboarding?step=done" : `/onboarding?step=${step + 1}`}
          className="mt-4 inline-block text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </Link>
      )}
    </div>
  );
}
