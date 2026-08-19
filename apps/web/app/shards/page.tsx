import type { Metadata } from "next";
import { ShardDashboard } from "@/components/shard-dashboard";

export const metadata: Metadata = { title: "Shard Flip" };
export default function ShardsPage() {
  return <><header className="page-header"><div><span className="eyebrow">Fusion intelligence</span><h1>Shard Flip</h1><p>從完整 Fusion Lines 求出最低投入成本，並比較四種下單／即時成交策略。</p></div></header><ShardDashboard /></>;
}

