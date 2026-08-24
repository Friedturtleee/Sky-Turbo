import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Crashing" };

export default function CrashingPage() {
  return <><PageHeader page="crashing" live /><MarketDashboard crashingOnly /></>;
}
