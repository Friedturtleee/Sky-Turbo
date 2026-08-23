import type { Metadata } from "next";
import { CraftDashboard } from "@/components/craft-dashboard";

export const metadata: Metadata = { title: "Craft Flip" };

export default function CraftsPage() {
  return <><header className="page-header"><div><span className="eyebrow">Crafting intelligence</span><h1>Craft Flip</h1><p>以最新 SkyBlock 合成配方比較 Buy Order、Instant Buy、Sell Order 與 Instant Sell 四種策略的單次合成利潤。</p></div><span className="live-pill"><i />LIVE</span></header><CraftDashboard /></>;
}
