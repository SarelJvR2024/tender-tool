import DeadlineCalculatorClient from "./DeadlineCalculatorClient";

export const metadata = {
  title: "Working-Day Deadline Calculator — Tender Ready",
  description:
    "Add or count working days excluding weekends and South African public holidays, for tender closing dates, briefing notices and query deadlines. Free, no signup needed.",
};

export default function Page() {
  return <DeadlineCalculatorClient />;
}
