import CidbGradeClient from "./CidbGradeClient";

export const metadata = {
  title: "CIDB Grade Calculator — Tender Ready",
  description:
    "Look up the CIDB contractor grade a South African tender's value requires, and check whether the grade you hold is enough to bid. Free, no signup needed.",
};

export default function Page() {
  return <CidbGradeClient />;
}
