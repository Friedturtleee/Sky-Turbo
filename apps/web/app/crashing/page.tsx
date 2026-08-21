import type { Metadata } from "next";
import { MarketDashboard } from "@/components/market-dashboard";

export const metadata: Metadata = { title: "Crashing" };

export default function CrashingPage() {
  return <><header className="page-header"><div><span className="eyebrow">24h Buy Order alerts</span><h1>Crashing</h1><p>監控目前 Buy Order 相較 24 小時前跌幅超過 30% 的物品；Min Cost 預設為 1,000 coins。</p></div><span className="live-pill"><i />LIVE</span></header><MarketDashboard crashingOnly /></>;
}
