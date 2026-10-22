import Link from "next/link";
import { AppShell } from "../../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";
import BeePreferencePointsClient from "../../tools/bee-preference-points/BeePreferencePointsClient";

export const metadata = {
  title: "B-BBEE preference points calculator - Tender Ready",
};

export default function Page() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
        <Link href="/toolkit" className="text-sm text-muted-foreground no-underline">
          ← Tools
        </Link>
        <PageHeader title="B-BBEE preference points calculator" />
        <BeePreferencePointsClient embedded />
      </div>
    </AppShell>
  );
}
