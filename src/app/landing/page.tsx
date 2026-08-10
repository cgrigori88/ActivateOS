import type { Metadata } from "next";
import "./landing.css";
import { Landing } from "./Landing";

/**
 * Public marketing page. Excluded from the Basic Auth gate in middleware.ts —
 * it holds no customer data and reads nothing from the database.
 */

export const metadata: Metadata = {
  title: "PursuitOS — Know where revenue moves next.",
  description:
    "PursuitOS scores the intersection of customer, product, partner, seller and timing, then assembles the motion to pursue it.",
  openGraph: {
    title: "PursuitOS — Know where revenue moves next.",
    description:
      "PursuitOS scores the intersection of customer, product, partner, seller and timing, then assembles the motion to pursue it.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function LandingPage() {
  return <Landing />;
}
