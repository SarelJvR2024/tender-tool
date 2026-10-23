import { Progress } from "@/components/ui/progress";

const STEP_TITLES = ["Your company", "Add documents"];
export const TOTAL_STEPS = STEP_TITLES.length;

/**
 * Chrome shared by both onboarding screens (spec v3 §3: two short screens,
 * not a long wizard - this used to share 6 steps' worth of Back/Skip
 * plumbing; neither screen needs either now. Screen 1 creates the company,
 * so there's nothing to go back to; Screen 2 has its own explicit "Skip for
 * now" action in its own content, since skipping there means something
 * specific (go to Home) rather than "advance to the next step").
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
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Step {step} of {TOTAL_STEPS}
        </div>
        <Progress value={(step / TOTAL_STEPS) * 100} />
      </div>

      <h2 className="mb-1 font-display text-xl font-medium text-foreground">{title}</h2>
      {description && <p className="mb-6 text-sm text-muted-foreground">{description}</p>}
      {!description && <div className="mb-6" />}

      {children}
    </div>
  );
}
