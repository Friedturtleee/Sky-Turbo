import type { Metadata } from "next";
import { NpcFlipDashboard } from "@/components/npc-flip-dashboard";

export const metadata: Metadata = { title: "NPC Flip" };

export default function NpcFlipPage() {
  return <><header className="page-header"><div><span className="eyebrow">NPC shop → Bazaar / Auction House</span><h1>NPC Flip</h1><p>比較 NPC 商店的 coins 與材料成本，找出可出售到 Bazaar 或 Auction House 的價差；包含 Miria Coupon、Miria Prize 等多材料交易。</p></div><span className="live-pill"><i />LIVE</span></header><NpcFlipDashboard /></>;
}
