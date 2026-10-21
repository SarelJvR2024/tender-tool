import BeePreferencePointsClient from "./BeePreferencePointsClient";

export const metadata = {
  title: "B-BBEE Preference Points Calculator — Tender Ready",
  description:
    "Work out the actual 80/20 or 90/10 PPPFA preference points for your tender price and B-BBEE status level, per the Preferential Procurement Regulations, 2022. Free, no signup needed.",
};

export default function Page() {
  return <BeePreferencePointsClient />;
}
