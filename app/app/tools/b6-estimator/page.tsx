import B6EstimatorClient from "./B6EstimatorClient";

export const metadata = {
  title: "SANRAL B6 Functionality Score Estimator — Tender Tool",
  description:
    "Estimate a SANRAL Conventional Consultant key position's B6 functionality score from the real published Book 1 scoring matrices. Free, no signup needed.",
};

export default function Page() {
  return <B6EstimatorClient />;
}
