import type { Metadata } from "next";
import { CraftDashboard } from "@/components/craft-dashboard";

export const metadata: Metadata = { title: "Craft Flip" };

export default function CraftsPage() {
  return <><header className="page-header"><div><span className="eyebrow">Crafting intelligence</span><h1>Craft Flip</h1><p>比較四種 Bazaar 策略的單次與深度總利潤，並規劃最大獲利或至少 80% Max Profit 所需的完整原料數量。</p></div><span className="live-pill"><i />LIVE</span></header><CraftDashboard /></>;
}
