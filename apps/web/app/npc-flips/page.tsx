import type { Metadata } from "next";
import { NpcFlipDashboard } from "@/components/npc-flip-dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "NPC Flip" };

export default function NpcFlipPage() {
  return <><PageHeader page="npc" live /><NpcFlipDashboard /></>;
}
