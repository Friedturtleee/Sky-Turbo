import type { Metadata } from "next";
import { ShardDashboard } from "@/components/shard-dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Shard Flip" };
export default function ShardsPage() {
  return <><PageHeader page="shard" /><ShardDashboard /></>;
}
