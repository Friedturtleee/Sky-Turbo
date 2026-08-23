import type { Metadata } from "next";
import { AhFlipDashboard } from "@/components/ah-flip-dashboard";

export const metadata: Metadata = { title: "AH Flip" };

export default function AhFlipsPage() {
  return <>
    <header className="page-header">
      <div>
        <span className="eyebrow">Auction intelligence</span>
        <h1>AH Flip</h1>
        <p>比較現有 BIN 售價、完整 NBT 規格估值與拍賣稅後收入；保留低信心機會，但以高風險標記清楚揭露。</p>
      </div>
      <span className="live-pill"><i />10s CHECK</span>
    </header>
    <AhFlipDashboard />
  </>;
}
