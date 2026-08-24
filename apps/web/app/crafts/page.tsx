import type { Metadata } from "next";
import { CraftDashboard } from "@/components/craft-dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Craft Flip" };

export default function CraftsPage() {
  return <><PageHeader page="craft" live /><CraftDashboard /></>;
}
